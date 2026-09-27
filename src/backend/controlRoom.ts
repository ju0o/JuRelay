import { execFile as nodeExecFile, ExecFileOptions } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import {
  RunLocation,
  newLaneProblem,
  normalizeRunLocation,
  resolveRunLocation,
  runLocationName,
} from '../shared/projectManager';

const execFile = promisify(nodeExecFile);
/** 엔진 CLI 기본 경로. ssh면 원격 셸이 `~`를 풀고, 이 컴퓨터면 여기서 홈 폴더로 바꾼다. */
export const DEFAULT_ENGINE_PATH = '~/.agents/skills/auto-night-orchestrator/scripts/night';
const SSH_OPTIONS: readonly string[] = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5'];
const EXEC_TIMEOUT = 10_000;

// ── 실행 위치 ────────────────────────────────────────────────────────────────
// main.ts가 시작할 때(그리고 설정이 바뀔 때) 넣어 준다. 넣지 않으면 환경 변수 → '이 컴퓨터'.
// 코드에는 특정 별칭·경로가 없다.

let configuredLocation: RunLocation | null = null;

/** 앱 설정(또는 시험)이 정한 실행 위치를 적용한다. 깨진 값은 '이 컴퓨터'가 된다. */
export function configureRunLocation(location: unknown): RunLocation {
  configuredLocation = normalizeRunLocation(location);
  return configuredLocation;
}

/** 지금 쓰는 실행 위치. 설정이 없으면 환경 변수, 그것도 없으면 '이 컴퓨터'. */
export function currentRunLocation(): RunLocation {
  return configuredLocation ?? resolveRunLocation(null, process.env);
}

/** `~`로 시작하는 경로를 이 컴퓨터의 홈 폴더로. shell:false로 실행하므로 직접 풀어야 한다. */
export function expandHomePath(value: string, home: string = homedir()): string {
  if (value === '~') return home;
  if (value.startsWith('~/')) return `${home}${value.slice(1)}`;
  return value;
}

/** 사용자 글자가 든 인자 — ssh면 원격 셸용으로 따옴표를 치고, 이 컴퓨터면 그대로 넘긴다. */
export class UserArg {
  constructor(readonly value: string) {}
}
const user = (value: string): UserArg => new UserArg(value);
export type EngineArg = string | UserArg;

export interface EngineCommand {
  file: string;
  args: string[];
}

/**
 * 엔진 명령 한 줄을 실행 위치에 맞는 실행 파일·인자로 바꾼다. Pure — 단위 시험 대상.
 * - ssh: `ssh -o BatchMode=yes -o ConnectTimeout=5 <별칭> <엔진> <인자…>` (사용자 인자는 POSIX 따옴표)
 * - local: `<엔진 경로> <인자…>` (따옴표 없이 그대로; shell:false)
 */
export function engineCommand(location: RunLocation, parts: readonly EngineArg[]): EngineCommand {
  const engine = location.engine.trim() || DEFAULT_ENGINE_PATH;
  if (location.kind === 'ssh') {
    return {
      file: 'ssh',
      args: [...SSH_OPTIONS, location.alias, engine, ...parts.map(part => (part instanceof UserArg ? shQuote(part.value) : part))],
    };
  }
  return {
    file: expandHomePath(engine),
    args: parts.map(part => (part instanceof UserArg ? part.value : part)),
  };
}
/** PM `night plan request` is slow; override the default ssh timeout. */
export const PLAN_REQUEST_TIMEOUT = 120_000;
export const MAX_PLAN_REQUEST_TEXT_LENGTH = 1500;
const MAX_OPTION_INDEX = 9999;

export type ControlRoomOperation =
  | 'board'
  | 'approvals'
  | 'envs'
  | 'tokens'
  | 'planStudio:get'
  | 'planStudio:save'
  | 'planStudio:chat'
  | 'planStudio:request'
  | 'planStudio:approve'
  | 'gates:list'
  | 'gates:answer'
  | 'controlRoom:laneSet'
  | 'controlRoom:laneAdd'
  | 'controlRoom:resume'
  | 'controlRoom:pause'
  | 'controlRoom:scheduleSet'
  | 'controlRoom:scheduleList'
  | 'controlRoom:scheduleCancel'
  | 'controlRoom:holdChoose'
  | 'controlRoom:approvalAdd'
  | 'controlRoom:approvalEdit'
  | 'controlRoom:approvalRemove'
  | 'controlRoom:automationStatus'
  | 'controlRoom:automationOn'
  | 'controlRoom:automationOff'
  | 'controlRoom:promoteHub'
  | 'controlRoom:nightReports';
export type PlanStudioAction = 'get' | 'save' | 'chat' | 'request' | 'approve';
export type GateAction = 'list' | 'answer';
export type ControlRoomErrorCode = 'EXEC_FAILED' | 'REMOTE_FAILED' | 'INVALID_JSON' | 'INVALID_INPUT';
export type ControlRoomExecOptions = ExecFileOptions & { input?: string | Uint8Array };
export type ControlRoomExec = (
  file: string,
  args: readonly string[],
  options: ControlRoomExecOptions,
) => Promise<{ stdout: string; stderr: string }>;

export const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;
export const TASK_ID_PATTERN = /^[A-Za-z][A-Za-z0-9-]{1,100}$/;
export const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const HOLD_OPTIONS = ['retry', 'narrow', 'skip'] as const;
export type HoldOption = (typeof HOLD_OPTIONS)[number];
export const GATE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const APPROVAL_CATEGORY_PATTERN = /^[a-z-]{2,30}$/;
export const MAX_APPROVAL_SUMMARY_LENGTH = 200;
export const APPROVAL_RULE_ID_PATTERN = /^A-\d{2,4}$/;
export const LANE_ROLES = ['worker', 'qa'] as const;
export type LaneRole = (typeof LANE_ROLES)[number];
export const NIGHT_RUNTIMES = [
  'codex',
  'opencode',
  'cline',
  'grok',
  'cursor',
  'claude',
  'claude-team',
  'claude-pro',
] as const;
export type NightRuntime = (typeof NIGHT_RUNTIMES)[number];

/** 보류 선택지 라벨이 '직접 확인'(자동 재개 없음)인지 판별. 구 라벨 'Founder에게 확인' 포함. Pure. */
export function isHoldSelfReviewOption(optionLabel: unknown): boolean {
  if (typeof optionLabel !== 'string') return false;
  const text = optionLabel.trim();
  if (!text) return false;
  if (text === '내가 직접 볼게요' || text === 'Founder에게 확인') return true;
  return text.includes('직접');
}

/**
 * 보류 선택지 버튼이 눌렸을 때 호출할 백엔드 동작을 정한다. Pure — 단위 테스트 대상.
 * - 'none': '내가 직접 볼게요' — 자동 호출 없이 원문/증거를 직접 확인한다.
 * - 'gate': gate가 열려 있으면 `gates:answer`(optionIndex 전달).
 * - 'resume': gate가 없으면 `controlRoom:resume`(project 전달).
 */
export function holdOptionAction(
  optionLabel: unknown,
  hasGate: boolean,
): 'gate' | 'resume' | 'none' {
  if (isHoldSelfReviewOption(optionLabel)) return 'none';
  return hasGate ? 'gate' : 'resume';
}

export function isValidProjectId(project: unknown): project is string {
  return typeof project === 'string' && PROJECT_ID_PATTERN.test(project);
}

export function isValidGateId(gateId: unknown): gateId is string {
  return typeof gateId === 'string' && GATE_ID_PATTERN.test(gateId);
}

export function isValidOptionIndex(optionIndex: unknown): optionIndex is number {
  return (
    typeof optionIndex === 'number' &&
    Number.isInteger(optionIndex) &&
    optionIndex >= 0 &&
    optionIndex <= MAX_OPTION_INDEX
  );
}

/**
 * POSIX single-quote one remote argument. ssh joins remote arguments into a
 * remote shell command line, so every variable remote argument goes through
 * this single helper: wrap in ' and escape embedded ' as '\''.
 */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function isValidLaneRole(role: unknown): role is LaneRole {
  return typeof role === 'string' && (LANE_ROLES as readonly string[]).includes(role);
}

export function isValidRuntimes(runtimes: unknown): runtimes is string[] {
  if (!Array.isArray(runtimes) || runtimes.length < 1 || runtimes.length > 4) return false;
  const allowed = new Set<string>(NIGHT_RUNTIMES as readonly string[]);
  const seen = new Set<string>();
  for (const runtime of runtimes) {
    if (typeof runtime !== 'string' || !allowed.has(runtime) || seen.has(runtime)) return false;
    seen.add(runtime);
  }
  return true;
}

export function isValidApprovalCategory(category: unknown): category is string {
  return typeof category === 'string' && APPROVAL_CATEGORY_PATTERN.test(category);
}

export function isValidApprovalSummary(summary: unknown): summary is string {
  return (
    typeof summary === 'string' && summary.length >= 1 && summary.length <= MAX_APPROVAL_SUMMARY_LENGTH
  );
}

export class ControlRoomError extends Error {
  constructor(
    readonly code: ControlRoomErrorCode,
    readonly operation: ControlRoomOperation,
    message: string,
    readonly cause?: unknown,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ControlRoomError';
  }
}

function invalidInput(operation: ControlRoomOperation, message: string): ControlRoomError {
  return new ControlRoomError('INVALID_INPUT', operation, message);
}

function assertProjectId(operation: ControlRoomOperation, project: unknown): asserts project is string {
  if (!isValidProjectId(project)) {
    throw invalidInput(operation, '프로젝트 ID가 올바르지 않습니다.');
  }
}

function assertTaskId(operation: ControlRoomOperation, taskId: unknown): asserts taskId is string {
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    throw invalidInput(operation, '작업 ID가 올바르지 않습니다.');
  }
}

function assertGateId(operation: ControlRoomOperation, gateId: unknown): asserts gateId is string {
  if (!isValidGateId(gateId)) {
    throw invalidInput(operation, '게이트 ID가 올바르지 않습니다.');
  }
}

function assertOptionIndex(operation: ControlRoomOperation, optionIndex: unknown): asserts optionIndex is number {
  if (!isValidOptionIndex(optionIndex)) {
    throw invalidInput(operation, '선택 번호가 올바르지 않습니다.');
  }
}

function assertHoldOption(operation: ControlRoomOperation, option: unknown): asserts option is HoldOption {
  if (typeof option !== 'string' || !(HOLD_OPTIONS as readonly string[]).includes(option)) {
    throw invalidInput(operation, '보류 선택지가 올바르지 않습니다.');
  }
}

function assertPayloadString(operation: ControlRoomOperation, name: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidInput(operation, '입력값이 올바르지 않습니다.');
  }
}

function assertPlanRequestText(operation: ControlRoomOperation, text: unknown): asserts text is string {
  if (typeof text !== 'string' || text.length === 0) {
    throw invalidInput(operation, '요청 내용을 입력해 주세요.');
  }
  if (text.length > MAX_PLAN_REQUEST_TEXT_LENGTH) {
    throw invalidInput(operation, '요청 내용이 너무 깁니다. 짧게 줄여 주세요.');
  }
}

function assertLaneRole(operation: ControlRoomOperation, role: unknown): asserts role is LaneRole {
  if (!isValidLaneRole(role)) {
    throw invalidInput(operation, '역할이 올바르지 않습니다.');
  }
}

function assertRuntimes(operation: ControlRoomOperation, runtimes: unknown): asserts runtimes is string[] {
  if (!isValidRuntimes(runtimes)) {
    throw invalidInput(operation, '실행 환경이 올바르지 않습니다.');
  }
}

function assertApprovalCategory(operation: ControlRoomOperation, category: unknown): asserts category is string {
  if (!isValidApprovalCategory(category)) {
    throw invalidInput(operation, '승인 분류가 올바르지 않습니다.');
  }
}

function assertApprovalSummary(operation: ControlRoomOperation, summary: unknown): asserts summary is string {
  if (!isValidApprovalSummary(summary)) {
    throw invalidInput(operation, '요약을 입력해 주세요.');
  }
}

// ── 실패 문구 — 실행 위치 이름으로 말한다 ──────────────────────────────────
/** 다른 컴퓨터(ssh)에 닿지 못함. 꺼짐/네트워크. */
export function offlineMessage(location: RunLocation): string {
  return `작업 PC(${runLocationName(location)})에 연결할 수 없습니다. 꺼져 있거나 네트워크가 끊겼을 수 있어요. 켜지면 자동으로 다시 불러옵니다.`;
}
/** 다른 컴퓨터는 켜져 있는데 명령이 실패함. */
export function remoteFailedMessage(location: RunLocation): string {
  return `작업 PC(${runLocationName(location)})는 켜져 있는데 요청을 처리하다 오류가 났어요. 잠시 후 자동으로 다시 불러와요. 계속되면 원문 보기로 알려 주세요.`;
}
/** 이 컴퓨터에서 엔진 CLI를 실행할 수 없음(없거나 실행 권한이 없음). */
export const LOCAL_ENGINE_MISSING_MESSAGE =
  '이 컴퓨터에서 작업 엔진을 찾지 못했습니다. 아직 설치되지 않았거나 경로가 다를 수 있어요. 설정 → 실행 위치에서 엔진 경로를 확인해 주세요.';
/** 이 컴퓨터에서 엔진이 돌았지만 실패함. */
export const LOCAL_FAILED_MESSAGE =
  '이 컴퓨터에서 요청을 처리하다 오류가 났어요. 잠시 후 자동으로 다시 불러와요. 계속되면 원문 보기로 알려 주세요.';
/** 이 컴퓨터에서 엔진이 시간 안에 답하지 않음. */
export const LOCAL_TIMEOUT_MESSAGE =
  '이 컴퓨터의 작업 엔진이 시간 안에 답하지 않았어요. 잠시 후 자동으로 다시 시도합니다.';
/** 응답이 JSON이 아님. */
export function badReplyMessage(location: RunLocation): string {
  return location.kind === 'ssh'
    ? '작업 PC의 응답을 읽지 못했습니다. 잠시 후 자동으로 다시 시도합니다.'
    : '작업 엔진의 응답을 읽지 못했습니다. 잠시 후 자동으로 다시 시도합니다.';
}

function stderrOf(record: { stderr?: unknown }): string {
  return typeof record.stderr === 'string' ? record.stderr : Buffer.isBuffer(record.stderr) ? record.stderr.toString('utf8') : '';
}

/**
 * 실행 실패를 위치에 맞게 가른다.
 * - ssh: 붙었는데 원격 명령이 실패한 경우(255 아닌 숫자 종료 코드, 또는 stderr에 Traceback)만 REMOTE_FAILED, 나머지는 꺼짐.
 * - local: 숫자 종료 코드(엔진이 돌았음) → REMOTE_FAILED, 시간 초과 → EXEC_FAILED(시간), 그 외(ENOENT 등) → EXEC_FAILED(엔진 없음).
 */
export function execFailure(operation: ControlRoomOperation, cause: unknown, location: RunLocation = currentRunLocation()): ControlRoomError {
  const record = cause && typeof cause === 'object' ? (cause as { code?: unknown; stderr?: unknown; killed?: unknown; signal?: unknown }) : {};
  const stderr = stderrOf(record);
  const exited = typeof record.code === 'number';
  if (location.kind === 'ssh') {
    if ((exited && record.code !== 255) || stderr.includes('Traceback')) {
      return new ControlRoomError('REMOTE_FAILED', operation, remoteFailedMessage(location), cause, stderr.slice(-400));
    }
    return new ControlRoomError('EXEC_FAILED', operation, offlineMessage(location), cause);
  }
  if (exited || stderr.includes('Traceback')) {
    return new ControlRoomError('REMOTE_FAILED', operation, LOCAL_FAILED_MESSAGE, cause, stderr.slice(-400));
  }
  if (record.killed === true || typeof record.signal === 'string') {
    return new ControlRoomError('EXEC_FAILED', operation, LOCAL_TIMEOUT_MESSAGE, cause);
  }
  return new ControlRoomError('EXEC_FAILED', operation, LOCAL_ENGINE_MISSING_MESSAGE, cause, stderr.slice(-400) || undefined);
}

/** 엔진 명령을 지금 실행 위치에서 돌리고 stdout JSON을 돌려준다. 모든 관제실 호출이 이 한 곳을 지난다. */
async function runEngineJson(
  operation: ControlRoomOperation,
  parts: readonly EngineArg[],
  execFileImpl: ControlRoomExec,
  options?: ControlRoomExecOptions,
): Promise<unknown> {
  const location = currentRunLocation();
  const command = engineCommand(location, parts);
  let stdout: string;
  try {
    ({ stdout } = await execFileImpl(command.file, command.args, { shell: false, timeout: EXEC_TIMEOUT, ...options }));
  } catch (cause) {
    throw execFailure(operation, cause, location);
  }

  try {
    return JSON.parse(stdout);
  } catch (cause) {
    throw new ControlRoomError('INVALID_JSON', operation, badReplyMessage(location), cause);
  }
}

export async function runControlRoom(
  operation: 'board' | 'approvals',
  execFileImpl: ControlRoomExec = execFile,
): Promise<unknown> {
  return runEngineJson(operation, operation === 'board' ? ['board', '--json'] : ['approvals', 'list', '--json'], execFileImpl);
}

/** 실행 환경(CPU·RAM·AI 프로그램) — `night envs --json`. 원격 점검이 느려 30초까지 기다린다. */
export const ENVS_TIMEOUT = 30_000;
export const runControlRoomEnvs = (execFileImpl: ControlRoomExec = execFile): Promise<unknown> =>
  runEngineJson('envs', ['envs', '--json'], execFileImpl, { timeout: ENVS_TIMEOUT });

/** 토큰 감지 — `night tokens --json`. */
export const runControlRoomTokens = (execFileImpl: ControlRoomExec = execFile): Promise<unknown> =>
  runEngineJson('tokens', ['tokens', '--json'], execFileImpl);

export async function runPlanStudioGet(
  project: string,
  execFileImpl: ControlRoomExec = execFile,
): Promise<unknown> {
  const operation: ControlRoomOperation = 'planStudio:get';
  assertProjectId(operation, project);
  return runEngineJson(operation, ['roadmap', 'get', project, '--json'], execFileImpl);
}

export async function runPlanStudioSave(
  project: string,
  draft: string,
  execFileImpl: ControlRoomExec = execFile,
): Promise<unknown> {
  const operation: ControlRoomOperation = 'planStudio:save';
  assertProjectId(operation, project);
  assertPayloadString(operation, 'draft', draft);
  return runEngineJson(
    operation,
    ['roadmap', 'save', project, '--json'],
    execFileImpl,
    { input: draft },
  );
}

export async function runPlanStudioChat(
  project: string,
  message: string,
  execFileImpl: ControlRoomExec = execFile,
): Promise<unknown> {
  const operation: ControlRoomOperation = 'planStudio:chat';
  assertProjectId(operation, project);
  assertPayloadString(operation, 'message', message);
  return runEngineJson(
    operation,
    ['roadmap', 'chat', project, '--json'],
    execFileImpl,
    { input: message },
  );
}

export async function runPlanStudioRequest(
  project: string,
  text: string,
  execFileImpl: ControlRoomExec = execFile,
): Promise<unknown> {
  const operation: ControlRoomOperation = 'planStudio:request';
  assertProjectId(operation, project);
  assertPlanRequestText(operation, text);
  return runEngineJson(
    operation,
    ['plan', 'request', user(project), user(text), '--json'],
    execFileImpl,
    { timeout: PLAN_REQUEST_TIMEOUT },
  );
}

export async function runPlanStudioApprove(
  project: string,
  execFileImpl: ControlRoomExec = execFile,
): Promise<unknown> {
  const operation: ControlRoomOperation = 'planStudio:approve';
  assertProjectId(operation, project);
  return runEngineJson(operation, ['roadmap', 'approve', project, '--json'], execFileImpl);
}

export async function runGatesList(execFileImpl: ControlRoomExec = execFile): Promise<unknown> {
  const operation: ControlRoomOperation = 'gates:list';
  return runEngineJson(operation, ['gate', 'list', '--json'], execFileImpl);
}

export async function runGateAnswer(
  gateId: string,
  optionIndex: number,
  execFileImpl: ControlRoomExec = execFile,
): Promise<unknown> {
  const operation: ControlRoomOperation = 'gates:answer';
  assertGateId(operation, gateId);
  assertOptionIndex(operation, optionIndex);
  return runEngineJson(
    operation,
    ['gate', 'answer', gateId, String(optionIndex), '--json'],
    execFileImpl,
  );
}

export async function runControlRoomLaneSet(
  project: string,
  role: string,
  runtimes: string[],
  execFileImpl: ControlRoomExec = execFile,
): Promise<unknown> {
  const operation: ControlRoomOperation = 'controlRoom:laneSet';
  assertProjectId(operation, project);
  assertLaneRole(operation, role);
  assertRuntimes(operation, runtimes);
  return runEngineJson(
    operation,
    ['lane', 'set', user(project), user(role), user(runtimes.join(',')), '--json'],
    execFileImpl,
  );
}

/** 프로젝트 추가 — `night lane add <id> <path> <name>`. 원격에서 폴더를 확인해 30초까지 기다린다. */
export const LANE_ADD_TIMEOUT = 30_000;
export async function runControlRoomLaneAdd(
  id: string,
  path: string,
  name: string,
  execFileImpl: ControlRoomExec = execFile,
): Promise<unknown> {
  const operation: ControlRoomOperation = 'controlRoom:laneAdd';
  const problem = newLaneProblem({ id, path, name }, [], runLocationName(currentRunLocation()));
  if (problem) throw invalidInput(operation, problem);
  return runEngineJson(
    operation,
    ['lane', 'add', user(id), user(path.trim()), user(name.trim()), '--json'],
    execFileImpl,
    { timeout: LANE_ADD_TIMEOUT },
  );
}

export async function runControlRoomResume(
  project: string,
  execFileImpl: ControlRoomExec = execFile,
): Promise<unknown> {
  const operation: ControlRoomOperation = 'controlRoom:resume';
  assertProjectId(operation, project);
  return runEngineJson(
    operation,
    ['roadmap', 'resume', user(project), '--json'],
    execFileImpl,
  );
}

export async function runControlRoomPause(
  project: string,
  execFileImpl: ControlRoomExec = execFile,
): Promise<unknown> {
  const operation: ControlRoomOperation = 'controlRoom:pause';
  assertProjectId(operation, project);
  return runEngineJson(
    operation,
    ['roadmap', 'pause', user(project), '--json'],
    execFileImpl,
  );
}

export async function runControlRoomScheduleSet(
  time: string,
  execFileImpl: ControlRoomExec = execFile,
): Promise<unknown> {
  const operation: ControlRoomOperation = 'controlRoom:scheduleSet';
  if (typeof time !== 'string' || !SCHEDULE_TIME_PATTERN.test(time)) {
    throw invalidInput(operation, '시간은 00:00부터 23:59 사이의 HH:MM 형식이어야 합니다.');
  }
  return runEngineJson(operation, ['schedule', time, '--json'], execFileImpl);
}

export const runControlRoomScheduleList = (execFileImpl: ControlRoomExec = execFile): Promise<unknown> =>
  runEngineJson('controlRoom:scheduleList', ['schedule', 'list', '--json'], execFileImpl);

export const runControlRoomScheduleCancel = (execFileImpl: ControlRoomExec = execFile): Promise<unknown> =>
  runEngineJson('controlRoom:scheduleCancel', ['schedule', 'cancel', '--json'], execFileImpl);

export async function runControlRoomHoldChoose(
  taskId: string,
  option: string,
  execFileImpl: ControlRoomExec = execFile,
): Promise<unknown> {
  const operation: ControlRoomOperation = 'controlRoom:holdChoose';
  assertTaskId(operation, taskId);
  assertHoldOption(operation, option);
  return runEngineJson(operation, ['hold', 'choose', user(taskId), option, '--json'], execFileImpl);
}

export async function runControlRoomApprovalAdd(
  category: string,
  summary: string,
  execFileImpl: ControlRoomExec = execFile,
): Promise<unknown> {
  const operation: ControlRoomOperation = 'controlRoom:approvalAdd';
  assertApprovalCategory(operation, category);
  assertApprovalSummary(operation, summary);
  return runEngineJson(
    operation,
    ['approvals', 'add', user(category), user(summary), '--source', 'app', '--json'],
    execFileImpl,
  );
}

function assertApprovalRuleId(operation: ControlRoomOperation, id: unknown): asserts id is string {
  if (typeof id !== 'string' || !APPROVAL_RULE_ID_PATTERN.test(id)) {
    throw invalidInput(operation, '규칙 번호가 올바르지 않습니다.');
  }
}

export async function runControlRoomApprovalEdit(
  id: string,
  summary: string,
  execFileImpl: ControlRoomExec = execFile,
): Promise<unknown> {
  const operation: ControlRoomOperation = 'controlRoom:approvalEdit';
  assertApprovalRuleId(operation, id);
  assertApprovalSummary(operation, summary);
  return runEngineJson(operation, ['approvals', 'edit', id, user(summary), '--json'], execFileImpl);
}

export async function runControlRoomApprovalRemove(
  id: string,
  execFileImpl: ControlRoomExec = execFile,
): Promise<unknown> {
  const operation: ControlRoomOperation = 'controlRoom:approvalRemove';
  assertApprovalRuleId(operation, id);
  return runEngineJson(operation, ['approvals', 'remove', id, '--json'], execFileImpl);
}

// 자동 진행 켜기/끄기/상태 — 고정 명령, 사용자 인자 없음.
const runAutomation = (operation: ControlRoomOperation, verb: string, execFileImpl: ControlRoomExec) =>
  runEngineJson(operation, [verb, '--json'], execFileImpl);

export const runControlRoomAutomationStatus = (execFileImpl: ControlRoomExec = execFile): Promise<unknown> =>
  runAutomation('controlRoom:automationStatus', 'status', execFileImpl);
export const runControlRoomAutomationOn = (execFileImpl: ControlRoomExec = execFile): Promise<unknown> =>
  runAutomation('controlRoom:automationOn', 'always', execFileImpl);
export const runControlRoomAutomationOff = (execFileImpl: ControlRoomExec = execFile): Promise<unknown> =>
  runAutomation('controlRoom:automationOff', 'stop', execFileImpl);

/** 허브 승격 — `night promote hub --json`. 호출될 때만 실행되고 느려서 60초까지 기다린다. */
export const PROMOTE_TIMEOUT = 60_000;
export const runControlRoomPromoteHub = (execFileImpl: ControlRoomExec = execFile): Promise<unknown> =>
  runEngineJson('controlRoom:promoteHub', ['promote', 'hub', '--json'], execFileImpl, { timeout: PROMOTE_TIMEOUT });

// ── Control Room "오늘 끝난 일 / 지금 일하는 AI" (R5/R6) ───────────────────
// Pure helpers — 단위 테스트 대상. board JSON 모양이 바뀌어도 깨지지 않게
// todayDone 계열 키를 넓게 읽고, 현재 작업은 한국어 title 우선·ID는 원문용으로 분리한다.

export interface TodayDoneItem {
  lane: string;
  taskId: string;
  title: string;
}

const TODAY_DONE_KEYS = ['todayDone', 'today_done', 'doneToday', 'done_today', 'completedToday', 'completed_today', 'done', 'today'] as const;

const CURRENT_TITLE_KEYS = ['title', 'taskTitle', 'task_title', 'name', 'label', 'subject', 'summary'] as const;

const CURRENT_ID_KEYS = ['taskId', 'task_id', 'id', 'key'] as const;

const CURRENT_START_KEYS = ['startedAt', 'started_at', 'startAt', 'start_at', 'beginAt', 'begin_at', 'since'] as const;

export const CONTROL_ROOM_FLOW = ['계획', '확인', '작업', '검수', '시험', '사람 확인', '반영'] as const;

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function laneIdOf(lane: unknown, fallback = ''): string {
  if (!lane || typeof lane !== 'object') return fallback;
  const record = lane as Record<string, unknown>;
  return cleanString(record.project ?? record.id ?? record.lane) || fallback;
}

function normalizeTodayEntry(entry: unknown, laneFallback: string): TodayDoneItem | null {
  if (typeof entry === 'string') {
    const text = entry.trim();
    if (!text) return null;
    return { lane: laneFallback, taskId: text, title: text };
  }
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  const lane = cleanString(record.lane ?? record.project) || laneFallback;
  const taskId = cleanString(record.taskId ?? record.task_id ?? record.id ?? record.key);
  const title = cleanString(record.title ?? record.taskTitle ?? record.name ?? record.label ?? record.summary) || taskId;
  if (!taskId && !title) return null;
  return { lane, taskId, title };
}

/** board.todayDone(계열) 또는 각 lane의 todayDone(계열) 배열을 모아 정규화한다. Pure. */
export function normalizeTodayDone(board: unknown): TodayDoneItem[] {
  if (!board || typeof board !== 'object' || Array.isArray(board)) return [];
  const root = board as Record<string, unknown>;
  const out: TodayDoneItem[] = [];
  for (const key of TODAY_DONE_KEYS) {
    const list = root[key];
    if (Array.isArray(list)) {
      for (const entry of list) {
        const fallback = entry && typeof entry === 'object'
          ? cleanString((entry as Record<string, unknown>).lane ?? (entry as Record<string, unknown>).project)
          : '';
        const item = normalizeTodayEntry(entry, fallback);
        if (item) out.push(item);
      }
      if (out.length > 0) return out;
    }
  }
  const lanes = root.lanes;
  if (!Array.isArray(lanes)) return out;
  for (const lane of lanes) {
    if (!lane || typeof lane !== 'object') continue;
    const record = lane as Record<string, unknown>;
    const laneId = laneIdOf(lane);
    for (const key of TODAY_DONE_KEYS) {
      const list = record[key];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        const item = normalizeTodayEntry(entry, laneId);
        if (item) out.push({ ...item, lane: item.lane || laneId });
      }
    }
  }
  return out;
}

/** current 객체에서 한국어 title 후보를 우선 반환, 없으면 taskId로 폴백. Pure. */
export function currentTaskTitle(current: unknown): string {
  if (typeof current === 'string') return current.trim();
  if (!current || typeof current !== 'object') return '';
  const record = current as Record<string, unknown>;
  for (const key of CURRENT_TITLE_KEYS) {
    const text = cleanString(record[key]);
    if (text) return text;
  }
  for (const key of CURRENT_ID_KEYS) {
    const text = cleanString(record[key]);
    if (text) return text;
  }
  return '';
}

/** current 객체의 작업 ID (원문 보기용). Pure. */
export function currentTaskId(current: unknown): string {
  if (typeof current === 'string') return current.trim();
  if (!current || typeof current !== 'object') return '';
  const record = current as Record<string, unknown>;
  for (const key of CURRENT_ID_KEYS) {
    const text = cleanString(record[key]);
    if (text) return text;
  }
  return '';
}

/** 현재 작업이 있으면 true (title 또는 ID 중 하나라도 비어 있지 않음). Pure. */
export function hasCurrentWork(lane: unknown): boolean {
  if (!lane || typeof lane !== 'object') return false;
  const current = (lane as Record<string, unknown>).current;
  return currentTaskTitle(current) !== '' || currentTaskId(current) !== '';
}

function parseStartMs(startedAt: unknown): number | null {
  if (typeof startedAt === 'number' && Number.isFinite(startedAt) && startedAt > 0) {
    return startedAt < 1e12 ? startedAt * 1000 : startedAt;
  }
  if (typeof startedAt === 'string' && startedAt.trim()) {
    const parsed = Date.parse(startedAt.trim());
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function startOfCurrent(current: unknown): unknown {
  if (!current || typeof current !== 'object') return undefined;
  const record = current as Record<string, unknown>;
  for (const key of CURRENT_START_KEYS) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    if (cleanString(value) !== '') return value;
  }
  return undefined;
}

/** 시작 시각 → 한국어 경과 ("방금 시작" / "N분째" / "N시간째" / "N시간 M분째" / "N일째"). Pure. */
export function elapsedKorean(startedAt: unknown, nowMs: number = Date.now()): string {
  const start = parseStartMs(startedAt);
  if (start === null || !Number.isFinite(nowMs)) return '';
  const diff = Math.max(0, nowMs - start);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '방금 시작';
  if (minutes < 60) return `${minutes}분째`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `${hours}시간째` : `${hours}시간 ${rest}분째`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}일째` : `${days}일 ${restHours}시간째`;
}

/** stage 값 → 한국어 단계 라벨 (숫자는 FLOW, 문자열은 그대로). Pure. */
export function laneStageLabel(stage: unknown): string {
  if (typeof stage === 'number' && Number.isFinite(stage)) {
    const index = Math.max(0, Math.min(CONTROL_ROOM_FLOW.length - 1, Math.floor(stage)));
    return CONTROL_ROOM_FLOW[index] as string;
  }
  const text = cleanString(stage);
  return text || CONTROL_ROOM_FLOW[0] as string;
}

function firstChainName(value: unknown): string {
  if (typeof value === 'string') {
    const parts = value.split(/[,|\s>→]+/).map(part => part.trim()).filter(part => part.length > 0);
    return parts[0] ?? '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) return item.trim();
    }
    return '';
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const chain = record.chain ?? record.runtimes ?? record.order;
    if (Array.isArray(chain)) return firstChainName(chain);
    for (const key of ['name', 'id', 'runtime', 'worker', 'owner']) {
      const text = cleanString(record[key]);
      if (text) return text;
    }
  }
  return '';
}

/** lane의 담당 AI 이름 (workerChain → current.worker 순). Pure. */
export function laneWorkerName(lane: unknown): string {
  if (!lane || typeof lane !== 'object') return '';
  const record = lane as Record<string, unknown>;
  const current = (record.current ?? {}) as Record<string, unknown>;
  return firstChainName(record.workerChain ?? current.worker ?? record.worker) || cleanString(current.worker);
}

/** 일하는 lane 1개의 "레인 · 단계 · 경과 · AI" 조각, 쉬는 lane은 null. Pure. */
export function whoSegmentForLane(lane: unknown, nowMs: number = Date.now()): string | null {
  if (!hasCurrentWork(lane)) return null;
  const record = lane as Record<string, unknown>;
  const current = (record.current ?? {}) as Record<string, unknown>;
  const laneName = laneIdOf(lane, '알 수 없는 레인');
  const stage = laneStageLabel(current.stage);
  const elapsed = elapsedKorean(startOfCurrent(current), nowMs) || '경과 확인 중';
  const worker = laneWorkerName(lane);
  return worker ? `${laneName} · ${stage} · ${elapsed} · ${worker}` : `${laneName} · ${stage} · ${elapsed}`;
}

/** 관제실 맨 위 한 줄: 일하는 AI가 있으면 "지금 일하는 AI: …", 없으면 "…쉬는 중". Pure. */
export function workingSummary(lanes: unknown, nowMs: number = Date.now()): string {
  if (!Array.isArray(lanes)) return '지금 일하는 AI: 쉬는 중';
  const segments: string[] = [];
  for (const lane of lanes) {
    const segment = whoSegmentForLane(lane, nowMs);
    if (segment) segments.push(segment);
  }
  if (segments.length === 0) return '지금 일하는 AI: 쉬는 중';
  return `지금 일하는 AI: ${segments.join(' / ')}`;
}

// ── 밤 보고서 수신 목록 (읽기 전용) ─────────────────────────────────────────
// `night review --json`은 LAST_NIGHT_RUN과 NIGHT_REPORT 수신 여부를 한 JSON으로 준다.
// 막힘이 있으면 종료 코드 1이지만 stdout JSON은 그대로 목록이다. 사용자 인자는 없다.

export interface NightReportRow {
  title: string;
  status: string;
  detail: string;
  tone: 'ok' | 'look';
}

export interface NightReportList {
  sentence: string;
  rows: NightReportRow[];
  raw: string;
}

const END_REASON_KO: Record<string, string> = {
  WBS_EXHAUSTED: '할 일을 다 끝냈어요',
  DEADLINE_COMPLETE: '정한 시각에 끝냈어요',
  DEADLINE_FORCED_CHECKPOINT: '정한 시각에 기록을 남기고 멈췄어요',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function infoMap(info: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(info)) return out;
  for (const line of info) {
    if (typeof line !== 'string') continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && !(key in out)) out[key] = value;
  }
  return out;
}

function blockerText(blockers: unknown): string {
  if (!Array.isArray(blockers)) return '';
  return blockers.filter((line): line is string => typeof line === 'string').join('\n');
}

/** 시각을 '방금' / '3분 전' / '오후 2:10'으로. ISO 문자열은 화면에 올리지 않는다. */
function founderWhen(value: unknown, nowMs: number): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  const delta = nowMs - ms;
  if (delta >= 0 && delta < 60_000) return '방금';
  if (delta >= 0 && delta < 60 * 60_000) return `${Math.max(1, Math.floor(delta / 60_000))}분 전`;
  if (delta >= 0 && delta < 24 * 60 * 60_000) return `${Math.max(1, Math.floor(delta / 3_600_000))}시간 전`;
  const at = new Date(ms);
  const hour = at.getHours();
  const minute = String(at.getMinutes()).padStart(2, '0');
  const ampm = hour < 12 ? '오전' : '오후';
  const h12 = hour % 12 || 12;
  return `${at.getMonth() + 1}월 ${at.getDate()}일 ${ampm} ${h12}:${minute}`;
}

function reportDayLabel(source: string): string {
  const match = /NIGHT_REPORT_(\d{4})-(\d{2})-(\d{2})/.exec(source);
  if (!match) return '';
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!month || !day) return '';
  return `${month}월 ${day}일`;
}

function titleFor(kind: 'report' | 'run', source: string): string {
  const day = reportDayLabel(source);
  if (kind === 'report') return day ? `${day} 밤 보고서` : '밤 보고서';
  return '어젯밤 기록';
}

function arrivalDetail(status: string, when: unknown, nowMs: number): string {
  const rel = founderWhen(when, nowMs);
  if (status === '받았어요') {
    if (!rel) return '이 컴퓨터로 도착했어요';
    if (rel === '방금') return '방금 도착했어요';
    return `${rel}에 도착했어요`;
  }
  if (status === '보내는 중이에요') return '지금 이 컴퓨터로 보내는 중이에요.';
  if (status === '보내지 못했어요') return '다른 컴퓨터는 켜져 있었는데, 보고서를 보내지 못했어요.';
  if (status === '연습으로만 만들었어요') return '실제로 이 컴퓨터에 보내지는 않았어요.';
  if (status === '확인하지 못했어요') return '도착했는지는 아직 확인하지 못했어요.';
  return '밤 작업이 끝나면 여기에 자동으로 나타나요.';
}

function reportStatusFrom(transfer: string, reportPath: string, blockers: string): { status: string; tone: 'ok' | 'look' } {
  const state = transfer.trim().toUpperCase();
  if (state === 'DELIVERED') return { status: '받았어요', tone: 'ok' };
  if (state === 'DRY_RUN') return { status: '연습으로만 만들었어요', tone: 'look' };
  if (state === 'PENDING') return { status: '보내는 중이에요', tone: 'look' };
  if (state.includes('FAIL') || blockers.includes('REPORT_TRANSFER_FAILED') || blockers.includes('reportTransferError')) {
    return { status: '보내지 못했어요', tone: 'look' };
  }
  if (blockers.includes('REPORT_MISSING')) return { status: '아직 안 왔어요', tone: 'look' };
  if (reportPath || state) return { status: '확인하지 못했어요', tone: 'look' };
  return { status: '아직 안 왔어요', tone: 'look' };
}

function rowsFromReview(payload: Record<string, unknown>, nowMs: number): NightReportRow[] {
  const info = infoMap(payload.info);
  const blockers = blockerText(payload.blockers);
  const reportPath = info.report ?? '';
  const reportStatus = reportStatusFrom(info.reportTransferState ?? '', reportPath, blockers);
  const when = info.endedAt || info.startedAt || '';
  const report: NightReportRow = {
    title: titleFor('report', reportPath),
    status: reportStatus.status,
    detail: arrivalDetail(reportStatus.status, when, nowMs),
    tone: reportStatus.tone,
  };
  const missingRun = blockers.includes('NO_LAST_NIGHT_RUN');
  const hasRun = !missingRun && Boolean(info.runId || info.startedAt || info.endedAt || info.endReason);
  const reason = hasRun ? (END_REASON_KO[info.endReason ?? ''] ?? (info.endReason ? '끝난 이유를 확인하지 못했어요' : '')) : '';
  const runDetail = hasRun ? arrivalDetail('받았어요', info.endedAt ?? '', nowMs) : '밤 작업이 끝나면 여기에 자동으로 나타나요.';
  const run: NightReportRow = {
    title: '어젯밤 기록',
    status: hasRun ? '받았어요' : '아직 안 왔어요',
    detail: reason ? `${reason} · ${runDetail}` : runDetail,
    tone: hasRun ? 'ok' : 'look',
  };
  return [report, run];
}

function kindFromText(text: string): 'report' | 'run' | null {
  if (/NIGHT_REPORT/i.test(text)) return 'report';
  if (/LAST_NIGHT_RUN/i.test(text)) return 'run';
  return null;
}

function textOf(record: Record<string, unknown>): string {
  return ['kind', 'type', 'name', 'file', 'path', 'id']
    .map((key) => record[key])
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
}

function statusFromRecord(record: Record<string, unknown>): { status: string; tone: 'ok' | 'look' } {
  const state = [record.state, record.status, record.reportTransferState]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  if (/PENDING/i.test(state)) return { status: '보내는 중이에요', tone: 'look' };
  if (/FAIL/i.test(state)) return { status: '보내지 못했어요', tone: 'look' };
  if (/DRY_RUN/i.test(state)) return { status: '연습으로만 만들었어요', tone: 'look' };
  if (record.received === false || record.ok === false) return { status: '아직 안 왔어요', tone: 'look' };
  if (/DELIVERED|RECEIVED/i.test(state) || record.received === true || record.ok === true) {
    return { status: '받았어요', tone: 'ok' };
  }
  if (state.trim()) return { status: '확인하지 못했어요', tone: 'look' };
  return { status: '받았어요', tone: 'ok' };
}

function firstTime(record: Record<string, unknown>): unknown {
  for (const key of ['at', 'receivedAt', 'endedAt', 'updatedAt']) {
    if (typeof record[key] === 'string' && record[key]) return record[key];
  }
  return '';
}

function rowFromItem(item: unknown, nowMs: number): NightReportRow[] {
  if (typeof item === 'string') {
    const kind = kindFromText(item);
    if (!kind) return [];
    return [{
      title: titleFor(kind, item),
      status: '받았어요',
      detail: arrivalDetail('받았어요', '', nowMs),
      tone: 'ok',
    }];
  }
  const record = asRecord(item);
  if (!record) return [];
  const source = textOf(record);
  const kind = kindFromText(source);
  if (!kind) return [];
  const status = statusFromRecord(record);
  return [{
    title: titleFor(kind, source),
    status: status.status,
    detail: arrivalDetail(status.status, firstTime(record), nowMs),
    tone: status.tone,
  }];
}

function explicitItems(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return null;
  for (const key of ['reports', 'items', 'nightReports', 'received', 'files']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return null;
}

function isReviewPayload(payload: unknown): payload is Record<string, unknown> {
  const record = asRecord(payload);
  if (!record) return false;
  if (record.kind === 'REVIEW') return true;
  return Array.isArray(record.info) && Array.isArray(record.blockers);
}

function nightReportSentence(rows: NightReportRow[]): string {
  if (rows.length === 0 || rows.every((row) => row.tone !== 'ok')) {
    return '아직 받은 밤 보고서가 없어요. 밤 작업이 끝나면 여기에 자동으로 나타나요.';
  }
  if (rows.every((row) => row.tone === 'ok')) {
    return '받은 밤 보고서가 있어요. 지금 하실 일은 없어요.';
  }
  return '일부만 도착했어요. 나머지는 밤 작업이 끝나면 알아서 채워져요. 지금 하실 일은 없어요.';
}

/**
 * 원격 JSON을 대표님용 수신 목록으로 바꾼다. 경로·해시·영문 상태어는 raw에만 남긴다.
 */
export function presentNightReports(payload: unknown, nowMs: number = Date.now()): NightReportList {
  const items = explicitItems(payload);
  const rows = items
    ? items.flatMap((item) => rowFromItem(item, nowMs))
    : isReviewPayload(payload)
      ? rowsFromReview(payload, nowMs)
      : [];
  let raw = '';
  try {
    raw = JSON.stringify(payload, null, 2);
  } catch {
    raw = '';
  }
  return { sentence: nightReportSentence(rows), rows, raw };
}

function thrownStdout(cause: unknown): string {
  if (!cause || typeof cause !== 'object') return '';
  const stdout = (cause as { stdout?: unknown }).stdout;
  if (typeof stdout === 'string') return stdout;
  if (Buffer.isBuffer(stdout)) return stdout.toString('utf8');
  return '';
}

function thrownCode(cause: unknown): number | null {
  if (!cause || typeof cause !== 'object') return null;
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'number' ? code : null;
}

/**
 * 관제실 밤 보고서 수신 목록. `night review --json`만 호출하고, 가짜 실행기로 시험한다.
 * 막힘으로 종료 코드가 1이어도 stdout JSON은 목록으로 읽는다. 연결 실패(255·응답 없음)는 꺼짐으로 구분한다.
 */
export async function runControlRoomNightReports(
  execFileImpl: ControlRoomExec = execFile,
  nowMs: number = Date.now(),
): Promise<NightReportList> {
  const operation: ControlRoomOperation = 'controlRoom:nightReports';
  const location = currentRunLocation();
  const command = engineCommand(location, ['review', '--json']);
  const parseStdout = (stdout: string): NightReportList => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch (cause) {
      throw new ControlRoomError('INVALID_JSON', operation, badReplyMessage(location), cause);
    }
    return presentNightReports(parsed, nowMs);
  };

  try {
    const { stdout } = await execFileImpl(command.file, command.args, { shell: false, timeout: EXEC_TIMEOUT });
    return parseStdout(stdout);
  } catch (cause) {
    if (cause instanceof ControlRoomError) throw cause;
    const code = thrownCode(cause);
    const stdout = thrownStdout(cause).trim();
    // ssh에서 255는 연결 실패라 stdout이 있어도 믿지 않는다. 이 컴퓨터에서는 어떤 종료 코드든 엔진이 낸 것이다.
    const engineRan = code !== null && (location.kind === 'local' || code !== 255);
    if (engineRan && stdout) return parseStdout(stdout);
    throw execFailure(operation, cause, location);
  }
}

// Aliases for relay wiring flexibility.
export const runLaneSet = runControlRoomLaneSet;
export const runRoadmapResume = runControlRoomResume;
export const runApprovalAdd = runControlRoomApprovalAdd;
