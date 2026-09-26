/** 설정 → 프로젝트 관리: 화면 문구와 입력 검사 (Pure — 백엔드·화면·테스트가 함께 쓴다). */
import { PROJECT_LABELS } from './projectLabels';

export const NEW_LANE_ID_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;
export const MAX_LANE_NAME_LENGTH = 60;
export const MAX_LANE_PATH_LENGTH = 300;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** 보드의 lane이 켜져 있는지 — 명시적으로 멈춘 것(paused)이나 꺼진 것(enabled:false)만 '쉬는 중'. */
export function isLaneOn(lane: unknown): boolean {
  if (!lane || typeof lane !== 'object') return false;
  const record = lane as Record<string, unknown>;
  return record.paused !== true && record.enabled !== false;
}

export function laneRowLabel(on: boolean): string {
  return on ? '켜짐 · ASUS 켤 때 자동으로 돌아요' : '쉬는 중';
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
): string | null {
  const { id, path, name } = input;
  if (typeof name !== 'string' || !name.trim()) return '프로젝트 이름을 적어 주세요.';
  if (name.trim().length > MAX_LANE_NAME_LENGTH || CONTROL_CHARS.test(name)) {
    return `이름은 ${MAX_LANE_NAME_LENGTH}자 안에서 한 줄로 적어 주세요.`;
  }
  if (typeof path !== 'string' || !path.trim()) return '프로젝트 폴더를 적어 주세요.';
  if (!path.trim().startsWith('/') || path.trim().length > MAX_LANE_PATH_LENGTH || CONTROL_CHARS.test(path)) {
    return '프로젝트 폴더는 ASUS의 전체 경로(/로 시작)를 한 줄로 적어 주세요.';
  }
  if (typeof id !== 'string' || !NEW_LANE_ID_PATTERN.test(id)) {
    return '고급 (개발용)의 짧은 이름은 영문 소문자로 시작하고 영문·숫자·-만 쓸 수 있어요 (2~41자).';
  }
  if (knownIds.includes(id)) return '이미 있는 프로젝트예요. 다른 짧은 이름을 써 주세요.';
  return null;
}

export type LaneErrorKind = 'offline' | 'remote-failed' | 'bad-reply' | 'other';

/** 백엔드 메시지로 실패 종류를 가른다 — ASUS가 꺼진 것과, 켜져 있는데 실패한 것을 구분하기 위해. */
export function laneErrorKind(message: string): LaneErrorKind {
  if (message.includes('연결할 수 없습니다')) return 'offline';
  if (message.includes('켜져 있는데')) return 'remote-failed';
  if (message.includes('응답을 읽지 못했습니다')) return 'bad-reply';
  return 'other';
}

/**
 * 실패를 세 줄(무슨 일 / 왜 / 할 일)로.
 * 이 화면은 자동으로 다시 불러오지 않으므로, 백엔드 문구(자동 재시도 약속 포함)는 그대로 내보내지 않고
 * 화면이 직접 이유를 적는다. 백엔드 원문은 원문 보기로 간다(laneErrorRaw).
 */
export function laneErrorLines(action: string, message: string): [string, string, string] {
  const kind = laneErrorKind(message);
  const why: Record<LaneErrorKind, string> = {
    offline: 'ASUS가 꺼져 있거나 네트워크가 끊긴 것 같아요.',
    'remote-failed': 'ASUS는 켜져 있는데, 요청을 처리하다 오류가 났어요.',
    'bad-reply': 'ASUS는 켜져 있는데, 답을 읽을 수 없는 모양으로 보냈어요.',
    other: message || '이유를 알 수 없어요.',
  };
  return [
    `${action} 못했어요.`,
    why[kind],
    kind === 'offline' ? 'ASUS를 켠 뒤 다시 시도해 주세요.' : '잠시 뒤 다시 시도해 주세요. 계속되면 원문 보기를 알려 주세요.',
  ];
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
