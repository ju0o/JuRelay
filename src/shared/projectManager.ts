/** 설정 → 프로젝트 관리: 화면 문구와 입력 검사 (Pure — 백엔드·화면·테스트가 함께 쓴다). */
import { PROJECT_LABELS } from './projectLabels';

export const NEW_LANE_ID_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;
export const MAX_LANE_NAME_LENGTH = 60;
export const MAX_LANE_PATH_LENGTH = 300;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// ── 실행 위치 (AI가 일하는 컴퓨터) ───────────────────────────────────────────
// 코드에는 특정 사람·PC(별칭·경로)를 두지 않는다. 기본은 '이 컴퓨터'(엔진 CLI를 바로 실행),
// 선택으로 '다른 컴퓨터(SSH)' — 별칭과 데이터 폴더는 사용자가 설정(settings.json) 또는 환경 변수로 준다.

export type RunLocationKind = 'local' | 'ssh';

export interface RunLocation {
  kind: RunLocationKind;
  /** SSH 별칭(또는 host). ssh일 때만 쓴다. */
  alias: string;
  /** 그 컴퓨터의 Agent Relay 데이터 폴더(founder-outbox 등이 있는 곳). ssh일 때만 쓴다. */
  dataRoot: string;
  /** 엔진 CLI 경로. 비어 있으면 기본 경로(~/.agents/skills/auto-night-orchestrator/scripts/night). */
  engine: string;
  /** 화면에 보여줄 이름. 비어 있으면 local → '이 컴퓨터', ssh → 별칭. */
  name: string;
}

/** '이 컴퓨터' — 화면·문구가 함께 쓰는 기본 위치 이름. */
export const LOCAL_LOCATION_NAME = '이 컴퓨터';
export const LOCAL_RUN_LOCATION: Readonly<RunLocation> = Object.freeze({ kind: 'local', alias: '', dataRoot: '', engine: '', name: '' });

/** ssh 별칭/호스트: 영문·숫자로 시작, 영문·숫자·.·_·-만 (1~64자). 공백·따옴표·옵션(-o …)은 거절. */
export const SSH_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const MAX_LOCATION_NAME_LENGTH = 40;
export const MAX_LOCATION_PATH_LENGTH = 300;

/** 환경 변수 이름 — 앱(settings.json)이 없을 때, 또는 Founder Bridge처럼 설정 파일이 없는 실행기가 쓴다. */
export const RUN_LOCATION_ENV = {
  kind: 'AGENT_RELAY_RUN_LOCATION',
  alias: 'AGENT_RELAY_SSH_ALIAS',
  dataRoot: 'AGENT_RELAY_REMOTE_DATA_ROOT',
  engine: 'AGENT_RELAY_ENGINE',
  name: 'AGENT_RELAY_RUN_LOCATION_NAME',
} as const;

const cleanText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** 깨진 값은 '이 컴퓨터'로 본다. ssh인데 별칭이 없으면 역시 '이 컴퓨터'. 예외 없음. */
export function normalizeRunLocation(raw: unknown): RunLocation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...LOCAL_RUN_LOCATION };
  const record = raw as Record<string, unknown>;
  const kindText = cleanText(record.kind).toLowerCase();
  const alias = cleanText(record.alias ?? record.host);
  const engine = cleanText(record.engine ?? record.enginePath);
  const name = cleanText(record.name).slice(0, MAX_LOCATION_NAME_LENGTH);
  const ssh = (kindText === 'ssh' || kindText === 'remote') && SSH_ALIAS_PATTERN.test(alias);
  if (!ssh) return { ...LOCAL_RUN_LOCATION, engine, name };
  return { kind: 'ssh', alias, dataRoot: cleanText(record.dataRoot ?? record.remoteRoot), engine, name };
}

/** 환경 변수에서 위치를 읽는다. 아무 변수도 없으면 null. */
export function runLocationFromEnv(env: Record<string, string | undefined> | null | undefined): RunLocation | null {
  if (!env) return null;
  const pick = (key: string): string => cleanText(env[key]);
  const kind = pick(RUN_LOCATION_ENV.kind);
  const alias = pick(RUN_LOCATION_ENV.alias);
  const dataRoot = pick(RUN_LOCATION_ENV.dataRoot);
  const engine = pick(RUN_LOCATION_ENV.engine);
  const name = pick(RUN_LOCATION_ENV.name);
  if (!kind && !alias && !dataRoot && !engine && !name) return null;
  // 별칭만 있어도 SSH로 본다 — 별칭 없이 SSH를 켤 수는 없으므로.
  return normalizeRunLocation({ kind: kind || (alias ? 'ssh' : 'local'), alias, dataRoot, engine, name });
}

/** settings.json에 실린 runLocation. 없으면 null. */
export function runLocationFromSettings(settings: unknown): unknown {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const record = settings as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(record, 'runLocation') ? record.runLocation : null;
}

/**
 * 실제로 쓸 위치: 사용자 설정(settings.json) → 환경 변수 → '이 컴퓨터'.
 * 사용자 설정이 있으면 환경 변수는 보지 않는다.
 */
export function resolveRunLocation(
  settings: unknown,
  env: Record<string, string | undefined> | null | undefined = null,
): RunLocation {
  const saved = runLocationFromSettings(settings);
  if (saved !== null && saved !== undefined) return normalizeRunLocation(saved);
  return runLocationFromEnv(env) ?? { ...LOCAL_RUN_LOCATION };
}

/** 화면에 쓰는 위치 이름. local → '이 컴퓨터', ssh → 정한 이름 또는 별칭. */
export function runLocationName(location: RunLocation | null | undefined): string {
  if (!location) return LOCAL_LOCATION_NAME;
  const name = cleanText(location.name);
  if (location.kind === 'ssh') return name || cleanText(location.alias) || '다른 컴퓨터';
  return name || LOCAL_LOCATION_NAME;
}

/** 설정 화면 입력 검사. 문제가 있으면 쉬운 한국어 한 줄, 괜찮으면 null. */
export function runLocationProblem(input: {
  kind?: unknown; alias?: unknown; dataRoot?: unknown; engine?: unknown; name?: unknown;
}): string | null {
  const kind = cleanText(input.kind).toLowerCase();
  if (kind !== 'local' && kind !== 'ssh') return '어디서 일할지 골라 주세요.';
  const name = cleanText(input.name);
  if (name.length > MAX_LOCATION_NAME_LENGTH || CONTROL_CHARS.test(name)) {
    return `이름은 ${MAX_LOCATION_NAME_LENGTH}자 안에서 한 줄로 적어 주세요.`;
  }
  const engine = cleanText(input.engine);
  if (engine && (engine.length > MAX_LOCATION_PATH_LENGTH || CONTROL_CHARS.test(engine))) {
    return '엔진 경로는 한 줄로 적어 주세요.';
  }
  if (kind === 'local') return null;
  const alias = cleanText(input.alias);
  if (!alias) return '연결 이름(ssh 별칭)을 적어 주세요.';
  if (!SSH_ALIAS_PATTERN.test(alias)) return '연결 이름은 영문·숫자·.·_·-만 쓸 수 있어요 (공백 없이 64자 안).';
  const dataRoot = cleanText(input.dataRoot);
  if (!dataRoot) return '그 컴퓨터의 데이터 폴더를 적어 주세요.';
  if (!dataRoot.startsWith('/') || dataRoot.length > MAX_LOCATION_PATH_LENGTH || CONTROL_CHARS.test(dataRoot)) {
    return '데이터 폴더는 그 컴퓨터의 전체 경로(/로 시작)를 한 줄로 적어 주세요.';
  }
  return null;
}

/** 실행 위치 카드 맨 위 한 줄. */
export function runLocationSentence(location: RunLocation | null | undefined): string {
  const name = runLocationName(location);
  return location?.kind === 'ssh'
    ? `지금은 다른 컴퓨터(${name})에서 AI가 일해요. 바꾸려면 아래에서 고르고 저장해 주세요.`
    : '지금은 이 컴퓨터에서 AI가 일해요. 다른 컴퓨터에서 돌리려면 아래에서 바꿀 수 있어요.';
}

/** 저장 성공 뒤, 누른 자리에 보여줄 한 줄. */
export function runLocationSavedLine(location: RunLocation | null | undefined): string {
  return `저장했어요 ✓ · 이제 ${runLocationName(location)}에서 일해요`;
}

/** 보드의 lane이 켜져 있는지 — 명시적으로 멈춘 것(paused)이나 꺼진 것(enabled:false)만 '쉬는 중'. */
export function isLaneOn(lane: unknown): boolean {
  if (!lane || typeof lane !== 'object') return false;
  const record = lane as Record<string, unknown>;
  return record.paused !== true && record.enabled !== false;
}

export function laneRowLabel(on: boolean, locationName: string = LOCAL_LOCATION_NAME): string {
  return on ? `켜짐 · ${locationName} 켤 때 자동으로 돌아요` : '쉬는 중';
}

/** 행 제목 — 보드가 준 이름 → 알려진 프로젝트 이름 → 안내 문구. 영문 id는 절대 쓰지 않는다. */
export function laneRowName(project: string, name?: unknown): string {
  if (typeof name === 'string' && name.trim()) return name.trim();
  const key = project.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PROJECT_LABELS, key) ? PROJECT_LABELS[key].name : '이름 없는 프로젝트';
}

/** 이름 → 짧은 영문 id 제안. 영문·숫자만 남기고 '-'로 잇는다. 한글뿐이라 못 만들면 ''. */
export function suggestLaneId(name: unknown): string {
  if (typeof name !== 'string') return '';
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[0-9-]+/, '')
    .slice(0, 41)
    .replace(/-+$/, '');
  return NEW_LANE_ID_PATTERN.test(id) ? id : '';
}

/** 짧은 이름 자동 정하기 — 이름에서 못 만들면(한글뿐) project-2, project-3… 중 안 겹치는 것. */
export function newLaneIdFor(name: unknown, knownIds: readonly string[] = []): string {
  const suggested = suggestLaneId(name);
  if (suggested && !knownIds.includes(suggested)) return suggested;
  const base = suggested || 'project';
  for (let n = 2; ; n++) {
    const id = `${base.slice(0, 36)}-${n}`;
    if (!knownIds.includes(id)) return id;
  }
}

/** 프로젝트 추가 입력 검사. 문제가 있으면 쉬운 한국어 한 줄, 괜찮으면 null. */
export function newLaneProblem(
  input: { id?: unknown; path?: unknown; name?: unknown },
  knownIds: readonly string[] = [],
  locationName: string = LOCAL_LOCATION_NAME,
): string | null {
  const { id, path, name } = input;
  if (typeof name !== 'string' || !name.trim()) return '프로젝트 이름을 적어 주세요.';
  if (name.trim().length > MAX_LANE_NAME_LENGTH || CONTROL_CHARS.test(name)) {
    return `이름은 ${MAX_LANE_NAME_LENGTH}자 안에서 한 줄로 적어 주세요.`;
  }
  if (typeof path !== 'string' || !path.trim()) return '프로젝트 폴더를 적어 주세요.';
  if (!path.trim().startsWith('/') || path.trim().length > MAX_LANE_PATH_LENGTH || CONTROL_CHARS.test(path)) {
    return `프로젝트 폴더는 ${locationName}의 전체 경로(/로 시작)를 한 줄로 적어 주세요.`;
  }
  if (typeof id !== 'string' || !NEW_LANE_ID_PATTERN.test(id)) {
    return '고급 (개발용)의 짧은 이름은 영문 소문자로 시작하고 영문·숫자·-만 쓸 수 있어요 (2~41자).';
  }
  if (knownIds.includes(id)) return '이미 있는 프로젝트예요. 다른 짧은 이름을 써 주세요.';
  return null;
}

export type LaneErrorKind = 'offline' | 'engine-missing' | 'remote-failed' | 'bad-reply' | 'other';

/**
 * 백엔드 메시지로 실패 종류를 가른다 — 다른 컴퓨터가 꺼진 것, 이 컴퓨터에 엔진이 없는 것,
 * 켜져 있는데 실패한 것을 구분하기 위해.
 */
export function laneErrorKind(message: string): LaneErrorKind {
  if (message.includes('연결할 수 없습니다')) return 'offline';
  if (message.includes('엔진을 찾지 못했습니다')) return 'engine-missing';
  if (message.includes('켜져 있는데') || message.includes('오류가 났어요') || message.includes('답하지 않았어요')) return 'remote-failed';
  if (message.includes('응답을 읽지 못했습니다')) return 'bad-reply';
  return 'other';
}

/**
 * 실패를 세 줄(무슨 일 / 왜 / 할 일)로.
 * 이 화면은 자동으로 다시 불러오지 않으므로, 백엔드 문구(자동 재시도 약속 포함)는 그대로 내보내지 않고
 * 화면이 직접 이유를 적는다. 백엔드 원문은 원문 보기로 간다(laneErrorRaw).
 * @param locationName 실행 위치 이름('이 컴퓨터' 또는 다른 컴퓨터 이름). 문구는 이 이름으로 말한다.
 */
export function laneErrorLines(
  action: string,
  message: string,
  locationName: string = LOCAL_LOCATION_NAME,
): [string, string, string] {
  const kind = laneErrorKind(message);
  const local = locationName === LOCAL_LOCATION_NAME;
  const why: Record<LaneErrorKind, string> = {
    offline: `${locationName}가 꺼져 있거나 네트워크가 끊긴 것 같아요.`,
    'engine-missing': `${locationName}에 작업 엔진이 아직 설치되지 않았거나, 경로가 다른 것 같아요.`,
    'remote-failed': local
      ? '이 컴퓨터에서 요청을 처리하다 오류가 났어요.'
      : `${locationName}는 켜져 있는데, 요청을 처리하다 오류가 났어요.`,
    'bad-reply': local
      ? '이 컴퓨터의 작업 엔진이 답을 읽을 수 없는 모양으로 보냈어요.'
      : `${locationName}는 켜져 있는데, 답을 읽을 수 없는 모양으로 보냈어요.`,
    other: message || '이유를 알 수 없어요.',
  };
  const next: Record<LaneErrorKind, string> = {
    offline: `${locationName}를 켠 뒤 다시 시도해 주세요.`,
    'engine-missing': '설정 → 실행 위치에서 엔진 경로를 확인해 주세요.',
    'remote-failed': '잠시 뒤 다시 시도해 주세요. 계속되면 원문 보기를 알려 주세요.',
    'bad-reply': '잠시 뒤 다시 시도해 주세요. 계속되면 원문 보기를 알려 주세요.',
    other: '잠시 뒤 다시 시도해 주세요. 계속되면 원문 보기를 알려 주세요.',
  };
  return [`${action} 못했어요.`, why[kind], next[kind]];
}

/** 추가할 때 적은 한국어 이름을 기억하는 저장 형식(id → 이름). 깨진 값은 빈 목록으로 본다. */
export function decodeLaneNames(text: string | null | undefined): Record<string, string> {
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [id, name] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof name === 'string' && name.trim()) out[id] = name.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function encodeLaneNames(names: Record<string, string>): string {
  return JSON.stringify(names);
}

/** 성공 응답을 원문 보기용 문자열로. 화면 줄에는 절대 쓰지 않고 접이식 안에만 넣는다. */
export function laneResultRaw(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** 원문 보기에 넣을 내용 — 백엔드 메시지와 stderr 조각을 합친다. 둘 다 없으면 undefined(접이식 자체를 숨긴다). */
export function laneErrorRaw(message?: string, detail?: string): string | undefined {
  const raw = [message?.trim(), detail?.trim()].filter((part): part is string => Boolean(part)).join('\n');
  return raw || undefined;
}

/** 설정에서 기억한 한국어 이름. 화면은 이 키만 쓴다. */
export const LANE_NAMES_STORAGE_KEY = 'relay.projectNames';

/** '다음부터 묻지 않기'가 이 기기에 저장되는 키. '1'이면 다음 실행부터 카드를 숨긴다. */
export const LAUNCH_PICK_SKIP_KEY = 'agent-relay.launch-pick.skip';

export interface LaunchPickRow {
  id: string;
  name: string;
  /** 체크됨 = 지금 켜져 있음(쉬는 중이 아님). */
  on: boolean;
}

export interface LaunchPickChange {
  /** 꺼져 있다가 체크된 프로젝트. 이 순서대로 켠다. */
  resume: string[];
  /** 켜져 있다가 체크가 빠진 프로젝트. 이 순서대로 쉬게 한다. */
  pause: string[];
}

/**
 * 보드에 있는 프로젝트를 카드 한 줄로. 이름은 한국어만 쓰고, 체크는 쉬는 중이 아니면 켠다.
 * 같은 id가 두 번 오면 첫 줄만 남긴다.
 */
export function launchPickRows(
  lanes: readonly unknown[],
  savedNames: Record<string, string> = {},
): LaunchPickRow[] {
  const out: LaunchPickRow[] = [];
  const seen = new Set<string>();
  for (const lane of lanes) {
    if (!lane || typeof lane !== 'object') continue;
    const record = lane as Record<string, unknown>;
    const raw = record.project ?? record.id ?? record.lane;
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const given = [record.name, record.displayName, record.label, savedNames[id]]
      .find((value) => typeof value === 'string' && value.trim());
    out.push({ id, name: laneRowName(id, given), on: isLaneOn(lane) });
  }
  return out;
}

function pickOn(row: { id?: unknown; on?: unknown } | null | undefined): { id: string; on: boolean } | null {
  if (!row || typeof row.id !== 'string') return null;
  const id = row.id.trim();
  if (!id || typeof row.on !== 'boolean') return null;
  return { id, on: row.on };
}

/**
 * 이대로 시작이 실제로 켤 id와 쉬게 할 id.
 * before는 카드를 열었을 때의 상태, after는 대표님이 남긴 체크.
 * 그대로인 줄은 빼서, 바뀐 줄만 설정 → 프로젝트 관리와 같은 켜기/쉬기 호출을 타게 한다.
 * 순서는 before를 따른다. after에만 있는 id는 무시한다.
 */
export function launchPickChanges(
  before: readonly { id: string; on: boolean }[],
  after: readonly { id: string; on: boolean }[],
): LaunchPickChange {
  const want = new Map<string, boolean>();
  for (const row of after) {
    const picked = pickOn(row);
    if (!picked || want.has(picked.id)) continue;
    want.set(picked.id, picked.on);
  }
  const resume: string[] = [];
  const pause: string[] = [];
  const seen = new Set<string>();
  for (const row of before) {
    const picked = pickOn(row);
    if (!picked || seen.has(picked.id)) continue;
    seen.add(picked.id);
    const next = want.get(picked.id);
    if (next === undefined || next === picked.on) continue;
    if (next) resume.push(picked.id);
    else pause.push(picked.id);
  }
  return { resume, pause };
}

/** 이대로 시작이 끝난 뒤, 누른 자리에 보여줄 한 줄. 켠 수 · 쉬게 한 수. */
export function launchPickResultLine(change: LaunchPickChange): string {
  return `${change.resume.length}개 켜고 ${change.pause.length}개 쉬게 했어요 ✓`;
}

/**
 * 이번 실행에 카드를 보여줄지.
 * 다음부터 묻지 않기를 기억했거나, 이번 실행에서 이미 닫았거나, 고를 프로젝트가 없으면 숨긴다.
 */
export function launchPickVisible(input: {
  skipped: boolean;
  closedThisLaunch: boolean;
  laneCount: number;
}): boolean {
  return !input.skipped && !input.closedThisLaunch && input.laneCount > 0;
}

/** 다음부터 묻지 않기가 저장돼 있으면 true. 저장소를 못 읽으면 카드를 그대로 보여 준다. */
export function launchPickSkipRead(read: ((key: string) => string | null) | null | undefined): boolean {
  try {
    return read?.(LAUNCH_PICK_SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

/** 다음부터 묻지 않기. 저장이 거절되면 이번 실행만 닫힌다. */
export function launchPickSkipWrite(write: ((key: string, value: string) => void) | null | undefined): void {
  try {
    write?.(LAUNCH_PICK_SKIP_KEY, '1');
  } catch {
    /* 기억하지 못해도 이번 실행에서는 닫는다. */
  }
}

/** 설정에서 다시 묻기. 저장소를 지우지 못하면 false. */
export function launchPickSkipClear(remove: ((key: string) => void) | null | undefined): boolean {
  try {
    remove?.(LAUNCH_PICK_SKIP_KEY);
    return true;
  } catch {
    return false;
  }
}
