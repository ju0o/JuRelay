/**
 * Pure project filter for a control-room board, and the shared-seat line.
 * An empty project id returns the same board. Otherwise the result is a new
 * board whose lanes match that id (lane `id` or `project`, trimmed, case-insensitive).
 * Holds, today-done items, token findings and work records in the result belong
 * only to those lanes. Board-wide `capacity` is kept as-is (every window shares it).
 * The input board is never changed.
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

/** Founder-facing shared-seat card. Null means the board did not say — never guess. */
export interface SharedSeatsView {
  /** 전체 AI 자리 N개 중 M개 사용 중 */
  line: string;
  max: number;
  busy: number;
  /** Bar fill, 0–100. */
  percent: number;
  /** Project window only: 이 프로젝트는 다음 차례예요. Otherwise null. */
  waiting: string | null;
  /** Amber line when lowMemory is true and freeMb is a real number. Otherwise null. */
  memory: string | null;
  /** Capacity JSON for 원문 보기. Not for the surface. */
  raw: string;
}

const QUEUED_STATE = 'QUEUED';

/** Seat use and the "지금 일하는 AI" tile. REQUEST_CHANGES and QUEUED stay out. */
const WORKING_STATES = new Set(['RUNNING', 'QA']);

function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isFreeMb(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Megabytes → GB, one decimal, trailing .0 dropped. */
function formatFreeGb(freeMb: number): string {
  const tenths = Math.round((freeMb / 1024) * 10);
  const whole = Math.trunc(tenths / 10);
  const frac = Math.abs(tenths % 10);
  return frac === 0 ? String(whole) : `${whole}.${frac}`;
}

function seatPercent(busy: number, max: number): number {
  if (max <= 0) return busy > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((busy / max) * 100)));
}

function isQueuedValue(value: unknown): boolean {
  return value === QUEUED_STATE;
}

/** True only when this lane itself carries QUEUED work. Does not invent a queue. */
function laneHasQueuedWork(lane: unknown): boolean {
  const record = asRecord(lane);
  if (!record) return false;
  if (isQueuedValue(record.state) || isQueuedValue(record.status)) return true;
  const current = asRecord(record.current);
  if (current && (isQueuedValue(current.state) || isQueuedValue(current.status) || isQueuedValue(current.stage))) {
    return true;
  }
  const counts = asRecord(record.counts);
  const queuedCount = counts?.QUEUED;
  if (typeof queuedCount === 'number' && Number.isFinite(queuedCount) && queuedCount > 0) return true;
  if (!Array.isArray(record.tasks)) return false;
  return record.tasks.some(task => {
    if (isQueuedValue(task)) return true;
    const item = asRecord(task);
    return item !== null && (isQueuedValue(item.state) || isQueuedValue(item.status));
  });
}

function taskWorkState(task: unknown): string {
  if (typeof task === 'string') return task.trim();
  const record = asRecord(task);
  if (!record) return '';
  const state = record.state ?? record.status;
  return typeof state === 'string' ? state.trim() : '';
}

function countWorkingInList(list: unknown): number | null {
  if (!Array.isArray(list)) return null;
  return list.filter(item => WORKING_STATES.has(taskWorkState(item))).length;
}

/** Lane `counts.RUNNING` + `counts.QA` when either key is present. Otherwise null. */
function countWorkingInCounts(counts: unknown): number | null {
  const record = asRecord(counts);
  if (!record) return null;
  if (!Object.prototype.hasOwnProperty.call(record, 'RUNNING')
    && !Object.prototype.hasOwnProperty.call(record, 'QA')) {
    return null;
  }
  let total = 0;
  for (const key of ['RUNNING', 'QA'] as const) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = record[key];
    if (isSafeCount(value)) total += value;
  }
  return total;
}

/**
 * Tasks in RUNNING or QA. This is the only used-seat number.
 * A top-level `tasks` list wins so the same work is not counted again on lanes.
 * Otherwise each lane uses its `tasks` list, then `counts`, then `current`.
 * A lane's own `state: "RUNNING"` is not a task and is not counted.
 * Does not change `board`.
 */
export function countWorkingTasks(board: unknown): number {
  const source = asRecord(board);
  if (!source) return 0;
  const listed = countWorkingInList(source.tasks);
  if (listed !== null) return listed;
  if (!Array.isArray(source.lanes)) return 0;
  let total = 0;
  for (const lane of source.lanes) {
    const record = asRecord(lane);
    if (!record) continue;
    const laneTasks = countWorkingInList(record.tasks);
    if (laneTasks !== null) {
      total += laneTasks;
      continue;
    }
    const fromCounts = countWorkingInCounts(record.counts);
    if (fromCounts !== null) {
      total += fromCounts;
      continue;
    }
    if (WORKING_STATES.has(taskWorkState(record.current))) total += 1;
  }
  return total;
}

/**
 * Shared seat line. Total is `capacity.maxBuilders`. Used count is
 * `countWorkingTasks` (RUNNING or QA), never `capacity.busy`.
 * Returns null when capacity or maxBuilders is missing — the tile still shows.
 * `projectId` is the open project window; a blank id never adds the waiting line.
 * Does not change `board`.
 */
export function sharedSeatsView(board: unknown, projectId = ''): SharedSeatsView | null {
  const source = asRecord(board);
  if (!source || !Object.prototype.hasOwnProperty.call(source, 'capacity')) return null;
  const capacity = asRecord(source.capacity);
  if (!capacity) return null;
  if (!isSafeCount(capacity.maxBuilders)) return null;

  const max = capacity.maxBuilders;
  const busy = countWorkingTasks(source);
  const waiting = projectKey(projectId) !== ''
    && busy >= max
    && Array.isArray(source.lanes)
    && source.lanes.some(lane => laneMatches(lane, projectKey(projectId)) && laneHasQueuedWork(lane))
    ? '이 프로젝트는 다음 차례예요'
    : null;
  const memory = capacity.lowMemory === true && isFreeMb(capacity.freeMb)
    ? `RAM이 부족해서 새 작업을 잠시 멈췄어요 (남은 ${formatFreeGb(capacity.freeMb)} GB)`
    : null;

  let raw = '';
  try {
    raw = JSON.stringify(capacity, null, 2) ?? '';
  } catch {
    raw = '';
  }

  return {
    line: `전체 AI 자리 ${max}개 중 ${busy}개 사용 중`,
    max,
    busy,
    percent: seatPercent(busy, max),
    waiting,
    memory,
    raw,
  };
}
