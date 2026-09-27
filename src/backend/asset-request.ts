/**
 * Asset Request kernel (Image Asset Harness, T1).
 *
 * Task-scoped sub-resource for "Worker needs an image/asset" requests.
 * Owns its own state machine; NEVER mutates Task executionState/pmState.
 *
 * States: REQUESTED → ROUTED → GENERATING → DELIVERED | FAILED
 *          DELIVERED → VERIFIED | REWORK (REWORK → GENERATING, max 3 attempts)
 *
 * Storage: {dataRoot}/{project}/_relay/asset-requests/{assetId}/request.{json,md}
 * Idempotency: deterministic assetId = AST-<sha12(taskId|runId|kind|output_path|prompt)>.
 * Same request twice returns the existing record (free cache hit).
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { relayDir, writeJsonAtomic, getTask } from './goal-task.js';

export const ASSET_REQUEST_SCHEMA_VERSION = 1 as const;

export const ASSET_KINDS = [
  'hero_image',
  'og_image',
  'thumbnail',
  'diagram',
  'icon',
  'edit',
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_STATUSES = [
  'REQUESTED',
  'ROUTED',
  'GENERATING',
  'DELIVERED',
  'FAILED',
  'VERIFIED',
  'REWORK',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const PROMPT_SIZE_LIMIT_BYTES = 16 * 1024;
export const MAX_GENERATION_ATTEMPTS = 3;

export class AssetRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AssetRequestError';
    this.code = code;
  }
}

export interface AssetRequestInput {
  asset_kind: string;
  purpose: string;
  prompt: string;
  negative_prompt?: string;
  style?: string;
  aspect_ratio?: string;
  transparent_background?: boolean;
  output_path: string;
  reference_asset_ids?: string[];
  edit_target_asset_id?: string;
  count?: number;
  owner_task_id: string;
  requester_run_id: string;
  priority?: string;
  workspaceRoot: string;
}

export interface AssetRecord {
  schemaVersion: typeof ASSET_REQUEST_SCHEMA_VERSION;
  assetId: string;
  project: string;
  taskId: string;
  runId: string;
  assetKind: AssetKind;
  purpose: string;
  prompt: string;
  negativePrompt?: string;
  style?: string;
  aspectRatio?: string;
  transparentBackground: boolean;
  outputPath: string;
  referenceAssetIds: string[];
  editTargetAssetId?: string;
  count: number;
  priority: string;
  status: AssetStatus;
  backendId?: string;
  attempts: number;
  result?: {
    path: string;
    width?: number;
    height?: number;
    source: string;
  };
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

// ── paths ────────────────────────────────────────────────────────────────────

export function assetRequestsDir(dataRoot: string, project: string): string {
  return path.join(relayDir(dataRoot, project), 'asset-requests');
}

export function assetRequestFolder(dataRoot: string, project: string, assetId: string): string {
  return path.join(assetRequestsDir(dataRoot, project), assetId);
}

// ── validation ───────────────────────────────────────────────────────────────

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AssetRequestError('INVALID_ARGUMENT', `${field}이(가) 필요합니다.`);
  }
  return value.trim();
}

function resolveOutputPath(workspaceRoot: string, outputPath: string): string {
  const rel = requireNonEmpty(outputPath, 'output_path');
  if (path.isAbsolute(rel)) {
    throw new AssetRequestError('INVALID_ARGUMENT', 'output_path는 workspace 상대경로여야 합니다.');
  }
  const resolved = path.resolve(workspaceRoot, rel);
  const rootWithSep = workspaceRoot.endsWith(path.sep) ? workspaceRoot : workspaceRoot + path.sep;
  if (resolved !== workspaceRoot && !resolved.startsWith(rootWithSep)) {
    throw new AssetRequestError('INVALID_ARGUMENT', 'output_path가 workspace를 벗어납니다.');
  }
  return rel;
}

export function computeAssetId(input: {
  taskId: string;
  runId: string;
  asset_kind: string;
  output_path: string;
  prompt: string;
}): string {
  const digest = createHash('sha256')
    .update([input.taskId, input.runId, input.asset_kind, input.output_path, input.prompt].join('|'), 'utf8')
    .digest('hex')
    .slice(0, 12);
  return `AST-${digest}`;
}

function validateInput(input: AssetRequestInput): void {
  if (!(ASSET_KINDS as readonly string[]).includes(input.asset_kind)) {
    throw new AssetRequestError(
      'INVALID_ARGUMENT',
      `asset_kind는 [${ASSET_KINDS.join(', ')}] 중 하나여야 합니다.`,
    );
  }
  requireNonEmpty(input.purpose, 'purpose');
  const prompt = requireNonEmpty(input.prompt, 'prompt');
  if (Buffer.byteLength(prompt, 'utf8') > PROMPT_SIZE_LIMIT_BYTES) {
    throw new AssetRequestError('INVALID_ARGUMENT', 'prompt가 16 KiB를 초과합니다.');
  }
  if (input.aspect_ratio !== undefined && !/^\d{1,2}:\d{1,2}$/.test(input.aspect_ratio)) {
    throw new AssetRequestError('INVALID_ARGUMENT', 'aspect_ratio는 W:H 형식이어야 합니다.');
  }
  resolveOutputPath(requireNonEmpty(input.workspaceRoot, 'workspaceRoot'), input.output_path);
  requireNonEmpty(input.owner_task_id, 'owner_task_id');
  requireNonEmpty(input.requester_run_id, 'requester_run_id');
  const count = input.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new AssetRequestError('INVALID_ARGUMENT', 'count는 1..4 정수여야 합니다.');
  }
}

// ── read/write ───────────────────────────────────────────────────────────────

function readRecord(dataRoot: string, project: string, assetId: string): AssetRecord {
  const file = path.join(assetRequestFolder(dataRoot, project, assetId), 'request.json');
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new AssetRequestError('NOT_FOUND', `Asset Request를 찾을 수 없습니다: ${assetId}`);
  }
  const rec = raw as AssetRecord;
  if (rec.schemaVersion !== ASSET_REQUEST_SCHEMA_VERSION || rec.assetId !== assetId) {
    throw new AssetRequestError('INVALID_STATE', `Asset Request 무결성 오류: ${assetId}`);
  }
  return rec;
}

function persist(dataRoot: string, project: string, rec: AssetRecord): AssetRecord {
  const folder = assetRequestFolder(dataRoot, project, rec.assetId);
  fs.mkdirSync(folder, { recursive: true });
  rec.updatedAt = new Date().toISOString();
  writeJsonAtomic(path.join(folder, 'request.json'), rec);
  const md = [
    `# ${rec.assetId} (${rec.assetKind}, ${rec.status})`,
    '',
    `- purpose: ${rec.purpose}`,
    `- output: ${rec.outputPath}`,
    `- task/run: ${rec.taskId} / ${rec.runId}`,
    rec.result ? `- result: ${rec.result.path} (${rec.result.source})` : `- result: -`,
    rec.failureReason ? `- failure: ${rec.failureReason}` : '',
  ].filter(Boolean).join('\n') + '\n';
  fs.writeFileSync(path.join(folder, 'request.md'), md, 'utf8');
  return rec;
}

function cas(rec: AssetRecord, expected: AssetStatus | AssetStatus[], what: string): void {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(rec.status)) {
    throw new AssetRequestError(
      'CONFLICT',
      `expected=${allowed.join('|')} but found ${rec.status} (${what}).`,
    );
  }
}

// ── transitions ──────────────────────────────────────────────────────────────

export function createAssetRequest(
  dataRoot: string,
  project: string,
  input: AssetRequestInput,
): { record: AssetRecord; created: boolean } {
  validateInput(input);
  const assetId = computeAssetId({
    taskId: input.owner_task_id,
    runId: input.requester_run_id,
    asset_kind: input.asset_kind,
    output_path: input.output_path,
    prompt: input.prompt.trim(),
  });
  const folder = assetRequestFolder(dataRoot, project, assetId);
  if (fs.existsSync(path.join(folder, 'request.json'))) {
    return { record: readRecord(dataRoot, project, assetId), created: false };
  }
  const now = new Date().toISOString();
  const rec: AssetRecord = {
    schemaVersion: ASSET_REQUEST_SCHEMA_VERSION,
    assetId,
    project,
    taskId: input.owner_task_id,
    runId: input.requester_run_id,
    assetKind: input.asset_kind as AssetKind,
    purpose: input.purpose.trim(),
    prompt: input.prompt.trim(),
    negativePrompt: input.negative_prompt?.trim() || undefined,
    style: input.style?.trim() || undefined,
    aspectRatio: input.aspect_ratio?.trim() || undefined,
    transparentBackground: input.transparent_background ?? false,
    outputPath: input.output_path.trim(),
    referenceAssetIds: input.reference_asset_ids ?? [],
    editTargetAssetId: input.edit_target_asset_id?.trim() || undefined,
    count: input.count ?? 1,
    priority: input.priority?.trim() || 'normal',
    status: 'REQUESTED',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  return { record: persist(dataRoot, project, rec), created: true };
}

export function routeAssetRequest(
  dataRoot: string,
  project: string,
  assetId: string,
  backendId: string,
  expectedStatus: AssetStatus = 'REQUESTED',
): AssetRecord {
  const rec = readRecord(dataRoot, project, assetId);
  cas(rec, expectedStatus, 'route');
  if (!backendId.trim()) throw new AssetRequestError('INVALID_ARGUMENT', 'backendId가 필요합니다.');
  rec.backendId = backendId.trim();
  rec.status = 'ROUTED';
  return persist(dataRoot, project, rec);
}

export function markAssetGenerating(
  dataRoot: string,
  project: string,
  assetId: string,
  expectedStatus: AssetStatus | AssetStatus[] = ['ROUTED', 'REWORK'],
): AssetRecord {
  const rec = readRecord(dataRoot, project, assetId);
  cas(rec, expectedStatus, 'generate');
  rec.attempts += 1;
  rec.status = 'GENERATING';
  return persist(dataRoot, project, rec);
}

export function markAssetDelivered(
  dataRoot: string,
  project: string,
  assetId: string,
  result: { path: string; width?: number; height?: number; source: string },
  expectedStatus: AssetStatus = 'GENERATING',
): AssetRecord {
  const rec = readRecord(dataRoot, project, assetId);
  cas(rec, expectedStatus, 'deliver');
  if (!result.path || !result.source) {
    throw new AssetRequestError('INVALID_ARGUMENT', 'result.path/source가 필요합니다.');
  }
  rec.result = { ...result };
  rec.failureReason = undefined;
  rec.status = 'DELIVERED';
  return persist(dataRoot, project, rec);
}

export function markAssetFailed(
  dataRoot: string,
  project: string,
  assetId: string,
  reason: string,
  expectedStatus: AssetStatus | AssetStatus[] = ['REQUESTED', 'ROUTED', 'GENERATING', 'REWORK'],
): AssetRecord {
  const rec = readRecord(dataRoot, project, assetId);
  cas(rec, expectedStatus, 'fail');
  rec.failureReason = reason.slice(0, 2000);
  rec.status = 'FAILED';
  return persist(dataRoot, project, rec);
}

export function markAssetVerified(
  dataRoot: string,
  project: string,
  assetId: string,
  expectedStatus: AssetStatus = 'DELIVERED',
): AssetRecord {
  const rec = readRecord(dataRoot, project, assetId);
  cas(rec, expectedStatus, 'verify');
  rec.status = 'VERIFIED';
  return persist(dataRoot, project, rec);
}

export function requestAssetRework(
  dataRoot: string,
  project: string,
  assetId: string,
  reason: string,
  expectedStatus: AssetStatus = 'DELIVERED',
): AssetRecord {
  const rec = readRecord(dataRoot, project, assetId);
  cas(rec, expectedStatus, 'rework');
  if (rec.attempts >= MAX_GENERATION_ATTEMPTS) {
    rec.failureReason = `attempt budget exhausted (${rec.attempts}): ${reason}`.slice(0, 2000);
    rec.status = 'FAILED';
    return persist(dataRoot, project, rec);
  }
  rec.failureReason = reason.slice(0, 2000);
  rec.status = 'REWORK';
  return persist(dataRoot, project, rec);
}

export function workspaceRootForRun(
  dataRoot: string,
  project: string,
  taskId: string,
  runId: string,
): string {
  const task = getTask(dataRoot, project, taskId);
  const link = (task.linkedRuns || []).find((r) => r.runId === runId);
  if (!link) throw new AssetRequestError('NOT_FOUND', `runId '${runId}' is not linked.`);
  let meta: { workspaceRoot?: unknown };
  try {
    meta = JSON.parse(fs.readFileSync(path.join(link.folder, 'meta.json'), 'utf8'));
  } catch {
    throw new AssetRequestError('NOT_FOUND', `Run meta missing for runId '${runId}'.`);
  }
  if (typeof meta.workspaceRoot !== 'string' || !path.isAbsolute(meta.workspaceRoot)) {
    throw new AssetRequestError('INVALID_STATE', `Run workspaceRoot invalid for runId '${runId}'.`);
  }
  return meta.workspaceRoot;
}

export function getAssetRequest(dataRoot: string, project: string, assetId: string): AssetRecord {
  return readRecord(dataRoot, project, assetId);
}

export function listAssetRequests(dataRoot: string, project: string): AssetRecord[] {
  const dir = assetRequestsDir(dataRoot, project);
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: AssetRecord[] = [];
  for (const id of ids) {
    try {
      out.push(readRecord(dataRoot, project, id));
    } catch {
      // Skip foreign/corrupt entries; never fail the listing.
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}
