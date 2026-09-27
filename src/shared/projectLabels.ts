export interface ProjectLabel {
  name: string;
  goal: string;
  /** 저장소 폴더. 이름이 비어 있을 때만 폴더 이름으로 보여주고, 경로 자체는 화면에 올리지 않는다. */
  path?: string;
}

/**
 * 코드에 실린 기본 목록은 비어 있다.
 * 이름과 목표는 사용자 설정(`settings.json`의 projectLabels, 또는 같은 JSON을 담은
 * localStorage `agent-relay.project-labels`)에서만 온다. 파일이 없거나 깨져 있어도 예외를 내지 않는다.
 */
export const PROJECT_LABELS: Record<string, ProjectLabel> = {};

/** 브라우저가 기억하는 사용자 프로젝트 설정 키. 파일과 같은 JSON이다. */
export const PROJECT_LABELS_STORAGE_KEY = 'agent-relay.project-labels';

/** JuControler 허브로 보는 제품 id. 다른 프로젝트 목록은 코드에 두지 않는다. */
const HUB_PROJECT_IDS = new Set(['jucontroler', 'jucontroler-app']);

let hubFromConfig = false;

export interface UserProjectConfig {
  labels: Record<string, ProjectLabel>;
  /** 사용자 설정이 JuControler 허브를 가리키면 true. */
  hub: boolean;
}

/** 사용자 홈 아래의 프로젝트 이름 파일. 특정 사람·PC 경로는 넣지 않는다. */
export function userProjectConfigPath(home: string): string {
  const base = home.trim().replace(/[\\/]+$/, '');
  if (!base) return '';
  return `${base}/.config/agent-relay/project-labels.json`;
}

/**
 * 설정 파일을 읽는다. 없거나 읽기 실패면 null. 예외를 밖으로 던지지 않는다.
 * @param read 경로를 받아 문자열을 돌려주는 함수. 실패하면 던져도 된다.
 * @param file 사용자 설정 파일 경로
 */
export function readUserProjectConfigText(read: (file: string) => string, file: string): string | null {
  try {
    const text = read(file);
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

/** 저장소 경로에서 폴더 이름만. 경로를 읽지 못하면 ''. */
export function folderDisplayName(folder: unknown): string {
  if (typeof folder !== 'string') return '';
  const trimmed = folder.trim().replace(/[\\/]+$/, '');
  if (!trimmed || trimmed === '.' || trimmed === '..') return '';
  const parts = trimmed.split(/[\\/]/).filter(part => part.length > 0 && part !== '.');
  const base = parts[parts.length - 1] ?? '';
  return base === '..' ? '' : base;
}

function labelFromEntry(value: unknown): ProjectLabel | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const goal = typeof record.goal === 'string' ? record.goal.trim() : '';
  const path = typeof record.path === 'string' ? record.path.trim() : '';
  if (!name && !goal && !path) return null;
  const label: ProjectLabel = { name, goal };
  if (path) label.path = path;
  return label;
}

function hubFlagOf(value: unknown): boolean {
  if (value === true) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (value as Record<string, unknown>).configured === true;
}

/**
 * 사용자 프로젝트 설정. 객체 또는 JSON 문자열.
 * `{ projects: { id: { name, goal, path } }, hub }` 또는 id → { name, goal } 평평한 표 둘 다 받는다.
 * 깨진 값이면 빈 설정. 예외 없음.
 */
export function parseUserProjectConfig(input: unknown): UserProjectConfig {
  try {
    const value = typeof input === 'string' ? JSON.parse(input) as unknown : input;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { labels: {}, hub: false };
    const record = value as Record<string, unknown>;
    const nested = record.projects ?? record.labels;
    const source = nested && typeof nested === 'object' && !Array.isArray(nested)
      ? nested as Record<string, unknown>
      : record;
    const labels: Record<string, ProjectLabel> = {};
    for (const [id, entry] of Object.entries(source)) {
      if (id === 'hub' || id === 'projects' || id === 'labels' || id === 'schema') continue;
      const key = id.trim().toLowerCase();
      if (!key) continue;
      const label = labelFromEntry(entry);
      if (!label) continue;
      labels[key] = label;
    }
    const hub = hubFlagOf(record.hub) || Object.keys(labels).some(id => HUB_PROJECT_IDS.has(id));
    return { labels, hub };
  } catch {
    return { labels: {}, hub: false };
  }
}

/** settings.json에 실린 projectLabels. 없으면 null. 다른 필드는 프로젝트 목록으로 보지 않는다. */
export function userProjectConfigFromSettings(settings: unknown): unknown {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const record = settings as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(record, 'projectLabels') ? record.projectLabels : null;
}

/**
 * 사용자 설정을 화면 이름 표에 반영한다. 나중 값이 같은 id를 덮어쓴다.
 * 비어 있거나 깨진 소스는 건너뛴다. 예외 없음.
 */
export function applyUserProjectConfig(...sources: unknown[]): UserProjectConfig {
  const labels: Record<string, ProjectLabel> = {};
  let hub = false;
  for (const source of sources) {
    if (source == null || source === '') continue;
    const parsed = parseUserProjectConfig(source);
    const ids = Object.keys(parsed.labels);
    if (ids.length === 0 && !parsed.hub) continue;
    for (const id of ids) labels[id] = parsed.labels[id];
    if (parsed.hub) hub = true;
  }
  for (const key of Object.keys(PROJECT_LABELS)) delete PROJECT_LABELS[key];
  Object.assign(PROJECT_LABELS, labels);
  hubFromConfig = hub;
  return { labels: PROJECT_LABELS, hub };
}

/** 사용자 설정이 허브를 가리키는지. 반영 전이면 false. */
export function projectHubConfigured(): boolean {
  return hubFromConfig;
}

function laneLooksLikeHub(lane: unknown): boolean {
  if (!lane || typeof lane !== 'object' || Array.isArray(lane)) return false;
  const row = lane as Record<string, unknown>;
  const id = typeof row.project === 'string' ? row.project : typeof row.id === 'string' ? row.id : '';
  if (HUB_PROJECT_IDS.has(id.trim().toLowerCase())) return true;
  return folderDisplayName(row.path ?? row.repo ?? row.folder).toLowerCase() === 'jucontroler';
}

/**
 * 허브 반영 카드를 보여줄지.
 * 사용자 설정이 허브를 가리키거나, 보드에서 JuControler 허브가 보일 때만 true.
 * 보드가 없거나 깨져 있으면 false. 예외 없음.
 */
export function hubCardVisible(input?: { configured?: boolean; board?: unknown } | null): boolean {
  try {
    if (!input) return false;
    if (input.configured === true) return true;
    const board = input.board;
    if (!board || typeof board !== 'object') return false;
    if (Array.isArray(board)) return board.some(laneLooksLikeHub);
    const record = board as Record<string, unknown>;
    if (hubFlagOf(record.hub)) return true;
    const lanes = record.lanes;
    return Array.isArray(lanes) && lanes.some(laneLooksLikeHub);
  } catch {
    return false;
  }
}

/** 목표 카드에 등록된 한국어 목표가 없을 때. */
export const PLAN_GOAL_UNSET = '목표가 아직 정리되지 않았어요';

function knownProject(projectId: string, labels: Record<string, ProjectLabel>): ProjectLabel | undefined {
  const key = projectId.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : undefined;
}

/**
 * 계획 화면 프로젝트 이름.
 * 사용자 설정의 이름 → 저장소 폴더 이름 → 보드 lane.name → id.
 */
export function planLaneDisplayName(projectId: string, laneName?: unknown, labels: Record<string, ProjectLabel> = PROJECT_LABELS): string {
  const known = knownProject(projectId, labels);
  const name = known?.name?.trim();
  if (name) return name;
  const folder = folderDisplayName(known?.path);
  if (folder) return folder;
  if (typeof laneName === 'string' && laneName.trim()) return laneName.trim();
  return projectId.trim() || '알 수 없는 프로젝트';
}

/** 목표 카드에 보이는 한국어 한 줄. 등록된 목표만 쓰고, 없으면 안내 문장. */
export function planVisibleGoal(projectId: string, labels: Record<string, ProjectLabel> = PROJECT_LABELS): string {
  const goal = knownProject(projectId, labels)?.goal?.trim();
  return goal || PLAN_GOAL_UNSET;
}

/** 영문 단어가 세 개 이상 이어지면 라틴 문장. 제품 이름 한두 개는 문장이 아니다. */
export function isLatinSentence(text: string): boolean {
  const words = text.match(/[A-Za-z]{2,}/g) ?? [];
  return words.length >= 3;
}

/** 원문 보기용. 화면에 이미 보인 한국어 목표와 같은 줄은 빼서 매니페스트 원문만 남긴다. */
export function foldedManifestGoal(visibleGoal: string, ...candidates: unknown[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const value of candidates) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (!text || text === visibleGoal || seen.has(text)) continue;
    seen.add(text);
    lines.push(text);
  }
  return lines.join('\n');
}

const AI_DISPLAY_NAMES: Record<string, string> = {
  codex: 'Codex',
  opencode: 'OpenCode',
  cline: 'Cline',
  grok: 'Grok',
  cursor: 'Cursor',
  claude: 'Claude',
  'claude-team': 'Claude Team',
  'claude-pro': 'Claude Pro',
  'opencode-free': '무료 모델',
};

/** runtime id → 제품 이름. 대소문자 무시, 모르는 id는 그대로 돌려준다. */
export function aiDisplayName(runtimeId: string): string {
  const key = runtimeId.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(AI_DISPLAY_NAMES, key) ? AI_DISPLAY_NAMES[key] : runtimeId;
}

/**
 * project/lane id → 화면 이름 (대소문자 무시).
 * 사용자 설정의 이름 → 저장소 폴더 이름 → id.
 */
export function projectDisplayName(projectId: string): string {
  const key = projectId.trim().toLowerCase();
  const known = Object.prototype.hasOwnProperty.call(PROJECT_LABELS, key) ? PROJECT_LABELS[key] : undefined;
  const name = known?.name?.trim();
  if (name) return name;
  const folder = folderDisplayName(known?.path);
  if (folder) return folder;
  return projectId;
}

/** 프로젝트 창 구분 키 — 대소문자·공백 무시. 같은 프로젝트는 같은 키라 창을 또 열지 않고 앞으로 가져온다. */
export function projectWindowKey(projectId: string): string {
  return projectId.trim().toLowerCase();
}

/** 프로젝트 창 제목: 'Agent Relay · <프로젝트 이름>'. */
export function projectWindowTitle(projectId: string): string {
  return `Agent Relay · ${projectDisplayName(projectId)}`;
}

/** 창 주소의 '?project=<id>' → 프로젝트 id. 없으면 ''. */
export function projectFromSearch(search: string): string {
  return (new URLSearchParams(search).get('project') ?? '').trim();
}

/** 쉬는 AI 종료 시각 → 'HH:MM' 로컬 시각. 'HH:MM'은 그대로, ISO/epoch는 로컬로 바꾸고, 못 읽으면 ''. */
export function localClockLabel(value: unknown): string {
  if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim())) return value.trim();
  const ms = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) return '';
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** '쉬는 AI' 한 항목: 'OpenCode (12:12까지 쉼)'. 시각을 못 읽으면 'OpenCode (잠시 쉼)'. */
export function coolingItemText(runtimeId: string, until: unknown): string {
  const clock = localClockLabel(until);
  return `${aiDisplayName(runtimeId)} (${clock ? `${clock}까지 쉼` : '잠시 쉼'})`;
}

/** Joined hold reasons that count as "no hold" (empty, dash placeholder, or only separators). */
function isEmptyReasons(text: string): boolean {
  const stripped = text.trim().replace(/[,\s·・|—–-]+/g, '');
  return stripped.length === 0 || stripped === '—';
}

/**
 * 보류 / 차단 카드 문구 — 비어 있으면 null을 반환해 카드를 렌더링하지 않음.
 * Control Room LaneView와 단위 테스트가 공유하는 단일 진입점.
 */
export function holdCardMessage(blocker: unknown, reason: unknown): string | null {
  const blockerText = typeof blocker === 'string' ? blocker.trim() : '';
  const reasonText = Array.isArray(reason)
    ? reason.map(item => (typeof item === 'string' ? item : '')).join(', ')
    : typeof reason === 'string'
      ? reason
      : '';
  if (!blockerText && isEmptyReasons(reasonText)) return null;
  const cleanReason = reasonText.trim();
  const text = `${blockerText} ${cleanReason}`.toUpperCase();
  if (text.includes('FOUNDER')) return 'Founder 확인이 필요해 작업을 보류했습니다.';
  if (text.includes('SCOPE')) return '승인된 작업 범위가 없어 작업을 보류했습니다.';
  if (text.includes('NOT_CONNECTED')) return 'PM 연결이 없어 다음 작업을 대기 중입니다.';
  // 원문 reason은 헤드라인에 넣지 않는다 — 원문 보기 details에서만 보여준다.
  return '작업이 보류되었습니다. 자세한 내용은 원문 보기에서 확인할 수 있어요.';
}

// ── 보류 explain (holds/<id>.json → night board step/explain/choice) ──────
// night board의 lane.holds 항목이 문자열이 아니라
// { taskId, reason, step, explain: { sentence }, choice } 형태일 수 있다.
// explain.sentence가 있으면 그 한국어 문장을 보여주고,
// 원문 영문 reason은 닫힌 <details>원문 보기</details> 안에만 둔다.
// choice가 'skip'인 항목은 보여주지 않는다. Pure — 단위 테스트 대상.

/** explain.sentence가 없을 때 대신 보여주는 보류 선택지 3개 (순수 한국어 라벨). */
export const HOLD_OPTION_LABELS: readonly string[] = [
  '다시 시도',
  '다음 작업으로 진행',
  '내가 직접 볼게요',
];

/** '내가 직접 볼게요' 선택지(직접 확인 — 자동 재개 없음)인지 판별. 구 라벨 'Founder에게 확인'도 포함. */
export function isSelfReviewOption(label: unknown): boolean {
  const text = cleanText(label);
  if (!text) return false;
  if (text === '내가 직접 볼게요') return true;
  if (text === 'Founder에게 확인') return true;
  return /직접/.test(text);
}

/** 보류 단계 표기 — 검수 단계 용어로 통일. QA/검증/확인 표기는 모두 '검수'로 보여준다. */
export function holdStepLabel(step: unknown): string {
  const text = cleanText(step);
  if (!text) return '';
  const upper = text.toUpperCase();
  if (text.includes('검수') || upper.includes('QA') || text.includes('검증') || text.includes('확인')) return '검수';
  return text;
}

/** Control Room 보류 항목 1개의 정규화 결과. */
export interface NormalizedHold {
  taskId: string;
  reason: string;
  step: string;
  /** explain.sentence — 한국어 문장. 없으면 '' . */
  sentence: string;
  /** holds/<id>.json의 choice 원문 (소문자 비교용으로 다듬지 않은 값). */
  choice: string;
  /** 보여줄 선택지 라벨 (holds 항목의 options가 있으면 그것을, 없으면 HOLD_OPTION_LABELS). */
  options: string[];
  /** Backend option ids matching options by index. */
  optionIds: string[];
  /** 선택지 설명 (options와 같은 index). 없으면 ''. */
  optionDetails: string[];
  /** 이미 저장된 choice의 라벨 (choice가 없으면 ''). */
  choiceLabel: string;
  /** holds 항목의 heldSeen (epoch 초/ms 또는 날짜 문자열) — 없으면 null. */
  heldSeen: string | number | null;
  /** 아무것도 안 고르면 추천대로 진행하기까지 기다리는 분 — 없으면 null. */
  waitMin: number | null;
  /** 추천 선택지 index — sentence가 있을 때만 사용, 없으면 -1. */
  recommendedIndex: number;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function explainSentenceOf(explain: unknown): string {
  if (typeof explain === 'string') return explain.trim();
  if (explain && typeof explain === 'object') {
    const record = explain as Record<string, unknown>;
    const direct = cleanText(record.sentence ?? record.text ?? record.summary);
    if (direct) return direct;
  }
  return '';
}

const DEFAULT_HOLD_OPTION_DETAILS: readonly string[] = [
  '같은 방법으로 한 번 더 해봐요.',
  '범위를 좁혀서 다음 단계로 넘어가요.',
  '자동으로 하지 않고 제가 직접 확인해요.',
];

function defaultOptions(): { labels: string[]; ids: string[]; details: string[] } {
  return { labels: [...HOLD_OPTION_LABELS], ids: ['retry', 'narrow', 'skip'], details: [...DEFAULT_HOLD_OPTION_DETAILS] };
}

function optionsOf(raw: unknown): { labels: string[]; ids: string[]; details: string[] } {
  if (!Array.isArray(raw)) return defaultOptions();
  const parsed = raw
    .map(option => {
      if (typeof option === 'string') return { id: '', label: option.trim(), detail: '' };
      if (option && typeof option === 'object') {
        const record = option as Record<string, unknown>;
        return { id: cleanText(record.id), label: cleanText(record.label ?? record.title ?? record.name), detail: cleanText(record.detail ?? record.description) };
      }
      return { id: '', label: '', detail: '' };
    })
    .filter(option => option.label.length > 0);
  return parsed.length > 0
    ? { labels: parsed.map(option => option.label), ids: parsed.map(option => option.id), details: parsed.map(option => option.detail) }
    : defaultOptions();
}

/** choice 원문을 options index로 푼다. 못 찾으면 sentence가 있을 때 0, 없으면 -1. */
function recommendedIndexOf(choice: unknown, options: string[], optionIds: string[], hasSentence: boolean): number {
  const normalized = cleanText(choice).toLowerCase();
  if (!normalized) return hasSentence ? 0 : -1;
  const byNumber = Number(normalized);
  if (Number.isInteger(byNumber) && byNumber >= 0 && byNumber < options.length) return byNumber;
  const hit = options.findIndex(label => label === cleanText(choice) || label.toLowerCase() === normalized);
  if (hit >= 0) return hit;
  const idHit = optionIds.findIndex(id => id === cleanText(choice) || id.toLowerCase() === normalized);
  if (idHit >= 0) return idHit;
  if (/(retry|reattempt|again|다시)/.test(normalized)) return 0;
  if (/(next|continue|proceed|다음)/.test(normalized)) return 1;
  if (/(founder|ask|confirm|확인|직접|볼게요)/.test(normalized)) return 2;
  return hasSentence ? 0 : -1;
}

/** choice가 'skip'이면 true — 대소문자/공백 무시. */
export function isHoldSkipped(choice: unknown): boolean {
  return cleanText(choice).toLowerCase() === 'skip';
}

/**
 * QA 체인이 작업자 체인과 겹치는지(스스로 검수) 판별 — 첫 번째 QA AI가 첫 번째 작업자 AI와 같으면 true.
 * Control Room 검수하는 AI 바꾸기 editor와 단위 테스트가 공유하는 순수 함수.
 */
export function isSelfReviewChain(worker: unknown, qa: unknown): boolean {
  const firstOf = (value: unknown): string => {
    if (Array.isArray(value)) {
      const first = value[0];
      return typeof first === 'string' ? first.trim() : '';
    }
    if (typeof value === 'string' && value.trim()) return value.trim();
    return '';
  };
  const firstWorker = firstOf(worker);
  const firstQa = firstOf(qa);
  return firstWorker !== '' && firstWorker === firstQa;
}

/**
 * holds 항목 1개를 정규화한다. 문자열이면 reason만 있는 항목으로 취급.
 * choice가 'skip'이거나 내용이 완전히 비어 있으면 null.
 */
export function normalizeHoldEntry(entry: unknown): NormalizedHold | null {
  if (typeof entry === 'string') {
    const reason = entry.trim();
    if (!reason || isEmptyReasons(reason)) return null;
    return { taskId: '', reason, step: '', sentence: '', choice: '', options: [...HOLD_OPTION_LABELS], optionIds: ['retry', 'narrow', 'skip'], optionDetails: [...DEFAULT_HOLD_OPTION_DETAILS], choiceLabel: '', heldSeen: null, waitMin: null, recommendedIndex: -1 };
  }
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  const explain = record.explain ?? record.explanation;
  const choiceRaw = record.choice ?? (explain && typeof explain === 'object'
    ? (explain as Record<string, unknown>).choice
    : undefined);
  const choice = cleanText(choiceRaw);
  if (isHoldSkipped(choice)) return null;
  const sentence = explainSentenceOf(explain);
  const reason = cleanText(record.reason ?? record.message ?? record.finding ?? record.detail);
  const taskId = cleanText(record.taskId ?? record.task ?? record.id);
  const stepValue = record.step ?? record.stage;
  const step = typeof stepValue === 'number' && Number.isFinite(stepValue) ? String(stepValue) : cleanText(stepValue);
  if (!sentence && !reason && !taskId && !step) return null;
  const optionSource = explain && typeof explain === 'object'
    ? (explain as Record<string, unknown>).options ?? record.options ?? record.choices
    : record.options ?? record.choices;
  const parsedOptions = optionsOf(optionSource);
  const options = parsedOptions.labels;
  const optionIds = parsedOptions.ids.map((id, index) => id || ['retry', 'narrow', 'skip'][index] || '');
  const recommended = explain && typeof explain === 'object'
    ? (explain as Record<string, unknown>).recommended ?? record.recommended ?? (Array.isArray(record.options) ? choiceRaw : record.options ?? choiceRaw) ?? HOLD_OPTION_LABELS[0]
    : record.recommended ?? (Array.isArray(record.options) ? choiceRaw : record.options ?? choiceRaw) ?? HOLD_OPTION_LABELS[0];
  const choiceIndex = choice ? recommendedIndexOf(choice, options, optionIds, false) : -1;
  const heldSeenRaw = record.heldSeen ?? record.held_seen;
  const waitRaw = Number(record.waitMin ?? record.wait_min);
  return {
    taskId,
    reason,
    step,
    sentence,
    choice,
    options,
    optionIds,
    optionDetails: parsedOptions.details,
    choiceLabel: choice ? options[choiceIndex] ?? choice : '',
    heldSeen: typeof heldSeenRaw === 'string' || typeof heldSeenRaw === 'number' ? heldSeenRaw : null,
    waitMin: Number.isFinite(waitRaw) && waitRaw > 0 ? waitRaw : null,
    recommendedIndex: recommendedIndexOf(recommended, options, optionIds, sentence.length > 0),
  };
}

/**
 * lane.holds 배열에서 보여줄 항목만 골라 정규화한다.
 * choice 'skip' 항목과 빈 항목은 제외된다. 배열이 아니면 [].
 */
export function visibleHoldEntries(holds: unknown): NormalizedHold[] {
  if (!Array.isArray(holds)) return [];
  const out: NormalizedHold[] = [];
  for (const entry of holds) {
    const normalized = normalizeHoldEntry(entry);
    if (normalized) out.push(normalized);
  }
  return out;
}

// ── 멈춘 작업 카드 helper (Control Room 쉬운 카드) ─────────────────────────

/** 카드 제목 — '보류/차단' 같은 말 없이 멈춘 작업 수만 알려준다. */
export function holdHeadingText(count: number): string {
  return `멈춘 작업 ${Math.max(0, Math.trunc(count) || 0)}개`;
}

/** 레인 탭 배지 — 호박색 '멈춘 작업 N' (blocker만 있어 개수를 모르면 1). */
export function holdBadgeText(count: number): string {
  return `멈춘 작업 ${Math.max(1, Math.trunc(count) || 0)}`;
}

export const HOLD_FLOW_STEPS: readonly string[] = ['PM', 'Worker', 'QA', 'Tester', '반영'];
export type HoldFlowState = 'done' | 'hold' | 'pending';

/** hold.step을 HOLD_FLOW_STEPS index로 푼다. 숫자는 Control Room FLOW(계획~반영 7칸) 기준. 모르면 -1. */
export function holdFlowIndex(step: unknown): number {
  const text = (typeof step === 'number' ? String(step) : cleanText(step)).toLowerCase();
  if (!text) return -1;
  if (/^\d+$/.test(text)) {
    const at = [0, 0, 1, 2, 3, 4, 4][Number(text)];
    return at ?? -1;
  }
  if (/사람|human|반영|apply|merge|deploy|ship/.test(text)) return 4;
  if (/시험|테스트|test/.test(text)) return 3;
  if (/qa|검수|검증|확인|review/.test(text)) return 2;
  if (/작업|구현|work|build|code/.test(text)) return 1;
  if (/pm|plan|계획|설계/.test(text)) return 0;
  return -1;
}

/** PM → Worker → QA → Tester → 반영 한 줄 흐름: hold 앞은 done, hold 단계는 hold, 뒤는 pending. 단계를 모르면 전부 pending. */
export function holdFlowStates(step: unknown): Array<{ name: string; state: HoldFlowState }> {
  const at = holdFlowIndex(step);
  return HOLD_FLOW_STEPS.map((name, index) => ({
    name,
    state: at < 0 ? 'pending' : index < at ? 'done' : index === at ? 'hold' : 'pending',
  }));
}

function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return toEpochMs(numeric);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** '아무것도 안 고르면 HH:MM에 추천대로 진행해요' (로컬 시각). heldSeen/waitMin 중 하나라도 없으면 ''. */
export function holdAutoProceedText(heldSeen: unknown, waitMin: unknown): string {
  const start = toEpochMs(heldSeen);
  const wait = Number(waitMin);
  if (start === null || !Number.isFinite(wait) || wait <= 0) return '';
  const at = new Date(start + wait * 60_000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `아무것도 안 고르면 ${pad(at.getHours())}:${pad(at.getMinutes())}에 추천대로 진행해요`;
}

// ── 관제실 '실행 환경' 카드 (night envs --json) ─────────────────────────────
export const ENV_LABELS: Record<string, string> = { asus: 'ASUS (이 컴퓨터)', mainpc: 'MainPC', cloud: '클라우드' };
export const ENV_RAM_WARN_GB = 3.5;
export const ENV_RAM_DANGER_GB = 1.5;
export const ENV_CPU_WARN_PCT = 80;
export type EnvTone = 'ok' | 'warn' | 'danger';

export interface EnvRow {
  id: string;
  label: string;
  ok: boolean;
  cpuPct: number | null;
  ramFreeGb: number | null;
  ramTotalGb: number | null;
  ais: string[];
  /** 원문 이유 (원문 보기용) */
  rawReason: string;
}

const envNum = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const envFirstNum = (r: Record<string, unknown>, keys: string[]): number | null => {
  for (const k of keys) { const n = envNum(r[k]); if (n !== null) return n; }
  return null;
};

/** 환경 id → 화면 라벨 (대소문자·'-'·'_' 무시). 모르면 id 그대로. */
export function envLabel(id: string): string {
  const key = id.trim().toLowerCase().replace(/[-_\s]/g, '');
  return Object.prototype.hasOwnProperty.call(ENV_LABELS, key) ? ENV_LABELS[key] : id;
}

/** `night envs --json` 응답({envs:[…]} · […] · {id:{…}})을 행 목록으로 정리한다. Pure. */
export function normalizeEnvs(payload: unknown): EnvRow[] {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const source = Array.isArray(payload) ? payload : root.envs ?? root;
  const list: Array<[string, unknown]> = Array.isArray(source)
    ? source.map(e => ['', e] as [string, unknown])
    : source && typeof source === 'object' ? Object.entries(source) : [];
  const rows: EnvRow[] = [];
  for (const [key, entry] of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const r = entry as Record<string, unknown>;
    const id = String(r.id ?? r.env ?? r.name ?? key).trim();
    if (!id) continue;
    const aiRaw = r.ais ?? r.ai ?? r.agents ?? r.runtimes ?? r.programs;
    const ais = (Array.isArray(aiRaw) ? aiRaw : []).map(a => (typeof a === 'string' ? aiDisplayName(a) : '')).filter(Boolean);
    rows.push({
      id,
      label: envLabel(id),
      ok: r.ok !== false,
      cpuPct: envFirstNum(r, ['cpu_pct', 'cpuPct', 'cpu_percent', 'cpu']),
      ramFreeGb: envFirstNum(r, ['ram_free_gb', 'ramFreeGb', 'ram_available_gb', 'ram_free']),
      ramTotalGb: envFirstNum(r, ['ram_total_gb', 'ramTotalGb', 'ram_total']),
      ais: [...new Set(ais)],
      rawReason: String(r.reason ?? r.error ?? '').trim(),
    });
  }
  return rows;
}

/** 막대 길이 0~100 (정수). 값이 없거나 max가 0 이하면 0. Pure. */
export function barPercent(value: number | null, max = 100): number {
  if (value === null || !(max > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

/** 색: 여유 → ok(초록), RAM<3.5GB·CPU>80%·연결 안 됨 → warn(주황), RAM<1.5GB만 danger(빨강). Pure. */
export function envTone(row: Pick<EnvRow, 'ok' | 'cpuPct' | 'ramFreeGb'>): EnvTone {
  if (!row.ok) return 'warn';
  if (row.ramFreeGb !== null && row.ramFreeGb < ENV_RAM_DANGER_GB) return 'danger';
  if ((row.ramFreeGb !== null && row.ramFreeGb < ENV_RAM_WARN_GB) || (row.cpuPct !== null && row.cpuPct > ENV_CPU_WARN_PCT)) return 'warn';
  return 'ok';
}

/** 연결 안 된 환경 이유 (영문 원문은 숨기고 쉬운 말로). Pure. */
export function envReasonText(row: Pick<EnvRow, 'ok'>): string {
  return row.ok ? '' : '지금은 상태를 가져오지 못했어요. 꺼져 있거나 네트워크가 끊겼을 수 있어요. 켜지면 자동으로 다시 불러와요.';
}

const envGb = (n: number): string => `${Math.round(n * 10) / 10}GB`;
/** '메모리 남은 6.2GB / 전체 16GB' — 값이 없으면 '메모리 확인 중'. Pure. */
export function ramText(row: Pick<EnvRow, 'ramFreeGb' | 'ramTotalGb'>): string {
  if (row.ramFreeGb === null) return '메모리 확인 중';
  return `메모리 남은 ${envGb(row.ramFreeGb)}${row.ramTotalGb !== null ? ` / 전체 ${envGb(row.ramTotalGb)}` : ''}`;
}
