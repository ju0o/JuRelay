/**
 * 작업 기록 — 자동 목록.
 * controlRoom:board 의 lanes[].done[] 과 각 lane 의 채널 메시지로
 * 고른 날짜에 끝난 작업을 '프로젝트 · 제목 · 시각' 한 줄씩 만든다.
 * 화면 줄에는 작업 id·영어 원문을 올리지 않고, 원문은 raw 로만 넘긴다. Pure.
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

/** QA 판정 → 쉬운 한 줄. 모르는 말이면 ''. */
export function worklogVerdictLine(verdict: string): string {
  const v = verdict.toUpperCase();
  if (/REQUEST_CHANGES|REJECT|FAIL/.test(v)) return '검사에서 고칠 점이 나왔어요';
  if (/APPROVE|PASS|OK/.test(v)) return '검사 통과';
  return '';
}

/** 한국어가 들어 있는 문장만 화면에 올린다. 영어뿐이면 fallback. */
function plain(text: string, fallback: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine || !/[가-힣]/.test(oneLine)) return fallback;
  return oneLine.length > 140 ? `${oneLine.slice(0, 139)}…` : oneLine;
}

/** 고른 날짜(YYYY-MM-DD)에 끝난 작업 줄. 최신이 위. */
export function worklogRows(board: unknown, date: string): WorklogRow[] {
  const root = rec(board);
  const lanes = root && Array.isArray(root.lanes) ? root.lanes : [];
  const rows: Array<WorklogRow & { ms: number }> = [];
  for (const laneValue of lanes) {
    const lane = rec(laneValue);
    if (!lane) continue;
    const project = pick(lane, ['project', 'id']);
    const messages = MESSAGE_KEYS.flatMap(key => Array.isArray(lane[key]) ? lane[key] as unknown[] : [])
      .map(rec).filter((m): m is Rec => m !== null);
    const done = Array.isArray(lane.done) ? lane.done : [];
    for (const taskValue of done) {
      const task = rec(taskValue);
      if (!task) continue;
      const ms = Date.parse(pick(task, AT_KEYS));
      if (!Number.isFinite(ms) || localYmd(ms) !== date) continue;
      const taskId = controlRoomTaskId(task);
      const title = founderTaskTitle(task);
      const mine = messages.filter(m => taskId && controlRoomTaskId(m) === taskId);
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
      const line = `${projectDisplayName(project) || '프로젝트'} · ${title} · ${worklogClock(ms)}`;
      const raw = [
        taskId && `taskId: ${taskId}`,
        project && `project: ${project}`,
        scope && `scope: ${scope}`,
        summary && `result: ${summary}`,
        ...mine.map(m => `[${pick(m, KIND_KEYS) || 'message'}] ${pick(m, ['verdict', ...TEXT_KEYS])}`),
      ].filter(Boolean).join('\n');
      rows.push({
        key: `${project}:${taskId || title}:${ms}`,
        line,
        ask,
        result,
        copyText: `${line}\n지시: ${ask}\n결과: ${result}`,
        raw,
        ms,
      });
    }
  }
  return rows.sort((a, b) => b.ms - a.ms).map(({ ms: _ms, ...row }) => row);
}
