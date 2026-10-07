/**
 * P1.8C-03 — First-run bootstrap gate (pure helpers).
 *
 * Decides when the production PM widget shows the bootstrap wizard vs the
 * normal project view. No I/O, no Goal/Task/Run/worker side effects.
 *
 * Canonical persistence remains C01 selectedProjectId + C02 assignment stores.
 * This module never invents a workspace path or a second wizard database.
 */

export type BootstrapProfileState =
  | 'CONFIGURED'
  | 'PARTIAL'
  | 'UNCONFIGURED'
  | 'LEGACY';

/** Minimal profile shape the gate needs (ProjectProfileView-compatible). */
export interface BootstrapProfileLike {
  projectId: string;
  projectName?: string;
  profileState: BootstrapProfileState | string;
  legacy?: boolean;
  workspacePath?: string | null;
  workspaceConfigured?: boolean;
  workspaceConflict?: boolean;
  pm?: unknown | null;
  builders?: unknown[] | null;
  qa?: unknown[] | null;
}

/** Minimal assignment shape (ProjectAssignmentView-compatible). */
export interface BootstrapAssignmentLike {
  projectId?: string;
  configurationRequired?: boolean;
  pm?: unknown | null;
  builders?: unknown[] | null;
  qa?: unknown[] | null;
  availableWorkers?: string[] | null;
  workspacePath?: string | null;
  workspaceConflict?: boolean;
}

export type BootstrapBlockerCode =
  | 'NO_PROJECT'
  | 'LEGACY_NOT_ALLOWED'
  | 'WORKSPACE_CONFIGURATION_REQUIRED'
  | 'WORKSPACE_CONFLICT'
  | 'PM_REQUIRED'
  | 'BUILDER_REQUIRED'
  | 'QA_REQUIRED'
  | 'CONFIGURATION_REQUIRED';

export interface BootstrapReadyResult {
  ready: boolean;
  /** Conceptual state when ready. Means context configured — not work started. */
  state: 'BOOTSTRAP_READY' | 'BOOTSTRAP_BLOCKED';
  blockers: BootstrapBlockerCode[];
}

export interface WorkspaceDisplay {
  kind: 'PATH' | 'WORKSPACE_CONFIGURATION_REQUIRED' | 'WORKSPACE_CONFLICT' | 'NONE';
  /** Exact existing path when kind=PATH; never invented. */
  workspacePath: string | null;
  label: string;
}

/**
 * First-run: no persisted selection suitable for normal use.
 *
 * Triggers:
 *   - selected project state absent
 *   - selected profile no longer exists
 *   - selected profile is LEGACY
 *   - selected profile is UNCONFIGURED
 *   - workspace missing or conflicted
 *
 * Does NOT trigger merely because storage scope is `ws`.
 */
export function needsFirstRunBootstrap(
  selectedProjectId: string | null | undefined,
  selectedProfile: BootstrapProfileLike | null | undefined,
): boolean {
  if (!selectedProjectId || typeof selectedProjectId !== 'string' || !selectedProjectId.trim()) {
    return true;
  }
  if (!selectedProfile || typeof selectedProfile !== 'object') {
    return true;
  }
  if (selectedProfile.legacy === true || selectedProfile.profileState === 'LEGACY') {
    return true;
  }
  if (selectedProfile.profileState === 'UNCONFIGURED') {
    return true;
  }
  if (selectedProfile.workspaceConflict === true) {
    return true;
  }
  if (selectedProfile.workspaceConfigured !== true) {
    return true;
  }
  // CONFIGURED (or PARTIAL with a real non-conflicting workspace) → returning user.
  return false;
}

/** LEGACY cannot complete as a normal bootstrap target. */
export function canCompleteBootstrapAsTarget(
  profile: BootstrapProfileLike | null | undefined,
): { ok: boolean; reason: BootstrapBlockerCode | null } {
  if (!profile) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  if (profile.legacy === true || profile.profileState === 'LEGACY') {
    return { ok: false, reason: 'LEGACY_NOT_ALLOWED' };
  }
  return { ok: true, reason: null };
}

/**
 * Workspace step display. Never invents a path for UNCONFIGURED.
 * CONFIGURED / known path → show the exact existing workspacePath.
 */
export function workspaceDisplayForProfile(
  profile: BootstrapProfileLike | null | undefined,
): WorkspaceDisplay {
  if (!profile) {
    return {
      kind: 'NONE',
      workspacePath: null,
      label: '프로젝트를 먼저 골라 주세요.',
    };
  }
  if (profile.workspaceConflict === true) {
    return {
      kind: 'WORKSPACE_CONFLICT',
      workspacePath: profile.workspacePath ?? null,
      label: '워크스페이스 설정이 서로 다릅니다. 계속할 수 없어요.',
    };
  }
  if (
    profile.workspaceConfigured === true &&
    typeof profile.workspacePath === 'string' &&
    profile.workspacePath.trim()
  ) {
    return {
      kind: 'PATH',
      workspacePath: profile.workspacePath,
      label: profile.workspacePath,
    };
  }
  return {
    kind: 'WORKSPACE_CONFIGURATION_REQUIRED',
    workspacePath: null,
    label: '워크스페이스 경로 설정이 필요해요.',
  };
}

function hasBinding(value: unknown): boolean {
  return value !== null && value !== undefined && typeof value === 'object';
}

function bindingCount(list: unknown[] | null | undefined): number {
  if (!Array.isArray(list)) return 0;
  return list.filter(hasBinding).length;
}

/**
 * Ready gate before 시작/계속.
 *
 * Requires:
 *   - valid non-LEGACY project
 *   - workspace configured
 *   - no workspace conflict
 *   - valid PM assignment
 *   - ≥1 builder and ≥1 QA (C02 write rules)
 *
 * BOOTSTRAP_READY = context configured. Never means work has started.
 */
export function evaluateBootstrapReady(
  profile: BootstrapProfileLike | null | undefined,
  assignment?: BootstrapAssignmentLike | null,
): BootstrapReadyResult {
  const blockers: BootstrapBlockerCode[] = [];

  const target = canCompleteBootstrapAsTarget(profile);
  if (!target.ok && target.reason) {
    blockers.push(target.reason);
  }

  if (profile) {
    if (profile.workspaceConflict === true) {
      blockers.push('WORKSPACE_CONFLICT');
    }
    if (profile.workspaceConfigured !== true) {
      blockers.push('WORKSPACE_CONFIGURATION_REQUIRED');
    }
  }

  const src = assignment && typeof assignment === 'object' ? assignment : profile;
  if (assignment && assignment.configurationRequired === true) {
    blockers.push('CONFIGURATION_REQUIRED');
  }

  if (!src || !hasBinding(src.pm)) {
    blockers.push('PM_REQUIRED');
  }
  if (!src || bindingCount(src.builders) < 1) {
    blockers.push('BUILDER_REQUIRED');
  }
  if (!src || bindingCount(src.qa) < 1) {
    blockers.push('QA_REQUIRED');
  }

  // Dedupe while preserving order.
  const unique: BootstrapBlockerCode[] = [];
  for (const code of blockers) {
    if (!unique.includes(code)) unique.push(code);
  }

  if (unique.length === 0) {
    return { ready: true, state: 'BOOTSTRAP_READY', blockers: [] };
  }
  return { ready: false, state: 'BOOTSTRAP_BLOCKED', blockers: unique };
}

/** Friendly Korean labels for blocker codes (Founder-facing). */
export function bootstrapBlockerLabel(code: BootstrapBlockerCode): string {
  switch (code) {
    case 'NO_PROJECT':
      return '프로젝트를 골라 주세요.';
    case 'LEGACY_NOT_ALLOWED':
      return '예전(레거시) 프로젝트는 여기서 시작할 수 없어요.';
    case 'WORKSPACE_CONFIGURATION_REQUIRED':
      return '워크스페이스 경로 설정이 필요해요.';
    case 'WORKSPACE_CONFLICT':
      return '워크스페이스 설정이 서로 달라 계속할 수 없어요.';
    case 'PM_REQUIRED':
      return 'PM을 정해 주세요.';
    case 'BUILDER_REQUIRED':
      return 'Builder를 정해 주세요.';
    case 'QA_REQUIRED':
      return 'QA를 정해 주세요.';
    case 'CONFIGURATION_REQUIRED':
      return '프로젝트 설정이 아직 없어요.';
    default:
      return '아직 준비가 끝나지 않았어요.';
  }
}

/** Zero-execution side-effect counters for bootstrap completion evidence. */
export const BOOTSTRAP_ZERO_SIDE_EFFECTS = Object.freeze({
  goalsCreated: 0 as const,
  tasksCreated: 0 as const,
  runsCreated: 0 as const,
  workersSpawned: 0 as const,
  tmuxOpened: 0 as const,
  shellStarted: 0 as const,
  gitMutations: 0 as const,
});

/**
 * Display label for profileState (surface may keep enum in a pill; Korean nearby).
 */
export function profileStatePill(state: string | undefined): {
  code: string;
  tone: 'ok' | 'warn' | 'legacy' | 'muted';
  labelKo: string;
} {
  switch (state) {
    case 'CONFIGURED':
      return { code: 'CONFIGURED', tone: 'ok', labelKo: '준비됨' };
    case 'PARTIAL':
      return { code: 'PARTIAL', tone: 'warn', labelKo: '일부만 설정' };
    case 'UNCONFIGURED':
      return { code: 'UNCONFIGURED', tone: 'warn', labelKo: '설정 필요' };
    case 'LEGACY':
      return { code: 'LEGACY', tone: 'legacy', labelKo: '예전(레거시)' };
    default:
      return { code: state || 'UNKNOWN', tone: 'muted', labelKo: state || '알 수 없음' };
  }
}

/** Binding display name helper — runtime / adapter / worker, never availableWorkers. */
export function bindingDisplayName(binding: unknown): string {
  if (!binding || typeof binding !== 'object') return '(없음)';
  const b = binding as Record<string, unknown>;
  const runtime = typeof b.runtime === 'string' ? b.runtime : '';
  const adapter = typeof b.runtimeAdapterId === 'string' ? b.runtimeAdapterId : '';
  const worker = typeof b.workerId === 'string' ? b.workerId : '';
  return runtime || adapter || worker || '(이름 없음)';
}
