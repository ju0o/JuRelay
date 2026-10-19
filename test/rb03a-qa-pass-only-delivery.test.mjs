/**
 * RB-03A — QA PASS-only PM Delivery and Incident separation.
 * Uses an isolated temp data root and fixture workers only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-rb03a-'));
const project = 'RB03A';
const NODE = process.execPath;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXIT_ZERO = path.resolve(__dirname, 'fixtures/workers/exit-zero-instant.mjs');

const gt = await import('../dist/server/backend/goal-task.js');
const gtr = await import('../dist/server/backend/goal-task-runtime.js');
const qa = await import('../dist/server/backend/qa-attempt.js');
const gate = await import('../dist/server/backend/qa-gate.js');
const disp = await import('../dist/server/backend/dispatcher.js');
const wr = await import('../dist/server/backend/worker-registry.js');
const pmDel = await import('../dist/server/backend/pm-delivery.js');
const incidents = await import('../dist/server/backend/incident.js');
const events = await import('../dist/server/backend/event.js');
const actions = await import('../dist/server/backend/task-actions.js');
const observation = await import('../dist/server/backend/observation-lock.js');
const fsKernel = await import('../dist/server/backend/fs.js');
const testFix = await import('../dist/server/integrations/test-fixture/watch.js');
testFix.ensureTestFixtureAdapterRegistered();

wr.writeWorkerRegistryRecord(ROOT, {
  schemaVersion: 'G.2', workerId: 'rb03a-worker', displayName: 'rb03a fixture',
  launchCommand: NODE, launchArgsPrefix: [EXIT_ZERO],
  capabilities: ['fixture'], observationAdapterId: 'test-fixture',
});

let seq = 0;
const goal = await gt.createGoal(ROOT, project, { title: 'RB03A', goalStatement: 'PASS-only delivery' });

function deliveries(taskId) {
  return pmDel.listPmDeliveries(ROOT, project).filter((d) => d.taskId === taskId);
}
function incidentRows(taskId, code) {
  return incidents.listIncidents(ROOT, project).filter((i) => i.taskId === taskId && (!code || i.code === code));
}

async function makeTask({ qaContract = true, executionState = 'RUNNING' } = {}) {
  const fields = {
    goalId: goal.goalId, title: 'RB03A task', goal: 'fixture', reason: 'fixture', scope: 'authorized file: out.txt',
    completionCriteria: ['done'], executionState, pmState: 'PENDING',
  };
  if (qaContract) {
    fields.acceptanceCriteria = [{ id: 'AC-01', description: 'out.txt exists', validationMode: 'DETERMINISTIC' }];
    fields.qaContract = { deterministic: [{ kind: 'fileExists', path: 'out.txt', criterionId: 'AC-01' }] };
  }
  return gt.createTask(ROOT, project, fields);
}

async function linkRun(taskId, { files = {}, resultText = 'result' } = {}) {
  seq += 1;
  const workspaceRoot = path.join(ROOT, 'ws', `t-${seq}`);
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const folder = path.join(ROOT, project, '_fixture-runs', `run-${seq}`);
  fs.mkdirSync(folder, { recursive: true });
  const runId = `rb03a-run-${seq}`;
  fs.writeFileSync(path.join(folder, 'meta.json'), JSON.stringify({ tags: [], runId, workspaceRoot, workerId: 'rb03a-worker' }));
  await gt.linkRunToTask(ROOT, project, taskId, folder);
  fs.mkdirSync(path.join(folder, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'evidence', 'adapter.json'), '{}');
  fs.writeFileSync(path.join(folder, 'result.md'), resultText);
  for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(workspaceRoot, rel), content);
  return { runId, folder, workspaceRoot };
}

async function receive(taskId, runId) {
  return gtr.markQaResultReceived(ROOT, project, taskId, runId);
}

function release(taskId, runId, workspaceRoot) {
  observation.releaseObservationLockByBinding({ observationAdapterId: 'test-fixture', workspaceRoot, taskId, runId });
}

async function finishCurrent(taskId, files = {}) {
  const t = gt.getTask(ROOT, project, taskId);
  const latest = [...t.linkedRuns].sort((a, b) => b.taskRunSequence - a.taskRunSequence)[0];
  const meta = fsKernel.readRunMeta(latest.folder);
  fs.mkdirSync(path.join(latest.folder, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(latest.folder, 'evidence', 'adapter.json'), '{}');
  fs.writeFileSync(path.join(latest.folder, 'result.md'), 'again');
  for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(meta.workspaceRoot, rel), content);
  release(taskId, latest.runId, meta.workspaceRoot);
  await receive(taskId, latest.runId);
  const res = await gate.reconcileQaGate(ROOT, project, taskId);
  const start = Date.now();
  for (;;) {
    const st = await disp.getDispatchStatus(ROOT, project, taskId);
    if (!st.active) break;
    if (Date.now() - start > 15000) throw new Error('dispatch did not clear');
    await new Promise((r) => setTimeout(r, 40));
  }
  return res;
}

test('QA PASS mints one TASK_VERIFY and a replay does not mint another', async () => {
  const task = await makeTask();
  const run = await linkRun(task.taskId, { files: { 'out.txt': 'ok' } });
  await receive(task.taskId, run.runId);
  const first = await gate.reconcileQaGate(ROOT, project, task.taskId);
  assert.equal(first.outcome, 'PASS_DELIVERED');
  const after = gt.getTask(ROOT, project, task.taskId);
  assert.equal(after.executionState, 'RESULT_RECEIVED');
  assert.equal(after.pmState, 'VERIFYING');
  assert.equal(after.pmState === 'ACCEPTED', false);
  const rows = deliveries(task.taskId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'TASK_VERIFY');
  assert.equal(rows[0].runId, run.runId);
  const second = await gate.reconcileQaGate(ROOT, project, task.taskId);
  assert.equal(second.outcome, 'PASS_DELIVERED');
  assert.equal(second.deliveryId, first.deliveryId);
  assert.equal(deliveries(task.taskId).length, 1);
  assert.equal(incidentRows(task.taskId).length, 0);
});

test('in-budget QA FAIL reworks the same Task and mints no Delivery', async () => {
  const task = await makeTask();
  const run = await linkRun(task.taskId);
  await receive(task.taskId, run.runId);
  const first = await finishCurrent(task.taskId);
  assert.equal(first.outcome, 'FAIL_REMEDIATION_DISPATCHED');
  const mid = gt.getTask(ROOT, project, task.taskId);
  assert.equal(mid.taskId, task.taskId);
  assert.equal(mid.linkedRuns.length, 2);
  assert.equal(deliveries(task.taskId).length, 0);
  const second = await finishCurrent(task.taskId);
  assert.equal(second.outcome, 'FAIL_REMEDIATION_DISPATCHED');
  assert.equal(gt.getTask(ROOT, project, task.taskId).linkedRuns.length, 3);
  assert.equal(deliveries(task.taskId).length, 0);
  assert.equal(incidentRows(task.taskId, 'QA_BUDGET_EXHAUSTED').length, 0);
});

test('QA budget exhaustion records one Incident and no new Worker Run', async () => {
  const task = await makeTask();
  const run = await linkRun(task.taskId);
  await receive(task.taskId, run.runId);
  await finishCurrent(task.taskId);
  await finishCurrent(task.taskId);
  const third = await finishCurrent(task.taskId);
  assert.equal(third.outcome, 'FAIL_ESCALATED_BUDGET_EXHAUSTED');
  const t = gt.getTask(ROOT, project, task.taskId);
  assert.equal(t.linkedRuns.length, 3);
  assert.equal(t.pmState, 'PENDING');
  assert.equal(deliveries(task.taskId).length, 0);
  const rows = incidentRows(task.taskId, 'QA_BUDGET_EXHAUSTED');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'OPEN');
  assert.equal(rows[0].source, 'qa-gate');
  assert.equal(JSON.stringify(rows[0]).includes('secret'), false);
  const again = await gate.reconcileQaGate(ROOT, project, task.taskId);
  assert.equal(again.incidentId, third.incidentId);
  assert.equal(gt.getTask(ROOT, project, task.taskId).linkedRuns.length, 3);
  assert.equal(incidentRows(task.taskId, 'QA_BUDGET_EXHAUSTED').length, 1);
  assert.equal(deliveries(task.taskId).length, 0);
});

test('QA BLOCKED records one Incident and no ordinary Delivery', async () => {
  const task = await gt.createTask(ROOT, project, {
    goalId: goal.goalId, title: 'blocked', goal: 'fixture', reason: 'fixture', scope: 'authorized file: out.txt',
    completionCriteria: ['done'], executionState: 'RUNNING', pmState: 'PENDING',
    acceptanceCriteria: [{ id: 'AC-01', description: 'probe', validationMode: 'DETERMINISTIC' }],
    qaContract: { deterministic: [{ kind: 'command', command: 'definitely-not-a-real-binary-xyz', args: [], criterionId: 'AC-01' }] },
  });
  const run = await linkRun(task.taskId);
  await receive(task.taskId, run.runId);
  const res = await gate.reconcileQaGate(ROOT, project, task.taskId);
  assert.equal(res.outcome, 'BLOCKED_ESCALATED');
  const t = gt.getTask(ROOT, project, task.taskId);
  assert.equal(t.pmState, 'PENDING');
  assert.equal(t.linkedRuns.length, 1);
  assert.equal(deliveries(task.taskId).length, 0);
  assert.equal(incidentRows(task.taskId, 'QA_BLOCKED').length, 1);
  const again = await gate.reconcileQaGate(ROOT, project, task.taskId);
  assert.equal(again.incidentId, res.incidentId);
  assert.equal(incidentRows(task.taskId, 'QA_BLOCKED').length, 1);
});

test('a corrupt QA attempt fails closed with no Delivery and no new Run', async () => {
  const task = await makeTask();
  const run = await linkRun(task.taskId, { files: { 'out.txt': 'ok' } });
  await receive(task.taskId, run.runId);
  const qaAttemptId = qa.qaAttemptIdFor(task.taskId, run.runId);
  const folder = qa.qaAttemptFolder(ROOT, project, qaAttemptId);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'qa.json'), '{');
  await assert.rejects(() => gate.reconcileQaGate(ROOT, project, task.taskId), (err) => err?.code === 'CORRUPT_RECORD');
  const t = gt.getTask(ROOT, project, task.taskId);
  assert.equal(t.pmState, 'PENDING');
  assert.equal(t.linkedRuns.length, 1);
  assert.equal(deliveries(task.taskId).length, 0);
  assert.equal(incidentRows(task.taskId).length, 0);
});

test('a damaged QA contract records one Incident and no Delivery', async () => {
  const task = await makeTask();
  const run = await linkRun(task.taskId);
  await receive(task.taskId, run.runId);
  const file = path.join(gt.taskFolder(ROOT, project, task.taskId), 'task.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.qaContract.deterministic[0].kind = 'teleport';
  fs.writeFileSync(file, JSON.stringify(raw));
  await assert.rejects(() => gate.reconcileQaGate(ROOT, project, task.taskId));
  assert.equal(deliveries(task.taskId).length, 0);
  const rows = incidentRows(task.taskId, 'QA_CONTRACT_INVALID');
  assert.equal(rows.length, 1);
  await assert.rejects(() => gate.reconcileQaGate(ROOT, project, task.taskId));
  assert.equal(incidentRows(task.taskId, 'QA_CONTRACT_INVALID').length, 1);
});

test('legacy no-contract promotion still mints one Delivery', async () => {
  const task = await makeTask({ qaContract: false });
  const run = await linkRun(task.taskId);
  await gtr.markResultReceived(ROOT, project, task.taskId, run.runId, { expectedExecutionState: 'RUNNING' });
  const t = gt.getTask(ROOT, project, task.taskId);
  assert.equal(t.pmState, 'VERIFYING');
  const delivery = await pmDel.ensurePmDeliveryForTaskVerify(ROOT, project, task.taskId);
  assert.equal(delivery?.kind, 'TASK_VERIFY');
  assert.equal(deliveries(task.taskId).length, 1);
  const again = await pmDel.ensurePmDeliveryForTaskVerify(ROOT, project, task.taskId);
  assert.equal(again?.deliveryId, delivery.deliveryId);
  assert.equal(deliveries(task.taskId).length, 1);
});

test('a non-PASS run cannot be recovered into an ordinary Delivery', async () => {
  const task = await makeTask();
  const run = await linkRun(task.taskId);
  await receive(task.taskId, run.runId);
  const res = await finishCurrent(task.taskId);
  assert.equal(res.outcome, 'FAIL_REMEDIATION_DISPATCHED');
  const minted = await pmDel.ensurePmDeliveryForTaskVerifyRun(ROOT, project, task.taskId, run.runId);
  assert.equal(minted, null);
  assert.equal(deliveries(task.taskId).length, 0);
});

test('PM ACCEPT and CHANGES still apply to a QA PASS Delivery', async () => {
  const acceptTask = await makeTask();
  const acceptRun = await linkRun(acceptTask.taskId, { files: { 'out.txt': 'ok' } });
  await receive(acceptTask.taskId, acceptRun.runId);
  await gate.reconcileQaGate(ROOT, project, acceptTask.taskId);
  const accepted = await actions.acceptTaskResult({
    dataRoot: ROOT, project, goalId: goal.goalId, taskId: acceptTask.taskId, runId: acceptRun.runId,
    expectedExecutionState: 'RESULT_RECEIVED', expectedPmState: 'VERIFYING', reason: 'pm accept', callerSurface: 'PM_MCP',
  });
  assert.equal(accepted.pmState, 'ACCEPTED');
  assert.equal(accepted.acceptedRunId, acceptRun.runId);

  const changesTask = await makeTask();
  const changesRun = await linkRun(changesTask.taskId, { files: { 'out.txt': 'ok' } });
  await receive(changesTask.taskId, changesRun.runId);
  await gate.reconcileQaGate(ROOT, project, changesTask.taskId);
  const changed = await actions.requestTaskChanges({
    dataRoot: ROOT, project, goalId: goal.goalId, taskId: changesTask.taskId, runId: changesRun.runId,
    expectedExecutionState: 'RESULT_RECEIVED', expectedPmState: 'VERIFYING',
    reason: 'revise the same task output', callerSurface: 'PM_MCP',
  });
  assert.equal(changed.pmState, 'CHANGES_REQUESTED');
  assert.equal(changed.taskId, changesTask.taskId);
  assert.notEqual(changed.pmState, 'ACCEPTED');
});

async function failBeforeQa({ qaContract = true, reason = 'dispatch failed: pane unavailable' } = {}) {
  const task = await makeTask({ qaContract, executionState: 'READY' });
  seq += 1;
  const folder = path.join(ROOT, project, '_fixture-runs', `bare-${seq}`);
  fs.mkdirSync(folder, { recursive: true });
  const runId = `rb03a-bare-${seq}`;
  fs.writeFileSync(path.join(folder, 'meta.json'), JSON.stringify({ tags: [], runId, workerId: 'rb03a-worker' }));
  await gt.linkRunToTask(ROOT, project, task.taskId, folder);
  await gtr.transitionTaskExecution(ROOT, project, task.taskId, { expectedExecutionState: 'READY', to: 'DISPATCHED', reason: 'test dispatch' });
  await gtr.transitionTaskExecution(ROOT, project, task.taskId, { expectedExecutionState: 'DISPATCHED', to: 'FAILED', reason });
  return { task, runId, folder };
}

function workerIncidents(taskId) {
  return incidents.listIncidents(ROOT, project).filter((row) => row.taskId === taskId && (
    row.code === 'WORKER_LAUNCH_FAILED'
    || row.code === 'WORKER_EXECUTION_FAILED'
    || row.code === 'WORKER_FAILED_UNCLASSIFIED'
  ));
}

test('a contracted worker failure before QA mints no Delivery and one unclassified Incident', async () => {
  const { task, runId } = await failBeforeQa({ reason: 'dispatch failed: pane unavailable SECRET-VALUE' });
  const first = await pmDel.ensurePmDeliveryForFailedRun(ROOT, project, task.taskId, runId);
  assert.equal(first, null);
  assert.equal(deliveries(task.taskId).length, 0);
  const rows = workerIncidents(task.taskId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'WORKER_FAILED_UNCLASSIFIED');
  assert.equal(rows[0].status, 'OPEN');
  assert.equal(rows[0].source, 'dispatcher');
  assert.deepEqual(rows[0].evidenceRefs, ['cause:unclassified']);
  const body = JSON.stringify(rows[0]);
  assert.equal(body.includes('SECRET-VALUE'), false);
  assert.equal(body.includes('pane unavailable'), false);
  const stored = gt.getTask(ROOT, project, task.taskId);
  assert.equal(stored.executionState, 'FAILED');
  assert.equal(stored.pmState, 'PENDING');
  await events.recordRunFailed(ROOT, project, {
    summary: 'Worker process exited non-zero for Task probe (code=1).',
    taskId: task.taskId, runId, source: { kind: 'dispatcher', subsystem: 'process-exit' },
  });
  const second = await pmDel.ensurePmDeliveryForFailedRun(ROOT, project, task.taskId, runId);
  assert.equal(second, null);
  const again = workerIncidents(task.taskId);
  assert.equal(again.length, 1);
  assert.equal(again[0].incidentId, rows[0].incidentId);
  assert.equal(again[0].code, 'WORKER_FAILED_UNCLASSIFIED');
});

test('process-start failure and in-execution failure use different Incident codes', async () => {
  const launch = await failBeforeQa({ reason: 'spawn failure: ENOENT SECRET-VALUE' });
  assert.equal(await pmDel.ensurePmDeliveryForFailedRun(ROOT, project, launch.task.taskId, launch.runId), null);
  const launchRows = workerIncidents(launch.task.taskId);
  assert.equal(launchRows.length, 1);
  assert.equal(launchRows[0].code, 'WORKER_LAUNCH_FAILED');
  assert.deepEqual(launchRows[0].evidenceRefs, ['transition:spawn-failure']);
  assert.equal(JSON.stringify(launchRows[0]).includes('SECRET-VALUE'), false);
  assert.equal(await pmDel.ensurePmDeliveryForFailedRun(ROOT, project, launch.task.taskId, launch.runId), null);
  assert.equal(workerIncidents(launch.task.taskId).length, 1);

  const armed = await failBeforeQa({ reason: 'capture arm failure: disk' });
  await events.recordRuntimeError(ROOT, project, {
    summary: 'RUN_FAILED: Capture arm failed for Task probe; Run preserved; no spawn.',
    taskId: armed.task.taskId, runId: armed.runId, source: { kind: 'dispatcher', subsystem: 'capture-arm' },
  });
  assert.equal(await pmDel.ensurePmDeliveryForFailedRun(ROOT, project, armed.task.taskId, armed.runId), null);
  const armedRows = workerIncidents(armed.task.taskId);
  assert.equal(armedRows.length, 1);
  assert.equal(armedRows[0].code, 'WORKER_LAUNCH_FAILED');
  assert.deepEqual(armedRows[0].evidenceRefs, ['event:capture-arm', 'transition:capture-arm']);

  const launchEventOnly = await failBeforeQa({ reason: 'dispatch failed: pane unavailable' });
  await events.recordRuntimeError(ROOT, project, {
    summary: 'LAUNCH_FAILED: spawn threw for Task probe: SECRET-VALUE',
    taskId: launchEventOnly.task.taskId, runId: launchEventOnly.runId, source: { kind: 'dispatcher', subsystem: 'spawn' },
  });
  assert.equal(await pmDel.ensurePmDeliveryForFailedRun(ROOT, project, launchEventOnly.task.taskId, launchEventOnly.runId), null);
  const eventRows = workerIncidents(launchEventOnly.task.taskId);
  assert.equal(eventRows.length, 1);
  assert.equal(eventRows[0].code, 'WORKER_LAUNCH_FAILED');
  assert.deepEqual(eventRows[0].evidenceRefs, ['event:spawn']);
  assert.equal(JSON.stringify(eventRows[0]).includes('SECRET-VALUE'), false);

  const executed = await failBeforeQa({ reason: 'worker process exit code=2 signal=SIGTERM' });
  await events.recordRunFailed(ROOT, project, {
    summary: 'Worker process exited non-zero for Task probe (code=2).',
    taskId: executed.task.taskId, runId: executed.runId, source: { kind: 'dispatcher', subsystem: 'process-exit' },
  });
  assert.equal(await pmDel.ensurePmDeliveryForFailedRun(ROOT, project, executed.task.taskId, executed.runId), null);
  const executedRows = workerIncidents(executed.task.taskId);
  assert.equal(executedRows.length, 1);
  assert.equal(executedRows[0].code, 'WORKER_EXECUTION_FAILED');
  assert.deepEqual(executedRows[0].evidenceRefs, ['event:process-exit', 'transition:process-exit']);
  assert.equal(JSON.stringify(executedRows[0]).includes('SIGTERM'), false);
  assert.equal(deliveries(executed.task.taskId).length, 0);
});

test('contradictory start and exit tokens stay one unclassified Incident', async () => {
  const { task, runId } = await failBeforeQa({ reason: 'spawn failure: ENOENT' });
  await events.recordRunFailed(ROOT, project, {
    summary: 'Worker process exited non-zero for Task probe (code=1).',
    taskId: task.taskId, runId, source: { kind: 'dispatcher', subsystem: 'process-exit' },
  });
  assert.equal(await pmDel.ensurePmDeliveryForFailedRun(ROOT, project, task.taskId, runId), null);
  const rows = workerIncidents(task.taskId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'WORKER_FAILED_UNCLASSIFIED');
  assert.deepEqual(rows[0].evidenceRefs, ['cause:conflict']);
  assert.equal(await pmDel.ensurePmDeliveryForFailedRun(ROOT, project, task.taskId, runId), null);
  assert.equal(workerIncidents(task.taskId).length, 1);
  assert.equal(deliveries(task.taskId).length, 0);
});

test('a spawn-success warning is not treated as a launch failure', async () => {
  const { task, runId } = await failBeforeQa({ reason: 'run has no result.md and no live process handle' });
  await events.recordRuntimeWarning(ROOT, project, {
    summary: 'DISPATCH_RUNNING_CAS_FAILED: worker process pid=9 spawned but CAS failed.',
    taskId: task.taskId, runId, source: { kind: 'dispatcher', subsystem: 'spawn' },
    details: { reason: 'DISPATCH_RUNNING_CAS_FAILED' },
  });
  assert.equal(await pmDel.ensurePmDeliveryForFailedRun(ROOT, project, task.taskId, runId), null);
  const rows = workerIncidents(task.taskId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'WORKER_FAILED_UNCLASSIFIED');
  assert.deepEqual(rows[0].evidenceRefs, ['cause:unclassified']);
});

test('an existing failed-run Delivery is returned unchanged and a no-contract failure still mints', async () => {
  const historical = await failBeforeQa({ reason: 'spawn failure: ENOENT' });
  const deliveryId = `PMD-${historical.task.taskId}-${historical.runId}`;
  const delFolder = path.join(ROOT, project, '_relay', 'pm-deliveries', deliveryId);
  fs.mkdirSync(delFolder, { recursive: true });
  const plantedAt = new Date().toISOString();
  const planted = JSON.stringify({
    schemaVersion: 1, deliveryId, project, kind: 'TASK_VERIFY', taskId: historical.task.taskId, runId: historical.runId,
    status: 'PENDING', createdAt: plantedAt, updatedAt: plantedAt, source: { kind: 'pm-work', workKind: 'TASK_VERIFY' },
  }, null, 2) + '\n';
  fs.writeFileSync(path.join(delFolder, 'delivery.json'), planted);
  const returned = await pmDel.ensurePmDeliveryForFailedRun(ROOT, project, historical.task.taskId, historical.runId);
  assert.equal(returned.deliveryId, deliveryId);
  assert.equal(returned.status, 'PENDING');
  assert.equal(fs.readFileSync(path.join(delFolder, 'delivery.json'), 'utf8'), planted);
  assert.equal(workerIncidents(historical.task.taskId).length, 0);

  const legacy = await failBeforeQa({ qaContract: false, reason: 'dispatch failed: pane unavailable' });
  const minted = await pmDel.ensurePmDeliveryForFailedRun(ROOT, project, legacy.task.taskId, legacy.runId);
  assert.equal(minted.kind, 'TASK_VERIFY');
  assert.equal(minted.runId, legacy.runId);
  assert.equal(deliveries(legacy.task.taskId).length, 1);
  assert.equal(workerIncidents(legacy.task.taskId).length, 0);
  const replay = await pmDel.ensurePmDeliveryForFailedRun(ROOT, project, legacy.task.taskId, legacy.runId);
  assert.equal(replay.deliveryId, minted.deliveryId);
});

test('an existing or corrupt QA attempt does not become a worker-failure Incident', async () => {
  const owned = await failBeforeQa();
  await qa.createQaAttempt(ROOT, project, { taskId: owned.task.taskId, runId: owned.runId, qaAttemptNumber: 1 });
  assert.equal(await pmDel.ensurePmDeliveryForFailedRun(ROOT, project, owned.task.taskId, owned.runId), null);
  assert.equal(deliveries(owned.task.taskId).length, 0);
  assert.equal(workerIncidents(owned.task.taskId).length, 0);

  const corrupt = await failBeforeQa();
  const qaAttemptId = qa.qaAttemptIdFor(corrupt.task.taskId, corrupt.runId);
  const qaFolder = qa.qaAttemptFolder(ROOT, project, qaAttemptId);
  fs.mkdirSync(qaFolder, { recursive: true });
  fs.writeFileSync(path.join(qaFolder, 'qa.json'), '{');
  assert.equal(await pmDel.ensurePmDeliveryForFailedRun(ROOT, project, corrupt.task.taskId, corrupt.runId), null);
  assert.equal(deliveries(corrupt.task.taskId).length, 0);
  assert.equal(workerIncidents(corrupt.task.taskId).length, 0);
});
