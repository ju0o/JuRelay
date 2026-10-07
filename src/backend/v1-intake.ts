/**
 * V1-G1 — PM MCP Single Task Intake.
 *
 * Task-first V1 surface: GPT PM submits ONE finalized Task Contract and gets
 * ONE canonical Task back, without managing a Goal manually.
 *
 * Project identity (P1.8A):
 *   - The intake owns the canonical project identity. The MCP process still
 *     carries a storage scope (`--project`, historically `ws`), but the Task it
 *     writes names the *product*: projectId + projectName, resolved through
 *     project-identity.ts. A new Task is therefore never filed as project "ws".
 *   - projectId / projectName are optional arguments for a caller that knows the
 *     product (JuIntake, JuCar, Insurance CRM, ...). When omitted, the identity
 *     is resolved from the scope deterministically — see resolveProjectIdentity.
 *
 * Per-project Goal container (P1.8A):
 *   - The Task kernel requires goalId, so every project gets its own
 *     deterministic technical container Goal ("JuIntake V1 Task Inbox",
 *     "JuCar V1 Task Inbox", ...), tagged `project:<projectId>`.
 *   - Reuse is keyed on that project tag, NOT on the shared V1 container marker.
 *     The old rule ("any V1 container in this scope will do") is what let a
 *     JuIntake Task land under a JuCar container; that is exactly the mixing
 *     P1.8A removes.
 *   - Historical containers (written before P1.8A, e.g. the original
 *     "V1 Single-Task Inbox") carry no project tag and are never reused for a new
 *     project and never mutated. New work goes to the project's own container.
 *   - Ensure/reuse stays serialized per (dataRoot, project) through a
 *     process-local Promise chain (`withV1ContainerLock`), so concurrent first
 *     intakes cannot multiply a container.
 *   - The container is ordinary Goal-kernel data (status PLANNING, mode PLAN,
 *     least privilege). No new public Goal UX, no auto-activate, no auto
 *     complete, no permission escalation.
 *
 * State preparation (frozen runtime transition only):
 *   - createTask() persists PLANNED+PENDING. Intake then applies the single
 *     already-frozen canonical transition PLANNED → READY via
 *     transitionTaskExecution (CAS), so the Task is suitable for the next V1
 *     dispatch stage (dispatcher requires READY). No auto-dispatch, no run
 *     linkage, no judgment mutation.
 */

import * as path from 'node:path';
import {
  createGoal,
  createTask,
  listGoals,
} from './goal-task.js';
import { transitionTaskExecution } from './goal-task-runtime.js';
import {
  isProjectContainer,
  loadProjectRegistry,
  projectIdentityTag,
  resolveProjectIdentity,
  type ProjectIdentity,
} from './project-identity.js';
import { assertGoalAcceptsTask, UserGoalError } from './user-goal.js';
import type { GoalRecord, TaskRecord } from '../shared/types.js';

/** Frozen marker identifying the internal V1 technical container. */
export const V1_CONTAINER_TAG = 'v1-internal';
/**
 * Title of the historical (pre-P1.8A) single shared container. Kept exported
 * because callers and tests pinned it. New containers are titled per project
 * (`<projectName> V1 Task Inbox`); this title is never created again.
 */
export const V1_CONTAINER_TITLE = 'V1 Single-Task Inbox (internal technical container)';
/** Suffix of the per-project technical container title (P1.8A). */
export const PROJECT_CONTAINER_TITLE_SUFFIX = 'V1 Task Inbox';
export const V1_CONTAINER_GOAL_STATEMENT =
  'Internal V1 technical container for single-task relay. Not user-facing Goal UX. ' +
  'Exists only because the Task schema requires goalId.';

export interface V1TaskContractInput {
  title: string;
  goal: string;
  reason: string;
  scope: string;
  /** P1.8A — canonical logical project identity (optional; resolved when absent). */
  projectId?: string;
  projectName?: string;
  completionCriteria?: string[];
  /**
   * P1.8C-05 — when provided, create the Task under this existing user Goal.
   * Fail closed if missing / wrong project / disallowed state.
   * When omitted, preserve the technical per-project Inbox container behaviour.
   */
  goalId?: string;
}

export interface V1IntakeResult {
  goal: GoalRecord;
  task: TaskRecord;
  /** The canonical project identity the Task was filed under. */
  project: ProjectIdentity;
  /** True when a pre-existing container was reused; false when just created. */
  containerReused: boolean;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field}이(가) 필요합니다.`);
  }
  return value.trim();
}

function normalizeCriteria(input: unknown): string[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error('completionCriteria는 문자열 배열이어야 합니다.');
  for (let i = 0; i < input.length; i += 1) {
    if (typeof input[i] !== 'string') {
      throw new Error(`completionCriteria[${i}]는 문자열이어야 합니다.`);
    }
  }
  return [...(input as string[])];
}

/** Any technical container marker (kept for diagnostics on historical data). */
function isV1Container(g: GoalRecord): boolean {
  if (g.title === V1_CONTAINER_TITLE) return true;
  return Array.isArray(g.tags) && g.tags.includes(V1_CONTAINER_TAG);
}

/**
 * The container that belongs to THIS project, and only this project.
 *
 * The `project:<projectId>` tag is the whole point of P1.8A Goal isolation: a
 * container is reusable only when it was created for the same product. A
 * historical untagged container is deliberately NOT a match — reusing it is
 * precisely how a JuCar Task ended up in a JuIntake inbox.
 */
function isContainerForProject(g: GoalRecord, identity: ProjectIdentity): boolean {
  return isProjectContainer(g, identity.projectId) && isV1Container(g);
}

/** "JuIntake V1 Task Inbox" — one deterministic technical container per project. */
export function projectContainerTitle(identity: ProjectIdentity): string {
  return `${identity.projectName} ${PROJECT_CONTAINER_TITLE_SUFFIX}`;
}

/**
 * Process-local per-project-identity serialization for container ensure/create.
 *
 * Key = resolved dataRoot + storage scope + logical projectId, so unrelated
 * projects/dataRoots never block each other, and two products inside one storage
 * scope never contend for the same lock. Each key owns an independent Promise
 * chain; every ensure/create runs strictly after the previous one for the same
 * key. The chain tail never rejects (errors are propagated to the caller but
 * swallowed in the stored tail) so one failure cannot wedge later intakes.
 */
const _v1ContainerChains = new Map<string, Promise<void>>();

function v1ScopeKey(dataRoot: string, project: string, projectId: string): string {
  return `${path.resolve(dataRoot)}@@${project}::${projectId}`;
}

function withV1ContainerLock<T>(
  dataRoot: string,
  project: string,
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = v1ScopeKey(dataRoot, project, projectId);
  const prev = _v1ContainerChains.get(key) ?? Promise.resolve();
  const work = prev.then(fn);
  const tail = work.then(
    () => undefined,
    () => undefined,
  );
  _v1ContainerChains.set(key, tail);
  tail.then(() => {
    if (_v1ContainerChains.get(key) === tail) _v1ContainerChains.delete(key);
  });
  return work;
}

/** Test-only reset for the process-local V1 container chains. */
export function _resetV1ContainerLocksForTests(): void {
  _v1ContainerChains.clear();
}

/**
 * Resolve the canonical identity for an intake. Exposed so a caller that knows
 * only the storage scope can ask what identity its Tasks would carry.
 */
export function resolveIntakeProjectIdentity(
  dataRoot: string,
  project: string,
  input: { projectId?: unknown; projectName?: unknown } = {},
): ProjectIdentity {
  return resolveProjectIdentity({
    scope: project,
    projectId: input.projectId,
    projectName: input.projectName,
    registry: loadProjectRegistry(dataRoot),
  });
}

/**
 * Deterministic serialized create/reuse of THIS project's technical container.
 * Reuse rule: lowest sorted goalId among containers tagged for this projectId.
 * No duplicates on repeats, including concurrent first intakes within this
 * process (serialized above).
 *
 * `identity` is optional so pre-P1.8A callers keep working; when omitted it is
 * resolved from the storage scope exactly as intake would resolve it.
 */
export async function ensureV1ContainerGoal(
  dataRoot: string,
  project: string,
  identity?: ProjectIdentity,
): Promise<{ goal: GoalRecord; reused: boolean; project: ProjectIdentity }> {
  const resolved = identity ?? resolveIntakeProjectIdentity(dataRoot, project);
  return withV1ContainerLock(dataRoot, project, resolved.projectId, async () => {
    const existing = listGoals(dataRoot, project)
      .filter((g) => isContainerForProject(g, resolved))
      .sort((a, b) => a.goalId.localeCompare(b.goalId));
    if (existing.length > 0) {
      return { goal: existing[0]!, reused: true, project: resolved };
    }
    const goal = await createGoal(dataRoot, project, {
      title: projectContainerTitle(resolved),
      goalStatement: V1_CONTAINER_GOAL_STATEMENT,
      description:
        `Internal technical container for the ${resolved.projectName} project. ` +
        'Not user-facing Goal UX. Holds every Task of this product and nothing else.',
      tags: [V1_CONTAINER_TAG, 'technical-container', projectIdentityTag(resolved.projectId)],
      projectId: resolved.projectId,
      projectName: resolved.projectName,
      completionCriteria: [],
      // Default permissionPolicy (PLAN, least privilege). No escalation in G1.
    });
    return { goal, reused: false, project: resolved };
  });
}

/**
 * Canonical V1 intake: validate contract → resolve project identity → ensure the
 * project's container → createTask → narrow PLANNED → READY preparation via the
 * frozen runtime transition.
 */
export async function createV1TaskFromContract(
  dataRoot: string,
  project: string,
  input: V1TaskContractInput,
): Promise<V1IntakeResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('잘못된 입력: Task Contract 객체가 필요합니다.');
  }
  const title = requireNonEmptyString(input.title, 'title');
  const goalText = requireNonEmptyString(input.goal, 'goal');
  if (typeof input.reason !== 'string') throw new Error('reason이 필요합니다.');
  if (typeof input.scope !== 'string') throw new Error('scope가 필요합니다.');
  const completionCriteria = normalizeCriteria(input.completionCriteria);

  // Identity first: the container a Task lands under is the project's container,
  // so a mismatch between the Task's identity and its Goal's identity is
  // impossible to express rather than merely discouraged.
  const identity = resolveIntakeProjectIdentity(dataRoot, project, {
    projectId: input.projectId,
    projectName: input.projectName,
  });

  let goal: GoalRecord;
  let reused = false;
  const explicitGoalId = typeof input.goalId === 'string' && input.goalId.trim()
    ? input.goalId.trim()
    : '';

  if (explicitGoalId) {
    // P1.8C-05 — bind to the exact user Goal. Never fall back to Inbox.
    try {
      goal = assertGoalAcceptsTask(dataRoot, project, explicitGoalId, identity.projectId);
    } catch (err) {
      if (err instanceof UserGoalError) throw err;
      throw err;
    }
    reused = true;
  } else {
    const ensured = await ensureV1ContainerGoal(dataRoot, project, identity);
    goal = ensured.goal;
    reused = ensured.reused;
  }

  const created = await createTask(dataRoot, project, {
    goalId: goal.goalId,
    title,
    goal: goalText,
    reason: input.reason,
    scope: input.scope,
    projectId: identity.projectId,
    projectName: identity.projectName,
    completionCriteria,
  });

  // Narrow frozen preparation: PLANNED → READY so V1-G2 dispatch (which
  // requires READY) can proceed. No dependencies → always eligible.
  const ready = await transitionTaskExecution(dataRoot, project, created.taskId, {
    expectedExecutionState: 'PLANNED',
    to: 'READY',
    reason: 'v1-intake:ready-for-dispatch',
  });

  return { goal, task: ready, project: identity, containerReused: reused };
}
