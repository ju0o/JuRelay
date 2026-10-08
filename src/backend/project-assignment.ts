/**
 * P1.8C-02 — Project agent assignment (desired roles, zero execution).
 *
 * Assignment means WHO SHOULD BE USED for a project. It never spawns workers,
 * creates Goals/Tasks, or opens tmux.
 *
 * Storage ownership (no new assignment DB):
 *   - WORKSPACE_CONFIG-owned → mutate WorkspaceConfigV2 lane bindings
 *   - ROLE_CONFIG-owned      → mutate RoleConfig assignments
 *   - UNCONFIGURED / LEGACY / no owning store → PROJECT_CONFIGURATION_REQUIRED
 *
 * Write policy (aligned with C01 display precedence):
 *   1. RoleConfig exists for projectId → ROLE_CONFIG
 *   2. Else WorkspaceConfigV2 lane     → WORKSPACE_CONFIG
 *   3. Else                            → PROJECT_CONFIGURATION_REQUIRED
 *
 * WorkspaceConfigV2 keeps singular `builder`/`qa` for runners and optional
 * `builders`/`qas` arrays for multi-binding (builders[0] === builder).
 * RoleConfig still allows at most one assignment per roleId.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  KNOWN_RUNTIMES,
  readWorkspaceConfigV2,
  writeWorkspaceConfigV2,
  type LaneConfigV2,
  type RoleBinding,
  type RoleProfile,
  type WorkspaceConfigV2,
} from '../workspace/config-v2.js';
import {
  defaultV1RoleGraph,
  readRoleConfig,
  roleConfigPath,
  writeRoleConfig,
  type RoleAssignment,
  type RoleConfig,
  type RoleId,
} from '../roles/role-config.js';
import {
  listWorkerRegistryRecords,
  loadWorkerRegistryRecord,
  type WorkerRegistryRecord,
} from './worker-registry.js';
import {
  getProjectProfile,
  listProjectProfiles,
  type ListProjectProfilesInput,
  type ProjectProfileView,
  type ProjectRoleBindingView,
} from './project-profile.js';
import { loadUiState } from './ui-state.js';
import { normalizeProjectId } from './project-identity.js';

export type AssignmentStore = 'WORKSPACE_CONFIG' | 'ROLE_CONFIG';

export type AssignmentErrorCode =
  | 'PROJECT_CONFIGURATION_REQUIRED'
  | 'NOT_FOUND'
  | 'INVALID_ARGUMENT'
  | 'UNKNOWN_WORKER'
  | 'UNKNOWN_RUNTIME'
  | 'WORKSPACE_PATH_CONFLICT'
  | 'ROLE_CONFIG_CARDINALITY'
  | 'ROLE_COMPATIBILITY'
  | 'MALFORMED_ASSIGNMENT';

export class AssignmentError extends Error {
  readonly code: AssignmentErrorCode;
  constructor(code: AssignmentErrorCode, message: string) {
    super(message);
    this.name = 'AssignmentError';
    this.code = code;
  }
}

/** One desired role binding in an assignment payload / read view. */
export interface AssignmentBindingInput {
  runtime?: string;
  runtimeAdapterId?: string;
  workerId?: string;
  provider?: string;
  model?: string;
  /** Forbidden to change on write — must match existing project workspacePath. */
  workspaceRoot?: string;
}

export interface ProjectAssignmentView {
  projectId: string;
  store: AssignmentStore | null;
  /** Why no store when store is null. */
  configurationRequired?: boolean;
  pm: ProjectRoleBindingView | null;
  builders: ProjectRoleBindingView[];
  qa: ProjectRoleBindingView[];
  availableWorkers: string[];
  workspacePath: string | null;
  workspacePathSource: ProjectProfileView['workspacePathSource'];
}

export interface SetProjectAssignmentsInput {
  projectId: string;
  pm: AssignmentBindingInput | null;
  builders: AssignmentBindingInput[];
  qa: AssignmentBindingInput[];
}

export interface SetProjectAssignmentsResult {
  ok: true;
  projectId: string;
  store: AssignmentStore;
  assignment: ProjectAssignmentView;
  profile: ProjectProfileView;
  sideEffects: {
    goalsCreated: 0;
    tasksCreated: 0;
    runsCreated: 0;
    workersSpawned: 0;
    tmuxOpened: 0;
    workspacePathChanged: false;
    selectedProjectIdChanged: false;
  };
}

const KNOWN_RUNTIME_SET = new Set<string>(KNOWN_RUNTIMES.map((r) => r.toLowerCase()));

const DEFAULT_PM_PROFILE: RoleProfile = {
  sessionPolicy: 'persistent',
  permissionProfile: 'read-only',
};
const DEFAULT_BUILDER_PROFILE: RoleProfile = {
  sessionPolicy: 'per-task',
  permissionProfile: 'write-workspace',
};
const DEFAULT_QA_PROFILE: RoleProfile = {
  sessionPolicy: 'per-task',
  permissionProfile: 'read-only',
};

function sameAbs(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function profileInput(input: ListProjectProfilesInput): ListProjectProfilesInput {
  return {
    ...input,
    selectedProjectId:
      input.selectedProjectId !== undefined
        ? input.selectedProjectId
        : loadUiState(input.dataRoot).selectedProjectId,
  };
}

/** Resolve which existing store owns writes for this project. */
export function resolveAssignmentStore(
  profile: ProjectProfileView,
  input: ListProjectProfilesInput,
): { store: AssignmentStore; hostRoot?: string; roleKey?: string; roleConfig?: RoleConfig } | null {
  if (profile.legacy || profile.profileState === 'LEGACY') {
    return null;
  }

  // Match C01 display precedence: when RoleConfig exists it owns the shown
  // pm/builders/qa bindings, so writes must update RoleConfig first.
  const roleKeyCandidates = [profile.projectId];
  try {
    const dir = path.join(path.resolve(input.dataRoot), '_relay', 'roles');
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json') || name.includes('.bak')) continue;
      const key = name.slice(0, -'.json'.length);
      try {
        if (normalizeProjectId(key) === profile.projectId) roleKeyCandidates.push(key);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  for (const key of [...new Set(roleKeyCandidates)]) {
    try {
      if (!fs.existsSync(roleConfigPath(input.dataRoot, key))) continue;
      const roleConfig = readRoleConfig(input.dataRoot, key);
      return { store: 'ROLE_CONFIG', roleKey: key, roleConfig };
    } catch {
      continue;
    }
  }

  // Otherwise WorkspaceConfigV2 lane is the owning store.
  const hostRoots = discoverHostRootsForAssignment(input);
  for (const hostRoot of hostRoots) {
    const cfg = readWorkspaceConfigV2(hostRoot);
    if (!cfg) continue;
    const lane = cfg.lanes.find((l) => {
      try {
        return normalizeProjectId(l.id) === profile.projectId;
      } catch {
        return l.id === profile.projectId;
      }
    });
    if (lane) return { store: 'WORKSPACE_CONFIG', hostRoot };
  }

  return null;
}

function discoverHostRootsForAssignment(input: ListProjectProfilesInput): string[] {
  const roots = new Set<string>();
  for (const r of input.hostRoots || []) {
    if (typeof r === 'string' && r.trim() && path.isAbsolute(r.trim())) {
      roots.add(path.resolve(r.trim()));
    }
  }
  if (input.includeCwdHostRoot !== false) {
    try {
      const cwd = path.resolve(process.cwd());
      if (fs.existsSync(path.join(cwd, '.agent-relay', 'workspace-config.json'))) {
        roots.add(cwd);
      }
    } catch {
      /* ignore */
    }
  }
  // Role workspace roots: walk up for workspace.v2 (bounded).
  try {
    const dir = path.join(path.resolve(input.dataRoot), '_relay', 'roles');
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json') || name.includes('.bak')) continue;
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as RoleConfig;
        for (const a of cfg.assignments || []) {
          const root = a?.workspace?.workspaceRoot;
          if (typeof root === 'string' && path.isAbsolute(root)) {
            let cur = path.resolve(root);
            for (let i = 0; i < 4; i++) {
              if (fs.existsSync(path.join(cur, '.agent-relay', 'workspace-config.json'))) {
                roots.add(cur);
              }
              const parent = path.dirname(cur);
              if (parent === cur) break;
              cur = parent;
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return [...roots].sort();
}

function workerById(dataRoot: string, workerId: string): WorkerRegistryRecord | null {
  try {
    return loadWorkerRegistryRecord(dataRoot, workerId);
  } catch {
    return null;
  }
}

function inferRuntimeFromWorkerId(workerId: string): string | null {
  const id = workerId.toLowerCase();
  for (const runtime of KNOWN_RUNTIMES) {
    if (id === runtime || id.endsWith(`-${runtime}`) || id.includes(`-${runtime}-`) || id.startsWith(`${runtime}-`)) {
      return runtime;
    }
  }
  // Common prefixes: builder-opencode, qa-codex, builder-codex-terra
  const m = /(?:^|-)(chatgpt|codex|opencode|claude|grok|cline|cursor|commandcode)(?:-|$)/i.exec(id);
  return m ? m[1].toLowerCase() : null;
}

export interface ResolvedBinding {
  runtime: string;
  model: string;
  provider?: string;
  workerId?: string;
  runtimeAdapterId?: string;
  roleProfile: RoleProfile;
}

/**
 * Validate one binding against WorkerRegistry / known runtimes.
 * Fail closed on unknown worker/runtime. Do not invent ids.
 */
export function resolveBindingInput(
  dataRoot: string,
  role: 'pm' | 'builder' | 'qa',
  raw: AssignmentBindingInput,
  roleProfile: RoleProfile,
): ResolvedBinding {
  if (!raw || typeof raw !== 'object') {
    throw new AssignmentError('INVALID_ARGUMENT', `${role} binding must be an object`);
  }
  const workerId = typeof raw.workerId === 'string' && raw.workerId.trim()
    ? raw.workerId.trim()
    : undefined;
  const runtimeAdapterId = typeof raw.runtimeAdapterId === 'string' && raw.runtimeAdapterId.trim()
    ? raw.runtimeAdapterId.trim()
    : undefined;
  let runtime = typeof raw.runtime === 'string' && raw.runtime.trim()
    ? raw.runtime.trim().toLowerCase()
    : undefined;
  const model = typeof raw.model === 'string' && raw.model.trim()
    ? raw.model.trim()
    : 'default';
  const provider = typeof raw.provider === 'string' && raw.provider.trim()
    ? raw.provider.trim()
    : undefined;

  if (workerId) {
    const worker = workerById(dataRoot, workerId);
    if (!worker) {
      throw new AssignmentError('UNKNOWN_WORKER', `unknown workerId: ${workerId}`);
    }
    // Proven incompatibility only: registry role tag 'qa' assigned as Builder.
    // (Absent role ≡ implementation; qa tag is the only hard signal we trust.)
    if (role === 'builder' && worker.role === 'qa') {
      throw new AssignmentError(
        'ROLE_COMPATIBILITY',
        `worker ${workerId} is tagged role=qa and cannot be assigned as builder`,
      );
    }
    if (!runtime) {
      runtime = inferRuntimeFromWorkerId(workerId)
        || (worker.observationAdapterId || '').toLowerCase()
        || undefined;
    }
    if (!runtime) {
      throw new AssignmentError(
        'UNKNOWN_RUNTIME',
        `cannot derive runtime for workerId ${workerId}; pass runtime explicitly`,
      );
    }
  }

  // runtimeAdapterId may be a worker id or a known runtime label.
  if (!runtime && runtimeAdapterId) {
    if (KNOWN_RUNTIME_SET.has(runtimeAdapterId.toLowerCase())) {
      runtime = runtimeAdapterId.toLowerCase();
    } else {
      const asWorker = workerById(dataRoot, runtimeAdapterId);
      if (asWorker) {
        if (role === 'builder' && asWorker.role === 'qa') {
          throw new AssignmentError(
            'ROLE_COMPATIBILITY',
            `worker ${runtimeAdapterId} is tagged role=qa and cannot be assigned as builder`,
          );
        }
        runtime = inferRuntimeFromWorkerId(runtimeAdapterId)
          || (asWorker.observationAdapterId || '').toLowerCase()
          || undefined;
        if (!runtime) {
          throw new AssignmentError(
            'UNKNOWN_RUNTIME',
            `cannot derive runtime for runtimeAdapterId ${runtimeAdapterId}`,
          );
        }
      } else if (runtimeAdapterId.includes('/')) {
        // provider/model style adapter ids are not in WorkerRegistry — reject.
        throw new AssignmentError('UNKNOWN_WORKER', `unknown runtimeAdapterId: ${runtimeAdapterId}`);
      } else {
        throw new AssignmentError('UNKNOWN_WORKER', `unknown runtimeAdapterId: ${runtimeAdapterId}`);
      }
    }
  }

  if (!runtime) {
    throw new AssignmentError('INVALID_ARGUMENT', `${role} binding requires runtime, workerId, or runtimeAdapterId`);
  }
  if (!KNOWN_RUNTIME_SET.has(runtime)) {
    throw new AssignmentError('UNKNOWN_RUNTIME', `unknown runtime: ${runtime}`);
  }

  return {
    runtime,
    model,
    ...(provider ? { provider } : {}),
    ...(workerId ? { workerId } : {}),
    ...(runtimeAdapterId ? { runtimeAdapterId } : workerId ? { runtimeAdapterId: workerId } : {}),
    roleProfile,
  };
}

function toWorkspaceBinding(resolved: ResolvedBinding): RoleBinding {
  return {
    runtime: resolved.runtime,
    model: resolved.model,
    roleProfile: { ...resolved.roleProfile },
    ...(resolved.workerId ? { workerId: resolved.workerId } : {}),
  };
}

function assertNoWorkspacePathChange(
  existingPath: string | null,
  bindings: Array<AssignmentBindingInput | null | undefined>,
): void {
  for (const b of bindings) {
    if (!b || typeof b.workspaceRoot !== 'string' || !b.workspaceRoot.trim()) continue;
    const requested = path.resolve(b.workspaceRoot.trim());
    if (!existingPath) {
      throw new AssignmentError(
        'WORKSPACE_PATH_CONFLICT',
        'assignment must not set workspaceRoot on a project without an existing workspace path',
      );
    }
    if (!sameAbs(existingPath, requested)) {
      throw new AssignmentError(
        'WORKSPACE_PATH_CONFLICT',
        `assignment must not change workspacePath (existing=${existingPath}, requested=${requested})`,
      );
    }
  }
}

function viewFromProfile(profile: ProjectProfileView, store: AssignmentStore | null): ProjectAssignmentView {
  return {
    projectId: profile.projectId,
    store,
    ...(store ? {} : { configurationRequired: true }),
    pm: profile.pm,
    builders: profile.builders,
    qa: profile.qa,
    availableWorkers: profile.availableWorkers,
    workspacePath: profile.workspacePath,
    workspacePathSource: profile.workspacePathSource,
  };
}

/** Read current assignments for a project (derived; no new store). */
export function getProjectAssignments(
  input: ListProjectProfilesInput,
  projectIdRaw: string,
): ProjectAssignmentView {
  const projectId = normalizeProjectId(projectIdRaw);
  const listedInput = profileInput(input);
  const profile = getProjectProfile(listedInput, projectId);
  if (!profile) {
    throw new AssignmentError('NOT_FOUND', `project profile not found: ${projectId}`);
  }
  const owner = resolveAssignmentStore(profile, listedInput);
  return viewFromProfile(profile, owner?.store ?? null);
}

function writeWorkspaceAssignments(
  hostRoot: string,
  projectId: string,
  existingPath: string,
  pm: ResolvedBinding,
  builders: ResolvedBinding[],
  qa: ResolvedBinding[],
): void {
  if (builders.length < 1) {
    throw new AssignmentError(
      'INVALID_ARGUMENT',
      'WORKSPACE_CONFIG lanes require at least one builder binding',
    );
  }
  if (qa.length < 1) {
    throw new AssignmentError(
      'INVALID_ARGUMENT',
      'WORKSPACE_CONFIG lanes require at least one qa binding',
    );
  }

  const cfg = readWorkspaceConfigV2(hostRoot);
  if (!cfg) {
    throw new AssignmentError('PROJECT_CONFIGURATION_REQUIRED', `workspace.v2 missing under ${hostRoot}`);
  }

  const idx = cfg.lanes.findIndex((l) => {
    try {
      return normalizeProjectId(l.id) === projectId;
    } catch {
      return l.id === projectId;
    }
  });
  if (idx < 0) {
    throw new AssignmentError('NOT_FOUND', `lane not found for projectId ${projectId}`);
  }

  const prev = cfg.lanes[idx];
  if (!sameAbs(prev.root, existingPath)) {
    // Defensive: never rewrite root.
    throw new AssignmentError(
      'WORKSPACE_PATH_CONFLICT',
      `refusing to write assignments while lane.root (${prev.root}) != profile workspacePath (${existingPath})`,
    );
  }

  const builderBindings = builders.map(toWorkspaceBinding);
  const qaBindings = qa.map(toWorkspaceBinding);
  const nextLane: LaneConfigV2 = {
    ...prev,
    root: prev.root, // immutable in C02
    pm: toWorkspaceBinding(pm),
    builder: builderBindings[0],
    qa: qaBindings[0],
    ...(builderBindings.length > 1 ? { builders: builderBindings } : { builders: undefined }),
    ...(qaBindings.length > 1 ? { qas: qaBindings } : { qas: undefined }),
    // Preserve qaFallback; if primary qa runtime changed, keep prior fallback
    // unless it was identical to the old primary (then point at new primary's peer).
    qaFallback: prev.qaFallback,
  };
  // Clear empty optional arrays explicitly for clean JSON.
  if (builderBindings.length <= 1) delete (nextLane as { builders?: RoleBinding[] }).builders;
  if (qaBindings.length <= 1) delete (nextLane as { qas?: RoleBinding[] }).qas;

  const nextConfig: WorkspaceConfigV2 = {
    ...cfg,
    lanes: cfg.lanes.map((lane, i) => (i === idx ? nextLane : lane)),
  };
  writeWorkspaceConfigV2(hostRoot, nextConfig);
}

function writeRoleAssignments(
  dataRoot: string,
  roleKey: string,
  existing: RoleConfig,
  existingWorkspaceRoot: string,
  pm: ResolvedBinding | null,
  builders: ResolvedBinding[],
  qaList: ResolvedBinding[],
): void {
  if (builders.length > 1 || qaList.length > 1) {
    throw new AssignmentError(
      'ROLE_CONFIG_CARDINALITY',
      'ROLE_CONFIG supports at most one builder and one qa assignment (unique roleId)',
    );
  }

  const projectName = existing.project;
  const keepArchitect = existing.assignments.filter((a) => a.roleId === 'architect');

  const makeAssignment = (
    roleId: RoleId,
    resolved: ResolvedBinding,
    permissionProfile: RoleAssignment['permissionProfile'],
    sessionPolicy: RoleAssignment['sessionPolicy'],
  ): RoleAssignment => ({
    roleId,
    runtimeAdapterId: resolved.runtimeAdapterId || resolved.workerId || resolved.runtime,
    ...(resolved.provider ? { provider: resolved.provider } : { provider: resolved.runtime }),
    model: resolved.model,
    workspace: { project: projectName, workspaceRoot: existingWorkspaceRoot },
    sessionPolicy,
    permissionProfile,
    capabilityRequirements: {},
    zeroExtraBilling: true,
    fallbackChain: [],
    enabled: true,
  });

  const nextAssignments: RoleAssignment[] = [...keepArchitect];
  if (pm) {
    nextAssignments.push(makeAssignment('pm', pm, 'read-only', 'persistent'));
  }
  if (builders[0]) {
    nextAssignments.push(makeAssignment('builder', builders[0], 'write-workspace', 'per-task'));
  }
  if (qaList[0]) {
    nextAssignments.push(makeAssignment('qa', qaList[0], 'read-only', 'per-task'));
  }

  const next: RoleConfig = {
    schema_version: 'role-config.v1',
    project: projectName,
    assignments: nextAssignments,
    graph: existing.graph?.length ? existing.graph : defaultV1RoleGraph(),
  };
  writeRoleConfig(dataRoot, roleKey, next);
}

/**
 * Atomically replace project role assignments in the owning store.
 * All-or-nothing: validates the full payload before any write.
 */
export function setProjectAssignments(
  input: ListProjectProfilesInput,
  payload: SetProjectAssignmentsInput,
): SetProjectAssignmentsResult {
  const projectId = normalizeProjectId(payload.projectId);
  const listedInput = profileInput(input);
  const selectedBefore = loadUiState(listedInput.dataRoot).selectedProjectId;

  const profileBefore = getProjectProfile(listedInput, projectId);
  if (!profileBefore) {
    throw new AssignmentError('NOT_FOUND', `project profile not found: ${projectId}`);
  }
  if (profileBefore.legacy || profileBefore.profileState === 'LEGACY') {
    throw new AssignmentError(
      'PROJECT_CONFIGURATION_REQUIRED',
      `legacy project ${projectId} cannot receive modern agent assignments`,
    );
  }

  const owner = resolveAssignmentStore(profileBefore, listedInput);
  if (!owner) {
    throw new AssignmentError(
      'PROJECT_CONFIGURATION_REQUIRED',
      `project ${projectId} has no WorkspaceConfigV2 lane or RoleConfig; bootstrap required`,
    );
  }

  // Full payload shape checks before resolving (fail closed, no partial write).
  if (!payload || typeof payload !== 'object') {
    throw new AssignmentError('MALFORMED_ASSIGNMENT', 'assignment payload must be an object');
  }
  if (!Array.isArray(payload.builders) || !Array.isArray(payload.qa)) {
    throw new AssignmentError('MALFORMED_ASSIGNMENT', 'builders and qa must be arrays');
  }
  if (payload.pm !== null && (typeof payload.pm !== 'object' || Array.isArray(payload.pm))) {
    throw new AssignmentError('MALFORMED_ASSIGNMENT', 'pm must be an object or null');
  }

  assertNoWorkspacePathChange(profileBefore.workspacePath, [
    payload.pm,
    ...payload.builders,
    ...payload.qa,
  ]);

  let pmResolved: ResolvedBinding | null = null;
  let buildersResolved: ResolvedBinding[] = [];
  let qaResolved: ResolvedBinding[] = [];
  try {
    if (payload.pm) {
      pmResolved = resolveBindingInput(listedInput.dataRoot, 'pm', payload.pm, DEFAULT_PM_PROFILE);
    }
    buildersResolved = payload.builders.map((b, i) => {
      if (!b || typeof b !== 'object') {
        throw new AssignmentError('MALFORMED_ASSIGNMENT', `builders[${i}] must be an object`);
      }
      return resolveBindingInput(listedInput.dataRoot, 'builder', b, DEFAULT_BUILDER_PROFILE);
    });
    qaResolved = payload.qa.map((b, i) => {
      if (!b || typeof b !== 'object') {
        throw new AssignmentError('MALFORMED_ASSIGNMENT', `qa[${i}] must be an object`);
      }
      return resolveBindingInput(listedInput.dataRoot, 'qa', b, DEFAULT_QA_PROFILE);
    });
  } catch (err) {
    // Ensure no write happened (we have not written yet).
    throw err;
  }

  if (owner.store === 'WORKSPACE_CONFIG') {
    if (!pmResolved) {
      throw new AssignmentError('INVALID_ARGUMENT', 'WORKSPACE_CONFIG assignment requires pm');
    }
    if (!owner.hostRoot || !profileBefore.workspacePath) {
      throw new AssignmentError('PROJECT_CONFIGURATION_REQUIRED', 'workspace host/root missing');
    }
    writeWorkspaceAssignments(
      owner.hostRoot,
      projectId,
      profileBefore.workspacePath,
      pmResolved,
      buildersResolved,
      qaResolved,
    );
  } else {
    const roleKey = owner.roleKey!;
    const existing = owner.roleConfig!;
    const existingRoot =
      profileBefore.workspacePath
      || existing.assignments.find((a) => a.workspace?.workspaceRoot)?.workspace?.workspaceRoot;
    if (!existingRoot) {
      throw new AssignmentError(
        'PROJECT_CONFIGURATION_REQUIRED',
        `RoleConfig ${roleKey} has no workspaceRoot to preserve`,
      );
    }
    writeRoleAssignments(
      listedInput.dataRoot,
      roleKey,
      existing,
      existingRoot,
      pmResolved,
      buildersResolved,
      qaResolved,
    );
  }

  const profileAfter = getProjectProfile(listedInput, projectId);
  if (!profileAfter) {
    throw new AssignmentError('NOT_FOUND', `project profile missing after assignment write: ${projectId}`);
  }
  const selectedAfter = loadUiState(listedInput.dataRoot).selectedProjectId;
  if (selectedBefore !== selectedAfter) {
    // Should be impossible — assignment never touches ui-state. Surface loudly.
    throw new AssignmentError(
      'INVALID_ARGUMENT',
      'internal error: selectedProjectId changed during assignment',
    );
  }
  if (
    profileBefore.workspacePath
    && profileAfter.workspacePath
    && !sameAbs(profileBefore.workspacePath, profileAfter.workspacePath)
  ) {
    throw new AssignmentError('WORKSPACE_PATH_CONFLICT', 'workspacePath changed during assignment');
  }

  return {
    ok: true,
    projectId,
    store: owner.store,
    assignment: viewFromProfile(profileAfter, owner.store),
    profile: profileAfter,
    sideEffects: {
      goalsCreated: 0,
      tasksCreated: 0,
      runsCreated: 0,
      workersSpawned: 0,
      tmuxOpened: 0,
      workspacePathChanged: false,
      selectedProjectIdChanged: false,
    },
  };
}

/** Compact dashboard summary labels from assigned bindings. */
export function assignmentSummaryFromProfile(profile: ProjectProfileView | null | undefined): {
  pm: string | null;
  builders: string[];
  qa: string[];
} | null {
  if (!profile) return null;
  const label = (b: ProjectRoleBindingView | null | undefined): string | null => {
    if (!b) return null;
    // Keep dashboard runtime labels stable; workerId is available on the binding view.
    if (b.runtime) return b.runtime;
    if (b.runtimeAdapterId) return b.runtimeAdapterId;
    if (b.workerId) return b.workerId;
    return null;
  };
  return {
    pm: label(profile.pm),
    builders: profile.builders.map((b) => label(b)).filter((x): x is string => !!x),
    qa: profile.qa.map((b) => label(b)).filter((x): x is string => !!x),
  };
}

/** Test helper: list known worker ids (availability). */
export function listAvailableWorkerIds(dataRoot: string): string[] {
  try {
    return listWorkerRegistryRecords(dataRoot).map((w) => w.workerId).sort();
  } catch {
    return [];
  }
}
