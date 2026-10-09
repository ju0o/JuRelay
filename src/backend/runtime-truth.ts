/**
 * P1.8A — Runtime truth: what is *actually* running, as opposed to what a file says.
 *
 * WHY this exists
 * ---------------
 * `executionState = RUNNING` is a persisted string. It is written when a Run is
 * spawned and nothing rewrites it when the worker dies, the machine reboots, or
 * the Relay process that owned the dispatch exits. Five real Tasks sat in RUNNING
 * for weeks with no worker anywhere, and the dashboard counted them as RUNNING
 * next to the real ones. That is the defect: a stored string was presented as a
 * live fact.
 *
 * So the two are separated and both are reported:
 *
 *   executionState  persisted, canonical, never mutated by this module.
 *   runtimeState    derived from runtime evidence, recomputed on every read.
 *
 * Runtime evidence, strongest first:
 *   1. a live Dispatcher process handle for this Task in THIS process (+ pid alive),
 *   2. a live worker process on this machine (cross-process probe),
 *   3. runtime observation on disk: the linked Run folder's newest write.
 *
 * Absence of all three while the persisted state says RUNNING is ORPHAN — and
 * ORPHAN is never counted as running.
 *
 * This module is PURE READ. It never transitions a Task, never writes a Task
 * file, and never clears a recovery record. Classifying is not resolving;
 * resolution stays an owner decision (P1.8D / relay_pm_resolve_orphan).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_ORPHAN_CONFIG } from './orphan-detector.js';
import {
  describeRecordProjectIdentity,
  resolveProjectIdentity,
  type ProjectIdentity,
  type ProjectIdentitySource,
  type ProjectRegistry,
} from './project-identity.js';
import type { GoalRecord, TaskExecutionState, TaskRecord } from '../shared/types.js';

/**
 * Runtime states, chosen to line up with the existing orphan ladder
 * (orphan-detector.ts) instead of inventing a parallel vocabulary.
 *
 *   ACTIVE   a worker process is proven alive and has produced runtime evidence
 *            inside the fresh window.
 *   STALE    a worker process is proven alive but has been silent past the fresh
 *            window — alive, and therefore not "done", and not "gone" either.
 *   ORPHAN   persisted DISPATCHED/RUNNING with no live worker process, no active
 *            binding, and no fresh runtime evidence.
 *   IDLE     the persisted state is not in flight (nothing is executing).
 *   UNKNOWN  runtime evidence could not be evaluated at all (no readable Run
 *            folder, or no way to observe processes). Never rounded to ORPHAN:
 *            "cannot prove death" is not "proven dead".
 */
export type TaskRuntimeState = 'ACTIVE' | 'STALE' | 'ORPHAN' | 'IDLE' | 'UNKNOWN';

/** Same window the orphan ladder already uses, so the two never disagree. */
export const RUNTIME_FRESH_WINDOW_MS = DEFAULT_ORPHAN_CONFIG.heartbeatStaleMs;

const IN_FLIGHT: ReadonlySet<TaskExecutionState> = new Set(['DISPATCHED', 'RUNNING']);

/** Next-action codes, stable for the PM/widget to branch on. */
export type NextActionCode =
  | 'NONE'
  | 'WAIT_FOR_WORKER'
  | 'WATCH_SILENT_WORKER'
  | 'PM_RESOLVE_ORPHAN'
  | 'PM_VERIFY_RESULT'
  | 'PM_DISPATCH_TASK';

export interface RuntimeSignals {
  taskId: string;
  executionState: TaskExecutionState;
  /** Live Dispatcher handle in THIS process, when it owns the Task. */
  liveHandle: { workerId: string; pid?: number; dispatchedAt: string } | null;
  /** Whether that handle's worker process is still alive (pid probe). */
  handleProcessAlive: boolean;
  /** A live worker process found by the cross-process probe. */
  observedPid: number | null;
  /** Newest runtime evidence on disk (Run folder write / launch log), epoch ms. */
  lastActivityAtMs: number | null;
  /** True when the evidence sources could actually be read. */
  evidenceReadable: boolean;
  /** True when the cross-process probe could run (false = cannot prove death). */
  processProbeAvailable: boolean;
  /** Dispatcher's own ORPHAN_SUSPECTED classification, when present. */
  orphanSuspected: boolean;
  nowMs: number;
  freshWindowMs?: number;
}

export interface RuntimeVerdict {
  runtimeState: TaskRuntimeState;
  reason: string;
  /** Minutes since the last runtime evidence (null = no evidence at all). */
  silentMinutes: number | null;
  liveProcess: boolean;
  workerId: string | null;
  pid: number | null;
}

function minutesSince(atMs: number, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - atMs) / 60000));
}

/**
 * Pure decision ladder: same signals + same clock always give the same verdict,
 * so every rule below is unit-testable without a process.
 */
export function evaluateTaskRuntime(signals: RuntimeSignals): RuntimeVerdict {
  const fresh = signals.freshWindowMs ?? RUNTIME_FRESH_WINDOW_MS;
  const silent = signals.lastActivityAtMs === null
    ? null
    : minutesSince(signals.lastActivityAtMs, signals.nowMs);
  const base = { silentMinutes: silent };

  if (!IN_FLIGHT.has(signals.executionState)) {
    return {
      ...base,
      runtimeState: 'IDLE',
      reason: `persisted executionState=${signals.executionState} — nothing is executing`,
      liveProcess: false,
      workerId: signals.liveHandle?.workerId ?? null,
      pid: null,
    };
  }

  // 1. This process owns the dispatch.
  if (signals.liveHandle) {
    if (!signals.handleProcessAlive) {
      return {
        ...base,
        runtimeState: 'ORPHAN',
        reason: 'live dispatch handle exists but its worker process is gone',
        liveProcess: false,
        workerId: signals.liveHandle.workerId,
        pid: null,
      };
    }
    const freshEvidence = signals.lastActivityAtMs !== null
      && signals.nowMs - signals.lastActivityAtMs <= fresh;
    return {
      ...base,
      runtimeState: freshEvidence ? 'ACTIVE' : 'STALE',
      reason: freshEvidence
        ? 'worker process alive with runtime evidence inside the fresh window'
        : 'worker process alive but silent past the fresh window',
      liveProcess: true,
      workerId: signals.liveHandle.workerId,
      pid: signals.liveHandle.pid ?? null,
    };
  }

  // 2. Another Relay process owns the worker (multi-process deployments are real:
  //    the MCP App process and the runner are separate).
  if (signals.observedPid !== null) {
    const freshEvidence = signals.lastActivityAtMs !== null
      && signals.nowMs - signals.lastActivityAtMs <= fresh;
    return {
      ...base,
      runtimeState: freshEvidence ? 'ACTIVE' : 'STALE',
      reason: freshEvidence
        ? 'worker process found on this machine with fresh runtime evidence'
        : 'worker process found on this machine but silent past the fresh window',
      liveProcess: true,
      workerId: null,
      pid: signals.observedPid,
    };
  }

  // 3. No proof of life. Only a completed probe may say ORPHAN.
  if (!signals.evidenceReadable) {
    return {
      ...base,
      runtimeState: 'UNKNOWN',
      reason: 'no readable Run evidence for this Task — liveness cannot be evaluated',
      liveProcess: false,
      workerId: null,
      pid: null,
    };
  }
  if (!signals.processProbeAvailable) {
    return {
      ...base,
      runtimeState: 'UNKNOWN',
      reason: 'process observation unavailable — liveness cannot be proven either way',
      liveProcess: false,
      workerId: null,
      pid: null,
    };
  }
  return {
    ...base,
    runtimeState: 'ORPHAN',
    reason: signals.orphanSuspected
      ? 'ORPHAN_SUSPECTED — persisted RUNNING with no live worker process and no fresh observation'
      : 'persisted RUNNING with no live worker process and no fresh observation',
    liveProcess: false,
    workerId: null,
    pid: null,
  };
}

// ── Process evidence ────────────────────────────────────────────────────────

/** Substring that identifies a Relay-spawned worker command line. */
const WORKER_CMDLINE_MARKER = 'relay-worker';

const PROBE_TTL_MS = 3000;
let probeCache: { at: number; entries: Array<{ pid: number; cmdline: string }> } | null = null;
let probeSupported: boolean | null = null;

/** Test-only reset for the process probe cache. */
export function _resetProcessProbeCacheForTests(): void {
  probeCache = null;
  probeSupported = null;
}

/** Whether a pid is alive. Never signals; a reused pid is accepted as evidence. */
export function isPidAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = exists but not ours — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function scanRelayWorkerProcesses(): Array<{ pid: number; cmdline: string }> | null {
  if (process.platform !== 'linux') {
    probeSupported = false;
    return null;
  }
  let pids: string[];
  try {
    pids = fs.readdirSync('/proc');
  } catch {
    probeSupported = false;
    return null;
  }
  const out: Array<{ pid: number; cmdline: string }> = [];
  for (const entry of pids) {
    if (!/^\d+$/.test(entry)) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(path.join('/proc', entry, 'cmdline'), 'utf8');
    } catch {
      continue; // the process exited between readdir and read — not evidence of anything
    }
    if (!raw || !raw.includes(WORKER_CMDLINE_MARKER)) continue;
    out.push({ pid: Number(entry), cmdline: raw.replace(/\0/g, ' ') });
    if (out.length >= 200) break;
  }
  probeSupported = true;
  return out;
}

/**
 * Live Relay worker processes on this machine, cached briefly because the
 * dashboard is polled continuously. Returns null when observation is impossible
 * on this platform — the caller must then report UNKNOWN, never ORPHAN.
 */
export function listLiveWorkerProcesses(nowMs: number = Date.now()): Array<{ pid: number; cmdline: string }> | null {
  if (probeCache && nowMs - probeCache.at < PROBE_TTL_MS) return probeCache.entries;
  const entries = scanRelayWorkerProcesses();
  if (entries === null) return null;
  probeCache = { at: nowMs, entries };
  return entries;
}

/**
 * Find a live worker process bound to one of `needles` (a Task id, a Run id, a
 * Run folder). Returns null both for "no match" and "cannot look"; callers get
 * the distinction from `listLiveWorkerProcesses` availability.
 */
export function findLiveWorkerPid(needles: string[], nowMs: number = Date.now()): number | null {
  const entries = listLiveWorkerProcesses(nowMs);
  if (!entries) return null;
  const wanted = needles.filter((n) => typeof n === 'string' && n.length > 0);
  if (!wanted.length) return null;
  for (const { pid, cmdline } of entries) {
    if (wanted.some((n) => cmdline.includes(n))) return pid;
  }
  return null;
}

// ── Evidence collection ─────────────────────────────────────────────────────

export interface LiveHandleLike {
  taskId: string;
  runId?: string;
  workerId: string;
  pid?: number;
  dispatchedAt: string;
}

/** Newest write under a Run folder, plus the launch log's own timestamp. */
export function readRunActivity(runFolder: string): { atMs: number | null; readable: boolean; model: string | null } {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(runFolder);
  } catch {
    return { atMs: null, readable: false, model: null };
  }
  if (!stat.isDirectory()) return { atMs: null, readable: false, model: null };
  let atMs = stat.mtimeMs;
  try {
    for (const name of fs.readdirSync(runFolder)) {
      try {
        atMs = Math.max(atMs, fs.statSync(path.join(runFolder, name)).mtimeMs);
      } catch { /* a file vanished mid-scan — the newest other write still stands */ }
    }
  } catch { /* directory unreadable: the folder's own mtime is still evidence */ }

  let model: string | null = null;
  try {
    const text = fs.readFileSync(path.join(runFolder, 'worker-launch.log'), 'utf8');
    const match = text.match(/"model"\s*:\s*"([^"]+)"/);
    if (match) model = match[1] ?? null;
    const at = text.match(/"at"\s*:\s*"([^"]+)"/);
    if (at?.[1]) {
      const parsed = Date.parse(at[1]);
      if (Number.isFinite(parsed)) atMs = Math.max(atMs, parsed);
    }
  } catch { /* no launch log here */ }
  return { atMs, readable: true, model };
}

export interface TaskRuntimeView {
  taskId: string;
  executionState: TaskExecutionState;
  pmState: string;
  runtimeState: TaskRuntimeState;
  reason: string;
  silentMinutes: number | null;
  workerId: string | null;
  model: string | null;
  runId: string | null;
  pid: number | null;
  lastActivityAt: string | null;
  /** Dispatcher's ORPHAN_SUSPECTED flag, when this process has one. */
  orphanSuspected: boolean;
}

function latestRunRef(task: TaskRecord): { runId: string; folder: string } | null {
  if (!task.linkedRuns.length) return null;
  const latest = [...task.linkedRuns].sort((a, b) => b.taskRunSequence - a.taskRunSequence)[0];
  if (!latest?.folder) return null;
  return { runId: latest.runId, folder: latest.folder };
}

/**
 * Derive the runtime truth for one Task from on-disk evidence + live handles.
 *
 * `liveHandles` / `orphanSuspectedOf` are injected so a caller can pass work it
 * already has (the dashboard lists active dispatches once, not per Task) and so
 * tests can drive every branch without a process.
 */
export function collectTaskRuntime(input: {
  task: TaskRecord;
  liveHandles?: readonly LiveHandleLike[];
  orphanSuspectedOf?: (taskId: string) => boolean;
  nowMs?: number;
  /** Set false to skip the cross-process probe (tests). */
  probe?: boolean;
}): TaskRuntimeView {
  const task = input.task;
  const nowMs = input.nowMs ?? Date.now();
  const handle = (input.liveHandles ?? []).find((h) => h.taskId === task.taskId) ?? null;
  const run = latestRunRef(task);
  const activity = run ? readRunActivity(run.folder) : { atMs: null, readable: false, model: null };

  let observedPid: number | null = null;
  let processProbeAvailable = false;
  if (IN_FLIGHT.has(task.executionState) && !handle && input.probe !== false) {
    const entries = listLiveWorkerProcesses(nowMs);
    processProbeAvailable = entries !== null;
    observedPid = findLiveWorkerPid(
      [task.taskId, ...(run ? [run.runId, run.folder] : [])],
      nowMs,
    );
  }

  const verdict = evaluateTaskRuntime({
    taskId: task.taskId,
    executionState: task.executionState,
    liveHandle: handle
      ? { workerId: handle.workerId, pid: handle.pid, dispatchedAt: handle.dispatchedAt }
      : null,
    handleProcessAlive: handle ? isPidAlive(handle.pid) : false,
    observedPid,
    lastActivityAtMs: activity.atMs,
    evidenceReadable: activity.readable,
    processProbeAvailable,
    orphanSuspected: input.orphanSuspectedOf?.(task.taskId) ?? false,
    nowMs,
  });

  return {
    taskId: task.taskId,
    executionState: task.executionState,
    pmState: task.pmState,
    runtimeState: verdict.runtimeState,
    reason: verdict.reason,
    silentMinutes: verdict.silentMinutes,
    workerId: verdict.workerId,
    model: activity.model,
    runId: run?.runId ?? null,
    pid: verdict.pid,
    lastActivityAt: activity.atMs === null ? null : new Date(activity.atMs).toISOString(),
    orphanSuspected: input.orphanSuspectedOf?.(task.taskId) ?? false,
  };
}

// ── Project-centric projection ──────────────────────────────────────────────

export interface ProjectTaskRuntime {
  taskId: string;
  title: string;
  goalId: string;
  executionState: TaskExecutionState;
  pmState: string;
  runtimeState: TaskRuntimeState;
  reason: string;
  silentMinutes: number | null;
  workerId: string | null;
  model: string | null;
  lastActivityAt: string | null;
  nextAction: NextActionCode;
  nextActionText: string;
}

export interface ProjectRuntimeCounts {
  tasks: number;
  persistedRunning: number;
  activeRuns: number;
  staleRuns: number;
  orphanRuns: number;
  readyTasks: number;
  verificationPending: number;
}

export interface ProjectRuntimeView {
  projectId: string;
  projectName: string;
  /** True when nobody declared this identity and it came from a storage bucket. */
  legacy: boolean;
  /** True when the storage scope itself is a machine layout name. */
  genericBucket: boolean;
  identitySource: ProjectIdentitySource;
  scope: string;
  activeGoal: { goalId: string; title: string; status: string } | null;
  activeTask: ProjectTaskRuntime | null;
  agent: string | null;
  model: string | null;
  executionState: TaskExecutionState | null;
  runtimeState: TaskRuntimeState;
  lastActivityAt: string | null;
  nextAction: NextActionCode;
  nextActionText: string;
  counts: ProjectRuntimeCounts;
  tasks: ProjectTaskRuntime[];
}

export interface ProjectRuntimeSnapshot {
  scope: string;
  /** Canonical identity of the storage scope itself (what a new Task would use). */
  scopeIdentity: ProjectIdentity;
  generatedAt: string;
  projects: ProjectRuntimeView[];
  summary: ProjectRuntimeCounts & { projects: number };
  /** Projects where something may still be executing (ACTIVE or STALE). */
  activeProjects: ProjectRuntimeView[];
}

const MAX_TASKS_PER_PROJECT = 25;

const NEXT_ACTION_TEXT: Record<NextActionCode, string> = {
  NONE: '진행 중인 작업 없음',
  WAIT_FOR_WORKER: '워커 실행 중 — 결과 대기',
  WATCH_SILENT_WORKER: '워커는 살아 있지만 소식이 없음 — 확인 필요',
  PM_RESOLVE_ORPHAN: '살아 있는 워커 없음 — PM이 orphan 처리 결정 필요',
  PM_VERIFY_RESULT: '결과 도착 — PM 검증 필요',
  PM_DISPATCH_TASK: '대기 중 Task — PM이 dispatch 결정 필요',
};

function nextActionFor(view: TaskRuntimeView): NextActionCode {
  if (view.executionState === 'RESULT_RECEIVED') {
    // PM already ACCEPTed — never re-ask for verification on a closed judgment.
    if (view.pmState === 'ACCEPTED') return 'NONE';
    return 'PM_VERIFY_RESULT';
  }
  switch (view.runtimeState) {
    case 'ACTIVE': return 'WAIT_FOR_WORKER';
    case 'STALE': return 'WATCH_SILENT_WORKER';
    case 'ORPHAN': return 'PM_RESOLVE_ORPHAN';
    default: return view.executionState === 'READY' ? 'PM_DISPATCH_TASK' : 'NONE';
  }
}

function toProjectTask(task: TaskRecord, view: TaskRuntimeView): ProjectTaskRuntime {
  const nextAction = nextActionFor(view);
  return {
    taskId: task.taskId,
    title: task.title,
    goalId: task.goalId,
    executionState: task.executionState,
    pmState: view.pmState,
    runtimeState: view.runtimeState,
    reason: view.reason,
    silentMinutes: view.silentMinutes,
    workerId: view.workerId,
    model: view.model,
    lastActivityAt: view.lastActivityAt,
    nextAction,
    nextActionText: NEXT_ACTION_TEXT[nextAction],
  };
}

/** Ordering used to pick the project's headline Task: live work first, silence next. */
const RUNTIME_SEVERITY: Record<TaskRuntimeState, number> = {
  ACTIVE: 0,
  STALE: 1,
  ORPHAN: 2,
  UNKNOWN: 3,
  IDLE: 4,
};

/**
 * Among IDLE headline candidates, prefer unfinished PM work over dispatching a
 * new READY Task. ACCEPTED maps to NONE and is excluded from the headline set.
 */
const NEXT_ACTION_SEVERITY: Record<NextActionCode, number> = {
  WAIT_FOR_WORKER: 0,
  WATCH_SILENT_WORKER: 1,
  PM_RESOLVE_ORPHAN: 2,
  PM_VERIFY_RESULT: 3,
  PM_DISPATCH_TASK: 4,
  NONE: 5,
};

/** ACCEPTED Tasks are closed for next-action leadership — READY must surface. */
function isHeadlineCandidate(t: ProjectTaskRuntime): boolean {
  if (t.pmState === 'ACCEPTED') return false;
  return t.executionState === 'RUNNING'
    || t.executionState === 'DISPATCHED'
    || t.executionState === 'RESULT_RECEIVED'
    || t.executionState === 'READY'
    || t.runtimeState !== 'IDLE';
}

/**
 * Prefer a status=ACTIVE user Goal for the project card so a READY Task under a
 * different PLANNING Goal does not overwrite the Active Goal title (FIX 1).
 */
function pickProjectActiveGoal(
  goalsById: Map<string, GoalRecord>,
  projectId: string,
  leaderGoalId: string | null,
): GoalRecord | undefined {
  const candidates: GoalRecord[] = [];
  for (const g of goalsById.values()) {
    if (g.status !== 'ACTIVE') continue;
    const tags = Array.isArray(g.tags) ? g.tags : [];
    if (tags.includes('v1-internal')) continue;
    const gid = typeof g.projectId === 'string' && g.projectId.trim()
      ? g.projectId.trim()
      : null;
    if (gid && gid !== projectId) continue;
    if (!gid && leaderGoalId && g.goalId !== leaderGoalId) continue;
    if (!gid && !leaderGoalId) continue;
    candidates.push(g);
  }
  candidates.sort((a, b) => {
    const ta = Date.parse(a.updatedAt || a.createdAt || '') || 0;
    const tb = Date.parse(b.updatedAt || b.createdAt || '') || 0;
    if (tb !== ta) return tb - ta;
    return b.goalId.localeCompare(a.goalId);
  });
  if (candidates[0]) return candidates[0];
  if (leaderGoalId) return goalsById.get(leaderGoalId);
  return undefined;
}

/**
 * Group Tasks by canonical project identity and attach runtime truth to each.
 *
 * Tasks without an explicit identity (everything filed before P1.8A) are grouped
 * under their legacy scope bucket and marked `legacy: true`, so the Founder can
 * tell "this is the Agent Relay project" from "this is an unnamed pile of old
 * records" instead of both reading `ws`.
 */
export function buildProjectRuntimeViews(input: {
  tasks: readonly TaskRecord[];
  goals: readonly GoalRecord[];
  scope: string;
  /** Identity a new Task in this scope would carry. Defaults to the scope itself. */
  scopeIdentity?: ProjectIdentity;
  registry?: ProjectRegistry;
  liveHandles?: readonly LiveHandleLike[];
  orphanSuspectedOf?: (taskId: string) => boolean;
  nowMs?: number;
  probe?: boolean;
}): ProjectRuntimeSnapshot {
  const nowMs = input.nowMs ?? Date.now();
  const goalsById = new Map(input.goals.map((g) => [g.goalId, g]));
  const scopeIdentity = input.scopeIdentity ?? resolveProjectIdentity({
    scope: input.scope,
    ...(input.registry ? { registry: input.registry } : {}),
  });

  interface Bucket {
    identity: ProjectIdentity;
    tasks: TaskRecord[];
  }
  const buckets = new Map<string, Bucket>();
  const order: string[] = [];
  for (const task of input.tasks) {
    const identity = describeRecordProjectIdentity(task, input.scope, input.registry);
    const key = identity.projectId;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { identity, tasks: [] };
      buckets.set(key, bucket);
      order.push(key);
    }
    // A name declared by one record wins for the whole group (first wins, so the
    // projection stays deterministic regardless of Task order).
    if (bucket.identity.source === 'RECORD_LEGACY' && identity.source === 'EXPLICIT') {
      bucket.identity = identity;
    }
    bucket.tasks.push(task);
  }

  const projects: ProjectRuntimeView[] = [];
  const summary = {
    projects: 0,
    tasks: 0,
    persistedRunning: 0,
    activeRuns: 0,
    staleRuns: 0,
    orphanRuns: 0,
    readyTasks: 0,
    verificationPending: 0,
  };

  for (const key of order) {
    const bucket = buckets.get(key)!;
    const views = bucket.tasks.map((task) => ({
      task: task,
      view: collectTaskRuntime({
        task,
        liveHandles: input.liveHandles,
        orphanSuspectedOf: input.orphanSuspectedOf,
        nowMs,
        ...(input.probe === undefined ? {} : { probe: input.probe }),
      }),
    }));

    const counts: ProjectRuntimeCounts = {
      tasks: views.length,
      persistedRunning: 0,
      activeRuns: 0,
      staleRuns: 0,
      orphanRuns: 0,
      readyTasks: 0,
      verificationPending: 0,
    };
    for (const { task, view } of views) {
      if (view.executionState === 'RUNNING' || view.executionState === 'DISPATCHED') {
        counts.persistedRunning += 1;
      }
      if (view.runtimeState === 'ACTIVE') counts.activeRuns += 1;
      if (view.runtimeState === 'STALE') counts.staleRuns += 1;
      if (view.runtimeState === 'ORPHAN') counts.orphanRuns += 1;
      if (task.executionState === 'READY') counts.readyTasks += 1;
      // ACCEPTED is closed — do not inflate verificationPending (matches dashboard).
      if (
        view.pmState !== 'ACCEPTED'
        && (task.executionState === 'RESULT_RECEIVED' || view.pmState === 'VERIFYING')
      ) {
        counts.verificationPending += 1;
      }
    }

    const projectTasks = views.map(({ task, view }) => toProjectTask(task, view));
    const interesting = projectTasks
      .filter(isHeadlineCandidate)
      .sort((a, b) => {
        const ra = RUNTIME_SEVERITY[a.runtimeState];
        const rb = RUNTIME_SEVERITY[b.runtimeState];
        if (ra !== rb) return ra - rb;
        const na = NEXT_ACTION_SEVERITY[a.nextAction] ?? 9;
        const nb = NEXT_ACTION_SEVERITY[b.nextAction] ?? 9;
        if (na !== nb) return na - nb;
        const la = a.lastActivityAt ?? '';
        const lb = b.lastActivityAt ?? '';
        if (la !== lb) return lb.localeCompare(la);
        return b.taskId.localeCompare(a.taskId);
      });

    const leader = interesting[0] ?? null;
    const projectRuntimeState: TaskRuntimeState = counts.activeRuns > 0
      ? 'ACTIVE'
      : counts.staleRuns > 0
        ? 'STALE'
        : counts.orphanRuns > 0
          ? 'ORPHAN'
          : 'IDLE';
    const leaderGoalId = leader?.goalId
      ?? projectTasks.find((t) => t.executionState === 'RUNNING')?.goalId
      ?? null;
    const activeGoal = pickProjectActiveGoal(
      goalsById,
      bucket.identity.projectId,
      leaderGoalId,
    );
    const nextAction = leader?.nextAction ?? 'NONE';
    const lastActivityAt = interesting
      .map((t) => t.lastActivityAt)
      .filter((x): x is string => typeof x === 'string')
      .sort()
      .reverse()[0] ?? null;

    projects.push({
      projectId: bucket.identity.projectId,
      projectName: bucket.identity.projectName,
      legacy: bucket.identity.legacy,
      genericBucket: bucket.identity.genericBucket,
      identitySource: bucket.identity.source,
      scope: bucket.identity.scope,
      activeGoal: activeGoal
        ? { goalId: activeGoal.goalId, title: activeGoal.title, status: activeGoal.status }
        : null,
      activeTask: leader,
      agent: leader?.workerId ?? null,
      model: leader?.model ?? null,
      executionState: leader?.executionState ?? null,
      runtimeState: projectRuntimeState,
      lastActivityAt,
      nextAction,
      nextActionText: NEXT_ACTION_TEXT[nextAction],
      counts,
      tasks: interesting.slice(0, MAX_TASKS_PER_PROJECT),
    });

    summary.projects += 1;
    summary.tasks += counts.tasks;
    summary.persistedRunning += counts.persistedRunning;
    summary.activeRuns += counts.activeRuns;
    summary.staleRuns += counts.staleRuns;
    summary.orphanRuns += counts.orphanRuns;
    summary.readyTasks += counts.readyTasks;
    summary.verificationPending += counts.verificationPending;
  }

  return {
    scope: input.scope,
    scopeIdentity,
    generatedAt: new Date(nowMs).toISOString(),
    projects,
    summary,
    activeProjects: projects.filter((p) => p.runtimeState === 'ACTIVE' || p.runtimeState === 'STALE'),
  };
}

export type SelectedProjectBasis = 'ARGUMENT' | 'SELECTED' | 'LAST_ACTIVE' | 'SCOPE';

/**
 * "Which project am I looking at?" must have one deterministic answer.
 *
 * selectedProject and activeProjects are deliberately separate (option C):
 *   - `selectedProject` is the ONE project the view is about. Precedence:
 *       1. explicit request argument
 *       2. persisted selectedProjectId (P1.8C-01), when it still matches
 *       3. the project with the most recent real runtime activity
 *       4. the storage scope itself
 *     It is never silently "the last row". Invalid persisted ids fall through.
 *   - `activeProjects[]` is every project where something may still be running.
 * A widget can therefore show "you are looking at JuIntake" while Agent Relay
 * runs beside it, without the two being confused.
 */
export function selectProjectView(
  snapshot: ProjectRuntimeSnapshot,
  requestedProjectId?: unknown,
  persistedSelectedProjectId?: unknown,
): { project: ProjectRuntimeView | null; basis: SelectedProjectBasis } {
  const requested = typeof requestedProjectId === 'string' ? requestedProjectId.trim() : '';
  if (requested) {
    const match = snapshot.projects.find((p) => p.projectId === requested);
    if (match) return { project: match, basis: 'ARGUMENT' };
  }
  const persisted = typeof persistedSelectedProjectId === 'string'
    ? persistedSelectedProjectId.trim()
    : '';
  if (persisted) {
    const match = snapshot.projects.find((p) => p.projectId === persisted);
    if (match) return { project: match, basis: 'SELECTED' };
  }
  const lastActive = [...snapshot.activeProjects]
    .filter((p) => p.lastActivityAt)
    .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))[0];
  if (lastActive) return { project: lastActive, basis: 'LAST_ACTIVE' };
  // SCOPE means "this storage scope's own project" — resolved through the scope
  // identity, never through the raw bucket name. Otherwise a legacy pile filed
  // under the bucket would masquerade as the product project.
  const scopeProjectId = snapshot.scopeIdentity?.projectId ?? snapshot.scope;
  const scopeMatch = snapshot.projects.find((p) => p.projectId === scopeProjectId)
    ?? snapshot.projects[0]
    ?? null;
  return { project: scopeMatch, basis: 'SCOPE' };
}