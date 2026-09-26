/**
 * 작업 기록 — 자동 목록.
 * night-board 가 보드 맨 위에 두는 done[] ({lane, taskId, title, at}) 과
 * 각 lane 의 channel 메시지로 고른 날짜에 끝난 작업을 한 줄씩 만든다.
 * lanes[].done[] 도 같은 줄로 읽는다. 화면 줄에는 작업 id·영어 원문을 올리지 않고, 원문은 raw 로만 넘긴다. Pure.
 */
import { founderTaskTitle, controlRoomTaskId } from './types.js';
import { projectDisplayName } from './projectLabels.js';

export interface WorklogRow {
  key: string;
  line: string;
  ask: string;
  result: string;
  copyText: string;
  raw: string;
}

type Rec = Record<string, unknown>;

const AT_KEYS = ['at', 'finishedAt', 'finished_at', 'completedAt', 'completed_at', 'doneAt', 'done_at', 'timestamp'] as const;
const TEXT_KEYS = ['text', 'body', 'message', 'summary', 'content'] as const;
const KIND_KEYS = ['kind', 'type', 'role', 'from'] as const;
const MESSAGE_KEYS = ['channel', 'messages', 'channelMessages', 'channel_messages'] as const;

function rec(value: unknown): Rec | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : null;
}

function pick(record: Rec, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function localYmd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 로컬 시각 '오후 2:10'. */
export function worklogClock(ms: number): string {
  const d = new Date(ms);
  const hour = d.getHours();
  return `${hour < 12 ? '오전' : '오후'} ${hour % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** QA 판정 → 쉬운 한 줄. 채널 원문은 'ACCEPT:' 로 시작한다. 모르는 말이면 ''. */
export function worklogVerdictLine(verdict: string): string {
  const token = (verdict.trim().match(/^[A-Za-z_]+/)?.[0] ?? '').toUpperCase();
  if (token === 'REQUEST_CHANGES' || token === 'REJECT' || token === 'FAIL') return '검사에서 고칠 점이 나왔어요';
  if (token === 'APPROVE' || token === 'ACCEPT' || token === 'PASS' || token === 'OK') return '검사 통과';
  const v = verdict.toUpperCase();
  if (/REQUEST_CHANGES|REJECT|FAIL/.test(v)) return '검사에서 고칠 점이 나왔어요';
  if (/APPROVE|ACCEPT|PASS|OK/.test(v)) return '검사 통과';
  return '';
}

/** 한국어가 들어 있는 문장만 화면에 올린다. 영어뿐이면 fallback. */
function plain(text: string, fallback: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine || !/[가-힣]/.test(oneLine)) return fallback;
  return oneLine.length > 140 ? `${oneLine.slice(0, 139)}…` : oneLine;
}

function laneNameOf(record: Rec): string {
  return pick(record, ['lane', 'project', 'id']);
}

function messagesOf(lane: Rec): Rec[] {
  return MESSAGE_KEYS.flatMap(key => Array.isArray(lane[key]) ? lane[key] as unknown[] : [])
    .map(rec).filter((m): m is Rec => m !== null);
}

/** 루트 done[] 이 실제 보드(night-board)이고, lanes[].done[] 은 예전 모양이다. */
function finishedTasks(root: Rec, lanes: Rec[]): Array<{ task: Rec; laneName: string }> {
  const out: Array<{ task: Rec; laneName: string }> = [];
  const seen = new Set<string>();
  const push = (value: unknown, fallbackLane: string): void => {
    const task = rec(value);
    if (!task) return;
    const laneName = laneNameOf(task) || fallbackLane;
    const at = pick(task, AT_KEYS);
    const key = `${laneName.toLowerCase()}\n${controlRoomTaskId(task)}\n${at}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ task, laneName });
  };
  if (Array.isArray(root.done)) {
    for (const item of root.done) push(item, '');
  }
  for (const lane of lanes) {
    if (!Array.isArray(lane.done)) continue;
    const fallback = laneNameOf(lane);
    for (const item of lane.done) push(item, fallback);
  }
  return out;
}

function messagesFor(lanes: Rec[], laneName: string, taskId: string): Rec[] {
  if (!taskId) return [];
  const key = laneName.trim().toLowerCase();
  const matched = key
    ? lanes.filter(lane => ['id', 'project', 'lane'].some(field => pick(lane, [field]).toLowerCase() === key))
    : [];
  const pool = (matched.length > 0 ? matched : lanes).flatMap(messagesOf);
  return pool.filter(m => controlRoomTaskId(m) === taskId);
}

/** 고른 날짜(YYYY-MM-DD)에 끝난 작업 줄. 최신이 위. */
export function worklogRows(board: unknown, date: string): WorklogRow[] {
  const root = rec(board);
  if (!root) return [];
  const lanes = (Array.isArray(root.lanes) ? root.lanes : []).map(rec).filter((lane): lane is Rec => lane !== null);
  const rows: Array<WorklogRow & { ms: number }> = [];
  for (const { task, laneName } of finishedTasks(root, lanes)) {
    const ms = Date.parse(pick(task, AT_KEYS));
    if (!Number.isFinite(ms) || localYmd(ms) !== date) continue;
    const taskId = controlRoomTaskId(task);
    const title = founderTaskTitle(task);
    const mine = messagesFor(lanes, laneName, taskId);
    const kindOf = (m: Rec): string => pick(m, KIND_KEYS).toLowerCase();
    const scopeMsg = mine.find(m => /scope|task|instruction|prompt|지시/.test(kindOf(m)));
    const resultMsg = [...mine].reverse().find(m => /result|summary|report|결과/.test(kindOf(m)));
    const qaMsg = [...mine].reverse().find(m => /qa|verdict|review|검사/.test(kindOf(m)) || typeof m.verdict === 'string');
    const scope = pick(task, ['scope', 'description']) || (scopeMsg ? pick(scopeMsg, TEXT_KEYS) : '');
    const summary = pick(task, ['result', 'resultSummary']) || (resultMsg ? pick(resultMsg, TEXT_KEYS) : '');
    const verdict = qaMsg ? worklogVerdictLine(pick(qaMsg, ['verdict', ...TEXT_KEYS])) : '';
    const ask = plain(scope, `'${title}' 작업을 맡겼어요`);
    const finished = plain(summary, '작업을 끝냈어요');
    const result = verdict ? `${finished} · ${verdict}` : finished;
    const line = `${projectDisplayName(laneName) || '프로젝트'} · ${title} · ${worklogClock(ms)}`;
    const raw = [
      taskId && `taskId: ${taskId}`,
      laneName && `lane: ${laneName}`,
      scope && `scope: ${scope}`,
      summary && `result: ${summary}`,
      ...mine.map(m => `[${pick(m, KIND_KEYS) || 'message'}] ${pick(m, ['verdict', ...TEXT_KEYS])}`),
    ].filter(Boolean).join('\n');
    rows.push({
      key: `${laneName}:${taskId || title}:${ms}`,
      line,
      ask,
      result,
      copyText: `${line}\n지시: ${ask}\n결과: ${result}`,
      raw,
      ms,
    });
  }
  return rows.sort((a, b) => b.ms - a.ms).map(({ ms: _ms, ...row }) => row);
}
