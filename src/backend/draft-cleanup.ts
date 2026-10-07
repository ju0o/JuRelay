/**
 * P1.8D — Cancel a draft READY Task that never ran, and optionally abandon
 * its user Goal when every sibling Task is also terminal-abandoned.
 *
 * Uses canonical transitions only:
 *   Task READY → CANCELLED  (EXEC_TRANSITIONS)
 *   Goal ACTIVE|PLANNING|… → ABANDONED when all Tasks are CANCELLED
 *
 * Never deletes files. Never kills Workers. linkedRuns must be empty.
 */
import { getGoal, getTask, listTasks } from './goal-task.js';
import {
  transitionGoalStatus,
  transitionTaskExecution,
  RuntimeConflictError,
} from './goal-task-runtime.js';
import type { GoalRecord, GoalStatus, TaskRecord } from '../shared/types.js';

export class DraftCleanupError extends Error {
  readonly code:
    | 'INVALID_ARGUMENT'
    | 'NOT_FOUND'
    | 'INVALID_STATE'
    | 'CONFLICT';
  constructor(code: DraftCleanupError['code'], message: string) {
    super(message);
    this.name = 'DraftCleanupError';
    this.code = code;
  }
}

export interface CancelReadyTaskInput {
  taskId: string;
  expectedExecutionState: 'READY';
  reason?: string;
  /** When true (default), abandon Goal if every Task under it is CANCELLED. */
  abandonEmptyGoal?: boolean;
}

export interface CancelReadyTaskResult {
  task: TaskRecord;
  goal: GoalRecord | null;
  goalAbandoned: boolean;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DraftCleanupError('INVALID_ARGUMENT', `${field}이(가) 필요합니다.`);
  }
  return value.trim();
}

const GOAL_ABANDON_FROM = new Set<GoalStatus>([
  'PLANNING',
  'ACTIVE',
  'WAITING_OWNER',
  'BLOCKED',
]);

/**
 * Cancel ONE READY Task with zero linked Runs.
 * Fail closed on RUNNING / RESULT_RECEIVED / any linkedRuns.
 */
export async function cancelReadyTask(
  dataRoot: string,
  project: string,
  input: CancelReadyTaskInput,
): Promise<CancelReadyTaskResult> {
  const taskId = requireText(input?.taskId, 'taskId');
  if (input?.expectedExecutionState !== 'READY') {
    throw new DraftCleanupError(
      'INVALID_ARGUMENT',
      `expectedExecutionState must be READY, got: ${String(input?.expectedExecutionState)}`,
    );
  }

  let before: TaskRecord;
  try {
    before = getTask(dataRoot, project, taskId);
  } catch {
    throw new DraftCleanupError('NOT_FOUND', `Task '${taskId}' 찾을 수 없습니다.`);
  }

  if (before.executionState !== 'READY') {
    throw new DraftCleanupError(
      'INVALID_STATE',
      `READY Task만 준비 취소할 수 있습니다 (found ${before.executionState}).`,
    );
  }
  if (before.linkedRuns.length > 0) {
    throw new DraftCleanupError(
      'INVALID_STATE',
      `이미 Run이 있는 Task는 준비 취소할 수 없습니다 (linkedRuns=${before.linkedRuns.length}).`,
    );
  }

  let task: TaskRecord;
  try {
    task = await transitionTaskExecution(dataRoot, project, taskId, {
      expectedExecutionState: 'READY',
      to: 'CANCELLED',
      reason: input.reason?.trim() || 'draft-cleanup:cancel-ready-no-run',
    });
  } catch (err) {
    if (err instanceof RuntimeConflictError) {
      throw new DraftCleanupError('CONFLICT', err.message);
    }
    throw err;
  }

  let goal: GoalRecord | null = null;
  let goalAbandoned = false;
  const abandonEmptyGoal = input.abandonEmptyGoal !== false;
  if (abandonEmptyGoal) {
    const abandoned = maybeAbandonGoalWhenAllTasksCancelled(dataRoot, project, task.goalId);
    goal = abandoned.goal;
    goalAbandoned = abandoned.abandoned;
  } else {
    try {
      goal = getGoal(dataRoot, project, task.goalId);
    } catch {
      goal = null;
    }
  }

  return { task, goal, goalAbandoned };
}

/**
 * If every Task under the Goal is CANCELLED (and at least one exists),
 * transition Goal → ABANDONED via canonical Goal transition.
 */
export function maybeAbandonGoalWhenAllTasksCancelled(
  dataRoot: string,
  project: string,
  goalId: string,
): { goal: GoalRecord | null; abandoned: boolean } {
  let goal: GoalRecord;
  try {
    goal = getGoal(dataRoot, project, goalId);
  } catch {
    return { goal: null, abandoned: false };
  }

  if (goal.status === 'ABANDONED' || goal.status === 'COMPLETED') {
    return { goal, abandoned: false };
  }
  if (!GOAL_ABANDON_FROM.has(goal.status)) {
    return { goal, abandoned: false };
  }

  const tasks = listTasks(dataRoot, project, goalId);
  if (tasks.length === 0) {
    // Goal with zero Tasks after cancel is still abandonable (user cancelled prep).
    // Keep coherent: abandon empty user Goal that has no remaining work.
  } else if (!tasks.every((t) => t.executionState === 'CANCELLED')) {
    return { goal, abandoned: false };
  }

  // Skip technical Inbox Goals — they are shared containers.
  const tags = Array.isArray(goal.tags) ? goal.tags : [];
  if (tags.includes('v1-internal')) {
    return { goal, abandoned: false };
  }

  try {
    goal = transitionGoalStatus(
      dataRoot,
      project,
      goalId,
      'ABANDONED',
      'draft-cleanup:all-tasks-cancelled',
    );
    return { goal, abandoned: true };
  } catch {
    return { goal, abandoned: false };
  }
}
