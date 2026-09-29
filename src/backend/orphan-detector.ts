/**
 * Orphan (stalled Run) detection.
 *
 * A RUNNING Run is NOT dead just because it is quiet. This detector only
 * reports a heartbeat as stale when the worker is genuinely not answering, and
 * it refuses to report while any of the three liveness signals is present:
 *
 *   1. the worker process is alive and emitted output/heartbeat recently,
 *   2. the output is still changing (a long tool call is not a stall),
 *   3. the Task is waiting on QA (a human/adapter owns the clock, not us).
 *
 * Detection is a pure function of the signals so it can be unit-tested without
 * a process, and the decision ladder lives in auto-advance.ts.
 */

export interface OrphanDetectionConfig {
  /** No heartbeat AND no output for this long → suspect. */
  heartbeatStaleMs: number;
  /** How often the caller runs the sweep. */
  checkIntervalMs: number;
  /** Consecutive stale checks tolerated before acting. */
  graceRuns: number;
  /** A heartbeat newer than this means alive. */
  heartbeatFreshMs?: number;
}

export const DEFAULT_ORPHAN_CONFIG: OrphanDetectionConfig = {
  heartbeatStaleMs: 15 * 60 * 1000,
  checkIntervalMs: 2 * 60 * 1000,
  graceRuns: 3,
  heartbeatFreshMs: 60 * 1000,
};

export interface OrphanSignals {
  taskId: string;
  runId: string;
  workerId: string;
  /** Last time the worker proved liveness (output or explicit heartbeat). */
  lastHeartbeatAtMs: number | null;
  /** Last time the captured output changed. */
  lastOutputAtMs: number | null;
  /** Worker process still running. */
  processAlive: boolean;
  /** Task is in a QA / review state — the clock belongs to someone else. */
  qaPending: boolean;
  /** Consecutive stale checks already recorded (durable across sweeps). */
  staleChecks?: number;
}

export interface OrphanVerdict {
  orphan: boolean;
  /** Minutes of silence, for the human-facing report. */
  staleMinutes: number;
  reason: 'alive' | 'output-moving' | 'qa-pending' | 'grace-not-met' | 'stale';
  staleChecks: number;
}

const minutesBetween = (fromMs: number, toMs: number): number =>
  Math.max(0, Math.round((toMs - fromMs) / 60000));

/**
 * Decide whether one RUNNING Run is an orphan. Pure: same signals + same clock
 * always produce the same verdict, so tests need no real process.
 */
export function evaluateOrphan(
  signals: OrphanSignals,
  config: OrphanDetectionConfig = DEFAULT_ORPHAN_CONFIG,
  nowMs: number = Date.now(),
): OrphanVerdict {
  const fresh = config.heartbeatFreshMs ?? 60000;
  const heartbeatAge = signals.lastHeartbeatAtMs === null
    ? Number.POSITIVE_INFINITY
    : nowMs - signals.lastHeartbeatAtMs;
  const staleMinutes = signals.lastHeartbeatAtMs === null
    ? minutesBetween(nowMs, nowMs)
    : minutesBetween(signals.lastHeartbeatAtMs, nowMs);
  const base = { staleMinutes, staleChecks: signals.staleChecks ?? 0 };

  // 1. The worker is alive AND still proving liveness. A live process that has
  // stopped speaking is exactly the orphan we hunt (a SIGSTOPped or wedged
  // worker), so process survival alone never clears the verdict — only fresh
  // output does.
  if (signals.processAlive && heartbeatAge <= fresh) {
    return { ...base, orphan: false, reason: 'alive' };
  }

  // 2. Output is still moving — a long turn is not a stall.
  if (
    signals.lastOutputAtMs !== null
    && nowMs - signals.lastOutputAtMs < config.heartbeatStaleMs
  ) {
    return { ...base, orphan: false, reason: 'output-moving' };
  }

  // 3. QA owns the clock.
  if (signals.qaPending) {
    return { ...base, orphan: false, reason: 'qa-pending' };
  }

  // Grace: a single quiet sweep is never enough.
  const staleChecks = (signals.staleChecks ?? 0) + 1;
  if (staleChecks < config.graceRuns) {
    return { ...base, orphan: false, reason: 'grace-not-met', staleChecks };
  }

  return { ...base, orphan: true, reason: 'stale', staleChecks };
}

/** Sweep helper: sweep every live Run and keep only the orphans. */
export function findOrphanRuns(
  live: OrphanSignals[],
  config: OrphanDetectionConfig = DEFAULT_ORPHAN_CONFIG,
  nowMs: number = Date.now(),
): Array<{ signals: OrphanSignals; verdict: OrphanVerdict }> {
  return live
    .map((signals) => ({ signals, verdict: evaluateOrphan(signals, config, nowMs) }))
    .filter((r) => r.verdict.orphan);
}
