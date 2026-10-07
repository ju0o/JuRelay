/**
 * P1.8C-04 / P1.8D — Bounded single-project dashboard read model.
 *
 * Canonical backing for `relay_pm_get_project`. Pure read. Never mutates
 * selection, assignments, workspace, Goals, Tasks, Runs, or workers.
 *
 * deliberately NOT a full `relay_pm_get_dashboard` clone: no portfolio dump,
 * no all-project profiles list, no unbounded task arrays, no evidence blobs.
 *
 * Count semantics (do NOT compare 1:1 in QA):
 *   - `relay_pm_get_dashboard.summary` = storage/scope aggregate across the
 *     process bucket (often `ws`), including every projectId in that scope.
 *   - `relay_pm_get_project(projectId).counts` = bounded counts for the
 *     selected logical project only (e.g. agent-relay).
 */
import * as goalTask from './goal-task.js';
import {
  assignmentSummaryFromProfile,
} from './project-assignment.js';
import {
  listProjectProfiles,
  resolveProjectSelection,
  type ProjectProfileView,
  type SelectedProjectBasis,
} from './project-profile.js';
import { loadUiState } from './ui-state.js';
import { loadProjectRegistry, normalizeProjectId } from './project-identity.js';
import {
  buildProjectRuntimeViews,
  type LiveHandleLike,
  type ProjectRuntimeView,
  type ProjectTaskRuntime,
  type TaskRuntimeState,
  type NextActionCode,
} from './runtime-truth.js';
import {
  resolveOwnerDispatch,
  type ResolveDispatchResult,
} from './dispatch-resolve.js';
import type { GoalRecord, TaskRecord } from '../shared/types.js';

/** Hard cap on recent task rows in the response. */
export const PROJECT_DASHBOARD_MAX_RECENT_TASKS = 5;

/** Soft byte budget for JSON evidence in tests (not enforced as truncation). */
export const PROJECT_DASHBOARD_SOFT_JSON_BYTES = 24_000;

export type ProjectDashboardViewState =
  | 'CONFIGURED'
  | 'PARTIAL'
  | 'UNCONFIGURED'
  | 'LEGACY'
  | 'UNKNOWN';

export interface ProjectDashboardProject {
  projectId: string;
  projectName: string;
  profileState: ProjectDashboardViewState | string;
  workspacePath: string | null;
  workspaceConfigured: boolean;
  workspaceConflict: boolean;
  legacy: boolean;
}

export interface ProjectDashboardAssignment {
  pm: string | null;
  builders: string[];
  qa: string[];
}

export interface ProjectDashboardGoal {
  goalId: string;
  title: string;
  status: string;
}

export interface ProjectDashboardTask {
  taskId: string;
  title: string;
  executionState: string;
  pmState: string;
  runtimeState: TaskRuntimeState;
  /** Observed/live worker when known — NOT the desired Builder assignment. */
  agent: string | null;
  model: string | null;
  lastActivityAt: string | null;
  reason: string;
  nextAction: NextActionCode | string;
  nextActionText: string;
}

export interface ProjectDashboardCounts {
  tasks: number;
  persistedRunning: number;
  actualActiveRuns: number;
  staleRuns: number;
  orphanRuns: number;
  readyTasks: number;
  verificationPending: number;
}

export interface ProjectDashboardWarning {
  code: string;
  message: string;
}

export interface ProjectDashboardView {
  schemaVersion: 'project-dashboard.v1';
  basis: SelectedProjectBasis;
  /** True when the resolved projectId came only from the request argument. */
  argumentOverride: boolean;
  project: ProjectDashboardProject | null;
  assignment: ProjectDashboardAssignment | null;
  goal: ProjectDashboardGoal | null;
  /** Primary / current Task (runtime-severity leader). */
  task: ProjectDashboardTask | null;
  /** Bounded recent interesting Tasks (max PROJECT_DASHBOARD_MAX_RECENT_TASKS). */
  recentTasks: ProjectDashboardTask[];
  counts: ProjectDashboardCounts;
  nextAction: NextActionCode | string;
  nextActionText: string;
  warnings: ProjectDashboardWarning[];
  empty: {
    goal: boolean;
    task: boolean;
    goalText: string | null;
    taskText: string | null;
  };
  /** P1.8C-05 — explicit Run eligibility (pure read; never dispatches). */
  runEligibility: ResolveDispatchResult | null;
  generatedAt: string;
  sideEffects: {
    goalsCreated: 0;
    tasksCreated: 0;
    runsCreated: 0;
    workersSpawned: 0;
    selectionChanged: 0;
    assignmentChanged: 0;
    workspaceChanged: 0;
  };
}

export interface GetProjectDashboardInput {
  dataRoot: string;
  scope: string;
  /** Explicit projectId argument (does NOT persist selection). */
  projectId?: string | null;
  hostRoots?: string[];
  includeCwdHostRoot?: boolean;
  /** Test overrides — when omitted, reads from disk. */
  tasks?: readonly TaskRecord[];
  goals?: readonly GoalRecord[];
  liveHandles?: readonly LiveHandleLike[];
  orphanSuspectedOf?: (taskId: string) => boolean;
  nowMs?: number;
  probe?: boolean;
}

const EMPTY_COUNTS: ProjectDashboardCounts = {
  tasks: 0,
  persistedRunning: 0,
  actualActiveRuns: 0,
  staleRuns: 0,
  orphanRuns: 0,
  readyTasks: 0,
  verificationPending: 0,
};

const ZERO_SIDE_EFFECTS: ProjectDashboardView['sideEffects'] = {
  goalsCreated: 0,
  tasksCreated: 0,
  runsCreated: 0,
  workersSpawned: 0,
  selectionChanged: 0,
  assignmentChanged: 0,
  workspaceChanged: 0,
};

function mapTask(t: ProjectTaskRuntime): ProjectDashboardTask {
  return {
    taskId: t.taskId,
    title: t.title,
    executionState: t.executionState,
    pmState: t.pmState,
    runtimeState: t.runtimeState,
    agent: t.workerId,
    model: t.model,
    lastActivityAt: t.lastActivityAt,
    reason: t.reason,
    nextAction: t.nextAction,
    nextActionText: t.nextActionText,
  };
}

function profileToProject(profile: ProjectProfileView | null): ProjectDashboardProject | null {
  if (!profile) return null;
  return {
    projectId: profile.projectId,
    projectName: profile.projectName,
    profileState: profile.profileState,
    workspacePath: profile.workspacePath,
    workspaceConfigured: profile.workspaceConfigured,
    workspaceConflict: profile.workspaceConflict,
    legacy: profile.legacy,
  };
}

function runtimeToProject(rt: ProjectRuntimeView): ProjectDashboardProject {
  return {
    projectId: rt.projectId,
    projectName: rt.projectName,
    profileState: rt.legacy ? 'LEGACY' : 'UNKNOWN',
    workspacePath: null,
    workspaceConfigured: false,
    workspaceConflict: false,
    legacy: rt.legacy,
  };
}

/**
 * P1.8C-05 — surface a user Goal even before any Task exists.
 * Prefer runtime-truth activeGoal (task-led). Else newest PLANNING|ACTIVE
 * non-v1-internal Goal bound to this projectId.
 */
function pickDashboardGoal(
  goals: readonly GoalRecord[],
  projectId: string | null,
  runtimeActive: { goalId: string; title: string; status: string } | null | undefined,
): ProjectDashboardGoal | null {
  if (runtimeActive) {
    return {
      goalId: runtimeActive.goalId,
      title: runtimeActive.title,
      status: runtimeActive.status,
    };
  }
  if (!projectId) return null;
  const expected = normalizeProjectId(projectId);
  const open = goals
    .filter((g) => {
      if (g.status !== 'PLANNING' && g.status !== 'ACTIVE') return false;
      const tags = Array.isArray(g.tags) ? g.tags : [];
      if (tags.includes('v1-internal')) return false;
      const pid = typeof g.projectId === 'string' && g.projectId.trim()
        ? normalizeProjectId(g.projectId)
        : null;
      return pid === expected;
    })
    .sort((a, b) => {
      const ta = Date.parse(a.updatedAt || a.createdAt || '') || 0;
      const tb = Date.parse(b.updatedAt || b.createdAt || '') || 0;
      if (tb !== ta) return tb - ta;
      return b.goalId.localeCompare(a.goalId);
    });
  const hit = open[0];
  if (!hit) return null;
  return { goalId: hit.goalId, title: hit.title, status: hit.status };
}

function buildWarnings(
  project: ProjectDashboardProject | null,
): ProjectDashboardWarning[] {
  const warnings: ProjectDashboardWarning[] = [];
  if (!project) {
    warnings.push({
      code: 'NO_PROJECT',
      message: '보여줄 프로젝트가 없어요. 프로젝트 준비부터 해 주세요.',
    });
    return warnings;
  }
  if (project.legacy || project.profileState === 'LEGACY') {
    warnings.push({
      code: 'LEGACY',
      message: 'Legacy 기록입니다. 일반 작업 프로젝트로 쓰지 마세요.',
    });
  }
  if (project.profileState === 'UNCONFIGURED') {
    warnings.push({
      code: 'UNCONFIGURED',
      message: '프로젝트 설정이 필요해요.',
    });
  }
  if (project.workspaceConflict) {
    warnings.push({
      code: 'WORKSPACE_CONFLICT',
      message: '워크스페이스 설정이 서로 달라 계속할 수 없어요.',
    });
  }
  return warnings;
}

/**
 * Build the bounded single-project dashboard. Pure read.
 */
export function getProjectDashboard(input: GetProjectDashboardInput): ProjectDashboardView {
  const dataRoot = input.dataRoot;
  const scope = (input.scope || '').trim() || 'ws';
  const persistedSelectedId = loadUiState(dataRoot).selectedProjectId;
  const registry = loadProjectRegistry(dataRoot);

  let tasks: readonly TaskRecord[] = input.tasks ?? [];
  if (!input.tasks) {
    try {
      tasks = goalTask.listTasks(dataRoot, scope, undefined);
    } catch {
      tasks = [];
    }
  }
  let goals: readonly GoalRecord[] = input.goals ?? [];
  if (!input.goals) {
    try {
      goals = goalTask.listGoals(dataRoot, scope);
    } catch {
      goals = [];
    }
  }

  const runtime = buildProjectRuntimeViews({
    tasks,
    goals,
    scope,
    registry,
    nowMs: input.nowMs,
    ...(input.liveHandles ? { liveHandles: input.liveHandles } : {}),
    ...(input.orphanSuspectedOf ? { orphanSuspectedOf: input.orphanSuspectedOf } : {}),
    ...(input.probe === undefined ? {} : { probe: input.probe }),
  });

  const listed = listProjectProfiles({
    dataRoot,
    scope,
    selectedProjectId: persistedSelectedId,
    runtimeProjects: runtime.projects,
    hostRoots: input.hostRoots,
    includeCwdHostRoot: input.includeCwdHostRoot,
    registry,
  });

  const resolved = resolveProjectSelection({
    profiles: listed.profiles,
    runtimeProjects: runtime.projects,
    requestedProjectId: input.projectId,
    persistedSelectedProjectId: persistedSelectedId,
    scopeIdentity: listed.scopeIdentity,
  });

  const argumentOverride = resolved.basis === 'ARGUMENT';
  const profile = resolved.selectedProjectProfile;
  const rt = resolved.selectedRuntimeProject;

  const project = profile
    ? profileToProject(profile)
    : rt
      ? runtimeToProject(rt)
      : null;

  const assignment = assignmentSummaryFromProfile(profile);

  // Counts: prefer runtime project counts; never invent live activity.
  // verificationPending excludes ACCEPTED (ACKNOWLEDGED delivery safety).
  let counts: ProjectDashboardCounts = { ...EMPTY_COUNTS };
  if (rt) {
    let verificationPending = 0;
    for (const t of rt.tasks) {
      const accepted = t.pmState === 'ACCEPTED';
      if (
        !accepted
        && (t.executionState === 'RESULT_RECEIVED' || t.pmState === 'VERIFYING')
      ) {
        verificationPending += 1;
      }
    }
    // Also scan full bucket counts from runtime (already computed) but clamp
    // verificationPending with the ACCEPTED filter above when we have rows.
    counts = {
      tasks: rt.counts.tasks,
      persistedRunning: rt.counts.persistedRunning,
      actualActiveRuns: rt.counts.activeRuns,
      staleRuns: rt.counts.staleRuns,
      orphanRuns: rt.counts.orphanRuns,
      readyTasks: rt.counts.readyTasks,
      verificationPending: rt.tasks.length
        ? verificationPending
        : rt.counts.verificationPending,
    };
  }

  const goal: ProjectDashboardGoal | null = pickDashboardGoal(
    goals,
    project?.projectId ?? null,
    rt?.activeGoal ?? null,
  );

  const task: ProjectDashboardTask | null = rt?.activeTask
    ? mapTask(rt.activeTask)
    : null;

  const recentTasks: ProjectDashboardTask[] = (rt?.tasks ?? [])
    .slice(0, PROJECT_DASHBOARD_MAX_RECENT_TASKS)
    .map(mapTask);

  const nextAction = task?.nextAction
    ?? rt?.nextAction
    ?? 'NONE';
  const nextActionText = task?.nextActionText
    ?? rt?.nextActionText
    ?? '진행 중인 작업 없음';

  const warnings = buildWarnings(project);
  const emptyGoal = !goal;
  const emptyTask = !task;

  let runEligibility: ResolveDispatchResult | null = null;
  if (task && task.executionState === 'READY' && project && !project.legacy) {
    try {
      runEligibility = resolveOwnerDispatch({
        dataRoot,
        scope,
        taskId: task.taskId,
        projectId: project.projectId,
        hostRoots: input.hostRoots,
        includeCwdHostRoot: input.includeCwdHostRoot,
      });
    } catch {
      runEligibility = null;
    }
  }

  return {
    schemaVersion: 'project-dashboard.v1',
    basis: resolved.basis,
    argumentOverride,
    project,
    assignment,
    goal,
    task,
    recentTasks,
    counts,
    nextAction,
    nextActionText,
    warnings,
    empty: {
      goal: emptyGoal,
      task: emptyTask,
      goalText: emptyGoal ? '아직 진행 중인 Goal이 없습니다.' : null,
      taskText: emptyTask ? '지금 보고 있는 Task가 없습니다.' : null,
    },
    runEligibility,
    generatedAt: runtime.generatedAt,
    sideEffects: { ...ZERO_SIDE_EFFECTS },
  };
}

/** Approximate JSON size helper for bound evidence in tests. */
export function estimateProjectDashboardJsonBytes(view: ProjectDashboardView): number {
  return Buffer.byteLength(JSON.stringify(view), 'utf8');
}
