/**
 * P2-OWNER-R01 — per-Task execution selection (Agent / model / profile / GO).
 *
 * Path: `{dataRoot}/{scope}/_relay/tasks/{taskId}/execution-config.json`
 *
 * Never rewrites project Assignment / workspace-config.
 * Never spawns workers. Invalid models are rejected (no silent substitute).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getTask, taskFolder, writeJsonAtomic } from './goal-task.js';
import {
  loadWorkerRegistryRecord,
  listWorkerRegistryRecords,
  type WorkerRegistryRecord,
} from './worker-registry.js';
import { isModelAllowedForWorker, listModelsForWorker } from './agent-model-catalog.js';

export const TASK_EXECUTION_CONFIG_SCHEMA_VERSION = 1 as const;

export type TaskExecutionApprovalSource = 'OWNER_WIDGET' | 'OWNER_MCP';

export interface TaskExecutionOwnerApproval {
  approved: boolean;
  approvedAt?: string;
  source?: TaskExecutionApprovalSource;
}

export interface TaskExecutionConfigV1 {
  schemaVersion: typeof TASK_EXECUTION_CONFIG_SCHEMA_VERSION;
  projectId: string;
  taskId: string;
  workerId: string;
  runtime: string;
  provider?: string;
  modelId: string | null;
  executionProfile?: string;
  ownerApproval: TaskExecutionOwnerApproval;
  runId?: string;
  effectiveModel?: string | null;
  selectionFrozenAt?: string;
  updatedAt: string;
}

export type TaskExecutionConfigErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_ARGUMENT'
  | 'TASK_NOT_READY'
  | 'UNKNOWN_WORKER'
  | 'FORBIDDEN_WORKER'
  | 'UNSUPPORTED_MODEL'
  | 'SELECTION_FROZEN'
  | 'OWNER_APPROVAL_REQUIRED'
  | 'WORKER_MISMATCH';

export class TaskExecutionConfigError extends Error {
  readonly code: TaskExecutionConfigErrorCode;
  constructor(code: TaskExecutionConfigErrorCode, message: string) {
    super(message);
    this.name = 'TaskExecutionConfigError';
    this.code = code;
  }
}

const FORBIDDEN_WORKER_IDS = new Set(['claude-code']); // Team cleanup — never re-select
const FORBIDDEN_CONFIG_DIR_MARKERS = ['.claude-team'];

export function taskExecutionConfigPath(
  dataRoot: string,
  scope: string,
  taskId: string,
): string {
  return path.join(taskFolder(dataRoot, scope, taskId), 'execution-config.json');
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TaskExecutionConfigError('INVALID_ARGUMENT', `${field}이(가) 필요합니다.`);
  }
  return value.trim();
}

function profileFromWorker(worker: WorkerRegistryRecord): string | undefined {
  const cfg = worker.driverOptions?.claude?.configDir;
  if (typeof cfg === 'string' && cfg.trim()) {
    const base = path.basename(path.resolve(cfg.trim()));
    if (base === '.claude-pro' || base === 'claude-pro') return 'pro';
    if (base === '.claude-team' || base === 'claude-team') return 'team';
    if (base === '.claude') return 'default';
    return base.replace(/^\./, '') || undefined;
  }
  return undefined;
}

function runtimeFromWorker(worker: WorkerRegistryRecord): string {
  const adapter = (worker.observationAdapterId || '').trim();
  if (adapter) return adapter;
  const id = worker.workerId.toLowerCase();
  if (id.includes('claude')) return 'claude-code';
  if (id.includes('codex')) return 'codex';
  if (id.includes('opencode')) return 'opencode';
  if (id.includes('cline')) return 'cline';
  if (id.includes('grok')) return 'grok';
  if (id.includes('commandcode') || id.includes('command-code')) return 'commandcode';
  return 'unknown';
}

function assertWorkerAllowed(worker: WorkerRegistryRecord): void {
  if (FORBIDDEN_WORKER_IDS.has(worker.workerId)) {
    throw new TaskExecutionConfigError(
      'FORBIDDEN_WORKER',
      `Worker '${worker.workerId}'는 Claude Team 전용으로 폐기되어 선택할 수 없습니다.`,
    );
  }
  const cfg = worker.driverOptions?.claude?.configDir;
  if (typeof cfg === 'string') {
    const norm = cfg.replace(/\\/g, '/');
    for (const marker of FORBIDDEN_CONFIG_DIR_MARKERS) {
      if (norm.includes(marker)) {
        throw new TaskExecutionConfigError(
          'FORBIDDEN_WORKER',
          `Worker '${worker.workerId}'는 Team configDir를 가리켜 선택할 수 없습니다.`,
        );
      }
    }
  }
  if (worker.role === 'qa' || worker.workerId.toLowerCase().startsWith('qa-')) {
    throw new TaskExecutionConfigError(
      'FORBIDDEN_WORKER',
      `Worker '${worker.workerId}'는 QA 전용이라 Builder 실행 선택에 쓸 수 없습니다.`,
    );
  }
}

function parseConfig(raw: unknown): TaskExecutionConfigV1 | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== TASK_EXECUTION_CONFIG_SCHEMA_VERSION) return null;
  if (typeof r.projectId !== 'string' || typeof r.taskId !== 'string') return null;
  if (typeof r.workerId !== 'string' || typeof r.runtime !== 'string') return null;
  if (typeof r.updatedAt !== 'string') return null;
  const modelId =
    r.modelId === null ? null : typeof r.modelId === 'string' ? r.modelId : null;
  const approvalRaw = r.ownerApproval;
  let ownerApproval: TaskExecutionOwnerApproval = { approved: false };
  if (approvalRaw && typeof approvalRaw === 'object' && !Array.isArray(approvalRaw)) {
    const a = approvalRaw as Record<string, unknown>;
    ownerApproval = {
      approved: a.approved === true,
      ...(typeof a.approvedAt === 'string' ? { approvedAt: a.approvedAt } : {}),
      ...(a.source === 'OWNER_WIDGET' || a.source === 'OWNER_MCP'
        ? { source: a.source }
        : {}),
    };
  }
  const out: TaskExecutionConfigV1 = {
    schemaVersion: TASK_EXECUTION_CONFIG_SCHEMA_VERSION,
    projectId: r.projectId,
    taskId: r.taskId,
    workerId: r.workerId,
    runtime: r.runtime,
    modelId,
    ownerApproval,
    updatedAt: r.updatedAt,
  };
  if (typeof r.provider === 'string' && r.provider.trim()) out.provider = r.provider.trim();
  if (typeof r.executionProfile === 'string' && r.executionProfile.trim()) {
    out.executionProfile = r.executionProfile.trim();
  }
  if (typeof r.runId === 'string' && r.runId.trim()) out.runId = r.runId.trim();
  if (r.effectiveModel === null) out.effectiveModel = null;
  else if (typeof r.effectiveModel === 'string') out.effectiveModel = r.effectiveModel;
  if (typeof r.selectionFrozenAt === 'string' && r.selectionFrozenAt.trim()) {
    out.selectionFrozenAt = r.selectionFrozenAt.trim();
  }
  return out;
}

export function getTaskExecutionConfig(
  dataRoot: string,
  scope: string,
  taskId: string,
): TaskExecutionConfigV1 | null {
  const fp = taskExecutionConfigPath(dataRoot, scope, taskId);
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return parseConfig(raw);
  } catch {
    return null;
  }
}

export interface SetTaskExecutionConfigInput {
  projectId: string;
  taskId: string;
  workerId: string;
  modelId: string | null;
  provider?: string;
  source?: TaskExecutionApprovalSource;
}

/**
 * Persist Agent/model selection for a READY Task. Clears ownerApproval.
 * Does not dispatch and does not mutate project Assignment.
 */
export function setTaskExecutionConfig(
  dataRoot: string,
  scope: string,
  input: SetTaskExecutionConfigInput,
): TaskExecutionConfigV1 {
  const projectId = requireNonEmpty(input.projectId, 'projectId');
  const taskId = requireNonEmpty(input.taskId, 'taskId');
  const workerId = requireNonEmpty(input.workerId, 'workerId');

  let task;
  try {
    task = getTask(dataRoot, scope, taskId);
  } catch {
    throw new TaskExecutionConfigError('NOT_FOUND', `Task '${taskId}' 찾을 수 없습니다.`);
  }
  if (task.executionState !== 'READY') {
    throw new TaskExecutionConfigError(
      'TASK_NOT_READY',
      `Task executionState must be READY to change selection (found ${task.executionState}).`,
    );
  }

  const existing = getTaskExecutionConfig(dataRoot, scope, taskId);
  if (existing?.selectionFrozenAt || existing?.runId) {
    throw new TaskExecutionConfigError(
      'SELECTION_FROZEN',
      `Task '${taskId}' 실행 설정은 이미 고정되어 바꿀 수 없습니다.`,
    );
  }

  const worker = loadWorkerRegistryRecord(dataRoot, workerId);
  if (!worker) {
    throw new TaskExecutionConfigError('UNKNOWN_WORKER', `Worker '${workerId}'가 Registry에 없습니다.`);
  }
  assertWorkerAllowed(worker);

  const modelId =
    input.modelId === null || input.modelId === undefined
      ? null
      : requireNonEmpty(input.modelId, 'modelId');

  if (modelId !== null && !isModelAllowedForWorker(dataRoot, worker, modelId)) {
    throw new TaskExecutionConfigError(
      'UNSUPPORTED_MODEL',
      `Model '${modelId}'는 Worker '${workerId}'에서 지원되지 않습니다.`,
    );
  }

  // Explicit model required when catalog supports selection and has entries.
  const catalog = listModelsForWorker(dataRoot, worker);
  if (catalog.supportsExplicitModel && modelId === null && (catalog.models?.length ?? 0) > 0) {
    throw new TaskExecutionConfigError(
      'INVALID_ARGUMENT',
      `Worker '${workerId}'는 modelId를 명시해야 합니다.`,
    );
  }

  const now = new Date().toISOString();
  const next: TaskExecutionConfigV1 = {
    schemaVersion: TASK_EXECUTION_CONFIG_SCHEMA_VERSION,
    projectId,
    taskId,
    workerId: worker.workerId,
    runtime: runtimeFromWorker(worker),
    modelId,
    ownerApproval: { approved: false },
    updatedAt: now,
  };
  const profile = profileFromWorker(worker);
  if (profile) next.executionProfile = profile;
  if (typeof input.provider === 'string' && input.provider.trim()) {
    next.provider = input.provider.trim();
  } else if (modelId && modelId.includes('/')) {
    next.provider = modelId.slice(0, modelId.indexOf('/'));
  }

  writeJsonAtomic(taskExecutionConfigPath(dataRoot, scope, taskId), next);
  return next;
}

export function approveTaskExecution(
  dataRoot: string,
  scope: string,
  taskId: string,
  source: TaskExecutionApprovalSource = 'OWNER_MCP',
): TaskExecutionConfigV1 {
  const id = requireNonEmpty(taskId, 'taskId');
  const cfg = getTaskExecutionConfig(dataRoot, scope, id);
  if (!cfg) {
    throw new TaskExecutionConfigError(
      'NOT_FOUND',
      `Task '${id}'에 실행 선택이 없습니다. Agent/모델을 먼저 고르세요.`,
    );
  }
  if (cfg.selectionFrozenAt || cfg.runId) {
    throw new TaskExecutionConfigError(
      'SELECTION_FROZEN',
      `Task '${id}' 실행 설정은 이미 고정되어 있습니다.`,
    );
  }
  const task = getTask(dataRoot, scope, id);
  if (task.executionState !== 'READY') {
    throw new TaskExecutionConfigError(
      'TASK_NOT_READY',
      `Task executionState must be READY to approve (found ${task.executionState}).`,
    );
  }
  const worker = loadWorkerRegistryRecord(dataRoot, cfg.workerId);
  if (!worker) {
    throw new TaskExecutionConfigError('UNKNOWN_WORKER', `Worker '${cfg.workerId}'가 Registry에 없습니다.`);
  }
  assertWorkerAllowed(worker);
  if (cfg.modelId !== null && !isModelAllowedForWorker(dataRoot, worker, cfg.modelId)) {
    throw new TaskExecutionConfigError(
      'UNSUPPORTED_MODEL',
      `Model '${cfg.modelId}'는 Worker '${cfg.workerId}'에서 더 이상 지원되지 않습니다.`,
    );
  }

  const next: TaskExecutionConfigV1 = {
    ...cfg,
    ownerApproval: {
      approved: true,
      approvedAt: new Date().toISOString(),
      source,
    },
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(taskExecutionConfigPath(dataRoot, scope, id), next);
  return next;
}

/** Freeze selection after successful dispatch (runId bound). */
export function freezeTaskExecutionConfig(
  dataRoot: string,
  scope: string,
  taskId: string,
  runId: string,
  effectiveModel?: string | null,
): TaskExecutionConfigV1 {
  const cfg = getTaskExecutionConfig(dataRoot, scope, taskId);
  if (!cfg) {
    throw new TaskExecutionConfigError('NOT_FOUND', `Task '${taskId}' execution-config missing at freeze.`);
  }
  if (!cfg.ownerApproval.approved) {
    throw new TaskExecutionConfigError('OWNER_APPROVAL_REQUIRED', 'ownerApproval required before freeze.');
  }
  const next: TaskExecutionConfigV1 = {
    ...cfg,
    runId,
    selectionFrozenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(effectiveModel !== undefined ? { effectiveModel } : { effectiveModel: cfg.modelId }),
  };
  writeJsonAtomic(taskExecutionConfigPath(dataRoot, scope, taskId), next);
  return next;
}

export interface ExecutableAgentRow {
  workerId: string;
  runtime: string;
  displayName: string;
  role: string;
  executionProfile?: string;
  available: boolean;
  blockedReason?: string;
  observationAdapterId?: string;
}

/** List Builder workers eligible for per-Task selection (Team excluded). */
export function listExecutableAgents(dataRoot: string): ExecutableAgentRow[] {
  const rows: ExecutableAgentRow[] = [];
  for (const w of listWorkerRegistryRecords(dataRoot)) {
    const id = w.workerId;
    if (w.role === 'qa' || id.toLowerCase().startsWith('qa-') || id.toLowerCase().startsWith('probe-')) {
      continue;
    }
    if (id.toLowerCase().startsWith('w-v0') || w.observationAdapterId === 'actl-managed') {
      rows.push({
        workerId: id,
        runtime: runtimeFromWorker(w),
        displayName: w.displayName || id,
        role: w.role || 'implementation',
        available: false,
        blockedReason: 'actl-managed runtime unavailable for R01 Task selection',
        observationAdapterId: w.observationAdapterId,
      });
      continue;
    }
    try {
      assertWorkerAllowed(w);
    } catch (err) {
      const msg = err instanceof TaskExecutionConfigError ? err.message : String(err);
      rows.push({
        workerId: id,
        runtime: runtimeFromWorker(w),
        displayName: w.displayName || id,
        role: w.role || 'implementation',
        available: false,
        blockedReason: msg,
        observationAdapterId: w.observationAdapterId,
        ...(profileFromWorker(w) ? { executionProfile: profileFromWorker(w) } : {}),
      });
      continue;
    }
    const launchOk =
      typeof w.launchCommand === 'string' &&
      w.launchCommand.length > 0 &&
      Array.isArray(w.launchArgsPrefix);
    rows.push({
      workerId: id,
      runtime: runtimeFromWorker(w),
      displayName: w.displayName || id,
      role: w.role || 'implementation',
      available: launchOk,
      ...(launchOk ? {} : { blockedReason: 'launchCommand/launchArgsPrefix incomplete' }),
      observationAdapterId: w.observationAdapterId,
      ...(profileFromWorker(w) ? { executionProfile: profileFromWorker(w) } : {}),
    });
  }
  rows.sort((a, b) => a.workerId.localeCompare(b.workerId));
  return rows;
}

/** Require approved selection matching dispatch workerId. */
export function requireApprovedExecutionConfig(
  dataRoot: string,
  scope: string,
  taskId: string,
  workerId: string,
): TaskExecutionConfigV1 {
  const cfg = getTaskExecutionConfig(dataRoot, scope, taskId);
  if (!cfg) {
    throw new TaskExecutionConfigError(
      'NOT_FOUND',
      'TASK_EXECUTION_SELECTION_REQUIRED: Agent/모델을 선택한 뒤 승인하세요.',
    );
  }
  if (!cfg.ownerApproval.approved) {
    throw new TaskExecutionConfigError(
      'OWNER_APPROVAL_REQUIRED',
      'OWNER_APPROVAL_REQUIRED: 실행 승인이 없습니다.',
    );
  }
  if (cfg.workerId !== workerId) {
    throw new TaskExecutionConfigError(
      'WORKER_MISMATCH',
      `선택 workerId '${cfg.workerId}'와 dispatch workerId '${workerId}'가 다릅니다.`,
    );
  }
  return cfg;
}
