/**
 * Work-PC connection and automation toggle copy.
 * Pure helpers — the top bar only renders what these return.
 * 실패 종류는 백엔드 한국어 문장으로만 가른다. 코드 이름(EXEC_FAILED 등)은 화면에 쓰지 않는다.
 */

export type ConnectionPhase = 'checking' | 'ok' | 'offline' | 'error';

export type AutomationOp = 'controlRoom:automationOn' | 'controlRoom:automationOff';

export interface ConnectionView {
  phase: ConnectionPhase;
  enabled: boolean | null;
  statusText: string;
}

export interface AutomationFailureLine {
  /** 버튼 옆에 바로 보여주는 한국어 한 줄 (백엔드 e.message). */
  text: string;
  /** stderr 등 원문. 있을 때만 '원문 보기'에 넣는다. */
  raw?: string;
}

const ON_MODES = new Set(['always', 'on', 'enabled']);
const OFF_MODES = new Set(['stop', 'stopped', 'off', 'disabled']);

/**
 * A failed automationStatus / automationOn / automationOff call.
 * `/연결할 수 없습니다/` (EXEC_FAILED) is offline. Every other Korean message,
 * including remote failure and unreadable JSON, is an error while the PC is on.
 */
export function classifyConnectionFailure(message: string): 'offline' | 'error' {
  return /연결할 수 없습니다/.test(message) ? 'offline' : 'error';
}

/**
 * Status line. '확인 중' is not used here — that phrase belongs only to the
 * toggle, and only before the first answer.
 */
export function connectionStatusText(phase: ConnectionPhase): string {
  switch (phase) {
    case 'ok':
      return '작업 PC 연결됨 · 방금 확인';
    case 'offline':
      return '작업 PC에 연결할 수 없어요';
    case 'error':
      return '작업 PC는 켜져 있는데 상태를 읽지 못했어요';
    default:
      return '작업 PC 연결을 확인하고 있어요';
  }
}

/**
 * Turns a failed screen-data load into the sentence the status line switches to.
 * Never returns '확인 중'.
 */
export function connectionSwitchSentence(message: string): string {
  return connectionStatusText(classifyConnectionFailure(message));
}

/** Reads `always.mode`. Missing or unknown mode is null (treated as off by the toggle). */
export function automationEnabledFromStatus(status: unknown): boolean | null {
  if (!status || typeof status !== 'object') return null;
  const always = (status as { always?: unknown }).always;
  if (!always || typeof always !== 'object') return null;
  const mode = (always as { mode?: unknown }).mode;
  if (typeof mode !== 'string') return null;
  const key = mode.trim().toLowerCase();
  if (!key) return null;
  if (ON_MODES.has(key)) return true;
  if (OFF_MODES.has(key)) return false;
  return null;
}

/** Successful status poll → connected sentence and the parsed on/off/unknown flag. */
export function connectionViewFromStatus(status: unknown): ConnectionView {
  return {
    phase: 'ok',
    enabled: automationEnabledFromStatus(status),
    statusText: connectionStatusText('ok'),
  };
}

/**
 * Failed screen-data load → offline or error sentence.
 * Keeps the last known on/off flag. Does not go back to '확인 중'.
 */
export function connectionViewFromLoadError(message: string, previousEnabled: boolean | null): ConnectionView {
  const phase = classifyConnectionFailure(message);
  return {
    phase,
    enabled: previousEnabled,
    statusText: connectionSwitchSentence(message),
  };
}

/**
 * Toggle button label: the Korean verb for what the click will do.
 * '자동 실행 확인 중' only before the first answer.
 * Unknown (null) and off both read '자동 실행 켜기'.
 * Already on reads '자동 실행 끄기' — the same choice as automationToggleOp.
 */
export function automationToggleLabel(enabled: boolean | null, phase: ConnectionPhase): string {
  if (phase === 'checking') return '자동 실행 확인 중';
  if (enabled === true) return '자동 실행 끄기';
  return '자동 실행 켜기';
}

/**
 * The click does what the button says.
 * Unknown (null) is off, so the click turns automation on.
 * 상태가 비어 있어도 여기서 멈추지 않고 automationOn을 부른다.
 * 이미 켜져 있으면 버튼 글자 '자동 실행 끄기'와 같이 automationOff를 부른다.
 */
export function automationToggleOp(enabled: boolean | null): AutomationOp {
  return enabled === true ? 'controlRoom:automationOff' : 'controlRoom:automationOn';
}

/** Result line after a toggle that succeeded. */
export function automationResultText(op: AutomationOp): '켰어요 ✓' | '껐어요 ✓' {
  return op === 'controlRoom:automationOn' ? '켰어요 ✓' : '껐어요 ✓';
}

/**
 * Result line after a toggle that failed.
 * The Korean backend message is the main text. Raw detail stays out of that line.
 */
export function automationFailureLine(message: string, detail?: string): AutomationFailureLine {
  const text = message.trim() || '상태를 바꾸지 못했어요. 잠시 후 다시 눌러 주세요.';
  const raw = detail?.trim();
  return raw ? { text, raw } : { text };
}
