/**
 * AUTO_ADVANCE rules (F0 Phase 2).
 *
 * Pure decision kernel: given what just happened, decide the next action
 * and whether a human must be involved. No I/O except the per-task
 * consecutive-failure counter (durable JSON, survives restarts).
 *
 * Rule table (F0 §5):
 *   RUNNING→RESULT_RECEIVED + QA PASS          → dispatch-next (no human)
 *   RUNNING→RUN_FAILED, retryable, 1st         → retry        (no human)
 *   RUNNING→RUN_FAILED, 2nd, fallback avail    → fallback     (no human)
 *   RUNNING→RUN_FAILED, 3rd / budget / perm    → wake-pm      (HUMAN)
 *   VERIFYING→CHANGES, reason sufficient       → dispatch-next (no human)
 *   VERIFYING→CHANGES, thin/conflict           → wake-pm      (HUMAN)
 *   QA PASS                                    → dispatch-next (no human)
 *   QA FAIL, 1st                               → retry        (no human)
 *   QA FAIL, 2nd+                              → wake-pm      (HUMAN)
 *   last task COMPLETE, all pass               → notify-final (human: notify only)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { relayDir } from './goal-task.js';
import type { FailureCategory, WakeAction } from './wake-queue.js';

export const MAX_ATTEMPTS = 3;

export type AdvanceAction =
  | 'dispatch-next'
  | 'retry'
  | 'fallback'
  | 'wake-pm'
  | 'notify-final';

export interface AdvanceDecision {
  action: AdvanceAction;
  /** True only when progress stops for a human (counts as an intervention). */
  humanRequired: boolean;
  consecutiveFailures: number;
  wakeAction: WakeAction;
}

interface CounterFile {
  schemaVersion: 1;
  counters: Record<string, number>;
}

function counterFile(dataRoot: string, project: string): string {
  return path.join(relayDir(dataRoot, project), 'auto-advance.json');
}

function readCounters(dataRoot: string, project: string): Record<string, number> {
  try {
    const raw = JSON.parse(fs.readFileSync(counterFile(dataRoot, project), 'utf8')) as CounterFile;
    if (raw && raw.schemaVersion === 1 && raw.counters) return { ...raw.counters };
    return {};
  } catch {
    return {};
  }
}

function writeCounters(dataRoot: string, project: string, counters: Record<string, number>): void {
  const file = counterFile(dataRoot, project);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, counters }, null, 2) + '\n', 'utf8');
}

export function getConsecutiveFailures(dataRoot: string, project: string, taskId: string): number {
  return readCounters(dataRoot, project)[taskId] ?? 0;
}

function setConsecutiveFailures(dataRoot: string, project: string, taskId: string, n: number): void {
  const all = readCounters(dataRoot, project);
  if (n <= 0) delete all[taskId];
  else all[taskId] = n;
  writeCounters(dataRoot, project, all);
}

export function resetConsecutiveFailures(dataRoot: string, project: string, taskId: string): void {
  setConsecutiveFailures(dataRoot, project, taskId, 0);
}

function wakeFor(action: AdvanceAction): WakeAction {
  if (action === 'retry') return 'retry';
  if (action === 'fallback') return 'fallback';
  if (action === 'dispatch-next') return 'dispatch-next';
  if (action === 'notify-final') return 'notify';
  return 'needs-human';
}

export interface RunOutcome {
  taskId: string;
  /** 'pass' | 'fail' for a run; 'qa-pass' | 'qa-fail' for QA; 'orphan' for a stalled RUNNING. */
  kind: 'pass' | 'fail' | 'qa-pass' | 'qa-fail' | 'orphan';
  failureCategory?: FailureCategory;
  /** Another worker available for fallback. */
  fallbackAvailable?: boolean;
  /** CHANGES with enough reason to auto-continue (VERIFYING path). */
  reasonSufficient?: boolean;
  /** This was the last task and everything passed. */
  finalTask?: boolean;
}

/**
 * Record one outcome, advance the counter, return the decision.
 * Human interventions happen ONLY on wake-pm with needs-human.
 */
export function recordOutcome(
  dataRoot: string,
  project: string,
  outcome: RunOutcome,
): AdvanceDecision {
  const counters = readCounters(dataRoot, project);
  const cur = counters[outcome.taskId] ?? 0;

  if (outcome.kind === 'pass' || outcome.kind === 'qa-pass') {
    if (outcome.finalTask) {
      delete counters[outcome.taskId];
      writeCounters(dataRoot, project, counters);
      return { action: 'notify-final', humanRequired: false, consecutiveFailures: 0, wakeAction: 'notify' };
    }
    delete counters[outcome.taskId];
    writeCounters(dataRoot, project, counters);
    return { action: 'dispatch-next', humanRequired: false, consecutiveFailures: 0, wakeAction: 'dispatch-next' };
  }

  // Failure paths.
  if (outcome.failureCategory === 'budget' || outcome.failureCategory === 'permission') {
    counters[outcome.taskId] = cur + 1;
    writeCounters(dataRoot, project, counters);
    return {
      action: 'wake-pm', humanRequired: true,
      consecutiveFailures: cur + 1, wakeAction: 'needs-human',
    };
  }

  if (outcome.kind === 'qa-fail') {
    if (cur + 1 >= 2) {
      counters[outcome.taskId] = cur + 1;
      writeCounters(dataRoot, project, counters);
      return {
        action: 'wake-pm', humanRequired: true,
        consecutiveFailures: cur + 1, wakeAction: 'needs-human',
      };
    }
    counters[outcome.taskId] = cur + 1;
    writeCounters(dataRoot, project, counters);
    return {
      action: 'retry', humanRequired: false,
      consecutiveFailures: cur + 1, wakeAction: wakeFor('retry'),
    };
  }

  // ORPHAN — the Run is still RUNNING but the worker stopped answering.
  // Same ladder as a run failure, but the reason a human needs to see it is
  // that the Task is not dead, it is stuck: retry, then another worker, and
  // only then wake.
  if (outcome.kind === 'orphan') {
    const next = cur + 1;
    counters[outcome.taskId] = next;
    writeCounters(dataRoot, project, counters);
    if (next >= MAX_ATTEMPTS) {
      return {
        action: 'wake-pm', humanRequired: true,
        consecutiveFailures: next, wakeAction: 'needs-human',
      };
    }
    if (next >= 2 && outcome.fallbackAvailable) {
      return {
        action: 'fallback', humanRequired: false,
        consecutiveFailures: next, wakeAction: wakeFor('fallback'),
      };
    }
    return {
      action: 'retry', humanRequired: false,
      consecutiveFailures: next, wakeAction: wakeFor('retry'),
    };
  }

  // Run failures (VERIFYING CHANGES with thin reason behaves like a failure here).
  if (outcome.kind === 'fail' && outcome.reasonSufficient === false) {
    counters[outcome.taskId] = cur + 1;
    writeCounters(dataRoot, project, counters);
    return {
      action: 'wake-pm', humanRequired: true,
      consecutiveFailures: cur + 1, wakeAction: 'needs-human',
    };
  }
  const next = cur + 1;
  counters[outcome.taskId] = next;
  writeCounters(dataRoot, project, counters);
  if (next >= MAX_ATTEMPTS) {
    return {
      action: 'wake-pm', humanRequired: true,
      consecutiveFailures: next, wakeAction: 'needs-human',
    };
  }
  if (next >= 2 && outcome.fallbackAvailable) {
    return {
      action: 'fallback', humanRequired: false,
      consecutiveFailures: next, wakeAction: wakeFor('fallback'),
    };
  }
  return {
    action: 'retry', humanRequired: false,
    consecutiveFailures: next, wakeAction: wakeFor('retry'),
  };
}
