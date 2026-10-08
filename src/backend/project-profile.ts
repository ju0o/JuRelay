/**
 * P1.8C-01 — ProjectProfile as a DERIVED VIEW.
 *
 * ProjectProfile is NOT a durable database. It aggregates existing sources:
 *
 *   ProjectIdentity  (project-identity.ts / projects.json)
 *     + WorkspaceConfigV2 (.agent-relay/workspace-config.json under a known host)
 *     + RoleConfig (_relay/roles/<project>.json)
 *     + WorkerRegistry (_relay/workers/*.json) as availability only
 *     + Runtime truth (optional ProjectRuntimeView summary)
 *       ↓
 *   ProjectProfileView
 *
 * No whole-disk scan. Host roots are discovered only from RoleConfig
 * workspaceRoot values, optional caller-supplied hostRoots, and (when enabled)
 * process.cwd() if it already contains a workspace.v2 file.
 *
 * Workspace path precedence (documented contract):
 *   1. WORKSPACE_CONFIG — lane.root from WorkspaceConfigV2 matching projectId
 *   2. ROLE_CONFIG      — RoleAssignment.workspace.workspaceRoot
 *   If both exist and resolve to different absolute paths → workspaceConflict
 *   and profileState PARTIAL (never silently pick one).
 *   If they agree → WORKSPACE_CONFIG (same path; source of richer config).
 *
 * Legacy `ws` is never merged into canonical `agent-relay`. Historical task
 * buckets stay LEGACY profiles.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  GENERIC_SCOPE_IDS,
  defaultIdentityForScope,
  deriveProjectName,
  loadProjectRegistry,
  normalizeProjectId,
  resolveProjectIdentity,
  type ProjectIdentity,
  type ProjectIdentitySource,
  type ProjectRegistry,
} from './project-identity.js';
import { listWorkerRegistryRecords } from './worker-registry.js';
import { loadUiState, saveSelectedProjectId } from './ui-state.js';
import {
  readWorkspaceConfigV2,
  workspaceConfigPath,
  type LaneConfigV2,
  type WorkspaceConfigV2,
} from '../workspace/config-v2.js';
import {
  roleConfigPath,
  type RoleConfig,
} from '../roles/role-config.js';
import type { ProjectRuntimeView } from './runtime-truth.js';

export type ProfileState = 'CONFIGURED' | 'PARTIAL' | 'UNCONFIGURED' | 'LEGACY';
export type WorkspacePathSource = 'WORKSPACE_CONFIG' | 'ROLE_CONFIG' | 'NONE';

export type ProjectProfileIdentitySource = ProjectIdentitySource | 'RUNTIME_LEGACY';

export interface ProjectRoleBindingView {
  roleId: string;
  runtimeAdapterId?: string;
  runtime?: string;
  model?: string;
  provider?: string;
  /** Explicit WorkerRegistry id when persisted on the owning store. */
  workerId?: string;
  workspaceRoot?: string;
  source: 'ROLE_CONFIG' | 'WORKSPACE_CONFIG';
}

export interface ProjectProfileRuntimeSummary {
  runtimeState?: string;
  executionState?: string | null;
  activeTaskId?: string | null;
  activeGoalId?: string | null;
  lastActivityAt?: string | null;
  nextAction?: string | null;
}

export interface ProjectProfileView {
  projectId: string;
  projectName: string;
  identitySource: ProjectProfileIdentitySource;
  legacy: boolean;
  workspacePath: string | null;
  workspacePathSource: WorkspacePathSource;
  workspaceConfigured: boolean;
  workspaceConflict: boolean;
  pm: ProjectRoleBindingView | null;
  builders: ProjectRoleBindingView[];
  qa: ProjectRoleBindingView[];
  /** Global worker registry ids — availability only, never assignment. */
  availableWorkers: string[];
  runtime: ProjectProfileRuntimeSummary | null;
  profileState: ProfileState;
  selected: boolean;
}

export interface ListProjectProfilesInput {
  dataRoot: string;
  /** MCP / storage scope (folder), e.g. `ws`. */
  scope: string;
  /** Optional known workspace host roots (tests / callers). */
  hostRoots?: string[];
  /**
   * When true (default), if process.cwd() already has workspace.v2, include it.
   * Bounded existence check — not a directory walk.
   */
  includeCwdHostRoot?: boolean;
  /** Override selected id (tests). Defaults to loadUiState(dataRoot). */
  selectedProjectId?: string | null;
  /** Runtime projects already computed for this scope (optional). */
  runtimeProjects?: readonly ProjectRuntimeView[];
  registry?: ProjectRegistry;
}

export interface ProjectProfileListResult {
  scope: string;
  scopeIdentity: ProjectIdentity;
  selectedProjectId: string | null;
  profiles: ProjectProfileView[];
  generatedAt: string;
}

function tryNormalizeId(raw: string): string | null {
  try {
    return normalizeProjectId(raw);
  } catch {
    return null;
  }
}

function safeReadRoleConfig(dataRoot: string, projectKey: string): RoleConfig | null {
  try {
    const file = roleConfigPath(dataRoot, projectKey);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as RoleConfig;
    if (!raw || raw.schema_version !== 'role-config.v1') return null;
    if (typeof raw.project !== 'string' || !raw.project) return null;
    if (!Array.isArray(raw.assignments)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Bounded listing of `_relay/roles/*.json` basenames (no recursion). */
export function listRoleConfigKeys(dataRoot: string): string[] {
  const dir = path.join(path.resolve(dataRoot), '_relay', 'roles');
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    if (name.includes('.bak')) continue;
    const key = name.slice(0, -'.json'.length);
    if (!key || key.includes('/') || key.includes('\\') || key === '.' || key === '..') continue;
    out.push(key);
  }
  return out.sort();
}

function roleWorkspaceRoots(config: RoleConfig): string[] {
  const roots: string[] = [];
  for (const a of config.assignments || []) {
    const root = a?.workspace?.workspaceRoot;
    if (typeof root === 'string' && root.trim() && path.isAbsolute(root.trim())) {
      roots.push(path.resolve(root.trim()));
    }
  }
  return roots;
}

/**
 * From a known absolute path, look for `.agent-relay/workspace-config.json` at
 * that path and up to 3 parents. Bounded walk-up from evidence we already have
 * — never a home/disk scan.
 */
function hostRootsNear(absPath: string): string[] {
  const out: string[] = [];
  let cur = path.resolve(absPath);
  for (let i = 0; i < 4; i++) {
    try {
      if (fs.existsSync(workspaceConfigPath(cur))) out.push(cur);
    } catch {
      /* ignore */
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return out;
}

function discoverHostRoots(
  _dataRoot: string,
  roleConfigs: Map<string, RoleConfig>,
  input: ListProjectProfilesInput,
): string[] {
  const roots = new Set<string>();
  for (const explicit of input.hostRoots || []) {
    if (typeof explicit === 'string' && explicit.trim() && path.isAbsolute(explicit.trim())) {
      const resolved = path.resolve(explicit.trim());
      roots.add(resolved);
      for (const near of hostRootsNear(resolved)) roots.add(near);
    }
  }
  for (const cfg of roleConfigs.values()) {
    for (const root of roleWorkspaceRoots(cfg)) {
      for (const near of hostRootsNear(root)) roots.add(near);
    }
  }
  const includeCwd = input.includeCwdHostRoot !== false;
  if (includeCwd) {
    try {
      const cwd = path.resolve(process.cwd());
      for (const near of hostRootsNear(cwd)) roots.add(near);
    } catch {
      /* ignore */
    }
  }
  return [...roots].sort();
}

function loadWorkspaceConfigs(hostRoots: string[]): Map<string, WorkspaceConfigV2> {
  const out = new Map<string, WorkspaceConfigV2>();
  for (const root of hostRoots) {
    const cfg = readWorkspaceConfigV2(root);
    if (cfg) out.set(root, cfg);
  }
  return out;
}

function findLaneForProject(
  workspaces: Map<string, WorkspaceConfigV2>,
  projectId: string,
): { hostRoot: string; lane: LaneConfigV2 } | null {
  for (const [hostRoot, cfg] of workspaces) {
    for (const lane of cfg.lanes) {
      const laneId = tryNormalizeId(lane.id);
      if (laneId === projectId) return { hostRoot, lane };
    }
  }
  return null;
}

/**
 * Find a RoleConfig whose normalized project key equals projectId, or whose
 * filename normalizes to projectId. Prefer exact filename match.
 */
function findRoleConfig(
  roleConfigs: Map<string, RoleConfig>,
  projectId: string,
): { key: string; config: RoleConfig } | null {
  if (roleConfigs.has(projectId)) {
    return { key: projectId, config: roleConfigs.get(projectId)! };
  }
  for (const [key, config] of roleConfigs) {
    const fromKey = tryNormalizeId(key);
    const fromProject = tryNormalizeId(config.project);
    if (fromKey === projectId || fromProject === projectId) {
      return { key, config };
    }
  }
  return null;
}

function firstRoleWorkspaceRoot(config: RoleConfig): string | null {
  for (const root of roleWorkspaceRoots(config)) return root;
  return null;
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function bindingsFromRole(config: RoleConfig): {
  pm: ProjectRoleBindingView | null;
  builders: ProjectRoleBindingView[];
  qa: ProjectRoleBindingView[];
} {
  let pm: ProjectRoleBindingView | null = null;
  const builders: ProjectRoleBindingView[] = [];
  const qa: ProjectRoleBindingView[] = [];
  for (const a of config.assignments || []) {
    if (!a || typeof a.roleId !== 'string') continue;
    const view: ProjectRoleBindingView = {
      roleId: a.roleId,
      runtimeAdapterId: a.runtimeAdapterId,
      ...(a.provider ? { provider: a.provider } : {}),
      ...(a.model ? { model: a.model } : {}),
      ...(a.workspace?.workspaceRoot ? { workspaceRoot: a.workspace.workspaceRoot } : {}),
      source: 'ROLE_CONFIG',
    };
    if (a.roleId === 'pm') pm = view;
    else if (a.roleId === 'builder') builders.push(view);
    else if (a.roleId === 'qa') qa.push(view);
  }
  return { pm, builders, qa };
}

function bindingsFromLane(lane: LaneConfigV2): {
  pm: ProjectRoleBindingView | null;
  builders: ProjectRoleBindingView[];
  qa: ProjectRoleBindingView[];
} {
  const fromBinding = (
    roleId: string,
    b: { runtime: string; model: string; workerId?: string },
  ): ProjectRoleBindingView => ({
    roleId,
    runtime: b.runtime,
    model: b.model,
    ...(b.workerId ? { workerId: b.workerId } : {}),
    workspaceRoot: lane.root,
    source: 'WORKSPACE_CONFIG',
  });
  const builderList = (lane.builders && lane.builders.length > 0) ? lane.builders : [lane.builder];
  const qaList = (lane.qas && lane.qas.length > 0) ? lane.qas : [lane.qa];
  return {
    pm: fromBinding('pm', lane.pm),
    builders: builderList.map((b) => fromBinding('builder', b)),
    qa: qaList.map((b) => fromBinding('qa', b)),
  };
}

function availableWorkerIds(dataRoot: string): string[] {
  try {
    return listWorkerRegistryRecords(dataRoot).map((w) => w.workerId).sort();
  } catch {
    return [];
  }
}

function runtimeSummaryFor(
  projectId: string,
  runtimeProjects: readonly ProjectRuntimeView[] | undefined,
): ProjectProfileRuntimeSummary | null {
  if (!runtimeProjects) return null;
  const hit = runtimeProjects.find((p) => p.projectId === projectId);
  if (!hit) return null;
  return {
    runtimeState: hit.runtimeState,
    executionState: hit.executionState ?? null,
    activeTaskId: hit.activeTask?.taskId ?? null,
    activeGoalId: hit.activeGoal?.goalId ?? null,
    lastActivityAt: hit.lastActivityAt ?? null,
    nextAction: hit.nextAction ?? null,
  };
}

interface Candidate {
  projectId: string;
  projectName: string;
  identitySource: ProjectProfileIdentitySource;
  legacy: boolean;
  /** Force LEGACY profile state (historical bucket). */
  forceLegacy: boolean;
}

function collectCandidates(input: {
  scope: string;
  scopeIdentity: ProjectIdentity;
  registry: ProjectRegistry;
  roleConfigs: Map<string, RoleConfig>;
  workspaces: Map<string, WorkspaceConfigV2>;
  runtimeProjects?: readonly ProjectRuntimeView[];
}): Map<string, Candidate> {
  const out = new Map<string, Candidate>();

  const upsert = (c: Candidate) => {
    const prev = out.get(c.projectId);
    if (!prev) {
      out.set(c.projectId, c);
      return;
    }
    // Prefer non-legacy / stronger identity evidence when merging names.
    if (prev.forceLegacy && !c.forceLegacy) {
      out.set(c.projectId, c);
      return;
    }
    if (!prev.forceLegacy && c.forceLegacy) return;
    if (prev.identitySource === 'RUNTIME_LEGACY' && c.identitySource !== 'RUNTIME_LEGACY') {
      out.set(c.projectId, c);
    }
  };

  // 1. Canonical scope identity (ws → agent-relay).
  upsert({
    projectId: input.scopeIdentity.projectId,
    projectName: input.scopeIdentity.projectName,
    identitySource: input.scopeIdentity.source,
    legacy: input.scopeIdentity.legacy,
    forceLegacy: false,
  });

  // 2. Registry declared projects / scope defaults.
  for (const [id, name] of Object.entries(input.registry.names)) {
    const projectId = tryNormalizeId(id);
    if (!projectId) continue;
    upsert({
      projectId,
      projectName: name,
      identitySource: 'REGISTRY',
      legacy: false,
      forceLegacy: false,
    });
  }
  for (const seed of Object.values(input.registry.scopeDefaults)) {
    upsert({
      projectId: seed.projectId,
      projectName: input.registry.names[seed.projectId] ?? seed.projectName,
      identitySource: 'REGISTRY',
      legacy: false,
      forceLegacy: false,
    });
  }

  // 3. Role configs (bounded directory).
  for (const [key, cfg] of input.roleConfigs) {
    const projectId = tryNormalizeId(cfg.project) ?? tryNormalizeId(key);
    if (!projectId) continue;
    upsert({
      projectId,
      projectName: input.registry.names[projectId] ?? deriveProjectName(projectId),
      identitySource: 'EXPLICIT',
      legacy: false,
      forceLegacy: false,
    });
  }

  // 4. Workspace lanes under known host roots.
  for (const cfg of input.workspaces.values()) {
    for (const lane of cfg.lanes) {
      const projectId = tryNormalizeId(lane.id);
      if (!projectId) continue;
      upsert({
        projectId,
        projectName: input.registry.names[projectId] ?? (lane.label.trim() || deriveProjectName(projectId)),
        identitySource: 'EXPLICIT',
        legacy: false,
        forceLegacy: false,
      });
    }
  }

  // 5. Runtime projects — preserve LEGACY rows (e.g. historical `ws`) separately.
  for (const rp of input.runtimeProjects || []) {
    if (!rp?.projectId) continue;
    const isGeneric = GENERIC_SCOPE_IDS.has(String(rp.projectId).toLowerCase());
    const legacy = !!rp.legacy || isGeneric || rp.identitySource === 'RECORD_LEGACY';
    if (legacy || isGeneric) {
      // Keep the raw legacy bucket id (do not normalize `ws` away).
      const projectId = isGeneric ? String(rp.projectId).trim() : (tryNormalizeId(rp.projectId) ?? String(rp.projectId).trim());
      if (!projectId) continue;
      upsert({
        projectId,
        projectName: rp.projectName || projectId,
        identitySource: 'RUNTIME_LEGACY',
        legacy: true,
        forceLegacy: true,
      });
      continue;
    }
    const projectId = tryNormalizeId(rp.projectId);
    if (!projectId) continue;
    upsert({
      projectId,
      projectName: rp.projectName || input.registry.names[projectId] || deriveProjectName(projectId),
      identitySource: (rp.identitySource as ProjectIdentitySource) || 'EXPLICIT',
      legacy: false,
      forceLegacy: false,
    });
  }

  // 6. When the storage scope itself is a generic bucket, always surface the
  //    LEGACY bucket profile beside the canonical product identity.
  if (GENERIC_SCOPE_IDS.has(input.scope.toLowerCase())) {
    const bucket = input.scope.trim();
    upsert({
      projectId: bucket,
      projectName: bucket,
      identitySource: 'RUNTIME_LEGACY',
      legacy: true,
      forceLegacy: true,
    });
  }

  return out;
}

function buildProfile(
  candidate: Candidate,
  ctx: {
    dataRoot: string;
    roleConfigs: Map<string, RoleConfig>;
    workspaces: Map<string, WorkspaceConfigV2>;
    availableWorkers: string[];
    runtimeProjects?: readonly ProjectRuntimeView[];
    selectedProjectId: string | null;
  },
): ProjectProfileView {
  if (candidate.forceLegacy) {
    return {
      projectId: candidate.projectId,
      projectName: candidate.projectName,
      identitySource: candidate.identitySource,
      legacy: true,
      workspacePath: null,
      workspacePathSource: 'NONE',
      workspaceConfigured: false,
      workspaceConflict: false,
      pm: null,
      builders: [],
      qa: [],
      availableWorkers: ctx.availableWorkers,
      runtime: runtimeSummaryFor(candidate.projectId, ctx.runtimeProjects),
      profileState: 'LEGACY',
      selected: ctx.selectedProjectId === candidate.projectId,
    };
  }

  const roleHit = findRoleConfig(ctx.roleConfigs, candidate.projectId);
  const laneHit = findLaneForProject(ctx.workspaces, candidate.projectId);

  const rolePath = roleHit ? firstRoleWorkspaceRoot(roleHit.config) : null;
  const lanePath = laneHit && typeof laneHit.lane.root === 'string' && path.isAbsolute(laneHit.lane.root)
    ? path.resolve(laneHit.lane.root)
    : null;

  let workspacePath: string | null = null;
  let workspacePathSource: WorkspacePathSource = 'NONE';
  let workspaceConflict = false;

  if (lanePath && rolePath) {
    if (samePath(lanePath, rolePath)) {
      workspacePath = lanePath;
      workspacePathSource = 'WORKSPACE_CONFIG';
    } else {
      // Documented conflict policy: never silently choose. Surface both via
      // conflict flag; prefer reporting the workspace-config path as the
      // displayed path only when they agree — here they do not, so leave path
      // null-ish? Task says return workspaceConflict:true and PARTIAL.
      // Keep both pieces of evidence: expose ROLE path only if we must pick
      // one display value — we expose WORKSPACE_CONFIG path as the candidate
      // display path AND set conflict so callers know not to trust a single
      // source. Actually "DO NOT silently choose" means we should not pretend
      // one is authoritative. Set path to null when conflicted.
      workspacePath = null;
      workspacePathSource = 'NONE';
      workspaceConflict = true;
    }
  } else if (lanePath) {
    workspacePath = lanePath;
    workspacePathSource = 'WORKSPACE_CONFIG';
  } else if (rolePath) {
    workspacePath = rolePath;
    workspacePathSource = 'ROLE_CONFIG';
  }

  let pm: ProjectRoleBindingView | null = null;
  let builders: ProjectRoleBindingView[] = [];
  let qa: ProjectRoleBindingView[] = [];
  if (roleHit) {
    const fromRole = bindingsFromRole(roleHit.config);
    pm = fromRole.pm;
    builders = fromRole.builders;
    qa = fromRole.qa;
  } else if (laneHit) {
    const fromLane = bindingsFromLane(laneHit.lane);
    pm = fromLane.pm;
    builders = fromLane.builders;
    qa = fromLane.qa;
  }

  const hasRoleOrLane = !!(roleHit || laneHit);
  const workspaceConfigured = workspacePath !== null && !workspaceConflict;

  // P2-OWNER-R00: stub registrations (builder runtime unconfigured / no workerId)
  // stay PARTIAL until Owner assigns a real Builder. Existing lanes with workerId
  // or a real runtime/runtimeAdapterId remain CONFIGURED.
  const STUB_RUNTIMES = new Set(['unconfigured', 'unset', 'none']);
  const hasUsableBuilder = builders.some((b) => {
    if (!b) return false;
    if (typeof b.workerId === 'string' && b.workerId.trim()) return true;
    const runtimeHint = (typeof b.runtime === 'string' && b.runtime.trim())
      ? b.runtime.trim()
      : (typeof b.runtimeAdapterId === 'string' && b.runtimeAdapterId.trim() ? b.runtimeAdapterId.trim() : '');
    if (runtimeHint && !STUB_RUNTIMES.has(runtimeHint.toLowerCase())) return true;
    return false;
  });

  let profileState: ProfileState;
  if (workspaceConflict) {
    profileState = 'PARTIAL';
  } else if (workspaceConfigured && hasRoleOrLane && hasUsableBuilder) {
    profileState = 'CONFIGURED';
  } else if (workspaceConfigured || hasRoleOrLane) {
    profileState = 'PARTIAL';
  } else {
    profileState = 'UNCONFIGURED';
  }

  return {
    projectId: candidate.projectId,
    projectName: candidate.projectName,
    identitySource: candidate.identitySource,
    legacy: candidate.legacy,
    workspacePath,
    workspacePathSource,
    workspaceConfigured,
    workspaceConflict,
    pm,
    builders,
    qa,
    availableWorkers: ctx.availableWorkers,
    runtime: runtimeSummaryFor(candidate.projectId, ctx.runtimeProjects),
    profileState,
    selected: ctx.selectedProjectId === candidate.projectId,
  };
}

/** Aggregate every known ProjectProfile for this storage scope. */
export function listProjectProfiles(input: ListProjectProfilesInput): ProjectProfileListResult {
  const dataRoot = path.resolve(input.dataRoot);
  const scope = (input.scope || '').trim() || 'ws';
  const registry = input.registry ?? loadProjectRegistry(dataRoot);
  const scopeIdentity = resolveProjectIdentity({ scope, registry });

  const roleConfigs = new Map<string, RoleConfig>();
  for (const key of listRoleConfigKeys(dataRoot)) {
    const cfg = safeReadRoleConfig(dataRoot, key);
    if (cfg) roleConfigs.set(key, cfg);
  }

  const hostRoots = discoverHostRoots(dataRoot, roleConfigs, input);
  const workspaces = loadWorkspaceConfigs(hostRoots);
  const availableWorkers = availableWorkerIds(dataRoot);

  const selectedRaw =
    input.selectedProjectId !== undefined
      ? input.selectedProjectId
      : loadUiState(dataRoot).selectedProjectId;
  const selectedProjectId =
    typeof selectedRaw === 'string' && selectedRaw.trim()
      ? tryNormalizeId(selectedRaw) ?? selectedRaw.trim()
      : null;

  const candidates = collectCandidates({
    scope,
    scopeIdentity,
    registry,
    roleConfigs,
    workspaces,
    runtimeProjects: input.runtimeProjects,
  });

  const profiles = [...candidates.values()]
    .map((c) =>
      buildProfile(c, {
        dataRoot,
        roleConfigs,
        workspaces,
        availableWorkers,
        runtimeProjects: input.runtimeProjects,
        selectedProjectId,
      }),
    )
    .sort((a, b) => {
      // Canonical non-legacy first, then id.
      if (a.legacy !== b.legacy) return a.legacy ? 1 : -1;
      return a.projectId.localeCompare(b.projectId);
    });

  // Invalid persisted selection: clear selected flags. Keep the raw id in the
  // result so resolveProjectSelection can fall through to LAST_ACTIVE/SCOPE.
  const knownSelected =
    !!selectedProjectId && profiles.some((p) => p.projectId === selectedProjectId);
  if (selectedProjectId && !knownSelected) {
    for (const p of profiles) p.selected = false;
  }

  return {
    scope,
    scopeIdentity,
    selectedProjectId,
    profiles,
    generatedAt: new Date().toISOString(),
  };
}

/** One derived profile, or null when unknown. */
export function getProjectProfile(
  input: ListProjectProfilesInput,
  projectIdRaw: string,
): ProjectProfileView | null {
  const projectId = tryNormalizeId(projectIdRaw) ?? String(projectIdRaw || '').trim();
  if (!projectId) return null;
  const listed = listProjectProfiles(input);
  return listed.profiles.find((p) => p.projectId === projectId)
    ?? listed.profiles.find((p) => p.projectId === String(projectIdRaw).trim())
    ?? null;
}

export type SelectedProjectBasis = 'ARGUMENT' | 'SELECTED' | 'LAST_ACTIVE' | 'SCOPE';

export interface ResolveSelectionInput {
  profiles: readonly ProjectProfileView[];
  runtimeProjects?: readonly ProjectRuntimeView[];
  requestedProjectId?: unknown;
  persistedSelectedProjectId?: string | null;
  scopeIdentity: ProjectIdentity;
}

export interface ResolveSelectionResult {
  selectedProjectId: string | null;
  selectedProjectProfile: ProjectProfileView | null;
  selectedRuntimeProject: ProjectRuntimeView | null;
  basis: SelectedProjectBasis;
}

/**
 * Dashboard / read selection precedence:
 *   1. explicit request argument
 *   2. persisted selectedProjectId (if still known)
 *   3. recent-active runtime project
 *   4. scope identity / first profile
 *
 * Invalid persisted ids fall through safely — they never invent a project.
 */
export function resolveProjectSelection(input: ResolveSelectionInput): ResolveSelectionResult {
  const profiles = input.profiles;
  const runtime = input.runtimeProjects || [];

  const findProfile = (id: string): ProjectProfileView | null =>
    profiles.find((p) => p.projectId === id) ?? null;
  const findRuntime = (id: string): ProjectRuntimeView | null =>
    runtime.find((p) => p.projectId === id) ?? null;

  const requested = typeof input.requestedProjectId === 'string'
    ? input.requestedProjectId.trim()
    : '';
  if (requested) {
    const reqId = tryNormalizeId(requested) ?? requested;
    const profile = findProfile(reqId) ?? findProfile(requested);
    const rt = findRuntime(reqId) ?? findRuntime(requested);
    if (profile || rt) {
      return {
        selectedProjectId: profile?.projectId ?? rt!.projectId,
        selectedProjectProfile: profile,
        selectedRuntimeProject: rt,
        basis: 'ARGUMENT',
      };
    }
    // Unknown explicit id: do not claim ARGUMENT; fall through.
  }

  const persistedRaw = input.persistedSelectedProjectId;
  if (typeof persistedRaw === 'string' && persistedRaw.trim()) {
    const persisted = tryNormalizeId(persistedRaw) ?? persistedRaw.trim();
    const profile = findProfile(persisted);
    const rt = findRuntime(persisted);
    if (profile || rt) {
      return {
        selectedProjectId: profile?.projectId ?? rt!.projectId,
        selectedProjectProfile: profile,
        selectedRuntimeProject: rt,
        basis: 'SELECTED',
      };
    }
  }

  const lastActive = [...runtime]
    .filter((p) => p.lastActivityAt && (p.runtimeState === 'ACTIVE' || p.runtimeState === 'STALE'))
    .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))[0];
  if (lastActive) {
    return {
      selectedProjectId: lastActive.projectId,
      selectedProjectProfile: findProfile(lastActive.projectId),
      selectedRuntimeProject: lastActive,
      basis: 'LAST_ACTIVE',
    };
  }

  const scopeId = input.scopeIdentity.projectId;
  const scopeProfile = findProfile(scopeId) ?? profiles.find((p) => !p.legacy) ?? profiles[0] ?? null;
  const scopeRuntime = scopeProfile ? findRuntime(scopeProfile.projectId) : findRuntime(scopeId);
  return {
    selectedProjectId: scopeProfile?.projectId ?? scopeId,
    selectedProjectProfile: scopeProfile,
    selectedRuntimeProject: scopeRuntime,
    basis: 'SCOPE',
  };
}

/**
 * Persist selection only. Zero execution side effects.
 * Rejects unknown project ids (must appear in the derived profile list).
 */
export function selectProject(
  input: ListProjectProfilesInput,
  projectIdRaw: string,
): {
  ok: true;
  selectedProjectId: string;
  profile: ProjectProfileView;
  uiState: ReturnType<typeof saveSelectedProjectId>;
  sideEffects: {
    goalsCreated: 0;
    tasksCreated: 0;
    dispatches: 0;
    workersSpawned: 0;
    workspaceMutations: 0;
  };
} {
  const projectId = normalizeProjectId(projectIdRaw);
  const before = listProjectProfiles({
    ...input,
    selectedProjectId: loadUiState(input.dataRoot).selectedProjectId,
  });
  const profile = before.profiles.find((p) => p.projectId === projectId);
  if (!profile) {
    throw new Error(`unknown projectId: ${projectId}`);
  }
  // Refuse selecting a LEGACY bucket as the modern working context? Task does
  // not forbid it — selection is only context. Allow, including LEGACY.
  const uiState = saveSelectedProjectId(input.dataRoot, projectId);
  const after = listProjectProfiles({ ...input, selectedProjectId: projectId });
  const selected = after.profiles.find((p) => p.projectId === projectId)!;
  return {
    ok: true,
    selectedProjectId: projectId,
    profile: selected,
    uiState,
    sideEffects: {
      goalsCreated: 0,
      tasksCreated: 0,
      dispatches: 0,
      workersSpawned: 0,
      workspaceMutations: 0,
    },
  };
}

/** Convenience: defaultIdentityForScope re-export for callers/tests. */
export { defaultIdentityForScope };
