/**
 * PM Wake queue (F0 Phase 1).
 *
 * A wake is a durable notification record: something happened that the PM
 * (human or ChatGPT) must eventually see. Wakes are records, not gates —
 * the Supervisor keeps advancing automatically; a wake never blocks it.
 *
 * Guarantees:
 * - Standard payload schema (F0 §4-2).
 * - eventId dedup: re-emitting the same event returns the existing record.
 * - pendingWake queue: records persist on disk (no TTL), so a closed
 *   conversation loses nothing; backlog drains on acknowledge.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { relayDir } from './goal-task.js';

export const WAKE_SCHEMA_VERSION = 1;

export type WakeReason =
  | 'RUN_FAILED'
  | 'QA_FAIL'
  | 'FALLBACK'
  | 'GOAL_COMPLETE'
  | 'VERIFYING'
  /** A RUNNING Run whose worker stopped answering. */
  | 'ORPHAN';

export type FailureCategory =
  | 'transient'
  | 'budget'
  | 'permission'
  | 'conflict'
  /** The Run is still RUNNING but the worker stopped answering. */
  | 'orphan'
  | 'unknown';

export type WakeAction = 'retry' | 'fallback' | 'needs-human' | 'notify' | 'dispatch-next';

export interface WakePayload {
  goalId: string;
  taskId: string;
  runId: string;
  workerId: string;
  model: string;
  oldState: string;
  newState: string;
  reason: string;
  failureCategory: FailureCategory;
  blockerSummary: string;
  nextRecommendedAction: WakeAction;
  attemptsUsed: number;
  attemptsMax: number;
  eventId: string;
  createdAt: string;
}

export interface WakeRecord {
  schemaVersion: 1;
  eventId: string;
  reason: WakeReason;
  payload: WakePayload;
  acknowledged: boolean;
  acknowledgedAt?: string;
  createdAt: string;
}

export class WakeQueueError extends Error {
  readonly code: 'INVALID_ARGUMENT' | 'NOT_FOUND';
  constructor(code: WakeQueueError['code'], message: string) {
    super(message);
    this.name = 'WakeQueueError';
    this.code = code;
  }
}

function wakesDir(dataRoot: string, project: string): string {
  return path.join(relayDir(dataRoot, project), 'wakes');
}

function wakeFile(dataRoot: string, project: string, eventId: string): string {
  return path.join(wakesDir(dataRoot, project), `${eventId}.json`);
}

/** Deterministic eventId: same inputs → same id → dedup. Attempts differ by runId. */
export function wakeEventId(input: {
  reason: WakeReason;
  taskId: string;
  runId?: string;
  attempt?: number;
}): string {
  const parts = ['evt', input.taskId, input.reason];
  if (input.runId) parts.push(input.runId);
  if (input.attempt !== undefined) parts.push(`a${input.attempt}`);
  return parts.join('-').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 160);
}

function readRecord(file: string): WakeRecord | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (
      raw && typeof raw === 'object'
      && (raw as WakeRecord).schemaVersion === 1
      && typeof (raw as WakeRecord).eventId === 'string'
    ) {
      return raw as WakeRecord;
    }
    return null;
  } catch {
    return null;
  }
}

export interface EmitWakeInput {
  reason: WakeReason;
  goalId: string;
  taskId: string;
  runId?: string;
  workerId?: string;
  model?: string;
  oldState?: string;
  newState?: string;
  reasonText?: string;
  failureCategory?: FailureCategory;
  blockerSummary?: string;
  nextRecommendedAction?: WakeAction;
  attemptsUsed?: number;
  attemptsMax?: number;
  attempt?: number;
  eventId?: string;
}

export interface EmitWakeResult {
  record: WakeRecord;
  /** True when this exact event already existed — no second wake. */
  deduped: boolean;
}

function requireNonEmpty(value: string | undefined, name: string): string {
  if (!value || !value.trim()) throw new WakeQueueError('INVALID_ARGUMENT', `${name} is required`);
  return value;
}

export function emitWake(
  dataRoot: string,
  project: string,
  input: EmitWakeInput,
): EmitWakeResult {
  const root = requireNonEmpty(dataRoot, 'dataRoot');
  const proj = requireNonEmpty(project, 'project');
  const taskId = requireNonEmpty(input.taskId, 'taskId');
  const eventId = input.eventId
    || wakeEventId({ reason: input.reason, taskId, runId: input.runId, attempt: input.attempt });
  const file = wakeFile(root, proj, eventId);
  const existing = readRecord(file);
  if (existing) return { record: existing, deduped: true };
  const ts = new Date().toISOString();
  const record: WakeRecord = {
    schemaVersion: WAKE_SCHEMA_VERSION,
    eventId,
    reason: input.reason,
    payload: {
      goalId: input.goalId || '',
      taskId,
      runId: input.runId || '',
      workerId: input.workerId || '',
      model: input.model || '',
      oldState: input.oldState || '',
      newState: input.newState || '',
      reason: input.reasonText || input.reason,
      failureCategory: input.failureCategory || 'unknown',
      blockerSummary: input.blockerSummary || '',
      nextRecommendedAction: input.nextRecommendedAction || 'notify',
      attemptsUsed: input.attemptsUsed ?? 0,
      attemptsMax: input.attemptsMax ?? 3,
      eventId,
      createdAt: ts,
    },
    acknowledged: false,
    createdAt: ts,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return { record, deduped: false };
}

/** Backlog: unacknowledged wakes, oldest first. Survives closed conversations. */
export function listPendingWakes(dataRoot: string, project: string): WakeRecord[] {
  const dir = wakesDir(dataRoot, project);
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out: WakeRecord[] = [];
  for (const f of files) {
    const r = readRecord(path.join(dir, f));
    if (r && !r.acknowledged) out.push(r);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return out;
}

export function acknowledgeWake(dataRoot: string, project: string, eventId: string): WakeRecord {
  const file = wakeFile(dataRoot, project, eventId);
  const rec = readRecord(file);
  if (!rec) throw new WakeQueueError('NOT_FOUND', `wake not found: ${eventId}`);
  if (!rec.acknowledged) {
    rec.acknowledged = true;
    rec.acknowledgedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n', 'utf8');
  }
  return rec;
}

/** Convenience: RUN_FAILED exit → wake (attempts from the failing run). */
export function emitRunFailedWake(
  dataRoot: string,
  project: string,
  args: {
    goalId: string;
    taskId: string;
    runId: string;
    workerId: string;
    model?: string;
    reasonText: string;
    failureCategory?: FailureCategory;
    attemptsUsed?: number;
    nextRecommendedAction?: WakeAction;
  },
): EmitWakeResult {
  return emitWake(dataRoot, project, {
    reason: 'RUN_FAILED',
    goalId: args.goalId,
    taskId: args.taskId,
    runId: args.runId,
    workerId: args.workerId,
    model: args.model,
    oldState: 'RUNNING',
    newState: 'RUN_FAILED',
    reasonText: args.reasonText,
    failureCategory: args.failureCategory || 'unknown',
    blockerSummary: args.reasonText.slice(0, 200),
    nextRecommendedAction: args.nextRecommendedAction || 'retry',
    attemptsUsed: args.attemptsUsed ?? 1,
    attemptsMax: 3,
  });
}
