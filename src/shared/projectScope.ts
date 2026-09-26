/**
 * Pure project filter for a control-room board.
 * An empty project id returns the same board. Otherwise the result is a new
 * board whose lanes match that id (lane `id` or `project`, trimmed, case-insensitive).
 * Holds, today-done items, token findings and work records in the result belong
 * only to those lanes. The input board is never changed.
 */

const OWNED_LISTS = [
  'holds',
  'todayDone',
  'today_done',
  'doneToday',
  'done_today',
  'completedToday',
  'completed_today',
  'tokenFindings',
  'token_findings',
  'workRecords',
  'work_records',
] as const;

const OWNER_FIELDS = ['project', 'projectId', 'lane', 'laneId'] as const;

const TOKEN_LISTS = ['findings', 'anomalies', 'leaks', 'projects'] as const;

/** Same comparison as projectDisplayName: trim, then ignore case. */
function projectKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function laneMatches(lane: unknown, target: string): boolean {
  const record = asRecord(lane);
  if (!record) return false;
  return projectKey(record.id) === target || projectKey(record.project) === target;
}

/** Project keys a record claims. `id` counts only when no owner field is set. */
function ownerKeys(record: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const field of OWNER_FIELDS) {
    const key = projectKey(record[field]);
    if (key) keys.push(key);
  }
  if (keys.length === 0) {
    const id = projectKey(record.id);
    if (id) keys.push(id);
  }
  const raw = asRecord(record.raw);
  if (raw) keys.push(...ownerKeys(raw));
  return keys;
}

function itemBelongs(item: unknown, allowed: ReadonlySet<string>): boolean {
  const record = asRecord(item);
  if (!record) return false;
  return ownerKeys(record).some(key => allowed.has(key));
}

function filterOwnedList(value: unknown, allowed: ReadonlySet<string>): unknown {
  if (!Array.isArray(value)) return value;
  return value.filter(item => itemBelongs(item, allowed));
}

function scopedTokens(value: unknown, allowed: ReadonlySet<string>): unknown {
  const record = asRecord(value);
  if (!record) return value;
  if (!TOKEN_LISTS.some(key => Array.isArray(record[key]))) return value;
  const next: Record<string, unknown> = { ...record };
  for (const key of TOKEN_LISTS) {
    if (Array.isArray(record[key])) next[key] = filterOwnedList(record[key], allowed);
  }
  return next;
}

/**
 * Keep only the lanes for `projectId`, plus the holds, today-done items,
 * token findings and work records that belong to those lanes.
 * A blank project id returns `board` unchanged.
 */
export function scopeBoard<T>(board: T, projectId: string): T {
  const target = projectKey(projectId);
  if (!target) return board;
  const source = asRecord(board);
  if (!source) return board;

  const lanes = Array.isArray(source.lanes)
    ? source.lanes.filter(lane => laneMatches(lane, target))
    : source.lanes;
  const allowed = new Set<string>([target]);
  if (Array.isArray(lanes)) {
    for (const lane of lanes) {
      const record = asRecord(lane);
      if (!record) continue;
      const id = projectKey(record.id);
      const project = projectKey(record.project);
      if (id) allowed.add(id);
      if (project) allowed.add(project);
    }
  }

  const next: Record<string, unknown> = { ...source, lanes };
  for (const key of OWNED_LISTS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      next[key] = filterOwnedList(source[key], allowed);
    }
  }
  if (Object.prototype.hasOwnProperty.call(source, 'tokens')) {
    next.tokens = scopedTokens(source.tokens, allowed);
  }
  return next as T;
}
