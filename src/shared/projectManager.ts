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

/** 실패를 세 줄(무슨 일 / 왜 / 할 일)로. 연결 문제면 ASUS가 꺼졌다는 뜻으로 구분한다. */
export function laneErrorLines(action: string, message: string): [string, string, string] {
  const offline = message.includes('연결할 수 없습니다');
  return [
    `${action} 못했어요.`,
    message || '이유를 알 수 없어요.',
    offline ? 'ASUS를 켠 뒤 다시 시도해 주세요.' : '잠시 뒤 다시 시도해 주세요. 계속되면 원문 보기를 알려 주세요.',
  ];
}
