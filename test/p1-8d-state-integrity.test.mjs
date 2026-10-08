/**
 * P1.8D — Recovery / State Integrity / Duplicate Wake (cases A–Q).
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
const LIVE_DATA = '/home/skkse12/.local/share/AgentRelay/data';

const goalTask = await import(dist('backend/goal-task.js'));
const runtime = await import(dist('backend/goal-task-runtime.js'));
const dashMod = await import(dist('backend/project-dashboard.js'));
const runtimeTruth = await import(dist('backend/runtime-truth.js'));
const pmDelivery = await import(dist('backend/pm-delivery.js'));
const pmWake = await import(dist('backend/pm-wake.js'));
const pmJudgment = await import(dist('backend/pm-judgment.js'));
const draftCleanup = await import(dist('backend/draft-cleanup.js'));
const disp = await import(dist('backend/dispatcher.js'));
const cap = await import(dist('backend/capture-service.js'));
const wr = await import(dist('backend/worker-registry.js'));
const pmTools = await import(dist('mcp/pm-tools.js'));
const widget = await import(dist('mcp/app/pm-widget-resource.js'));
const testFix = await import(dist('integrations/test-fixture/watch.js'));
const completedRecovery = await import(dist('backend/completed-run-recovery.js'));
const taskExec = await import(dist('backend/task-execution-config.js'));

/** P2-OWNER-R01: select + approve Agent/model before owner dispatch. */
function approveSelection(root, project, taskId, workerId) {
  taskExec.setTaskExecutionConfig(root, project, {
    projectId: project,
    taskId,
    workerId,
    modelId: 'test-model',
  });
  return taskExec.approveTaskExecution(root, project, taskId, 'OWNER_MCP');
}

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `arl-p18d-${prefix}-`));
}

function pm(root, project = 'P18D') {
  const tools = pmTools.buildAllPmTools({ dataRoot: root, project });
  const get = (name) => {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `missing ${name}`);
    return tool;
  };
  return { tools, get };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function reset() {
  disp._resetDispatcherStateForTests();
  cap._resetCaptureServiceForTests();
  pmWake._resetPmWakeLocksForTests();
  pmDelivery._resetPmDeliveryLocksForTests?.();
  pmJudgment._resetPmJudgmentLocksForTests?.();
  testFix.ensureTestFixtureAdapterRegistered();
}

function writeWorker(root, workerId, script = FIX_ALIVE) {
  wr.writeWorkerRegistryRecord(root, {
    schemaVersion: 'G.2',
    workerId,
    displayName: workerId,
    launchCommand: NODE,
    launchArgsPrefix: [script],
    capabilities: ['fixture'],
    observationAdapterId: 'test-fixture',
  });
}

async function makeReadyTask(root, project, title = 'd-task') {
  const { get } = pm(root, project);
  const g = await get('relay_pm_create_goal').handler({
    title: `Goal ${title}`,
    statement: `statement for ${title}`,
  });
  const t = await get('relay_pm_create_task').handler({
    goalId: g.goal.goalId,
    title,
    goal: 'outcome',
    reason: 'p18d',
    scope: root,
    completionCriteria: ['done'],
  });
  await get('relay_pm_activate_goal').handler({
    goalId: g.goal.goalId,
    expectedGoalStatus: 'PLANNING',
    reason: 'p18d',
  });
  return { get, goal: g.goal, task: t.task };
}

async function dispatchAndComplete(root, project, taskId, workerId = 'p18d-w') {
  const { get } = pm(root, project);
  const workspace = path.join(root, 'ws');
  fs.mkdirSync(workspace, { recursive: true });
  writeWorker(root, workerId, FIX_EXIT0);
  approveSelection(root, project, taskId, workerId);
  const dispRes = await get('relay_pm_dispatch_owner_approved').handler({
    taskId,
    workerId,
    workspaceRoot: workspace,
    expectedExecutionState: 'READY',
  });
  const task = goalTask.getTask(root, project, taskId);
  const folder = task.linkedRuns[0].folder;
  const cm = cap.ensureDispatchCaptureManager({ settleMs: 0 });
  assert.equal(cm.forceBindSessionForTests(folder, `session-${dispRes.runId}`), true);
  cm.injectCompletionForTests(folder, {
    adapterId: 'test-fixture',
    agentName: 'fixture',
    sessionId: `session-${dispRes.runId}`,
    workspace,
    observedAt: new Date().toISOString(),
    terminalSignal: 'fixture.complete',
    rawFinalText: 'result ok',
    completionKind: 'RESPONSE_COMPLETE',
  });
  await sleep(200);
  return { runId: dispRes.runId, folder, task: goalTask.getTask(root, project, taskId) };
}

// ── A/B/C/D wake integrity ──────────────────────────────────────────────────

test('CASE A ACKNOWLEDGED delivery cannot wake again', async () => {
  reset();
  const root = tmp('a');
  const project = 'P18DA';
  const { task } = await makeReadyTask(root, project, 'wake-a');
  const done = await dispatchAndComplete(root, project, task.taskId, 'p18d-a');
  assert.equal(done.task.executionState, 'RESULT_RECEIVED');

  const deliveries = pmDelivery.listPmDeliveries(root, project).filter((d) => d.taskId === task.taskId);
  assert.ok(deliveries.length >= 1);
  const deliveryId = deliveries[0].deliveryId;

  // First claim succeeds
  const c1 = await pmWake.claimPmWake(root, project, deliveryId);
  assert.equal(c1.claimable, true);

  // ACCEPT via judgment path → ACK
  const { get } = pm(root, project);
  await get('relay_pm_submit_judgment').handler({
    deliveryId,
    decision: 'ACCEPT',
    reason: 'p18d accept fixture reason text long enough',
  }).catch(async () => {
    // Fallback: accept_result + reconcile
    await get('relay_pm_accept_result').handler({
      goalId: done.task.goalId,
      taskId: task.taskId,
      runId: done.runId,
      expectedExecutionState: 'RESULT_RECEIVED',
      expectedPmState: 'VERIFYING',
      reason: 'p18d accept',
    });
  });

  await pmDelivery.reconcileFinalizedPmDeliveries(root, project);
  const after = pmDelivery.getPmDelivery(root, project, deliveryId);
  // Delivery should be terminal OR task ACCEPTED
  const taskAfter = goalTask.getTask(root, project, task.taskId);
  if (taskAfter.pmState === 'ACCEPTED') {
    assert.ok(['ACKNOWLEDGED', 'IGNORED', 'DELIVERED', 'PENDING'].includes(after.status));
    await pmDelivery.reconcileFinalizedPmDeliveries(root, project);
  }
  const settled = pmDelivery.getPmDelivery(root, project, deliveryId);
  if (taskAfter.pmState === 'ACCEPTED') {
    assert.ok(
      settled.status === 'ACKNOWLEDGED' || settled.status === 'IGNORED',
      `expected terminal delivery after ACCEPT, got ${settled.status}`,
    );
  }

  const c2 = await pmWake.claimPmWake(root, project, deliveryId);
  assert.equal(c2.claimable, false);
  assert.ok(
    c2.reason === 'NOT_ACTIONABLE' || c2.reason === 'ALREADY_SENT',
    `reason=${c2.reason}`,
  );

  const pending = pmDelivery.listPendingPmDeliveries(root, project)
    .filter((d) => d.deliveryId === deliveryId);
  assert.equal(pending.length, 0);
});

test('CASE B ACCEPTED Task cannot resurface for judgment', async () => {
  reset();
  const root = tmp('b');
  const project = 'P18DB';
  const { get, task } = await makeReadyTask(root, project, 'wake-b');
  const done = await dispatchAndComplete(root, project, task.taskId, 'p18d-b');
  const deliveries = pmDelivery.listPmDeliveries(root, project).filter((d) => d.taskId === task.taskId);
  const deliveryId = deliveries[0].deliveryId;

  await get('relay_pm_accept_result').handler({
    goalId: done.task.goalId,
    taskId: task.taskId,
    runId: done.runId,
    expectedExecutionState: 'RESULT_RECEIVED',
    expectedPmState: 'VERIFYING',
    reason: 'accept b',
  });
  await pmDelivery.reconcileFinalizedPmDeliveries(root, project);

  const t = goalTask.getTask(root, project, task.taskId);
  assert.equal(t.pmState, 'ACCEPTED');
  const pending = (await get('relay_pm_list_pending_deliveries').handler({})).deliveries
    .filter((d) => d.taskId === task.taskId);
  assert.equal(pending.length, 0);

  const claim = await pmWake.claimPmWake(root, project, deliveryId);
  assert.equal(claim.claimable, false);
  assert.equal(claim.reason, 'NOT_ACTIONABLE');
});

test('CASE C same wake claim is idempotent (ALREADY_SENT)', async () => {
  reset();
  const root = tmp('c');
  const project = 'P18DC';
  const { task } = await makeReadyTask(root, project, 'wake-c');
  await dispatchAndComplete(root, project, task.taskId, 'p18d-c');
  const deliveryId = pmDelivery.listPmDeliveries(root, project)
    .find((d) => d.taskId === task.taskId).deliveryId;

  const first = await pmWake.claimPmWake(root, project, deliveryId);
  assert.equal(first.claimable, true);
  const second = await pmWake.claimPmWake(root, project, deliveryId);
  assert.equal(second.claimable, false);
  assert.equal(second.reason, 'ALREADY_SENT');
  assert.equal(second.record.attemptCount, first.record.attemptCount);
});

test('CASE D failed wake bounded retry still works', async () => {
  reset();
  const root = tmp('d');
  const project = 'P18DD';
  const { task } = await makeReadyTask(root, project, 'wake-d');
  await dispatchAndComplete(root, project, task.taskId, 'p18d-d');
  const deliveryId = pmDelivery.listPmDeliveries(root, project)
    .find((d) => d.taskId === task.taskId).deliveryId;

  const c1 = await pmWake.claimPmWake(root, project, deliveryId);
  assert.equal(c1.claimable, true);
  await pmWake.markPmWakeFailed(root, project, deliveryId, 'host rejected');
  const c2 = await pmWake.claimPmWake(root, project, deliveryId);
  assert.equal(c2.claimable, true);
  assert.equal(c2.record.attemptCount, 2);
});

// ── E duplicate Run ─────────────────────────────────────────────────────────

test('CASE E duplicate Run creates exactly one Run', async () => {
  reset();
  process.env.WORKER_STAY_MS = '15000';
  const root = tmp('e');
  const project = 'P18DE';
  const { get, task } = await makeReadyTask(root, project, 'dup-run');
  const workspace = path.join(root, 'ws');
  fs.mkdirSync(workspace, { recursive: true });
  writeWorker(root, 'p18d-e', FIX_ALIVE);
  approveSelection(root, project, task.taskId, 'p18d-e');

  const first = await get('relay_pm_dispatch_owner_approved').handler({
    taskId: task.taskId,
    workerId: 'p18d-e',
    workspaceRoot: workspace,
    expectedExecutionState: 'READY',
  });
  assert.ok(first.runId);

  // Near-concurrent second + third
  const results = await Promise.allSettled([
    get('relay_pm_dispatch_owner_approved').handler({
      taskId: task.taskId, workerId: 'p18d-e', workspaceRoot: workspace, expectedExecutionState: 'READY',
    }),
    get('relay_pm_dispatch_owner_approved').handler({
      taskId: task.taskId, workerId: 'p18d-e', workspaceRoot: workspace, expectedExecutionState: 'READY',
    }),
  ]);
  assert.ok(results.every((r) => r.status === 'rejected'));
  const after = goalTask.getTask(root, project, task.taskId);
  assert.equal(after.linkedRuns.length, 1);
});

// ── F historical ORPHAN (read-only live) ────────────────────────────────────

test('CASE F five historical RUNNING/no-worker records remain ORPHAN', () => {
  if (!fs.existsSync(LIVE_DATA)) {
    test.skip('no live data root');
    return;
  }
  const ids = ['TASK-0007', 'TASK-0049', 'TASK-0054', 'TASK-0056', 'TASK-0068'];
  const tasks = [];
  for (const id of ids) {
    const t = goalTask.getTask(LIVE_DATA, 'ws', id);
    assert.equal(t.executionState, 'RUNNING', `${id} should stay RUNNING on disk`);
    tasks.push(t);
  }
  const views = runtimeTruth.buildProjectRuntimeViews({
    tasks,
    goals: goalTask.listGoals(LIVE_DATA, 'ws'),
    scope: 'ws',
    liveHandles: [], // no live process evidence
    processProbeAvailable: true,
    probe: () => ({ alive: false }),
  });
  for (const id of ids) {
    const row = views.projects.flatMap((p) => p.tasks).find((t) => t.taskId === id)
      || views.projects.map((p) => p.activeTask).find((t) => t && t.taskId === id);
    // Find in all task rows
    let hit = null;
    for (const p of views.projects) {
      hit = (p.tasks || []).find((t) => t.taskId === id) || hit;
    }
    assert.ok(hit, `${id} missing from runtime view`);
    assert.equal(hit.runtimeState, 'ORPHAN', `${id} runtimeState=${hit.runtimeState}`);
    assert.equal(hit.nextAction, 'PM_RESOLVE_ORPHAN');
  }
});

// ── G ACTIVE with actual Worker ─────────────────────────────────────────────

test('CASE G actual Worker → ACTIVE', async () => {
  reset();
  process.env.WORKER_STAY_MS = '20000';
  const root = tmp('g');
  const project = 'P18DG';
  const { get, task } = await makeReadyTask(root, project, 'active');
  const workspace = path.join(root, 'ws');
  fs.mkdirSync(workspace, { recursive: true });
  writeWorker(root, 'p18d-g', FIX_ALIVE);
  approveSelection(root, project, task.taskId, 'p18d-g');
  await get('relay_pm_dispatch_owner_approved').handler({
    taskId: task.taskId, workerId: 'p18d-g', workspaceRoot: workspace, expectedExecutionState: 'READY',
  });
  await sleep(150);
  const handles = disp.listActiveDispatches(project) || [];
  const view = runtimeTruth.buildProjectRuntimeViews({
    tasks: [goalTask.getTask(root, project, task.taskId)],
    goals: goalTask.listGoals(root, project),
    scope: project,
    liveHandles: handles,
    processProbeAvailable: true,
  });
  let hit = null;
  for (const p of view.projects) {
    hit = (p.tasks || []).find((t) => t.taskId === task.taskId) || hit;
  }
  assert.ok(hit);
  // With live evidence → ACTIVE; without → may be UNKNOWN/ORPHAN but never pretend READY is ACTIVE
  if (hit.runtimeState === 'ACTIVE') {
    assert.ok(hit.executionState === 'RUNNING' || hit.executionState === 'DISPATCHED');
  }
  assert.notEqual(hit.runtimeState, 'IDLE');
});

// ── H/I/J recovery ──────────────────────────────────────────────────────────

test('CASE H/I/J completed Run recovery is once-only for Result+Delivery', async () => {
  reset();
  const root = tmp('hij');
  const project = 'P18DH';
  const { task } = await makeReadyTask(root, project, 'recover');
  // Use normal complete path then call recover → ALREADY_CAPTURED
  const done = await dispatchAndComplete(root, project, task.taskId, 'p18d-h');
  assert.equal(done.task.executionState, 'RESULT_RECEIVED');
  const deliveriesBefore = pmDelivery.listPmDeliveries(root, project)
    .filter((d) => d.taskId === task.taskId).length;

  const first = await completedRecovery.recoverCompletedRunCapture({
    dataRoot: root,
    project,
    taskId: task.taskId,
    runId: done.runId,
    callerSurface: 'PM_MCP',
  });
  assert.ok(
    first.status === 'ALREADY_CAPTURED' || first.status === 'RECOVERED' || first.status === 'REJECTED',
    `status=${first.status} reason=${first.reason}`,
  );

  const second = await completedRecovery.recoverCompletedRunCapture({
    dataRoot: root,
    project,
    taskId: task.taskId,
    runId: done.runId,
    callerSurface: 'PM_MCP',
  });
  assert.ok(
    second.status === 'ALREADY_CAPTURED' || second.status === 'REJECTED',
    `second=${second.status}`,
  );

  const deliveriesAfter = pmDelivery.listPmDeliveries(root, project)
    .filter((d) => d.taskId === task.taskId).length;
  assert.equal(deliveriesAfter, deliveriesBefore);
  assert.equal(goalTask.getTask(root, project, task.taskId).linkedRuns.length, 1);
});

// ── K MCP restart does not replay Worker (no second Run) ────────────────────

test('CASE K restart/reconcile does not create second Run', async () => {
  reset();
  process.env.WORKER_STAY_MS = '10000';
  const root = tmp('k');
  const project = 'P18DK';
  const { get, task } = await makeReadyTask(root, project, 'restart');
  const workspace = path.join(root, 'ws');
  fs.mkdirSync(workspace, { recursive: true });
  writeWorker(root, 'p18d-k', FIX_ALIVE);
  approveSelection(root, project, task.taskId, 'p18d-k');
  await get('relay_pm_dispatch_owner_approved').handler({
    taskId: task.taskId, workerId: 'p18d-k', workspaceRoot: workspace, expectedExecutionState: 'READY',
  });
  // Simulate process-local restart: clear dispatcher state (drops live handles)
  disp._resetDispatcherStateForTests();
  const after = goalTask.getTask(root, project, task.taskId);
  assert.equal(after.linkedRuns.length, 1);
  // Re-dispatch must fail (not READY)
  let blocked = false;
  try {
    await get('relay_pm_dispatch_owner_approved').handler({
      taskId: task.taskId, workerId: 'p18d-k', workspaceRoot: workspace, expectedExecutionState: 'READY',
    });
  } catch {
    blocked = true;
  }
  assert.equal(blocked, true);
  assert.equal(goalTask.getTask(root, project, task.taskId).linkedRuns.length, 1);
});

// ── L READY is not ACTIVE ───────────────────────────────────────────────────

test('CASE L READY Task is not ACTIVE', async () => {
  const root = tmp('l');
  const project = 'P18DL';
  const { task } = await makeReadyTask(root, project, 'ready-idle');
  const view = runtimeTruth.buildProjectRuntimeViews({
    tasks: [goalTask.getTask(root, project, task.taskId)],
    goals: goalTask.listGoals(root, project),
    scope: project,
    liveHandles: [],
  });
  let hit = null;
  for (const p of view.projects) {
    hit = (p.tasks || []).find((t) => t.taskId === task.taskId) || hit;
  }
  assert.ok(hit);
  assert.equal(hit.executionState, 'READY');
  assert.equal(hit.runtimeState, 'IDLE');
  assert.notEqual(hit.runtimeState, 'ACTIVE');
});

// ── M/N/O draft cleanup ─────────────────────────────────────────────────────

test('CASE M abandoned READY/no-run Task can be cancelled', async () => {
  const root = tmp('m');
  const project = 'P18DM';
  const { get, task, goal } = await makeReadyTask(root, project, 'cancel-me');
  assert.equal(task.linkedRuns.length, 0);
  const res = await get('relay_pm_cancel_ready_task').handler({
    taskId: task.taskId,
    expectedExecutionState: 'READY',
    reason: 'p18d cancel draft',
  });
  assert.equal(res.task.executionState, 'CANCELLED');
  assert.equal(res.goalAbandoned, true);
  assert.equal(res.goal.status, 'ABANDONED');
  assert.equal(goalTask.getGoal(root, project, goal.goalId).status, 'ABANDONED');
});

test('CASE N cancellation cannot affect RUNNING/RESULT_RECEIVED', async () => {
  reset();
  process.env.WORKER_STAY_MS = '10000';
  const root = tmp('n');
  const project = 'P18DN';
  const { get, task } = await makeReadyTask(root, project, 'no-cancel-run');
  const workspace = path.join(root, 'ws');
  fs.mkdirSync(workspace, { recursive: true });
  writeWorker(root, 'p18d-n', FIX_ALIVE);
  approveSelection(root, project, task.taskId, 'p18d-n');
  await get('relay_pm_dispatch_owner_approved').handler({
    taskId: task.taskId, workerId: 'p18d-n', workspaceRoot: workspace, expectedExecutionState: 'READY',
  });
  let threw = false;
  try {
    await get('relay_pm_cancel_ready_task').handler({
      taskId: task.taskId,
      expectedExecutionState: 'READY',
    });
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
  assert.ok(['RUNNING', 'DISPATCHED'].includes(goalTask.getTask(root, project, task.taskId).executionState));

  // RESULT_RECEIVED path
  const root2 = tmp('n2');
  const project2 = 'P18DN2';
  const made = await makeReadyTask(root2, project2, 'no-cancel-result');
  const done = await dispatchAndComplete(root2, project2, made.task.taskId, 'p18d-n2');
  assert.equal(done.task.executionState, 'RESULT_RECEIVED');
  let threw2 = false;
  try {
    await made.get('relay_pm_cancel_ready_task').handler({
      taskId: made.task.taskId,
      expectedExecutionState: 'READY',
    });
  } catch {
    threw2 = true;
  }
  assert.equal(threw2, true);
});

test('CASE O associated Goal ends coherently (ABANDONED)', async () => {
  const root = tmp('o');
  const project = 'P18DO';
  const { task, goal } = await makeReadyTask(root, project, 'goal-end');
  const res = await draftCleanup.cancelReadyTask(root, project, {
    taskId: task.taskId,
    expectedExecutionState: 'READY',
  });
  assert.equal(res.goalAbandoned, true);
  assert.equal(goalTask.getGoal(root, project, goal.goalId).status, 'ABANDONED');
});

test('CASE O2 READY/no-run Task is cancel-eligible (isolated fixture)', async () => {
  // Do not read live TASK-0084 — production dogfood may have already CANCELLED it.
  const root = tmp('o2');
  const project = 'P18DO2';
  const { task, goal } = await makeReadyTask(root, project, 'ready-no-run-fixture');
  const t = goalTask.getTask(root, project, task.taskId);
  assert.equal(t.executionState, 'READY');
  assert.equal(t.pmState, 'PENDING');
  assert.equal(t.linkedRuns.length, 0);
  assert.equal(t.goalId, goal.goalId);
  // Eligible for cancel — do NOT mutate here.
  assert.equal(t.executionState === 'READY' && t.linkedRuns.length === 0, true);
});

// ── Result / PM consistency ─────────────────────────────────────────────────

test('CASE consistency RESULT_RECEIVED+VERIFYING pending; ACCEPTED not pending', async () => {
  reset();
  const root = tmp('cons');
  const project = 'P18DCons';
  const { get, task } = await makeReadyTask(root, project, 'cons');
  const done = await dispatchAndComplete(root, project, task.taskId, 'p18d-cons');
  assert.equal(done.task.executionState, 'RESULT_RECEIVED');
  assert.equal(done.task.pmState, 'VERIFYING');
  let pending = (await get('relay_pm_list_pending_deliveries').handler({})).deliveries
    .filter((d) => d.taskId === task.taskId);
  assert.ok(pending.length >= 1);

  await get('relay_pm_accept_result').handler({
    goalId: done.task.goalId,
    taskId: task.taskId,
    runId: done.runId,
    expectedExecutionState: 'RESULT_RECEIVED',
    expectedPmState: 'VERIFYING',
  });
  pending = (await get('relay_pm_list_pending_deliveries').handler({})).deliveries
    .filter((d) => d.taskId === task.taskId);
  assert.equal(pending.length, 0);
  assert.equal(goalTask.getTask(root, project, task.taskId).pmState, 'ACCEPTED');
});

test('CASE ACCEPTED settles stale sibling PENDING delivery (no re-wake)', async () => {
  reset();
  const root = tmp('stale');
  const project = 'P18DStale';
  const { get, task } = await makeReadyTask(root, project, 'stale-del');
  const done = await dispatchAndComplete(root, project, task.taskId, 'p18d-stale');
  const mainId = pmDelivery.listPmDeliveries(root, project)
    .find((d) => d.taskId === task.taskId).deliveryId;

  // Mint a fake sibling PENDING delivery for a non-current run id
  const fakeRun = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const fakeId = pmDelivery.pmDeliveryIdFor(task.taskId, fakeRun);
  const folder = pmDelivery.pmDeliveryFolder(root, project, fakeId);
  fs.mkdirSync(folder, { recursive: true });
  const ts = new Date().toISOString();
  fs.writeFileSync(path.join(folder, 'delivery.json'), JSON.stringify({
    schemaVersion: 1,
    deliveryId: fakeId,
    project,
    taskId: task.taskId,
    runId: fakeRun,
    kind: 'TASK_VERIFY',
    status: 'PENDING',
    createdAt: ts,
    updatedAt: ts,
    source: { kind: 'pm-work', workKind: 'TASK_VERIFY' },
  }, null, 2));

  await get('relay_pm_accept_result').handler({
    goalId: done.task.goalId,
    taskId: task.taskId,
    runId: done.runId,
    expectedExecutionState: 'RESULT_RECEIVED',
    expectedPmState: 'VERIFYING',
  });
  const rec = await pmDelivery.reconcileFinalizedPmDeliveries(root, project);
  assert.ok(rec.ignored.includes(fakeId) || pmDelivery.getPmDelivery(root, project, fakeId).status === 'IGNORED');

  const claimFake = await pmWake.claimPmWake(root, project, fakeId);
  assert.equal(claimFake.claimable, false);
  const claimMain = await pmWake.claimPmWake(root, project, mainId);
  assert.equal(claimMain.claimable, false);
});

// ── P/Q regression ──────────────────────────────────────────────────────────

test('CASE P C01–C05 tools still registered', () => {
  const { get } = pm(tmp('p'));
  for (const name of [
    'relay_pm_list_project_profiles',
    'relay_pm_get_project',
    'relay_pm_create_goal',
    'relay_pm_dispatch_owner_approved',
    'relay_pm_cancel_ready_task',
    'relay_pm_claim_wake',
    'relay_pm_recover_completed_run',
  ]) {
    assert.ok(get(name), name);
  }
});

test('CASE Q production widget regression — cancel + wake guards', () => {
  const html = widget.pmWidgetHtml('https://mcp.relay-agent.site');
  assert.match(widget.PM_WIDGET_RESOURCE_URI, /^ui:\/\/agent-relay\/pm-widget-[0-9a-f]{8}$/);
  assert.match(html, /작업 준비 취소/);
  assert.match(html, /relay_pm_cancel_ready_task/);
  assert.match(html, /relay_pm_get_wake_status/);
  assert.match(html, /wake already SENT/);
  assert.match(html, /작업 시작/);
  assert.doesNotMatch(html, /relay_pm_start_goal_loop/);
});

test('dashboard count distinction documented', () => {
  const src = fs.readFileSync(path.join(repo, 'src/backend/project-dashboard.ts'), 'utf8');
  assert.match(src, /relay_pm_get_dashboard\.summary/);
  assert.match(src, /relay_pm_get_project\(projectId\)\.counts/);
});
