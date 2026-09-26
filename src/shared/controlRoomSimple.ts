import {
  aiDisplayName,
  isLatinSentence,
  isSelfReviewOption,
  projectDisplayName,
  visibleHoldEntries,
} from './projectLabels.js';
import type { NormalizedHold } from './projectLabels.js';
import { NEW_TASK_TITLE, controlRoomTaskId, controlRoomTaskTitle, founderTaskTitle } from './types.js';

/** How many founder holds the first screen shows before 더 보기. */
export const CONTROL_ROOM_HOLD_PREVIEW = 3;

export interface ControlRoomStatusSentence {
  tone: 'teal' | 'amber' | 'muted';
  /** One sentence for the top of the control room. Never empty. */
  text: string;
  /** Empty when the Founder has nothing to choose. */
  actionLabel: '' | '고르기';
  workingProjects: number;
  chooseCount: number;
  /** Holds that proceed on their own (waitMin set, not a self-review). */
  autoCount: number;
  /** Muted second line. Empty when nothing proceeds on its own. */
  autoLine: string;
}

export type ControlRoomRowState = '일하는 중' | '쉬는 중' | '확인 필요';

export interface ControlRoomSimpleRow {
  key: string;
  name: string;
  /** One line: what this project is doing now. */
  doing: string;
  state: ControlRoomRowState;
  tone: 'teal' | 'muted' | 'amber';
}

export interface ControlRoomFounderHold {
  key: string;
  kind: 'hold' | 'gate';
  laneKey: string;
  /** Index in the lane's visible holds. -1 for a gate. */
  holdIndex: number;
  taskId: string;
  projectName: string;
  title: string;
  sentence: string;
  /** Task id and original reason. Shown only under 원문 보기. */
  raw: string;
}

const STAGE_VERB = ['계획하는', '확인하는', '만드는', '검사하는', '시험하는', '대표님 확인을 기다리는', '반영하는'];
const START_KEYS = ['startedAt', 'started_at', 'startAt', 'since'];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function lanesOf(board: unknown): Record<string, unknown>[] {
  const root = asRecord(board);
  if (!root || !Array.isArray(root.lanes)) return [];
  return root.lanes.filter((lane): lane is Record<string, unknown> => Boolean(asRecord(lane)));
}

/**
 * Stable key for one lane. The index keeps two nameless lanes apart.
 */
export function controlRoomLaneKey(lane: unknown, index: number): string {
  const record = asRecord(lane);
  const id = typeof record?.id === 'string' ? record.id.trim() : '';
  const project = typeof record?.project === 'string' ? record.project.trim() : '';
  return `${id || project || 'lane'}:${index}`;
}

function projectNameOf(lane: Record<string, unknown>): string {
  const id = typeof lane.project === 'string' && lane.project.trim()
    ? lane.project
    : typeof lane.id === 'string' ? lane.id : '';
  return id.trim() ? projectDisplayName(id) : '알 수 없는 프로젝트';
}

function stageIndex(stage: unknown): number {
  if (typeof stage === 'number' && Number.isFinite(stage)) return Math.max(0, Math.min(6, Math.floor(stage)));
  const value = String(stage ?? '').toUpperCase();
  if (value.includes('INTEGR') || value.includes('반영') || value === 'DONE' || value === 'COMPLETE') return 6;
  if (value.includes('HUMAN') || value.includes('FOUNDER') || value.includes('사람')) return 5;
  if (value.includes('GATE') || value.includes('시험')) return 4;
  if (value.includes('QA') || value.includes('검수')) return 3;
  if (value.includes('WORKER') || value.includes('BUILDER') || value.includes('작업')) return 2;
  if (value.includes('VERIF') || value.includes('확인')) return 1;
  return 0;
}

function firstRuntime(value: unknown): string {
  if (typeof value === 'string') {
    return value.split(/[,|\s>→]+/).map((part) => part.trim()).find((part) => part.length > 0) ?? '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = firstRuntime(item);
      if (id) return id;
    }
    return '';
  }
  const record = asRecord(value);
  if (!record) return '';
  const chain = record.chain ?? record.runtimes ?? record.order;
  if (Array.isArray(chain) || typeof chain === 'string') return firstRuntime(chain);
  const single = record.name ?? record.id ?? record.runtime;
  return typeof single === 'string' ? single.trim() : '';
}

function runtimeLabel(id: string): string {
  return id === 'opencode-free' ? '무료 모델(예비)' : aiDisplayName(id);
}

function subjectParticle(name: string): string {
  const code = name.charCodeAt(name.length - 1);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0 ? '이' : '가';
}

function minutesSince(value: unknown, now: number): number | null {
  const ms = typeof value === 'number'
    ? (value < 1e12 ? value * 1000 : value)
    : typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((now - ms) / 60000));
}

function spanText(min: number): string {
  if (min < 60) return `${min}분`;
  if (min < 1440) return min % 60 ? `${Math.floor(min / 60)}시간 ${min % 60}분` : `${min / 60}시간`;
  return `${Math.floor(min / 1440)}일`;
}

function hasCurrentWork(lane: Record<string, unknown>): boolean {
  const current = asRecord(lane.current) ?? {};
  return controlRoomTaskTitle(current) !== '' || controlRoomTaskId(current) !== '';
}

/** Explicit pause. A hold or a blocker is not this state. */
function isPaused(lane: Record<string, unknown>): boolean {
  const current = asRecord(lane.current) ?? {};
  const stage = `${current.stage ?? ''} ${lane.state ?? ''} ${lane.status ?? ''}`;
  return lane.paused === true || current.paused === true || lane.enabled === false || /pause/i.test(stage);
}

function hasBlocker(lane: Record<string, unknown>): boolean {
  if (typeof lane.blocker === 'string') return lane.blocker.trim().length > 0;
  return lane.blocker === true;
}

/**
 * A hold the system will finish without the Founder.
 * waitMin alone is enough — a missing start clock still means "proceeds in N minutes".
 * "I'll look myself" still waits for the Founder, even when waitMin is set.
 */
function willAutoProceed(hold: NormalizedHold): boolean {
  if (hold.choice || hold.choiceLabel) return false;
  if (hold.waitMin === null) return false;
  const recommended = hold.options[hold.recommendedIndex] ?? '';
  return !isSelfReviewOption(recommended);
}

/** Muted line for holds that retry on their own. */
function autoProceedLine(count: number): string {
  if (count <= 0) return '';
  return `자동으로 다시 하는 중 ${count}개 · 원하면 골라 주세요`;
}

/** Latin words that are product or AI names, not developer status text. */
function isAllowedLatin(word: string): boolean {
  return /^(agent|relay|actl|juplan|juceipt|jucontroler|jutell|juai|juradar|codex|claude|opencode|grok|cursor|cline|team|pro|ai)$/i.test(word);
}

function hasDeveloperLatin(text: string): boolean {
  const words = text.match(/[A-Za-z]{2,}/g) ?? [];
  return words.some((word) => !isAllowedLatin(word));
}

function plainSentence(text: string, fallback: string): string {
  const sentence = text.trim();
  if (!sentence || !/[\uac00-\ud7a3]/.test(sentence) || hasDeveloperLatin(sentence) || isLatinSentence(sentence)) return fallback;
  return sentence;
}

function plainTitle(raw: unknown, sentence: string): string {
  const titled = founderTaskTitle(raw);
  if (titled !== NEW_TASK_TITLE && !hasDeveloperLatin(titled) && !isLatinSentence(titled)) return titled;
  const fromSentence = plainSentence(sentence, '');
  if (fromSentence) return fromSentence.length > 42 ? `${fromSentence.slice(0, 42)}…` : fromSentence;
  return '멈춘 작업';
}

function doingLine(lane: Record<string, unknown>, now: number): string {
  if (!hasCurrentWork(lane)) return isPaused(lane) ? '잠시 멈춘 프로젝트예요.' : '지금 하는 일이 없어요';
  const current = asRecord(lane.current) ?? {};
  const title = founderTaskTitle(current);
  if (isPaused(lane)) return `'${title}' 작업이 멈춰 있어요.`;
  const idx = stageIndex(current.stage ?? 0);
  const picked = idx >= 3
    ? firstRuntime(current.qa) || firstRuntime(lane.qaChain)
    : firstRuntime(current.worker) || firstRuntime(lane.workerChain);
  const ai = picked ? runtimeLabel(picked) : 'AI';
  const started = START_KEYS.map((key) => current[key]).find((value) => value !== undefined && value !== '');
  const startedMin = minutesSince(started, now);
  const elapsed = startedMin === null ? '' : startedMin < 1 ? ' · 방금 시작' : ` · ${spanText(startedMin)}째`;
  return `${ai}${subjectParticle(ai)} '${title}' ${STAGE_VERB[idx] ?? '진행하는'} 중${elapsed}`;
}

function gateRecord(lane: Record<string, unknown>): Record<string, unknown> | null {
  const gate = lane.humanGate ?? lane.founderGate;
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) return null;
  return gate as Record<string, unknown>;
}

function founderHoldsOnLane(lane: Record<string, unknown>, laneKey: string): ControlRoomFounderHold[] {
  const projectName = projectNameOf(lane);
  const rawHolds = Array.isArray(lane.holds) ? lane.holds : [];
  const items: ControlRoomFounderHold[] = [];
  visibleHoldEntries(lane.holds).forEach((hold, holdIndex) => {
    if (willAutoProceed(hold) || hold.choice || hold.choiceLabel) return;
    const raw = rawHolds.find((entry) => asRecord(entry) !== null && controlRoomTaskId(entry) === hold.taskId && hold.taskId !== '') ?? hold;
    const sentence = plainSentence(hold.sentence, '어떻게 할지 골라 주세요.');
    items.push({
      key: `${laneKey}:hold:${hold.taskId || holdIndex}`,
      kind: 'hold',
      laneKey,
      holdIndex,
      taskId: hold.taskId,
      projectName,
      title: plainTitle(raw, hold.sentence),
      sentence,
      raw: [hold.taskId, hold.reason].filter((part) => part.trim().length > 0).join('\n'),
    });
  });
  const gate = gateRecord(lane);
  if (gate) {
    const ask = [gate.ask, gate.title, gate.question, gate.summary].find((value) => typeof value === 'string') ?? '';
    const gateId = typeof gate.gateId === 'string' ? gate.gateId : typeof gate.id === 'string' ? gate.id : '';
    items.push({
      key: `${laneKey}:gate`,
      kind: 'gate',
      laneKey,
      holdIndex: -1,
      taskId: '',
      projectName,
      title: '결정이 필요해요',
      sentence: plainSentence(typeof ask === 'string' ? ask : '', '답을 골라 주세요.'),
      raw: [gateId, typeof ask === 'string' ? ask : ''].filter((part) => part.trim().length > 0).join('\n'),
    });
  }
  return items;
}

function rowState(lane: Record<string, unknown>, founderOnLane: boolean): { state: ControlRoomRowState; tone: ControlRoomSimpleRow['tone'] } {
  if (founderOnLane || isPaused(lane) || hasBlocker(lane)) return { state: '확인 필요', tone: 'amber' };
  if (hasCurrentWork(lane)) return { state: '일하는 중', tone: 'teal' };
  return { state: '쉬는 중', tone: 'muted' };
}

/** Holds with a wait that the system finishes. Chosen and self-review holds are not included. */
function autoProceedCountOnLane(lane: Record<string, unknown>): number {
  return visibleHoldEntries(lane.holds).filter((hold) => willAutoProceed(hold)).length;
}

/**
 * Sentence shown before the board arrives. The card always has this line — never a blank block.
 */
export function controlRoomLoadingStatus(): ControlRoomStatusSentence {
  return {
    tone: 'muted',
    text: '상태를 확인하고 있어요',
    actionLabel: '',
    workingProjects: 0,
    chooseCount: 0,
    autoCount: 0,
    autoLine: '',
  };
}

/**
 * Top sentence. Amber when the Founder has something to choose.
 * Only gates and holds with no waitMin (and self-review holds) count as choices.
 * Holds that proceed on their own are a muted line, not part of that count.
 */
export function controlRoomStatusSentence(board: unknown): ControlRoomStatusSentence {
  const lanes = lanesOf(board);
  const chooseCount = lanes.reduce((sum, lane, index) => sum + founderHoldsOnLane(lane, controlRoomLaneKey(lane, index)).length, 0);
  const autoCount = lanes.reduce((sum, lane) => sum + autoProceedCountOnLane(lane), 0);
  const workingProjects = lanes.filter((lane) => hasCurrentWork(lane) && !isPaused(lane)).length;
  const autoLine = autoProceedLine(autoCount);
  if (chooseCount > 0) {
    return {
      tone: 'amber',
      text: `대표님이 고를 것 ${chooseCount}개`,
      actionLabel: '고르기',
      workingProjects,
      chooseCount,
      autoCount,
      autoLine,
    };
  }
  return {
    tone: 'teal',
    text: `지금 ${workingProjects}개 프로젝트가 일하는 중 · 대표님이 하실 일 없어요`,
    actionLabel: '',
    workingProjects,
    chooseCount: 0,
    autoCount,
    autoLine,
  };
}

/**
 * One compact row per project, in lane order.
 * 확인 필요 wins over 일하는 중 when this project needs the Founder.
 */
export function controlRoomSimpleRows(board: unknown, now: number = Date.now()): ControlRoomSimpleRow[] {
  return lanesOf(board).map((lane, index) => {
    const key = controlRoomLaneKey(lane, index);
    const founderOnLane = founderHoldsOnLane(lane, key).length > 0;
    const state = rowState(lane, founderOnLane);
    return {
      key,
      name: projectNameOf(lane),
      doing: doingLine(lane, now),
      state: state.state,
      tone: state.tone,
    };
  });
}

/**
 * Holds and gates the Founder must answer.
 * A hold that will proceed on its own at a set time is left out.
 */
export function controlRoomFounderHolds(board: unknown): ControlRoomFounderHold[] {
  return lanesOf(board).flatMap((lane, index) => founderHoldsOnLane(lane, controlRoomLaneKey(lane, index)));
}

/**
 * First screen shows at most three founder holds until 더 보기.
 */
export function controlRoomFounderHoldPreview<T>(items: readonly T[], showAll = false): { shown: T[]; hidden: number } {
  const list = Array.isArray(items) ? [...items] : [];
  if (showAll || list.length <= CONTROL_ROOM_HOLD_PREVIEW) return { shown: list, hidden: 0 };
  return {
    shown: list.slice(0, CONTROL_ROOM_HOLD_PREVIEW),
    hidden: list.length - CONTROL_ROOM_HOLD_PREVIEW,
  };
}
