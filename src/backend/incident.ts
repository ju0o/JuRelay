/**
 * RB-03A — durable Incident kernel.
 *
 * An Incident is not a PM Delivery, not a QA PASS, and not a Task ACCEPT.
 * It records one fail-closed cause for one Task Run. The id is deterministic
 * (`INC-{taskId}-{runId}-{code}`), so a retry or restart returns the same
 * record and never mints a second one. Existing status is left untouched.
 *
 * The record stores identity and evidence refs only. It does not store
 * prompts, model output, secrets, workspace paths, or result text.
 *
 * A worker failure before a QA verdict uses WORKER_LAUNCH_FAILED only when
 * a dispatcher token says the process never started, WORKER_EXECUTION_FAILED
 * only when a token says the process exited after it started, and
 * WORKER_FAILED_UNCLASSIFIED when those tokens are absent or contradict.
 *
 * Storage: {dataRoot}/{project}/_relay/incidents/{incidentId}/incident.json
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { relayDir, writeJsonAtomic } from './goal-task.js';

export const INCIDENT_SCHEMA_VERSION = 1;

export const INCIDENT_CODES = [
  'QA_BUDGET_EXHAUSTED',
  'QA_BLOCKED',
  'QA_CONTRACT_INVALID',
  'WAKE_EXHAUSTED',
  'WORKER_LAUNCH_FAILED',
  'WORKER_EXECUTION_FAILED',
  'WORKER_FAILED_UNCLASSIFIED',
] as const;
export type IncidentCode = (typeof INCIDENT_CODES)[number];

/** Pre-QA worker failure codes. One Task Run keeps at most one of these. */
export const PRE_QA_WORKER_INCIDENT_CODES = [
  'WORKER_LAUNCH_FAILED',
  'WORKER_EXECUTION_FAILED',
  'WORKER_FAILED_UNCLASSIFIED',
] as const satisfies readonly IncidentCode[];

export const INCIDENT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_SOURCES = ['qa-gate', 'pm-wake', 'dispatcher'] as const;
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];

export interface IncidentRecord {
  schemaVersion: number;
  incidentId: string;
  project: string;
  taskId: string;
  runId: string;
  qaAttemptId?: string;
  code: IncidentCode;
  status: IncidentStatus;
  source: IncidentSource;
  executionState: string;
  pmState: string;
  evidenceRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export class IncidentError extends Error {
  readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_STATE' | 'INVALID_ARGUMENT' | 'CORRUPT_RECORD';
  constructor(code: IncidentError['code'], message: string) {
    super(message);
    this.name = 'IncidentError';
    this.code = code;
  }
}

export interface EnsureIncidentInput {
  taskId: string;
  runId: string;
  code: IncidentCode;
  source: IncidentSource;
  executionState: string;
  pmState: string;
  qaAttemptId?: string;
  evidenceRefs?: string[];
}

const TASK_ID_RE = /^TASK-\d+$/;
const STATE_RE = /^[A-Z_]{1,40}$/;
const EVIDENCE_REF_RE = /^[A-Za-z0-9:._-]{1,160}$/;
const INCIDENT_ID_RE = new RegExp(
  `^INC-TASK-\\d+-[A-Za-z0-9._-]+-(?:${INCIDENT_CODES.join('|')})$`,
);

const _incidentLocks = new Map<string, Promise<void>>();

function incidentLockKey(dataRoot: string, project: string, incidentId: string): string {
  return `${path.resolve(dataRoot)}@@${project}::${incidentId}`;
}

function withIncidentLock<T>(dataRoot: string, project: string, incidentId: string, fn: () => T | Promise<T>): Promise<T> {
  const key = incidentLockKey(dataRoot, project, incidentId);
  const prev = _incidentLocks.get(key) ?? Promise.resolve();
  const work = prev.then(() => fn());
  _incidentLocks.set(key, work.then(() => undefined, () => undefined));
  return work;
}

export function _resetIncidentLocksForTests(): void {
  _incidentLocks.clear();
}

export function incidentsDir(dataRoot: string, project: string): string {
  return path.join(relayDir(dataRoot, project), 'incidents');
}

export function incidentFolder(dataRoot: string, project: string, incidentId: string): string {
  return path.join(incidentsDir(dataRoot, project), incidentId);
}

function incidentJsonPath(folder: string): string {
  return path.join(folder, 'incident.json');
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new IncidentError('INVALID_ARGUMENT', `${field}이(가) 필요합니다.`);
  }
  return value.trim();
}

function requireStateToken(value: unknown, field: string): string {
  const token = requireNonEmpty(value, field);
  if (!STATE_RE.test(token)) {
    throw new IncidentError('INVALID_ARGUMENT', `${field}는 상태 토큰이어야 합니다.`);
  }
  return token;
}

export function incidentIdFor(taskId: string, runId: string, code: IncidentCode): string {
  const tid = requireNonEmpty(taskId, 'taskId');
  const rid = requireNonEmpty(runId, 'runId');
  if (!TASK_ID_RE.test(tid)) throw new IncidentError('INVALID_ARGUMENT', `잘못된 Task ID: ${tid}`);
  if (/[/\\]/.test(rid) || rid === '.' || rid === '..') {
    throw new IncidentError('INVALID_ARGUMENT', `잘못된 runId: ${rid}`);
  }
  if (!(INCIDENT_CODES as readonly string[]).includes(code)) {
    throw new IncidentError('INVALID_ARGUMENT', `알 수 없는 Incident code: ${String(code)}`);
  }
  return `INC-${tid}-${rid}-${code}`;
}

function sanitizeEvidenceRefs(refs: unknown): string[] {
  if (refs === undefined) return [];
  if (!Array.isArray(refs)) throw new IncidentError('INVALID_ARGUMENT', 'evidenceRefs는 배열이어야 합니다.');
  const out: string[] = [];
  for (const ref of refs) {
    if (typeof ref !== 'string' || !EVIDENCE_REF_RE.test(ref)) {
      throw new IncidentError('INVALID_ARGUMENT', 'evidenceRefs에는 식별자만 넣을 수 있습니다.');
    }
    if (!out.includes(ref)) out.push(ref);
  }
  return out;
}

export function validateIncidentRecord(record: IncidentRecord): void {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new IncidentError('INVALID_STATE', 'Incident 레코드가 필요합니다.');
  }
  if (record.schemaVersion !== INCIDENT_SCHEMA_VERSION) {
    throw new IncidentError('INVALID_STATE', `지원하지 않는 Incident schemaVersion: ${String(record.schemaVersion)}`);
  }
  if (!INCIDENT_ID_RE.test(record.incidentId)) {
    throw new IncidentError('INVALID_STATE', `잘못된 incidentId: ${String(record.incidentId)}`);
  }
  if (!record.project || typeof record.project !== 'string') {
    throw new IncidentError('INVALID_STATE', 'Incident project가 필요합니다.');
  }
  if (!TASK_ID_RE.test(record.taskId)) {
    throw new IncidentError('INVALID_STATE', `잘못된 Task ID: ${String(record.taskId)}`);
  }
  const expected = incidentIdFor(record.taskId, record.runId, record.code);
  if (record.incidentId !== expected) {
    throw new IncidentError('INVALID_STATE', `incidentId 불일치: ${record.incidentId} ≠ ${expected}`);
  }
  if (!(INCIDENT_STATUSES as readonly string[]).includes(record.status)) {
    throw new IncidentError('INVALID_STATE', `알 수 없는 Incident status: ${String(record.status)}`);
  }
  if (!(INCIDENT_SOURCES as readonly string[]).includes(record.source)) {
    throw new IncidentError('INVALID_STATE', `알 수 없는 Incident source: ${String(record.source)}`);
  }
  requireStateToken(record.executionState, 'executionState');
  requireStateToken(record.pmState, 'pmState');
  sanitizeEvidenceRefs(record.evidenceRefs);
  if (record.qaAttemptId !== undefined && (typeof record.qaAttemptId !== 'string' || !EVIDENCE_REF_RE.test(record.qaAttemptId))) {
    throw new IncidentError('INVALID_STATE', 'qaAttemptId는 식별자여야 합니다.');
  }
}

function renderIncidentMarkdown(record: IncidentRecord): string {
  return [
    `# ${record.incidentId}`,
    '',
    '이 기록은 QA PASS도 Task ACCEPT도 아닙니다.',
    '',
    `- code: ${record.code}`,
    `- status: ${record.status}`,
    `- source: ${record.source}`,
    `- taskId: ${record.taskId}`,
    `- runId: ${record.runId}`,
    `- executionState: ${record.executionState}`,
    `- pmState: ${record.pmState}`,
    '',
  ].join('\n');
}

function persistIncident(folder: string, record: IncidentRecord): void {
  validateIncidentRecord(record);
  fs.mkdirSync(folder, { recursive: true });
  writeJsonAtomic(incidentJsonPath(folder), record);
  try {
    fs.writeFileSync(path.join(folder, 'incident.md'), renderIncidentMarkdown(record), 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new IncidentError('INVALID_STATE', `Incident JSON은 저장됐지만 Markdown 쓰기에 실패했습니다: ${msg}`);
  }
}

function readIncidentFile(dataRoot: string, project: string, incidentId: string): IncidentRecord {
  const file = incidentJsonPath(incidentFolder(dataRoot, project, incidentId));
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') throw new IncidentError('NOT_FOUND', `Incident를 찾을 수 없습니다: ${incidentId}`);
    throw new IncidentError('CORRUPT_RECORD', `Incident JSON을 읽을 수 없습니다: ${incidentId}`);
  }
  try {
    validateIncidentRecord(raw as IncidentRecord);
  } catch (err) {
    if (err instanceof IncidentError && err.code === 'CORRUPT_RECORD') throw err;
    throw new IncidentError('CORRUPT_RECORD', `Incident 레코드가 손상되었습니다: ${incidentId}`);
  }
  return raw as IncidentRecord;
}

/**
 * Create the Incident once. A second call for the same task, run, and code
 * returns the stored record and does not reset its status or rewrite it.
 * A corrupt file fails closed and is never replaced.
 */
export function ensureIncident(
  dataRoot: string,
  project: string,
  input: EnsureIncidentInput,
): Promise<IncidentRecord> {
  const taskId = requireNonEmpty(input.taskId, 'taskId');
  const runId = requireNonEmpty(input.runId, 'runId');
  const incidentId = incidentIdFor(taskId, runId, input.code);
  const evidenceRefs = sanitizeEvidenceRefs(input.evidenceRefs);
  const executionState = requireStateToken(input.executionState, 'executionState');
  const pmState = requireStateToken(input.pmState, 'pmState');
  if (input.qaAttemptId !== undefined && !EVIDENCE_REF_RE.test(input.qaAttemptId)) {
    throw new IncidentError('INVALID_ARGUMENT', 'qaAttemptId는 식별자여야 합니다.');
  }
  return withIncidentLock(dataRoot, project, incidentId, () => {
    const folder = incidentFolder(dataRoot, project, incidentId);
    const file = incidentJsonPath(folder);
    if (fs.existsSync(file)) {
      const existing = readIncidentFile(dataRoot, project, incidentId);
      if (existing.taskId !== taskId || existing.runId !== runId || existing.code !== input.code) {
        throw new IncidentError('CORRUPT_RECORD', `Incident ${incidentId} 신원이 요청과 다릅니다.`);
      }
      return existing;
    }
    const ts = new Date().toISOString();
    const record: IncidentRecord = {
      schemaVersion: INCIDENT_SCHEMA_VERSION,
      incidentId,
      project,
      taskId,
      runId,
      ...(input.qaAttemptId ? { qaAttemptId: input.qaAttemptId } : {}),
      code: input.code,
      status: 'OPEN',
      source: input.source,
      executionState,
      pmState,
      evidenceRefs,
      createdAt: ts,
      updatedAt: ts,
    };
    persistIncident(folder, record);
    return record;
  });
}

export function listIncidents(dataRoot: string, project: string): IncidentRecord[] {
  const dir = incidentsDir(dataRoot, project);
  if (!fs.existsSync(dir)) return [];
  const out: IncidentRecord[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!INCIDENT_ID_RE.test(name)) continue;
    try {
      out.push(readIncidentFile(dataRoot, project, name));
    } catch {
      // A directory scan skips one corrupt sibling. Point reads still fail closed.
    }
  }
  out.sort((a, b) => a.incidentId.localeCompare(b.incidentId));
  return out;
}
