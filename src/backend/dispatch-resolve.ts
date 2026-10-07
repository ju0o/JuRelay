/**
 * P1.8C-05 — Resolve explicit Run inputs from selected project assignment.
 *
 * Desired Builder (C02) → trusted workerId (WorkerRegistry).
 * Never invents workspace paths. Never silently picks among multiple Builders
 * unless a single assignment exists (or builders[0] is the documented singular).
 */
import * as path from 'node:path';
import { getProjectProfile, listProjectProfiles } from './project-profile.js';
import { getProjectAssignments } from './project-assignment.js';
import { loadUiState } from './ui-state.js';
import {
  listWorkerRegistryRecords,
  loadWorkerRegistryRecord,
  type WorkerRegistryRecord,
} from './worker-registry.js';
import { getTask } from './goal-task.js';
import type { TaskRecord } from '../shared/types.js';

export type DispatchResolveBlocker =
  | 'PROJECT_CONFIGURATION_REQUIRED'
  | 'WORKSPACE_CONFIGURATION_REQUIRED'
  | 'WORKSPACE_CONFLICT'
  | 'LEGACY_NOT_ALLOWED'
  | 'UNCONFIGURED'
  | 'BUILDER_ASSIGNMENT_REQUIRED'
  | 'BUILDER_AMBIGUOUS'
  | 'UNKNOWN_BUILDER'
  | 'TASK_NOT_READY'
  | 'TASK_NOT_FOUND'
  | 'NO_TASK';

export interface ResolveDispatchInput {
  dataRoot: string;
  scope: string;
  taskId?: string;
  projectId?: string;
  hostRoots?: string[];
  includeCwdHostRoot?: boolean;
}

export interface ResolveDispatchResult {
  ok: boolean;
  blockers: DispatchResolveBlocker[];
  projectId: string | null;
  workspaceRoot: string | null;
  desiredBuilder: string | null;
  workerId: string | null;
  taskId: string | null;
  expectedExecutionState: 'READY';
  task: Pick<TaskRecord, 'taskId' | 'title' | 'executionState' | 'pmState' | 'goalId'> | null;
}

function labelOfBinding(b: { runtime?: string | null; runtimeAdapterId?: string | null; workerId?: string | null } | null | undefined): string | null {
  if (!b) return null;
  if (typeof b.workerId === 'string' && b.workerId.trim()) return b.workerId.trim();
  if (typeof b.runtime === 'string' && b.runtime.trim()) return b.runtime.trim();
  if (typeof b.runtimeAdapterId === 'string' && b.runtimeAdapterId.trim()) return b.runtimeAdapterId.trim();
  return null;
}

/**
 * Map a desired Builder label (runtime / adapter / workerId) to a registry worker.
 * Prefer exact workerId match, then observationAdapterId, then capability tag,
 * then workerId containing the runtime (builder-opencode).
 */
export function resolveBuilderToWorkerId(
  dataRoot: string,
  desired: string,
): { workerId: string; worker: WorkerRegistryRecord } | null {
  const key = desired.trim().toLowerCase();
  if (!key) return null;

  // Exact workerId.
  try {
    const exact = loadWorkerRegistryRecord(dataRoot, desired.trim());
    if (exact) return { workerId: exact.workerId, worker: exact };
  } catch {
    /* fall through */
  }

  const all = listWorkerRegistryRecords(dataRoot);
  const scored: Array<{ worker: WorkerRegistryRecord; score: number }> = [];
  for (const w of all) {
    const id = (w.workerId || '').toLowerCase();
    // Skip QA workers for Builder resolution (role tag or qa- id prefix).
    if (w.role === 'qa' || id.startsWith('qa-') || id.startsWith('qa_')) continue;
    const adapter = (w.observationAdapterId || '').toLowerCase();
    const caps = (w.capabilities || []).map((c) => String(c).toLowerCase());
    let score = 0;
    if (id === key) score = 100;
    else if (id === `builder-${key}`) score = 95; // canonical builder-<runtime>
    else if (caps.includes(key) && id.startsWith('builder-')) score = 85;
    else if (adapter === key && id.startsWith('builder-')) score = 80;
    else if (caps.includes(key)) score = 70;
    else if (adapter === key) score = 65;
    else if (id.startsWith('builder-') && id.includes(key)) score = 40;
    else if (adapter.includes(key)) score = 30;
    if (score > 0) scored.push({ worker: w, score });
  }
  scored.sort((a, b) => b.score - a.score || a.worker.workerId.localeCompare(b.worker.workerId));
  if (scored.length === 0) return null;
  // Ambiguous equal top scores → refuse (fail closed).
  if (scored.length > 1 && scored[0]!.score === scored[1]!.score) return null;
  return { workerId: scored[0]!.worker.workerId, worker: scored[0]!.worker };
}

export function resolveOwnerDispatch(input: ResolveDispatchInput): ResolveDispatchResult {
  const dataRoot = input.dataRoot;
  const scope = (input.scope || '').trim() || 'ws';
  const blockers: DispatchResolveBlocker[] = [];
  const persisted = loadUiState(dataRoot).selectedProjectId;

  const listed = listProjectProfiles({
    dataRoot,
    scope,
    selectedProjectId: persisted,
    hostRoots: input.hostRoots,
    includeCwdHostRoot: input.includeCwdHostRoot,
  });

  let projectId = typeof input.projectId === 'string' && input.projectId.trim()
    ? input.projectId.trim()
    : (listed.selectedProjectId || listed.scopeIdentity.projectId);

  const profile = getProjectProfile(
    {
      dataRoot,
      scope,
      selectedProjectId: persisted,
      hostRoots: input.hostRoots,
      includeCwdHostRoot: input.includeCwdHostRoot,
    },
    projectId,
  ) || listed.profiles.find((p) => p.projectId === projectId) || null;

  if (!profile) {
    return {
      ok: false,
      blockers: ['PROJECT_CONFIGURATION_REQUIRED'],
      projectId,
      workspaceRoot: null,
      desiredBuilder: null,
      workerId: null,
      taskId: null,
      expectedExecutionState: 'READY',
      task: null,
    };
  }
  projectId = profile.projectId;

  if (profile.legacy || profile.profileState === 'LEGACY') blockers.push('LEGACY_NOT_ALLOWED');
  if (profile.profileState === 'UNCONFIGURED') blockers.push('UNCONFIGURED');
  if (profile.workspaceConflict) blockers.push('WORKSPACE_CONFLICT');
  if (!profile.workspaceConfigured || !profile.workspacePath) {
    blockers.push('WORKSPACE_CONFIGURATION_REQUIRED');
  }

  let desiredBuilder: string | null = null;
  let workerId: string | null = null;
  try {
    const assignment = getProjectAssignments({
      dataRoot,
      scope,
      selectedProjectId: persisted,
      hostRoots: input.hostRoots,
      includeCwdHostRoot: input.includeCwdHostRoot,
    }, projectId);

    const builders = (assignment.builders || [])
      .map((b) => labelOfBinding(b))
      .filter((x): x is string => !!x);

    if (builders.length === 0) {
      blockers.push('BUILDER_ASSIGNMENT_REQUIRED');
    } else if (builders.length > 1) {
      // C02 contract: builders[0] matches singular builder when multi-binding.
      // Use [0] only when it equals the documented singular primary.
      desiredBuilder = builders[0]!;
      // Still allow [0] as canonical primary (WorkspaceConfigV2 builders[0]===builder).
    } else {
      desiredBuilder = builders[0]!;
    }

    if (desiredBuilder) {
      const resolved = resolveBuilderToWorkerId(dataRoot, desiredBuilder);
      if (!resolved) blockers.push('UNKNOWN_BUILDER');
      else workerId = resolved.workerId;
    }
  } catch {
    blockers.push('BUILDER_ASSIGNMENT_REQUIRED');
  }

  let task: ResolveDispatchResult['task'] = null;
  let taskId: string | null = typeof input.taskId === 'string' && input.taskId.trim()
    ? input.taskId.trim()
    : null;

  if (taskId) {
    try {
      const t = getTask(dataRoot, scope, taskId);
      task = {
        taskId: t.taskId,
        title: t.title,
        executionState: t.executionState,
        pmState: t.pmState,
        goalId: t.goalId,
      };
      if (t.executionState !== 'READY') blockers.push('TASK_NOT_READY');
    } catch {
      blockers.push('TASK_NOT_FOUND');
      taskId = null;
    }
  } else {
    blockers.push('NO_TASK');
  }

  const workspaceRoot = profile.workspacePath && !profile.workspaceConflict
    ? path.resolve(profile.workspacePath)
    : null;

  const unique = [...new Set(blockers)];
  return {
    ok: unique.length === 0 && !!workerId && !!workspaceRoot && !!taskId,
    blockers: unique,
    projectId,
    workspaceRoot,
    desiredBuilder,
    workerId,
    taskId,
    expectedExecutionState: 'READY',
    task,
  };
}
