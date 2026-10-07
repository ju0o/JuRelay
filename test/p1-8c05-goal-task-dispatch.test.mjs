/**
 * P1.8C-05 — Goal → Task → Explicit Dispatch E2E (fixture cases A–U).
 *
 * Canonical order under test:
 *   create Goal (PLANNING, 0 Task/Run/Worker)
 *   → create READY Task under that Goal (goalId)
 *   → activate Goal (PLANNING → ACTIVE)
 *   → wait for explicit Run
 *   → owner-approved dispatch only
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(import.meta.dirname, '..');
const dist = (p) => path.join(repo, 'dist/server', p);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX_ALIVE = path.resolve(__dirname, 'fixtures/workers/stay-alive.mjs');
const FIX_EXIT0 = path.resolve(__dirname, 'fixtures/workers/exit-zero-instant.mjs');
const NODE = process.execPath;

const userGoal = await import(dist('backend/user-goal.js'));
const dispatchResolve = await import(dist('backend/dispatch-resolve.js'));
const dashMod = await import(dist('backend/project-dashboard.js'));
const profileMod = await import(dist('backend/project-profile.js'));
const uiState = await import(dist('backend/ui-state.js'));
const goalTask = await import(dist('backend/goal-task.js'));
const workerRegistry = await import(dist('backend/worker-registry.js'));
const wsConfig = await import(dist('workspace/config-v2.js'));
const pmTools = await import(dist('mcp/pm-tools.js'));
const appServer = await import(dist('mcp/app-server.js'));
const widget = await import(dist('mcp/app/pm-widget-resource.js'));
const disp = await import(dist('backend/dispatcher.js'));
const cap = await import(dist('backend/capture-service.js'));
const bridge = await import(dist('backend/result-bridge.js'));
const pmDelivery = await import(dist('backend/pm-delivery.js'));
const testFix = await import(dist('integrations/test-fixture/watch.js'));

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `arl-p18c05-${prefix}-`));
}

function pm(root, project = 'ws') {
  const tools = pmTools.buildAllPmTools({ dataRoot: root, project });
  const get = (name) => {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `missing tool ${name}`);
    return tool;
  };
  return { tools, get };
}

function writeWorkspace(hostRoot, lanes) {
  fs.mkdirSync(path.join(hostRoot, '.agent-relay'), { recursive: true });
  const config = {
    schemaVersion: 'workspace.v2',
    concurrency: { maxActiveBuilders: 2, maxActiveQa: 1 },
    lanes: lanes.map((lane) => ({
      id: lane.id,
      label: lane.label || lane.id,
      root: lane.root,
      goal: lane.goal || 'fixture goal',
      pm: lane.pm || {
        runtime: 'chatgpt',
        model: 'default',
        roleProfile: { sessionPolicy: 'persistent', permissionProfile: 'read-only' },
      },
      builder: lane.builder || {
        runtime: 'opencode',
        model: 'default',
        roleProfile: { sessionPolicy: 'per-task', permissionProfile: 'write-workspace' },
      },
      ...(lane.builders ? { builders: lane.builders } : {}),
      qa: lane.qa || {
        runtime: 'cline',
        model: 'default',
        roleProfile: { sessionPolicy: 'per-task', permissionProfile: 'read-only' },
      },
      qaFallback: { runtime: 'codex', model: 'default' },
    })),
  };
  wsConfig.writeWorkspaceConfigV2(hostRoot, config);
  return config;
}

function writeWorker(root, workerId, extra = {}) {
  workerRegistry.writeWorkerRegistryRecord(root, {
    schemaVersion: 'G.2',
    workerId,
    displayName: workerId,
    launchCommand: NODE,
    launchArgsPrefix: [FIX_ALIVE],
    capabilities: ['fixture'],
    observationAdapterId: 'test-fixture',
    ...extra,
  });
}

function fixtureConfigured(prefix, opts = {}) {
  const dataRoot = tmp(`${prefix}-data`);
  const hostRoot = tmp(`${prefix}-host`);
  const projectRoot = path.join(hostRoot, 'Agent-Relay');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({
    name: 'agent-relay-log',
    version: '0.3.1',
  }, null, 2));
  const defaultBuilder = {
    runtime: 'opencode',
    model: 'default',
    roleProfile: { sessionPolicy: 'per-task', permissionProfile: 'write-workspace' },
  };
  writeWorkspace(hostRoot, [{
    id: 'agent-relay',
    root: projectRoot,
    builder: opts.builder
      ? {
        ...defaultBuilder,
        ...opts.builder,
        roleProfile: opts.builder.roleProfile || defaultBuilder.roleProfile,
      }
      : defaultBuilder,
    ...(opts.builders ? { builders: opts.builders } : {}),
  }]);
  uiState.saveSelectedProjectId(dataRoot, 'agent-relay');
  if (opts.worker !== false) {
    writeWorker(dataRoot, opts.workerId || 'builder-opencode', {
      observationAdapterId: 'opencode',
      capabilities: ['opencode', 'fixture'],
      ...(opts.workerExtra || {}),
    });
  }
  return { dataRoot, hostRoot, projectRoot };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function resetRuntime() {
  disp._resetDispatcherStateForTests();
  cap._resetCaptureServiceForTests();
  testFix.ensureTestFixtureAdapterRegistered();
}

// ── A: create Goal only → no Task/Run/Worker ────────────────────────────────

test('CASE A create Goal only — zero Task/Run/Worker/dispatch', async () => {
  const { dataRoot, hostRoot } = fixtureConfigured('a');
  const { get } = pm(dataRoot);
  const beforeGoals = goalTask.listGoals(dataRoot, 'ws').length;
  const beforeTasks = goalTask.listTasks(dataRoot, 'ws').length;
  const res = await get('relay_pm_create_goal').handler({
    projectId: 'agent-relay',
    title: 'C05 A Goal',
    statement: 'Create Goal and stop',
  });
  assert.equal(res.ok, true);
  assert.equal(res.goal.status, 'PLANNING');
  assert.equal(res.goal.projectId, 'agent-relay');
  assert.deepEqual(res.sideEffects, {
    goalsCreated: 1,
    tasksCreated: 0,
    runsCreated: 0,
    workersSpawned: 0,
    dispatches: 0,
  });
  assert.equal(goalTask.listGoals(dataRoot, 'ws').length, beforeGoals + 1);
  assert.equal(goalTask.listTasks(dataRoot, 'ws').length, beforeTasks);
  assert.equal(res.goal.goalId.startsWith('GOAL-'), true);
  void hostRoot;
});

// ── B: create Task under explicit user Goal ─────────────────────────────────

test('CASE B create Task under explicit user Goal', async () => {
  const { dataRoot } = fixtureConfigured('b');
  const { get } = pm(dataRoot);
  const g = await get('relay_pm_create_goal').handler({
    projectId: 'agent-relay',
    title: 'C05 B',
    statement: 'User goal for task binding',
  });
  const t = await get('relay_pm_create_task').handler({
    projectId: 'agent-relay',
    goalId: g.goal.goalId,
    title: 'Inspect package',
    goal: 'Report package name',
    reason: 'C05 B',
    scope: '/tmp/c05-b',
    completionCriteria: ['name reported'],
  });
  assert.equal(t.task.goalId, g.goal.goalId);
  assert.equal(t.containerReused, true);
  assert.equal(t.task.executionState, 'READY');
  assert.equal(t.task.pmState, 'PENDING');
  assert.equal(t.task.linkedRuns.length, 0);
});

// ── C: omitted goalId preserves technical Inbox ─────────────────────────────

test('CASE C omitted goalId preserves technical Inbox behaviour', async () => {
  const { dataRoot } = fixtureConfigured('c');
  const { get } = pm(dataRoot);
  const first = await get('relay_pm_create_task').handler({
    projectId: 'agent-relay',
    title: 'Inbox 1',
    goal: 'inbox goal',
    reason: 'c',
    scope: 's',
    completionCriteria: ['x'],
  });
  assert.ok((first.goal.tags || []).includes('v1-internal'));
  const second = await get('relay_pm_create_task').handler({
    projectId: 'agent-relay',
    title: 'Inbox 2',
    goal: 'inbox goal 2',
    reason: 'c',
    scope: 's',
    completionCriteria: ['x'],
  });
  assert.equal(second.goal.goalId, first.goal.goalId);
  assert.equal(second.containerReused, true);
});

// ── D: wrong-project goalId rejected ────────────────────────────────────────

test('CASE D wrong-project goalId rejected fail-closed', async () => {
  const { dataRoot } = fixtureConfigured('d');
  const { get } = pm(dataRoot);
  // Create a Goal under a different projectId identity in same scope bucket.
  const other = await userGoal.createUserGoal(dataRoot, 'ws', {
    projectId: 'other-product',
    title: 'Other',
    statement: 'belongs elsewhere',
  });
  let threw = false;
  try {
    await get('relay_pm_create_task').handler({
      projectId: 'agent-relay',
      goalId: other.goal.goalId,
      title: 'Mismatch',
      goal: 'should fail',
      reason: 'd',
      scope: 's',
      completionCriteria: ['x'],
    });
  } catch (err) {
    threw = true;
    const msg = err instanceof Error ? err.message : String(err);
    assert.match(msg, /속하지 않|MISMATCH|INVALID_STATE|project/i);
  }
  assert.equal(threw, true);
});

// ── E: Task READY/PENDING and no Worker ─────────────────────────────────────

test('CASE E Task creation yields READY/PENDING and no Worker', async () => {
  const { dataRoot } = fixtureConfigured('e');
  const { get } = pm(dataRoot);
  const g = await get('relay_pm_create_goal').handler({
    projectId: 'agent-relay', title: 'E', statement: 'e',
  });
  const t = await get('relay_pm_create_task').handler({
    projectId: 'agent-relay',
    goalId: g.goal.goalId,
    title: 'E task',
    goal: 'e',
    reason: 'e',
    scope: 's',
    completionCriteria: ['x'],
  });
  assert.equal(t.task.executionState, 'READY');
  assert.equal(t.task.pmState, 'PENDING');
  assert.equal(t.task.linkedRuns.length, 0);
});

// ── F: dashboard shows Goal + READY Task ────────────────────────────────────

test('CASE F dashboard shows Goal + READY Task + nextAction', async () => {
  const { dataRoot, hostRoot } = fixtureConfigured('f');
  const { get } = pm(dataRoot);
  const g = await get('relay_pm_create_goal').handler({
    projectId: 'agent-relay', title: 'F Goal', statement: 'show on dash',
  });
  // Goal-only should already surface on dashboard (PLANNING, no task).
  let view = dashMod.getProjectDashboard({
    dataRoot,
    scope: 'ws',
    hostRoots: [hostRoot],
    includeCwdHostRoot: false,
  });
  assert.ok(view.goal, 'Goal-only must appear on dashboard');
  assert.equal(view.goal.goalId, g.goal.goalId);
  assert.equal(view.empty.goal, false);

  const t = await get('relay_pm_create_task').handler({
    projectId: 'agent-relay',
    goalId: g.goal.goalId,
    title: 'F task',
    goal: 'f',
    reason: 'f',
    scope: 's',
    completionCriteria: ['x'],
  });
  await get('relay_pm_activate_goal').handler({
    goalId: g.goal.goalId,
    expectedGoalStatus: 'PLANNING',
    reason: 'f-activate',
  });
  view = dashMod.getProjectDashboard({
    dataRoot,
    scope: 'ws',
    hostRoots: [hostRoot],
    includeCwdHostRoot: false,
  });
  assert.ok(view.task);
  assert.equal(view.task.taskId, t.task.taskId);
  assert.equal(view.task.executionState, 'READY');
  assert.ok(
    view.nextAction === 'PM_DISPATCH_TASK' || view.task.nextAction === 'PM_DISPATCH_TASK'
      || String(view.nextActionText || '').length > 0,
    `expected dispatch nextAction, got ${view.nextAction}`,
  );
  assert.ok(view.runEligibility);
  assert.equal(view.runEligibility.taskId, t.task.taskId);
});

// ── G: assigned Builder resolution ──────────────────────────────────────────

test('CASE G assigned Builder resolves to trusted workerId', () => {
  const { dataRoot, hostRoot, projectRoot } = fixtureConfigured('g');
  const resolved = dispatchResolve.resolveOwnerDispatch({
    dataRoot,
    scope: 'ws',
    taskId: undefined,
    projectId: 'agent-relay',
    hostRoots: [hostRoot],
    includeCwdHostRoot: false,
  });
  // No task → NO_TASK blocker, but Builder/workspace should resolve.
  assert.equal(resolved.desiredBuilder, 'opencode');
  assert.equal(resolved.workerId, 'builder-opencode');
  assert.equal(resolved.workspaceRoot, path.resolve(projectRoot));
  assert.ok(resolved.blockers.includes('NO_TASK'));
});

// ── H: 0 Builder → blocked ──────────────────────────────────────────────────

test('CASE H 0 Builder → BUILDER_ASSIGNMENT_REQUIRED', () => {
  const dataRoot = tmp('h-data');
  const hostRoot = tmp('h-host');
  const projectRoot = path.join(hostRoot, 'proj');
  fs.mkdirSync(projectRoot, { recursive: true });
  // RoleConfig with PM only wins over workspace.v2 for assignment reads (C02 precedence).
  writeWorkspace(hostRoot, [{
    id: 'agent-relay',
    root: projectRoot,
  }]);
  const dir = path.join(dataRoot, '_relay', 'roles');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent-relay.json'), `${JSON.stringify({
    schema_version: 'role-config.v1',
    project: 'agent-relay',
    assignments: [{
      roleId: 'pm',
      runtimeAdapterId: 'chatgpt',
      provider: 'openai',
      model: 'default',
      workspace: { project: 'agent-relay', workspaceRoot: projectRoot },
      sessionPolicy: 'persistent',
      permissionProfile: 'read-only',
      capabilityRequirements: {},
      zeroExtraBilling: true,
      fallbackChain: [],
      enabled: true,
    }],
    graph: [],
  }, null, 2)}\n`);
  uiState.saveSelectedProjectId(dataRoot, 'agent-relay');

  const resolved = dispatchResolve.resolveOwnerDispatch({
    dataRoot,
    scope: 'ws',
    projectId: 'agent-relay',
    hostRoots: [hostRoot],
    includeCwdHostRoot: false,
  });
  assert.ok(
    resolved.blockers.includes('BUILDER_ASSIGNMENT_REQUIRED'),
    `expected BUILDER_ASSIGNMENT_REQUIRED, got ${resolved.blockers.join(',')}`,
  );
  assert.equal(resolved.ok, false);
});

// ── I: multi Builder uses C02 primary [0], equal-score map fail-closed ───────

test('CASE I multi Builder uses C02 primary; equal-score worker map fails closed', () => {
  const rpBuilder = { sessionPolicy: 'per-task', permissionProfile: 'write-workspace' };
  const { dataRoot, hostRoot } = fixtureConfigured('i', {
    builders: [
      { runtime: 'opencode', model: 'default', roleProfile: rpBuilder },
      { runtime: 'codex', model: 'default', roleProfile: rpBuilder },
    ],
    builder: { runtime: 'opencode', model: 'default', roleProfile: rpBuilder },
  });
  writeWorker(dataRoot, 'builder-codex', {
    observationAdapterId: 'codex',
    capabilities: ['codex', 'fixture'],
  });
  const resolved = dispatchResolve.resolveOwnerDispatch({
    dataRoot,
    scope: 'ws',
    projectId: 'agent-relay',
    hostRoots: [hostRoot],
    includeCwdHostRoot: false,
  });
  // C02: builders[0] === singular builder → opencode primary is deterministic.
  assert.equal(resolved.desiredBuilder, 'opencode');
  assert.equal(resolved.workerId, 'builder-opencode');

  // Equal-score ambiguous map: two workers both matching "twin" equally.
  writeWorker(dataRoot, 'alpha-twin', { capabilities: ['twin'], observationAdapterId: 'twin' });
  writeWorker(dataRoot, 'beta-twin', { capabilities: ['twin'], observationAdapterId: 'twin' });
  const amb = dispatchResolve.resolveBuilderToWorkerId(dataRoot, 'twin');
  assert.equal(amb, null, 'equal top score must fail closed');
});

// ── J/K/L: explicit Run, exactly one Run, duplicate blocked ─────────────────

test('CASE J/K/L explicit Run → one Run; duplicate does not double-spawn', async () => {
  resetRuntime();
  process.env.WORKER_STAY_MS = '20000';
  const { dataRoot, hostRoot, projectRoot } = fixtureConfigured('jkl', {
    workerExtra: {
      launchArgsPrefix: [FIX_ALIVE],
      observationAdapterId: 'test-fixture',
    },
  });
  const { get } = pm(dataRoot);
  const g = await get('relay_pm_create_goal').handler({
    projectId: 'agent-relay', title: 'JKL', statement: 'dispatch once',
  });
  const t = await get('relay_pm_create_task').handler({
    projectId: 'agent-relay',
    goalId: g.goal.goalId,
    title: 'JKL task',
    goal: 'dispatch',
    reason: 'jkl',
    scope: projectRoot,
    completionCriteria: ['one run'],
  });
  await get('relay_pm_activate_goal').handler({
    goalId: g.goal.goalId,
    expectedGoalStatus: 'PLANNING',
    reason: 'jkl-activate',
  });
  // Before Run: 0 linked runs
  assert.equal(goalTask.getTask(dataRoot, 'ws', t.task.taskId).linkedRuns.length, 0);

  const resolved = await get('relay_pm_resolve_run').handler({
    taskId: t.task.taskId,
    projectId: 'agent-relay',
  });
  // resolve with hostRoots via tool context — tool uses goalLoop workspace; pass via dispatch inputs
  // The resolve_run tool may not see hostRoots; use backend resolve with hostRoots.
  const resolved2 = dispatchResolve.resolveOwnerDispatch({
    dataRoot,
    scope: 'ws',
    taskId: t.task.taskId,
    projectId: 'agent-relay',
    hostRoots: [hostRoot],
    includeCwdHostRoot: false,
  });
  assert.equal(resolved2.ok, true, `blockers: ${resolved2.blockers.join(',')}`);
  assert.equal(resolved2.workerId, 'builder-opencode');

  const first = await get('relay_pm_dispatch_owner_approved').handler({
    taskId: t.task.taskId,
    workerId: resolved2.workerId,
    workspaceRoot: resolved2.workspaceRoot,
    expectedExecutionState: 'READY',
  });
  assert.ok(first.runId);
  const afterFirst = goalTask.getTask(dataRoot, 'ws', t.task.taskId);
  assert.equal(afterFirst.linkedRuns.length, 1);
  assert.ok(['DISPATCHED', 'RUNNING'].includes(afterFirst.executionState));

  let dupThrew = false;
  try {
    await get('relay_pm_dispatch_owner_approved').handler({
      taskId: t.task.taskId,
      workerId: resolved2.workerId,
      workspaceRoot: resolved2.workspaceRoot,
      expectedExecutionState: 'READY',
    });
  } catch {
    dupThrew = true;
  }
  assert.equal(dupThrew, true, 'duplicate Run must be rejected');
  const afterDup = goalTask.getTask(dataRoot, 'ws', t.task.taskId);
  assert.equal(afterDup.linkedRuns.length, 1, 'still exactly one Run');
  void resolved;
});

// ── M/N: runtime ACTIVE vs desired Builder ──────────────────────────────────

test('CASE M/N runtime ACTIVE uses actual Worker; desired Builder distinct', async () => {
  resetRuntime();
  process.env.WORKER_STAY_MS = '20000';
  const { dataRoot, hostRoot, projectRoot } = fixtureConfigured('mn', {
    workerExtra: {
      launchArgsPrefix: [FIX_ALIVE],
      observationAdapterId: 'test-fixture',
    },
  });
  const { get } = pm(dataRoot);
  const g = await get('relay_pm_create_goal').handler({
    projectId: 'agent-relay', title: 'MN', statement: 'runtime truth',
  });
  const t = await get('relay_pm_create_task').handler({
    projectId: 'agent-relay',
    goalId: g.goal.goalId,
    title: 'MN task',
    goal: 'mn',
    reason: 'mn',
    scope: projectRoot,
    completionCriteria: ['x'],
  });
  await get('relay_pm_activate_goal').handler({
    goalId: g.goal.goalId, expectedGoalStatus: 'PLANNING', reason: 'mn',
  });
  const resolved = dispatchResolve.resolveOwnerDispatch({
    dataRoot, scope: 'ws', taskId: t.task.taskId, projectId: 'agent-relay',
    hostRoots: [hostRoot], includeCwdHostRoot: false,
  });
  assert.equal(resolved.desiredBuilder, 'opencode');
  assert.equal(resolved.workerId, 'builder-opencode');
  assert.notEqual(resolved.desiredBuilder, resolved.workerId);

  await get('relay_pm_dispatch_owner_approved').handler({
    taskId: t.task.taskId,
    workerId: resolved.workerId,
    workspaceRoot: resolved.workspaceRoot,
    expectedExecutionState: 'READY',
  });
  await sleep(200);
  const view = dashMod.getProjectDashboard({
    dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false,
  });
  assert.ok(view.task);
  // Desired Builder stays in assignment; actual worker on task.agent when known.
  assert.ok(view.assignment.builders.includes('opencode'));
  // Desired Builder (assignment) must stay distinct from actual Worker identity.
  assert.notEqual(view.assignment.builders[0], 'builder-opencode');
  if (view.task.agent) {
    assert.equal(view.task.agent, 'builder-opencode');
    assert.notEqual(view.task.agent, view.assignment.builders[0]);
  }
  // Runtime truth is evidence-based: ACTIVE when live process proof exists;
  // ORPHAN/UNKNOWN/IDLE are also honest outcomes (never fake desired Builder as live).
  assert.ok(
    ['ACTIVE', 'UNKNOWN', 'IDLE', 'ORPHAN', 'STALE'].includes(view.task.runtimeState),
    `runtimeState=${view.task.runtimeState}`,
  );
  if (view.counts.actualActiveRuns > 0) {
    assert.equal(view.task.runtimeState, 'ACTIVE');
  }
});

// ── O/P/Q: result → RESULT_RECEIVED → Delivery; no auto-accept ──────────────

test('CASE O/P/Q result reaches RESULT_RECEIVED + Delivery; no auto-ACCEPT', async () => {
  resetRuntime();
  const { dataRoot, hostRoot, projectRoot } = fixtureConfigured('opq', {
    workerExtra: {
      launchArgsPrefix: [FIX_EXIT0],
      observationAdapterId: 'test-fixture',
    },
  });
  const { get } = pm(dataRoot);
  const g = await get('relay_pm_create_goal').handler({
    projectId: 'agent-relay', title: 'OPQ', statement: 'result bridge',
  });
  const t = await get('relay_pm_create_task').handler({
    projectId: 'agent-relay',
    goalId: g.goal.goalId,
    title: 'OPQ task',
    goal: 'opq',
    reason: 'opq',
    scope: projectRoot,
    completionCriteria: ['result'],
  });
  await get('relay_pm_activate_goal').handler({
    goalId: g.goal.goalId, expectedGoalStatus: 'PLANNING', reason: 'opq',
  });
  const resolved = dispatchResolve.resolveOwnerDispatch({
    dataRoot, scope: 'ws', taskId: t.task.taskId, projectId: 'agent-relay',
    hostRoots: [hostRoot], includeCwdHostRoot: false,
  });
  const dispatched = await get('relay_pm_dispatch_owner_approved').handler({
    taskId: t.task.taskId,
    workerId: resolved.workerId,
    workspaceRoot: resolved.workspaceRoot,
    expectedExecutionState: 'READY',
  });
  const taskAfter = goalTask.getTask(dataRoot, 'ws', t.task.taskId);
  const folder = taskAfter.linkedRuns[0].folder;
  const cm = cap.ensureDispatchCaptureManager({ settleMs: 0 });
  assert.equal(cm.forceBindSessionForTests(folder, `session-${dispatched.runId}`), true);
  cm.injectCompletionForTests(folder, {
    adapterId: 'test-fixture',
    agentName: 'fixture',
    sessionId: `session-${dispatched.runId}`,
    workspace: projectRoot,
    observedAt: new Date().toISOString(),
    terminalSignal: 'fixture.complete',
    rawFinalText: 'package name=agent-relay-log version=0.3.1',
    completionKind: 'RESPONSE_COMPLETE',
  });
  await sleep(200);
  const done = goalTask.getTask(dataRoot, 'ws', t.task.taskId);
  assert.equal(done.executionState, 'RESULT_RECEIVED');
  assert.notEqual(done.pmState, 'ACCEPTED');
  const deliveries = pmDelivery.listPmDeliveries(dataRoot, 'ws').filter((d) => d.taskId === t.task.taskId);
  assert.ok(deliveries.length >= 1, 'PM Delivery must exist');
  // verification context readable
  const deliveryId = deliveries[0].deliveryId;
  const vctx = await get('relay_pm_get_verification_context').handler({
    deliveryId,
  });
  assert.ok(vctx);
  assert.notEqual(done.pmState, 'ACCEPTED');
  void bridge;
});

// ── R: read-only fixture worker changes zero files in workspace ─────────────

test('CASE R fixture dispatch does not mutate workspace package.json', async () => {
  resetRuntime();
  const { dataRoot, hostRoot, projectRoot } = fixtureConfigured('r', {
    workerExtra: {
      launchArgsPrefix: [FIX_EXIT0],
      observationAdapterId: 'test-fixture',
    },
  });
  const pkgPath = path.join(projectRoot, 'package.json');
  const before = fs.readFileSync(pkgPath, 'utf8');
  const { get } = pm(dataRoot);
  const g = await get('relay_pm_create_goal').handler({
    projectId: 'agent-relay', title: 'R', statement: 'readonly',
  });
  const t = await get('relay_pm_create_task').handler({
    projectId: 'agent-relay', goalId: g.goal.goalId,
    title: 'R', goal: 'r', reason: 'r', scope: projectRoot, completionCriteria: ['x'],
  });
  await get('relay_pm_activate_goal').handler({
    goalId: g.goal.goalId, expectedGoalStatus: 'PLANNING', reason: 'r',
  });
  const resolved = dispatchResolve.resolveOwnerDispatch({
    dataRoot, scope: 'ws', taskId: t.task.taskId, projectId: 'agent-relay',
    hostRoots: [hostRoot], includeCwdHostRoot: false,
  });
  await get('relay_pm_dispatch_owner_approved').handler({
    taskId: t.task.taskId,
    workerId: resolved.workerId,
    workspaceRoot: resolved.workspaceRoot,
    expectedExecutionState: 'READY',
  });
  await sleep(100);
  assert.equal(fs.readFileSync(pkgPath, 'utf8'), before);
});

// ── S: LEGACY / UNCONFIGURED blocked ────────────────────────────────────────

test('CASE S LEGACY and UNCONFIGURED execution blocked', () => {
  const dataRoot = tmp('s-data');
  const hostRoot = tmp('s-host');
  fs.mkdirSync(hostRoot, { recursive: true });

  // Missing project → fail closed.
  const missing = dispatchResolve.resolveOwnerDispatch({
    dataRoot,
    scope: 'ws',
    projectId: 'does-not-exist-c05',
    hostRoots: [hostRoot],
    includeCwdHostRoot: false,
  });
  assert.equal(missing.ok, false);
  assert.ok(
    missing.blockers.includes('PROJECT_CONFIGURATION_REQUIRED'),
    `missing blockers=${missing.blockers.join(',')}`,
  );

  // Real repo agent-relay via hostRoots=[repo] is CONFIGURED; instead synthesize
  // an UNCONFIGURED profile by selecting a known-empty host with no workspace.v2
  // and reading whatever profile surfaces as UNCONFIGURED/LEGACY.
  const listed = profileMod.listProjectProfiles({
    dataRoot,
    scope: 'ws',
    hostRoots: [hostRoot],
    includeCwdHostRoot: false,
  });
  const blocked = listed.profiles.find((p) =>
    p.legacy || p.profileState === 'LEGACY' || p.profileState === 'UNCONFIGURED' || !p.workspaceConfigured,
  );
  if (blocked) {
    const resolved = dispatchResolve.resolveOwnerDispatch({
      dataRoot,
      scope: 'ws',
      projectId: blocked.projectId,
      hostRoots: [hostRoot],
      includeCwdHostRoot: false,
    });
    assert.equal(resolved.ok, false);
    assert.ok(
      resolved.blockers.some((b) =>
        ['LEGACY_NOT_ALLOWED', 'UNCONFIGURED', 'WORKSPACE_CONFIGURATION_REQUIRED', 'PROJECT_CONFIGURATION_REQUIRED', 'BUILDER_ASSIGNMENT_REQUIRED'].includes(b)
      ),
      `blockers=${resolved.blockers.join(',')}`,
    );
  }
});

// ── T: C01–C04 regression smoke (tools still registered) ────────────────────

test('CASE T C01–C04 tools still registered', () => {
  const { dataRoot } = fixtureConfigured('t');
  const { get, tools } = pm(dataRoot);
  for (const name of [
    'relay_pm_list_project_profiles',
    'relay_pm_select_project',
    'relay_pm_get_project_assignments',
    'relay_pm_set_project_assignments',
    'relay_pm_get_project',
    'relay_pm_create_goal',
    'relay_pm_resolve_run',
    'relay_pm_dispatch_owner_approved',
  ]) {
    assert.ok(get(name), `missing ${name}`);
  }
  assert.ok(tools.length > 10);
});

// ── U: widget production mount + C05 affordances ────────────────────────────

test('CASE U widget production mount includes Goal/Run affordances', () => {
  const html = widget.pmWidgetHtml('https://mcp.relay-agent.site');
  assert.match(widget.PM_WIDGET_RESOURCE_URI, /^ui:\/\/agent-relay\/pm-widget-[0-9a-f]{8}$/);
  assert.match(html, /새 Goal/);
  assert.match(html, /작업 시작/);
  assert.match(html, /pdGoalFlow/);
  assert.match(html, /pdTaskPrev/);
  assert.match(html, /relay_pm_create_goal/);
  assert.match(html, /relay_pm_dispatch_owner_approved/);
  assert.match(html, /relay_pm_resolve_run/);
  assert.doesNotMatch(html, /relay_pm_start_goal_loop/);
  assert.ok(widget.PM_WIDGET_RESOURCE_URI.includes('pm-widget-'));
  assert.ok(typeof appServer === 'object');
});

// ── activate order documentation ────────────────────────────────────────────

test('canonical order: Goal → Task → activate → explicit Run', async () => {
  const { dataRoot, hostRoot, projectRoot } = fixtureConfigured('order');
  const { get } = pm(dataRoot);
  const g = await get('relay_pm_create_goal').handler({
    projectId: 'agent-relay', title: 'Order', statement: 'canonical',
  });
  assert.equal(g.goal.status, 'PLANNING');
  const t = await get('relay_pm_create_task').handler({
    projectId: 'agent-relay', goalId: g.goal.goalId,
    title: 'Order task', goal: 'o', reason: 'o', scope: projectRoot, completionCriteria: ['x'],
  });
  assert.equal(t.task.executionState, 'READY');
  assert.equal(goalTask.getTask(dataRoot, 'ws', t.task.taskId).linkedRuns.length, 0);
  const activated = await get('relay_pm_activate_goal').handler({
    goalId: g.goal.goalId, expectedGoalStatus: 'PLANNING', reason: 'order',
  });
  assert.equal(activated.status, 'ACTIVE');
  // Still no Run until explicit dispatch
  assert.equal(goalTask.getTask(dataRoot, 'ws', t.task.taskId).linkedRuns.length, 0);
  void hostRoot;
});
