/**
 * P1.8C-05 — User Goal creation (create and stop).
 *
 * Thin wrapper over goal-task.createGoal. Never creates Tasks/Runs/Workers.
 * Initial status is always PLANNING unless the caller explicitly passes a
 * validated status (MCP surface locks PLANNING).
 */
import { createGoal, getGoal, type GoalCreateInput } from './goal-task.js';
import {
  loadProjectRegistry,
  normalizeProjectId,
  resolveProjectIdentity,
  type ProjectIdentity,
} from './project-identity.js';
import type { GoalRecord } from '../shared/types.js';

export interface CreateUserGoalInput {
  title: string;
  statement: string;
  projectId?: string;
  projectName?: string;
  description?: string;
  completionCriteria?: string[];
}

export interface CreateUserGoalResult {
  ok: true;
  goal: GoalRecord;
  project: ProjectIdentity;
  sideEffects: {
    goalsCreated: 1;
    tasksCreated: 0;
    runsCreated: 0;
    workersSpawned: 0;
    dispatches: 0;
  };
}

export class UserGoalError extends Error {
  readonly code:
    | 'INVALID_ARGUMENT'
    | 'NOT_FOUND'
    | 'GOAL_PROJECT_MISMATCH'
    | 'GOAL_STATE_NOT_ALLOWED';
  constructor(
    code: UserGoalError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'UserGoalError';
    this.code = code;
  }
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new UserGoalError('INVALID_ARGUMENT', `${field}이(가) 필요합니다.`);
  }
  return value.trim();
}

export async function createUserGoal(
  dataRoot: string,
  scope: string,
  input: CreateUserGoalInput,
): Promise<CreateUserGoalResult> {
  const title = requireText(input?.title, 'title');
  const statement = requireText(input?.statement, 'statement');
  const identity = resolveProjectIdentity({
    scope,
    projectId: input.projectId,
    projectName: input.projectName,
    registry: loadProjectRegistry(dataRoot),
  });

  const createInput: GoalCreateInput = {
    title,
    goalStatement: statement,
    projectId: identity.projectId,
    projectName: identity.projectName,
    status: 'PLANNING',
    completionCriteria: Array.isArray(input.completionCriteria)
      ? input.completionCriteria.filter((x) => typeof x === 'string')
      : [],
    ...(typeof input.description === 'string' ? { description: input.description } : {}),
  };

  const goal = await createGoal(dataRoot, scope, createInput);
  return {
    ok: true,
    goal,
    project: identity,
    sideEffects: {
      goalsCreated: 1,
      tasksCreated: 0,
      runsCreated: 0,
      workersSpawned: 0,
      dispatches: 0,
    },
  };
}

/** Allowed Goal statuses for attaching a user Task. */
export const GOAL_STATES_ALLOWING_TASK = new Set(['PLANNING', 'ACTIVE'] as const);

/**
 * Validate that an existing Goal can receive a Task for the given project.
 * Fail closed on mismatch / missing / disallowed state.
 */
export function assertGoalAcceptsTask(
  dataRoot: string,
  scope: string,
  goalId: string,
  expectedProjectId: string,
): GoalRecord {
  const id = requireText(goalId, 'goalId');
  let goal: GoalRecord;
  try {
    goal = getGoal(dataRoot, scope, id);
  } catch {
    throw new UserGoalError('NOT_FOUND', `Goal '${id}' 찾을 수 없습니다.`);
  }

  const expected = normalizeProjectId(expectedProjectId);
  const goalProjectId = typeof goal.projectId === 'string' && goal.projectId.trim()
    ? normalizeProjectId(goal.projectId)
    : null;

  if (!goalProjectId || goalProjectId !== expected) {
    throw new UserGoalError(
      'GOAL_PROJECT_MISMATCH',
      `Goal '${id}'는 프로젝트 '${expected}'에 속하지 않습니다` +
        (goalProjectId ? ` (found '${goalProjectId}')` : ' (projectId 없음)'),
    );
  }

  if (!GOAL_STATES_ALLOWING_TASK.has(goal.status as 'PLANNING' | 'ACTIVE')) {
    throw new UserGoalError(
      'GOAL_STATE_NOT_ALLOWED',
      `Goal '${id}' 상태 ${goal.status}에서는 Task를 만들 수 없습니다.`,
    );
  }

  return goal;
}
