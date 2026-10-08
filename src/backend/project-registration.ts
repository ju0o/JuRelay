/**
 * P2-OWNER-R00 — register project into WorkspaceConfigV2 + change path safely.
 *
 * No separate project DB. Registration appends a lane with schema stubs
 * (no workerId). Path changes never rewrite Task.scope / Run.workspaceRoot /
 * Evidence. Zero Goals/Tasks/Runs/Workers.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  readWorkspaceConfigV2,
  writeWorkspaceConfigV2,
  type LaneConfigV2,
  type RoleBinding,
  type WorkspaceConfigV2,
} from '../workspace/config-v2.js';
import {
  normalizeProjectId,
  upsertProjectRegistryName,
} from './project-identity.js';
import {
  getProjectProfile,
  listProjectProfiles,
  type ListProjectProfilesInput,
  type ProjectProfileView,
} from './project-profile.js';
import {
  DEFAULT_WORKSPACE_BROWSE_ROOTS,
  listBrowseRoots,
  resolveAndValidatePath,
  tryRealpath,
  type BrowseRootInfo,
} from './workspace-browse.js';
import { listTasks } from './goal-task.js';
import {
  readRoleConfig,
  roleConfigPath,
  writeRoleConfig,
  type RoleConfig,
} from '../roles/role-config.js';

export type ProjectRegistrationErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'DUPLICATE_PROJECT_ID'
  | 'DUPLICATE_WORKSPACE'
  | 'HOST_ROOT_REQUIRED'
  | 'CONFIRM_REQUIRED'
  | 'PATH_CHANGE_BLOCKED'
  | 'WORKSPACE_PATH_CONFLICT'
  | 'OUTSIDE_ALLOWLIST'
  | 'NOT_DIRECTORY';

export class ProjectRegistrationError extends Error {
  readonly code: ProjectRegistrationErrorCode;
  readonly blockers?: string[];
  constructor(code: ProjectRegistrationErrorCode, message: string, blockers?: string[]) {
    super(message);
    this.name = 'ProjectRegistrationError';
    this.code = code;
    this.blockers = blockers;
  }
}

export interface GitProbeInfo {
  isRepo: boolean;
  headSha: string | null;
  remoteUrl: string | null;
  topLevel: string | null;
}

export interface RegisterProjectInput {
  dataRoot: string;
  scope: string;
  /** Host that owns WorkspaceConfigV2 (Agent-Relay). */
  hostRoot: string;
  projectName: string;
  workspacePath: string;
  projectId?: string;
  /** Must be true to write. */
  confirm?: boolean;
  browseRoots?: ReadonlyArray<{ rootId: string; label: string; path: string }>;
  hostRoots?: string[];
}

export interface RegisterProjectPreview {
  ok: true;
  wouldWrite: boolean;
  projectId: string;
  projectName: string;
  workspacePath: string;
  hostRoot: string;
  git: GitProbeInfo;
  profileStateAfter: 'PARTIAL';
  blockers: string[];
  sideEffects: ZeroSideEffects;
}

export interface ZeroSideEffects {
  goalsCreated: 0;
  tasksCreated: 0;
  runsCreated: 0;
  workersSpawned: 0;
  tmuxOpened: 0;
  agentAutoSelected: 0;
  modelAutoSelected: 0;
}

export interface RegisterProjectResult {
  ok: true;
  projectId: string;
  projectName: string;
  workspacePath: string;
  hostRoot: string;
  profile: ProjectProfileView;
  git: GitProbeInfo;
  sideEffects: ZeroSideEffects;
}

export interface SetProjectWorkspacePathInput {
  dataRoot: string;
  scope: string;
  projectId: string;
  workspacePath: string;
  hostRoot?: string;
  hostRoots?: string[];
  /** When lane and RoleConfig disagree, update RoleConfig to the new path too. */
  syncRoleConfig?: boolean;
  browseRoots?: ReadonlyArray<{ rootId: string; label: string; path: string }>;
}

export interface SetProjectWorkspacePathResult {
  ok: true;
  projectId: string;
  previousPath: string | null;
  nextPath: string;
  profile: ProjectProfileView;
  blockers: string[];
  sideEffects: ZeroSideEffects & { taskScopesRewritten: 0; runRootsRewritten: 0 };
}

const ZERO: ZeroSideEffects = {
  goalsCreated: 0,
  tasksCreated: 0,
  runsCreated: 0,
  workersSpawned: 0,
  tmuxOpened: 0,
  agentAutoSelected: 0,
  modelAutoSelected: 0,
};

const STUB_RUNTIMES = new Set(['unconfigured', 'unset', 'none']);

function requireHostRoot(hostRoot: string | undefined | null): string {
  if (typeof hostRoot !== 'string' || !hostRoot.trim()) {
    throw new ProjectRegistrationError(
      'HOST_ROOT_REQUIRED',
      'WorkspaceConfigV2 hostRoot가 필요합니다 (MCP goalLoop.workspaceRoot).',
    );
  }
  const real = tryRealpath(hostRoot.trim());
  if (!real) {
    throw new ProjectRegistrationError('NOT_FOUND', `hostRoot가 없습니다: ${hostRoot}`);
  }
  if (!fs.existsSync(path.join(real, '.agent-relay', 'workspace-config.json'))) {
    throw new ProjectRegistrationError(
      'HOST_ROOT_REQUIRED',
      `hostRoot에 workspace-config.json이 없습니다: ${real}`,
    );
  }
  return real;
}

function stubBinding(role: 'pm' | 'builder' | 'qa'): RoleBinding {
  if (role === 'pm') {
    return {
      runtime: 'chatgpt',
      model: 'default',
      roleProfile: { sessionPolicy: 'persistent', permissionProfile: 'read-only' },
    };
  }
  if (role === 'builder') {
    return {
      runtime: 'unconfigured',
      model: 'unset',
      roleProfile: { sessionPolicy: 'per-task', permissionProfile: 'write-workspace' },
    };
  }
  return {
    runtime: 'unconfigured',
    model: 'unset',
    roleProfile: { sessionPolicy: 'per-task', permissionProfile: 'read-only' },
  };
}

/** Read-only git probe — never mutates. */
export function probeGitReadonly(workspacePath: string): GitProbeInfo {
  const empty: GitProbeInfo = { isRepo: false, headSha: null, remoteUrl: null, topLevel: null };
  try {
    const top = execFileSync('git', ['-C', workspacePath, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!top) return empty;
    let headSha: string | null = null;
    try {
      headSha = execFileSync('git', ['-C', top, 'rev-parse', '--short', 'HEAD'], {
        encoding: 'utf8',
        timeout: 8000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim() || null;
    } catch {
      headSha = null;
    }
    let remoteUrl: string | null = null;
    try {
      remoteUrl = execFileSync('git', ['-C', top, 'remote', 'get-url', 'origin'], {
        encoding: 'utf8',
        timeout: 8000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim() || null;
    } catch {
      remoteUrl = null;
    }
    return { isRepo: true, headSha, remoteUrl, topLevel: top };
  } catch {
    return empty;
  }
}

function loadHostConfig(hostRoot: string): WorkspaceConfigV2 {
  const cfg = readWorkspaceConfigV2(hostRoot);
  if (!cfg) {
    throw new ProjectRegistrationError(
      'HOST_ROOT_REQUIRED',
      `WorkspaceConfigV2를 읽을 수 없습니다: ${hostRoot}`,
    );
  }
  return cfg;
}

function sameRealpath(a: string, b: string): boolean {
  const ra = tryRealpath(a);
  const rb = tryRealpath(b);
  if (ra && rb) return ra === rb;
  return path.resolve(a) === path.resolve(b);
}

function findLane(
  cfg: WorkspaceConfigV2,
  projectId: string,
): { index: number; lane: LaneConfigV2 } | null {
  for (let i = 0; i < cfg.lanes.length; i++) {
    const lane = cfg.lanes[i];
    try {
      if (normalizeProjectId(lane.id) === projectId) return { index: i, lane };
    } catch {
      if (lane.id === projectId) return { index: i, lane };
    }
  }
  return null;
}

function findDuplicateWorkspace(
  cfg: WorkspaceConfigV2,
  workspacePath: string,
  exceptProjectId?: string,
): string | null {
  for (const lane of cfg.lanes) {
    let laneId = lane.id;
    try {
      laneId = normalizeProjectId(lane.id);
    } catch {
      /* keep */
    }
    if (exceptProjectId && laneId === exceptProjectId) continue;
    if (sameRealpath(lane.root, workspacePath)) return laneId;
  }
  return null;
}

function profileInput(
  dataRoot: string,
  scope: string,
  hostRoot: string,
  hostRoots?: string[],
): ListProjectProfilesInput {
  const roots = new Set<string>([hostRoot, ...(hostRoots || [])]);
  return {
    dataRoot,
    scope,
    hostRoots: [...roots],
    includeCwdHostRoot: false,
  };
}

function collectBlockersForPathChange(input: {
  dataRoot: string;
  scope: string;
  projectId: string;
  profile: ProjectProfileView;
}): string[] {
  const blockers: string[] = [];
  const rt = input.profile.runtime;
  if (rt?.runtimeState === 'ACTIVE' || rt?.runtimeState === 'STALE') {
    blockers.push(`ACTIVE_WORKER:${rt.runtimeState}`);
  }
  if (rt?.executionState === 'RUNNING' || rt?.executionState === 'DISPATCHED') {
    blockers.push(`ACTIVE_EXECUTION:${rt.executionState}`);
  }

  let tasks: ReturnType<typeof listTasks> = [];
  try {
    tasks = listTasks(input.dataRoot, input.scope);
  } catch {
    tasks = [];
  }
  for (const t of tasks) {
    const tid = typeof t.projectId === 'string' ? t.projectId.trim() : '';
    if (tid !== input.projectId) continue;
    const ex = t.executionState;
    if (ex === 'READY' || ex === 'RUNNING' || ex === 'DISPATCHED') {
      blockers.push(`TASK_${ex}:${t.taskId}`);
    }
    if (t.pmState === 'VERIFYING') {
      blockers.push(`TASK_PM_VERIFYING:${t.taskId}`);
    }
    const runs = t.linkedRuns || [];
    // Any linked run counts as binding to prior workspace evidence — hard block.
    if (runs.length) {
      const first = runs[0] as { folder?: string; runId?: string };
      const tip = first?.runId || (first?.folder ? path.basename(first.folder) : String(runs.length));
      blockers.push(`LINKED_RUN:${t.taskId}:${tip}`);
    }
  }
  return [...new Set(blockers)];
}

function validateRegisterCommon(input: RegisterProjectInput): {
  hostRoot: string;
  projectId: string;
  projectName: string;
  workspacePath: string;
  git: GitProbeInfo;
  cfg: WorkspaceConfigV2;
  blockers: string[];
} {
  const hostRoot = requireHostRoot(input.hostRoot);
  const roots = input.browseRoots ?? DEFAULT_WORKSPACE_BROWSE_ROOTS;
  let workspacePath: string;
  try {
    workspacePath = resolveAndValidatePath(input.workspacePath, roots).absolutePath;
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : '';
    if (code === 'OUTSIDE_ALLOWLIST' || code === 'NOT_FOUND' || code === 'NOT_DIRECTORY' || code === 'INVALID_ARGUMENT') {
      throw new ProjectRegistrationError(
        code as ProjectRegistrationErrorCode,
        err instanceof Error ? err.message : String(err),
      );
    }
    throw err;
  }

  const projectName = (input.projectName || '').trim();
  if (!projectName) {
    throw new ProjectRegistrationError('INVALID_ARGUMENT', '프로젝트 이름이 필요합니다.');
  }
  const projectId = input.projectId && String(input.projectId).trim()
    ? normalizeProjectId(input.projectId)
    : normalizeProjectId(path.basename(workspacePath));

  const cfg = loadHostConfig(hostRoot);
  const blockers: string[] = [];
  if (findLane(cfg, projectId)) {
    throw new ProjectRegistrationError(
      'DUPLICATE_PROJECT_ID',
      `이미 등록된 projectId입니다: ${projectId}`,
    );
  }
  const dupRoot = findDuplicateWorkspace(cfg, workspacePath);
  if (dupRoot) {
    throw new ProjectRegistrationError(
      'DUPLICATE_WORKSPACE',
      `이미 다른 프로젝트(${dupRoot})에 등록된 작업 폴더입니다.`,
    );
  }

  const git = probeGitReadonly(workspacePath);
  return { hostRoot, projectId, projectName, workspacePath, git, cfg, blockers };
}

export function previewRegisterProject(input: RegisterProjectInput): RegisterProjectPreview {
  const common = validateRegisterCommon(input);
  return {
    ok: true,
    wouldWrite: false,
    projectId: common.projectId,
    projectName: common.projectName,
    workspacePath: common.workspacePath,
    hostRoot: common.hostRoot,
    git: common.git,
    profileStateAfter: 'PARTIAL',
    blockers: common.blockers,
    sideEffects: { ...ZERO },
  };
}

export function registerProject(input: RegisterProjectInput): RegisterProjectResult {
  if (input.confirm !== true) {
    throw new ProjectRegistrationError(
      'CONFIRM_REQUIRED',
      '등록하려면 confirm=true로 명시적 승인이 필요합니다. 먼저 preview를 확인하세요.',
    );
  }
  const common = validateRegisterCommon(input);
  const lane: LaneConfigV2 = {
    id: common.projectId,
    label: common.projectName,
    root: common.workspacePath,
    goal: `${common.projectName} (등록됨 — 역할 할당 전)`,
    pm: stubBinding('pm'),
    builder: stubBinding('builder'),
    qa: stubBinding('qa'),
    qaFallback: { runtime: 'cursor', model: 'default' },
  };
  const next: WorkspaceConfigV2 = {
    ...common.cfg,
    lanes: [...common.cfg.lanes, lane],
  };
  writeWorkspaceConfigV2(common.hostRoot, next);
  try {
    upsertProjectRegistryName(input.dataRoot, common.projectId, common.projectName);
  } catch {
    /* registry is auxiliary; lane write already succeeded */
  }

  const listedInput = profileInput(input.dataRoot, input.scope, common.hostRoot, input.hostRoots);
  const profile = getProjectProfile(listedInput, common.projectId);
  if (!profile) {
    throw new ProjectRegistrationError(
      'NOT_FOUND',
      `등록 후 ProjectProfile을 찾지 못했습니다: ${common.projectId}`,
    );
  }
  return {
    ok: true,
    projectId: common.projectId,
    projectName: common.projectName,
    workspacePath: common.workspacePath,
    hostRoot: common.hostRoot,
    profile,
    git: common.git,
    sideEffects: { ...ZERO },
  };
}

function findRoleConfigForProject(dataRoot: string, projectId: string): { key: string; config: RoleConfig } | null {
  const candidates = [projectId];
  try {
    const dir = path.join(path.resolve(dataRoot), '_relay', 'roles');
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json') || name.includes('.bak')) continue;
      const key = name.slice(0, -'.json'.length);
      try {
        if (normalizeProjectId(key) === projectId) candidates.push(key);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  for (const key of [...new Set(candidates)]) {
    try {
      if (!fs.existsSync(roleConfigPath(dataRoot, key))) continue;
      return { key, config: readRoleConfig(dataRoot, key) };
    } catch {
      continue;
    }
  }
  return null;
}

export function setProjectWorkspacePath(input: SetProjectWorkspacePathInput): SetProjectWorkspacePathResult {
  const projectId = normalizeProjectId(input.projectId);
  const roots = input.browseRoots ?? DEFAULT_WORKSPACE_BROWSE_ROOTS;
  let nextPath: string;
  try {
    nextPath = resolveAndValidatePath(input.workspacePath, roots).absolutePath;
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : '';
    if (code === 'OUTSIDE_ALLOWLIST' || code === 'NOT_FOUND' || code === 'NOT_DIRECTORY' || code === 'INVALID_ARGUMENT') {
      throw new ProjectRegistrationError(
        code as ProjectRegistrationErrorCode,
        err instanceof Error ? err.message : String(err),
      );
    }
    throw err;
  }

  const hostRoot = input.hostRoot
    ? requireHostRoot(input.hostRoot)
    : null;
  const hostRoots = [
    ...(hostRoot ? [hostRoot] : []),
    ...(input.hostRoots || []),
  ];
  const listedInput = profileInput(input.dataRoot, input.scope, hostRoot || (hostRoots[0] || ''), hostRoots);
  // Ensure hostRoots non-empty for profile discovery
  if (!listedInput.hostRoots?.length && hostRoot) listedInput.hostRoots = [hostRoot];

  const profileBefore = getProjectProfile(
    {
      ...listedInput,
      hostRoots: listedInput.hostRoots?.length
        ? listedInput.hostRoots
        : (hostRoot ? [hostRoot] : undefined),
      includeCwdHostRoot: !hostRoot,
    },
    projectId,
  );
  if (!profileBefore) {
    throw new ProjectRegistrationError('NOT_FOUND', `프로젝트를 찾을 수 없습니다: ${projectId}`);
  }

  const blockers = collectBlockersForPathChange({
    dataRoot: input.dataRoot,
    scope: input.scope,
    projectId,
    profile: profileBefore,
  });
  if (blockers.length) {
    throw new ProjectRegistrationError(
      'PATH_CHANGE_BLOCKED',
      `경로를 바꿀 수 없습니다: ${blockers.join(', ')}`,
      blockers,
    );
  }

  // Resolve which host holds the lane.
  let targetHost = hostRoot;
  let cfg: WorkspaceConfigV2 | null = null;
  const searchRoots = [...new Set([
    ...(hostRoot ? [hostRoot] : []),
    ...(input.hostRoots || []),
  ])];
  if (!searchRoots.length) {
    // Fall back to profile discovery via includeCwd
    const discovered = listProjectProfiles({
      dataRoot: input.dataRoot,
      scope: input.scope,
      includeCwdHostRoot: true,
      hostRoots: input.hostRoots,
    });
    void discovered;
  }
  for (const hr of searchRoots) {
    const c = readWorkspaceConfigV2(hr);
    if (!c) continue;
    if (findLane(c, projectId)) {
      targetHost = hr;
      cfg = c;
      break;
    }
  }
  if (!cfg || !targetHost) {
    // Try reading hostRoot even if lane search failed
    if (hostRoot) {
      cfg = loadHostConfig(hostRoot);
      targetHost = hostRoot;
    }
  }
  if (!cfg || !targetHost) {
    throw new ProjectRegistrationError(
      'HOST_ROOT_REQUIRED',
      `프로젝트 '${projectId}' lane을 담은 hostRoot를 찾을 수 없습니다.`,
    );
  }

  const dup = findDuplicateWorkspace(cfg, nextPath, projectId);
  if (dup) {
    throw new ProjectRegistrationError(
      'DUPLICATE_WORKSPACE',
      `이미 다른 프로젝트(${dup})에 등록된 작업 폴더입니다.`,
    );
  }

  const hit = findLane(cfg, projectId);
  const roleHit = findRoleConfigForProject(input.dataRoot, projectId);
  const previousPath = profileBefore.workspacePath;

  if (profileBefore.workspaceConflict && input.syncRoleConfig !== true) {
    throw new ProjectRegistrationError(
      'WORKSPACE_PATH_CONFLICT',
      'WorkspaceConfig와 RoleConfig 경로가 서로 다릅니다. syncRoleConfig=true로 같은 새 경로에 맞추거나 충돌을 먼저 해소하세요.',
      ['WORKSPACE_PATH_CONFLICT'],
    );
  }

  if (!hit) {
    throw new ProjectRegistrationError(
      'NOT_FOUND',
      `WorkspaceConfigV2 lane이 없습니다: ${projectId}`,
    );
  }

  const lanes = cfg.lanes.slice();
  lanes[hit.index] = { ...hit.lane, root: nextPath };
  writeWorkspaceConfigV2(targetHost, { ...cfg, lanes });

  if (roleHit && (input.syncRoleConfig === true || !profileBefore.workspaceConflict)) {
    // Keep RoleConfig roots aligned when present (avoid creating new conflict).
    const nextRole: RoleConfig = {
      ...roleHit.config,
      assignments: roleHit.config.assignments.map((a) => ({
        ...a,
        workspace: { ...a.workspace, workspaceRoot: nextPath },
      })),
    };
    writeRoleConfig(input.dataRoot, roleHit.key, nextRole);
  }

  const profile = getProjectProfile(
    {
      dataRoot: input.dataRoot,
      scope: input.scope,
      hostRoots: [targetHost, ...(input.hostRoots || [])],
      includeCwdHostRoot: false,
    },
    projectId,
  );
  if (!profile) {
    throw new ProjectRegistrationError('NOT_FOUND', `경로 변경 후 profile을 찾지 못했습니다: ${projectId}`);
  }

  return {
    ok: true,
    projectId,
    previousPath,
    nextPath,
    profile,
    blockers: [],
    sideEffects: { ...ZERO, taskScopesRewritten: 0, runRootsRewritten: 0 },
  };
}

export function listBrowseRootsPublic(): BrowseRootInfo[] {
  return listBrowseRoots();
}

/** Exported for profile heuristic tests. */
export function isStubRuntime(runtime: string | undefined | null): boolean {
  if (!runtime) return true;
  return STUB_RUNTIMES.has(String(runtime).trim().toLowerCase());
}

export function hasUsableBuilder(
  builders: Array<{ workerId?: string; runtime?: string } | null | undefined> | null | undefined,
): boolean {
  if (!Array.isArray(builders) || !builders.length) return false;
  for (const b of builders) {
    if (!b) continue;
    if (typeof b.workerId === 'string' && b.workerId.trim()) return true;
    if (typeof b.runtime === 'string' && b.runtime.trim() && !isStubRuntime(b.runtime)) return true;
  }
  return false;
}

