/**
 * P1.8C-05 — Resolve explicit Run inputs from selected project assignment.
 *
 * Desired Builder (C02) → trusted workerId (WorkerRegistry).
 * Never invents workspace paths. Never silently picks among multiple Builders
 * unless a single assignment exists (or builders[0] is the documented singular).
 *
 * P2-OWNER-R01: when taskId is present, approved Task execution-config is
 * required for ok — project Assignment alone is not enough to dispatch.
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
import { getTaskExecutionConfig } from './task-execution-config.js';
import { isModelAllowedForWorker } from './agent-model-catalog.js';

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
  | 'NO_TASK'
  | 'TASK_EXECUTION_SELECTION_REQUIRED'
  | 'OWNER_APPROVAL_REQUIRED'
  | 'UNSUPPORTED_MODEL'
  | 'FORBIDDEN_WORKER';

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
  /** Effective Builder label (execution selection worker when approved). */
  desiredBuilder: string | null;
  /** Project Assignment Builder label (hint only; never sufficient for ok). */
  projectDesiredBuilder: string | null;
  workerId: string | null;
  modelId?: string | null;
  executionProfile?: string;
  selectionApproved?: boolean;
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

export type ResolveBuilderMapResult =
  | { ok: true; workerId: string; worker: WorkerRegistryRecord }
  | { ok: false; reason: 'unknown' }
  | { ok: false; reason: 'ambiguous'; candidates: string[] };

/**
 * Map a desired Builder label (runtime / adapter / workerId) to a registry worker.
 * Prefer exact workerId match, then observationAdapterId, then capability tag,
 * then workerId containing the runtime (builder-opencode).
 * Equal top scores fail closed as ambiguous — never pick arbitrarily.
 */
export function mapBuilderToWorker(
  dataRoot: string,
  desired: string,
): ResolveBuilderMapResult {
  const key = desired.trim().toLowerCase();
  if (!key) return { ok: false, reason: 'unknown' };

  // Exact workerId.
  try {
    const exact = loadWorkerRegistryRecord(dataRoot, desired.trim());
    if (exact) return { ok: true, workerId: exact.workerId, worker: exact };
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
  if (scored.length === 0) return { ok: false, reason: 'unknown' };
  // Ambiguous equal top scores → refuse (fail closed).
  if (scored.length > 1 && scored[0]!.score === scored[1]!.score) {
    const top = scored[0]!.score;
    return {
      ok: false,
      reason: 'ambiguous',
      candidates: scored.filter((s) => s.score === top).map((s) => s.worker.workerId),
    };
  }
  return { ok: true, workerId: scored[0]!.worker.workerId, worker: scored[0]!.worker };
}

/** @deprecated Prefer mapBuilderToWorker; kept for callers expecting null on failure. */
export function resolveBuilderToWorkerId(
  dataRoot: string,
  desired: string,
): { workerId: string; worker: WorkerRegistryRecord } | null {
  const mapped = mapBuilderToWorker(dataRoot, desired);
  if (!mapped.ok) return null;
  return { workerId: mapped.workerId, worker: mapped.worker };
}

function isForbiddenWorkerId(workerId: string, worker: WorkerRegistryRecord | null): boolean {
  if (workerId === 'claude-code') return true;
  const cfg = worker?.driverOptions?.claude?.configDir;
  if (typeof cfg === 'string' && cfg.replace(/\\/g, '/').includes('.claude-team')) return true;
  if (worker?.role === 'qa' || workerId.toLowerCase().startsWith('qa-')) return true;
  return false;
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
      projectDesiredBuilder: null,
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

  let projectDesiredBuilder: string | null = null;
  let assignmentWorkerId: string | null = null;
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
      projectDesiredBuilder = builders[0]!;
      // Still allow [0] as canonical primary (WorkspaceConfigV2 builders[0]===builder).
    } else {
      projectDesiredBuilder = builders[0]!;
    }

    if (projectDesiredBuilder) {
      const mapped = mapBuilderToWorker(dataRoot, projectDesiredBuilder);
      if (mapped.ok) {
        assignmentWorkerId = mapped.workerId;
      } else if (mapped.reason === 'ambiguous') {
        blockers.push('BUILDER_AMBIGUOUS');
      } else {
        blockers.push('UNKNOWN_BUILDER');
      }
    }
  } catch {
    blockers.push('BUILDER_ASSIGNMENT_REQUIRED');
  }

  let desiredBuilder: string | null = projectDesiredBuilder;
  let workerId: string | null = assignmentWorkerId;
  let modelId: string | null | undefined;
  let executionProfile: string | undefined;
  let selectionApproved: boolean | undefined;

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

    // P2-OWNER-R01: approved per-Task execution selection required for ok.
    if (taskId) {
      const cfg = getTaskExecutionConfig(dataRoot, scope, taskId);
      if (!cfg) {
        blockers.push('TASK_EXECUTION_SELECTION_REQUIRED');
        workerId = null;
        selectionApproved = false;
      } else {
        modelId = cfg.modelId;
        if (cfg.executionProfile) executionProfile = cfg.executionProfile;
        selectionApproved = cfg.ownerApproval.approved === true;
        desiredBuilder = cfg.workerId;

        const worker = (() => {
          try {
            return loadWorkerRegistryRecord(dataRoot, cfg.workerId);
          } catch {
            return null;
          }
        })();

        if (!worker) {
          blockers.push('UNKNOWN_BUILDER');
          workerId = null;
        } else if (isForbiddenWorkerId(cfg.workerId, worker)) {
          blockers.push('FORBIDDEN_WORKER');
          workerId = null;
        } else if (
          cfg.modelId !== null
          && cfg.modelId !== undefined
          && !isModelAllowedForWorker(dataRoot, worker, cfg.modelId)
        ) {
          blockers.push('UNSUPPORTED_MODEL');
          workerId = cfg.workerId;
        } else if (!cfg.ownerApproval.approved) {
          blockers.push('OWNER_APPROVAL_REQUIRED');
          workerId = cfg.workerId;
        } else {
          workerId = cfg.workerId;
        }
      }
    }
  } else {
    blockers.push('NO_TASK');
  }

  const workspaceRoot = profile.workspacePath && !profile.workspaceConflict
    ? path.resolve(profile.workspacePath)
    : null;

  const unique = [...new Set(blockers)];
  // ok requires approved selection + workspace + READY task (project default alone is NOT enough).
  const ok =
    unique.length === 0
    && !!workerId
    && !!workspaceRoot
    && !!taskId
    && selectionApproved === true;

  return {
    ok,
    blockers: unique,
    projectId,
    workspaceRoot,
    desiredBuilder,
    projectDesiredBuilder,
    workerId,
    ...(modelId !== undefined ? { modelId } : {}),
    ...(executionProfile ? { executionProfile } : {}),
    ...(selectionApproved !== undefined ? { selectionApproved } : {}),
    taskId,
    expectedExecutionState: 'READY',
    task,
  };
}
