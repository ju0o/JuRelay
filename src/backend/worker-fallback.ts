/**
 * Worker fallback routing (Founder 2026-09-28).
 *
 * A worker that dies from a PROVIDER/RUNTIME cause (overload, dead model,
 * quota, auth, timeout, spawn failure) must not end the Task: the next
 * worker in priority order is picked and the Task auto-continues.
 * A worker that dies from a TASK cause (tests, types, scope) stays FAILED.
 *
 * Priority (Founder order): Codex Luna (default) → OpenCode free →
 * other free/cheap → Claude (only when explicitly enabled) → Terra LAST,
 * and Terra only for complex blockers (explicit flag, never automatic).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type FailureKind = 'provider' | 'task' | 'unknown';

const PROVIDER_PATTERNS: RegExp[] = [
  /service temporarily overloaded/i,
  /overloaded/i,
  /model not found/i,
  /quota|rate.?limit|429|402|balance exhausted|usage limit|out of credits/i,
  /unauthorized|unauthenticated|forbidden|login|sign.?in|auth/i,
  /timed out|timeout|ETIMEDOUT|ECONNREFUSED|ECONNRESET|socket hang up/i,
  /ENOENT|spawn .* ENOENT|cannot find module.*(claude|codex|cline|opencode)/i,
  /hook dispatch failed/i,
];

const TASK_PATTERNS: RegExp[] = [
  /assertion|expected|✗|failed test|FAIL\b.*test/i,
  /type ?error|TS\d+|tsc/i,
  /lint|eslint/i,
  /SCOPE|scope violation/i,
];

export function classifyExitFailure(text: string): { kind: FailureKind; reason: string } {
  const input = String(text || '');
  if (!input.trim()) return { kind: 'unknown', reason: 'empty output' };
  for (const pattern of PROVIDER_PATTERNS) {
    if (pattern.test(input)) {
      return { kind: 'provider', reason: `provider/runtime failure (${pattern.source.slice(0, 60)})` };
    }
  }
  for (const pattern of TASK_PATTERNS) {
    if (pattern.test(input)) {
      return { kind: 'task', reason: 'task failure (tests/types/scope)' };
    }
  }
  return { kind: 'unknown', reason: 'unclassified failure' };
}

/** Normal priority: Luna default → OpenCode free → other free/cheap. Terra excluded unless complex. */
export const FALLBACK_ORDER = [
  'builder-codex',
  'builder-opencode',
  'builder-cline',
] as const;

export const TERRA_WORKER_ID = 'builder-codex-terra';

function claudeFallbackEnabled(): boolean {
  return process.env['AGENT_RELAY_ENABLE_CLAUDE_FALLBACK'] === '1';
}

export function pickFallbackWorker(
  triedWorkerIds: string[],
  opts: { complex?: boolean } = {},
): string | null {
  const tried = new Set(triedWorkerIds);
  const order: string[] = [...FALLBACK_ORDER];
  if (claudeFallbackEnabled()) {
    order.push('builder-claude-pro', 'builder-claude-live');
  }
  if (opts.complex) {
    order.push(TERRA_WORKER_ID);
  }
  for (const id of order) {
    if (!tried.has(id)) return id;
  }
  return null;
}

export interface FallbackRecord {
  schemaVersion: 1;
  taskId: string;
  fromWorkerId: string;
  toWorkerId: string;
  reason: string;
  at: string;
}

export function writeFallbackRecord(runFolder: string, record: Omit<FallbackRecord, 'schemaVersion' | 'at'>): void {
  try {
    const full: FallbackRecord = {
      schemaVersion: 1, ...record, at: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(runFolder, 'fallback.json'), JSON.stringify(full, null, 2) + '\n', 'utf8',
    );
  } catch {
    // Diagnostics never break the loop.
  }
}

export function readFallbackRecord(runFolder: string): FallbackRecord | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(runFolder, 'fallback.json'), 'utf8'));
    if (raw && raw.schemaVersion === 1 && typeof raw.toWorkerId === 'string') return raw as FallbackRecord;
    return null;
  } catch {
    return null;
  }
}
