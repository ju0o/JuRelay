/**
 * RB-03A-R3A/R3B — canonical ACCEPT boundary and Evidence Gate purity.
 * Isolated temp data root. No production data, no Worker, no model call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-rb03a-r3-'));
const project = 'R3B';

const gt = await import('../dist/server/backend/goal-task.js');
const gtr = await import('../dist/server/backend/goal-task-runtime.js');
const qa = await import('../dist/server/backend/qa-attempt.js');
const actions = await import('../dist/server/backend/task-actions.js');
const judgment = await import('../dist/server/backend/pm-judgment.js');
const events = await import('../dist/server/backend/event.js');
const plans = await import('../dist/server/backend/execution-plan.js');
const retryAuth = await import('../dist/server/backend/retry-authorization.js');
const verify = await import('../dist/server/backend/pm-verification-context.js');
const packets = await import('../dist/server/orchestrator/pm-packets.js');
const evidenceGate = await import('../dist/server/orchestrator/evidence-gate.js');
const loop = await import('../dist/server/backend/goal-loop.js');
const roleLoop = await import('../dist/server/orchestrator/role-loop.js');

const goal = await gt.createGoal(ROOT, project, { title: 'R3B', goalStatement: 'ACCEPT boundary' });
const workspace = path.join(ROOT, 'ws');
fs.mkdirSync(workspace, { recursive: true });
let seq = 0;

function acceptedEvents(taskId) {
  return events.listEvents(ROOT, project, { taskId, type: 'TASK_RESULT_ACCEPTED' }).events;
}

async function makeTask({ contracted = true, fullContract = false, executionState = 'RUNNING' } = {}) {
  const fields = {
    goalId: goal.goalId,
    title: 'R3B task',
    goal: 'fixture goal',
    reason: 'fixture',
    scope: 'authorized file: out.txt',
    completionCriteria: ['done'],
    executionState,
    pmState: 'PENDING',
  };
  if (fullContract) {
    fields.contract = {
      goal: 'fixture goal',
      bounded_scope: 'authorized file: out.txt',
      acceptance_criteria: [{ id: 'AC-01', description: 'out.txt exists', validationMode: 'DETERMINISTIC' }],
      qa_route: { deterministic: [{ kind: 'fileExists', path: 'out.txt', criterionId: 'AC-01' }] },
    };
  } else if (contracted) {
    fields.acceptanceCriteria = [{ id: 'AC-01', description: 'out.txt exists', validationMode: 'DETERMINISTIC' }];
    fields.qaContract = { deterministic: [{ kind: 'fileExists', path: 'out.txt', criterionId: 'AC-01' }] };
  }
  return gt.createTask(ROOT, project, fields);
}

async function linkRun(taskId, runId) {
  seq += 1;
  const folder = path.join(ROOT, project, '_fixture-runs', `run-${seq}`);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'meta.json'), JSON.stringify({ tags: [], runId, workspaceRoot: workspace, workerId: 'r3-worker' }));
  fs.writeFileSync(path.join(folder, 'result.md'), `result ${runId}`);
  await gt.linkRunToTask(ROOT, project, taskId, folder);
  return { runId, folder };
}

async function receive(taskId, runId) {
  return gtr.markResultReceived(ROOT, project, taskId, runId);
}

function plantDelivery(taskId, runId) {
  const deliveryId = `PMD-${taskId}-${runId}`;
  const folder = path.join(ROOT, project, '_relay', 'pm-deliveries', deliveryId);
  fs.mkdirSync(folder, { recursive: true });
  const now = new Date().toISOString();
  const body = JSON.stringify({
    schemaVersion: 1, deliveryId, project, kind: 'TASK_VERIFY', taskId, runId, status: 'PENDING',
    createdAt: now, updatedAt: now, source: { kind: 'pm-work', workKind: 'TASK_VERIFY' },
  }, null, 2) + '\n';
  fs.writeFileSync(path.join(folder, 'delivery.json'), body);
  return { deliveryId, body, file: path.join(folder, 'delivery.json') };
}

const passCheck = { checkIndex: 0, kind: 'fileExists', status: 'PASS', detail: 'exists', criterionId: 'AC-01' };

async function writeAttempt(taskId, runId, status, { sequence = 1, contractHash } = {}) {
  const created = await qa.createQaAttempt(ROOT, project, {
    taskId, runId, qaAttemptNumber: sequence,
    ...(contractHash !== undefined ? { contractHash } : {}),
  });
  if (status === 'PENDING') return created;
  if (status === 'FAIL') {
    return qa.recordDeterministicEvidence(ROOT, project, created.qaAttemptId, {
      status: 'FAIL',
      checks: [{ checkIndex: 0, kind: 'fileExists', status: 'FAIL', detail: 'missing', criterionId: 'AC-01' }],
      failedCriteria: ['AC-01'],
    });
  }
  if (status === 'BLOCKED') {
    return qa.recordDeterministicEvidence(ROOT, project, created.qaAttemptId, {
      status: 'BLOCKED',
      checks: [{ checkIndex: 0, kind: 'command', status: 'BLOCKED', detail: 'unavailable', criterionId: 'AC-01' }],
    });
  }
  await qa.recordDeterministicEvidence(ROOT, project, created.qaAttemptId, { status: 'PASS', checks: [passCheck] });
  return qa.completeQaAttempt(ROOT, project, created.qaAttemptId, { finalQaStatus: 'PASS' });
}

function qaFile(qaAttemptId) {
  return path.join(qa.qaAttemptFolder(ROOT, project, qaAttemptId), 'qa.json');
}

async function verifyingTask(opts) {
  const task = await makeTask(opts);
  const run = await linkRun(task.taskId, `run-${task.taskId.toLowerCase()}`);
  await receive(task.taskId, run.runId);
  return { task: gt.getTask(ROOT, project, task.taskId), run };
}

function acceptInput(task, runId) {
  return {
    dataRoot: ROOT,
    project,
    goalId: task.goalId,
    taskId: task.taskId,
    runId,
    expectedExecutionState: 'RESULT_RECEIVED',
    expectedPmState: 'VERIFYING',
    reason: 'canonical accept after durable qa pass',
    callerSurface: 'PM_MCP',
  };
}

test('QA PASS allows a new ACCEPT and records one accept event', async () => {
  const { task, run } = await verifyingTask();
  const attempt = await writeAttempt(task.taskId, run.runId, 'PASS');
  assert.equal(attempt.finalQaStatus, 'PASS');
  const delivery = plantDelivery(task.taskId, run.runId);
  const applied = await judgment.submitPmJudgment(ROOT, project, {
    deliveryId: delivery.deliveryId,
    decision: 'ACCEPT',
    reason: 'durable qa pass allows accept',
  });
  assert.equal(applied.judgment.status, 'APPLIED');
  assert.equal(applied.applied, true);
  const after = gt.getTask(ROOT, project, task.taskId);
  assert.equal(after.pmState, 'ACCEPTED');
  assert.equal(after.acceptedRunId, run.runId);
  assert.equal(acceptedEvents(task.taskId).length, 1);
});

test('FAIL, BLOCKED, PENDING, missing, and corrupt QA attempts reject ACCEPT', async () => {
  const cases = [
    ['FAIL', 'NOT_PASS'],
    ['BLOCKED', 'NOT_PASS'],
    ['PENDING', 'NOT_PASS'],
    ['MISSING', 'MISSING_ATTEMPT'],
    ['CORRUPT', 'CORRUPT_ATTEMPT'],
  ];
  for (const [status, reason] of cases) {
    const { task, run } = await verifyingTask();
    const before = fs.readFileSync(path.join(ROOT, project, '_relay', 'tasks', task.taskId, 'task.json'), 'utf8');
    if (status === 'CORRUPT') {
      const attempt = await writeAttempt(task.taskId, run.runId, 'PASS');
      fs.writeFileSync(qaFile(attempt.qaAttemptId), '{');
    } else if (status !== 'MISSING') {
      await writeAttempt(task.taskId, run.runId, status);
    }
    await assert.rejects(
      () => gtr.acceptResult(ROOT, project, task.taskId, run.runId, {
        goalId: task.goalId, expectedExecutionState: 'RESULT_RECEIVED', expectedPmState: 'VERIFYING',
      }),
      (err) => err instanceof gtr.QaAcceptEligibilityError && err.code === 'QA_ACCEPT_BLOCKED' && err.reason === reason,
    );
    await assert.rejects(
      () => actions.acceptTaskResult(acceptInput(task, run.runId)),
      (err) => err instanceof gtr.QaAcceptEligibilityError && err.reason === reason,
    );
    const after = gt.getTask(ROOT, project, task.taskId);
    assert.equal(after.pmState, 'VERIFYING');
    assert.equal(after.acceptedRunId, undefined);
    assert.equal(fs.readFileSync(path.join(ROOT, project, '_relay', 'tasks', task.taskId, 'task.json'), 'utf8'), before);
    assert.equal(acceptedEvents(task.taskId).length, 0, status);
  }
});

test('wrong project, task, run identity, sequence, and contract hash reject ACCEPT', async () => {
  const { task, run } = await verifyingTask({ fullContract: true });
  const hash = gt.getTask(ROOT, project, task.taskId).contract.contract_hash;
  const attempt = await writeAttempt(task.taskId, run.runId, 'PASS', { contractHash: 'a'.repeat(64) });
  assert.notEqual(hash, 'a'.repeat(64));
  assert.throws(
    () => gtr.assertCurrentRunQaAllowsAccept(ROOT, project, gt.getTask(ROOT, project, task.taskId), run.runId),
    (err) => err.reason === 'HASH_MISMATCH',
  );

  const projectCase = await verifyingTask();
  const projectAttempt = await writeAttempt(projectCase.task.taskId, projectCase.run.runId, 'PASS');
  const projectRecord = JSON.parse(fs.readFileSync(qaFile(projectAttempt.qaAttemptId), 'utf8'));
  projectRecord.project = 'OtherProject';
  fs.writeFileSync(qaFile(projectAttempt.qaAttemptId), JSON.stringify(projectRecord));
  await assert.rejects(
    () => gtr.acceptResult(ROOT, project, projectCase.task.taskId, projectCase.run.runId, {
      goalId: projectCase.task.goalId, expectedExecutionState: 'RESULT_RECEIVED', expectedPmState: 'VERIFYING',
    }),
    (err) => err.reason === 'IDENTITY_MISMATCH',
  );

  const taskCase = await verifyingTask();
  const taskAttempt = await writeAttempt(taskCase.task.taskId, taskCase.run.runId, 'PASS');
  const taskRecord = JSON.parse(fs.readFileSync(qaFile(taskAttempt.qaAttemptId), 'utf8'));
  taskRecord.taskId = 'TASK-9999';
  fs.writeFileSync(qaFile(taskAttempt.qaAttemptId), JSON.stringify(taskRecord));
  await assert.rejects(
    () => gtr.acceptResult(ROOT, project, taskCase.task.taskId, taskCase.run.runId, {
      goalId: taskCase.task.goalId, expectedExecutionState: 'RESULT_RECEIVED', expectedPmState: 'VERIFYING',
    }),
    (err) => err.reason === 'CORRUPT_ATTEMPT',
  );

  const sequenceCase = await verifyingTask();
  const sequenceAttempt = await writeAttempt(sequenceCase.task.taskId, sequenceCase.run.runId, 'PASS');
  const sequenceRecord = JSON.parse(fs.readFileSync(qaFile(sequenceAttempt.qaAttemptId), 'utf8'));
  sequenceRecord.qaAttemptNumber = 2;
  fs.writeFileSync(qaFile(sequenceAttempt.qaAttemptId), JSON.stringify(sequenceRecord));
  await assert.rejects(
    () => gtr.acceptResult(ROOT, project, sequenceCase.task.taskId, sequenceCase.run.runId, {
      goalId: sequenceCase.task.goalId, expectedExecutionState: 'RESULT_RECEIVED', expectedPmState: 'VERIFYING',
    }),
    (err) => err.reason === 'IDENTITY_MISMATCH' && /sequence/.test(err.message),
  );

  const stale = await verifyingTask();
  await writeAttempt(stale.task.taskId, stale.run.runId, 'PASS');
  const newer = await linkRun(stale.task.taskId, `run-newer-${stale.task.taskId.toLowerCase()}`);
  assert.throws(
    () => gtr.assertCurrentRunQaAllowsAccept(ROOT, project, gt.getTask(ROOT, project, stale.task.taskId), stale.run.runId),
    (err) => err.reason === 'STALE_RUN',
  );
  await assert.rejects(
    () => gtr.acceptResult(ROOT, project, stale.task.taskId, stale.run.runId, {
      goalId: stale.task.goalId, expectedExecutionState: 'RESULT_RECEIVED', expectedPmState: 'VERIFYING',
    }),
    (err) => /과거\/오래된 Run/.test(err.message),
  );
  assert.equal(gt.getTask(ROOT, project, stale.task.taskId).pmState, 'VERIFYING');
  assert.equal(gt.getTask(ROOT, project, stale.task.taskId).linkedRuns.some((row) => row.runId === newer.runId), true);
  assert.equal(acceptedEvents(task.taskId).length + acceptedEvents(projectCase.task.taskId).length + acceptedEvents(taskCase.task.taskId).length + acceptedEvents(sequenceCase.task.taskId).length + acceptedEvents(stale.task.taskId).length, 0);
});

test('a historical delivery and a stale run cannot mint a new ACCEPT', async () => {
  const { task, run } = await verifyingTask();
  await writeAttempt(task.taskId, run.runId, 'PASS');
  const historical = plantDelivery(task.taskId, run.runId);
  const newer = await linkRun(task.taskId, `hist-newer-${task.taskId.toLowerCase()}`);
  const beforeDelivery = fs.readFileSync(historical.file, 'utf8');
  await assert.rejects(
    () => judgment.submitPmJudgment(ROOT, project, {
      deliveryId: historical.deliveryId, decision: 'ACCEPT', reason: 'historical delivery is not current',
    }),
    (err) => err.code === 'CONFLICT' && /historical attempt/.test(err.message),
  );
  const after = gt.getTask(ROOT, project, task.taskId);
  assert.equal(after.pmState, 'VERIFYING');
  assert.equal(after.acceptedRunId, undefined);
  assert.equal(fs.readFileSync(historical.file, 'utf8'), beforeDelivery);
  assert.equal(acceptedEvents(task.taskId).length, 0);
  assert.equal(newer.runId !== run.runId, true);
});

test('an already applied ACCEPT replays after the QA record is later damaged', async () => {
  const { task, run } = await verifyingTask();
  const attempt = await writeAttempt(task.taskId, run.runId, 'PASS');
  const delivery = plantDelivery(task.taskId, run.runId);
  const first = await judgment.submitPmJudgment(ROOT, project, {
    deliveryId: delivery.deliveryId, decision: 'ACCEPT', reason: 'historical accept stays applied',
  });
  assert.equal(first.judgment.status, 'APPLIED');
  const accepted = fs.readFileSync(path.join(ROOT, project, '_relay', 'tasks', task.taskId, 'task.json'), 'utf8');
  fs.writeFileSync(qaFile(attempt.qaAttemptId), '{');
  const replay = await judgment.submitPmJudgment(ROOT, project, {
    deliveryId: delivery.deliveryId, decision: 'ACCEPT', reason: 'historical accept stays applied',
  });
  assert.equal(replay.judgment.status, 'APPLIED');
  assert.equal(replay.applied, false);
  assert.equal(fs.readFileSync(path.join(ROOT, project, '_relay', 'tasks', task.taskId, 'task.json'), 'utf8'), accepted);
  assert.equal(gt.getTask(ROOT, project, task.taskId).pmState, 'ACCEPTED');
  assert.equal(acceptedEvents(task.taskId).length, 1);
});

test('a task with no QA contract keeps the legacy ACCEPT and goal-loop fallback', async () => {
  const direct = await verifyingTask({ contracted: false });
  const accepted = await gtr.acceptResult(ROOT, project, direct.task.taskId, direct.run.runId, {
    goalId: direct.task.goalId, expectedExecutionState: 'RESULT_RECEIVED', expectedPmState: 'VERIFYING',
    reason: 'legacy task has no qa contract',
  });
  assert.equal(accepted.pmState, 'ACCEPTED');
  assert.equal(qa.listQaAttemptsForTask(ROOT, project, direct.task.taskId).length, 0);

  const fallback = await verifyingTask({ contracted: false });
  const applied = await loop.applyAutoReviewPass({
    dataRoot: ROOT, project, goalId: fallback.task.goalId, taskId: fallback.task.taskId,
    runId: fallback.run.runId, deliveryId: `PMD-${fallback.task.taskId}-missing-run`,
    reason: 'legacy review has no delivery and still accepts',
  });
  assert.equal(applied.applied, true);
  assert.equal(gt.getTask(ROOT, project, fallback.task.taskId).pmState, 'ACCEPTED');
  assert.equal(acceptedEvents(fallback.task.taskId).length, 1);
});

test('a QA-contracted goal-loop does not fall back to direct ACCEPT', async () => {
  const missing = await verifyingTask();
  const blocked = await loop.applyAutoReviewPass({
    dataRoot: ROOT, project, goalId: missing.task.goalId, taskId: missing.task.taskId,
    runId: missing.run.runId, deliveryId: null,
    reason: 'contracted loop must not accept directly',
  });
  assert.equal(blocked.applied, false);
  assert.match(blocked.blocked, /direct ACCEPT fallback is refused/);
  assert.equal(gt.getTask(ROOT, project, missing.task.taskId).pmState, 'VERIFYING');
  assert.equal(acceptedEvents(missing.task.taskId).length, 0);

  const failed = await verifyingTask();
  await writeAttempt(failed.task.taskId, failed.run.runId, 'FAIL');
  const delivery = plantDelivery(failed.task.taskId, failed.run.runId);
  const refused = await loop.applyAutoReviewPass({
    dataRoot: ROOT, project, goalId: failed.task.goalId, taskId: failed.task.taskId,
    runId: failed.run.runId, deliveryId: delivery.deliveryId,
    reason: 'qa fail must not become an automatic accept',
  });
  assert.equal(refused.applied, false);
  assert.match(refused.blocked, /was not applied/);
  assert.equal(gt.getTask(ROOT, project, failed.task.taskId).pmState, 'VERIFYING');
  assert.equal(acceptedEvents(failed.task.taskId).length, 0);
});

test('CHANGES remains recordable when QA is not PASS', async () => {
  const { task, run } = await verifyingTask();
  await writeAttempt(task.taskId, run.runId, 'FAIL');
  const delivery = plantDelivery(task.taskId, run.runId);
  const recorded = await judgment.submitPmJudgment(ROOT, project, {
    deliveryId: delivery.deliveryId,
    decision: 'CHANGES',
    reason: 'qa fail still allows a changes request',
    retryInstruction: 'repair the failed criterion and rerun the same task',
  });
  assert.equal(recorded.judgment.decision, 'CHANGES');
  assert.equal(recorded.judgment.status, 'RECEIVED');
  assert.equal(gt.getTask(ROOT, project, task.taskId).pmState, 'VERIFYING');
  assert.equal(acceptedEvents(task.taskId).length, 0);
});

test('the PM packet does not offer ACCEPT from a displayed PASS or a missing QA block', async () => {
  const omitted = await verifyingTask({ fullContract: true });
  const omittedDelivery = plantDelivery(omitted.task.taskId, omitted.run.runId);
  const omittedPacket = packets.buildPmFinalGatePacket(ROOT, project, omittedDelivery.deliveryId);
  const omittedContext = verify.getVerificationContextForDelivery(ROOT, project, omittedDelivery.deliveryId);
  assert.equal(omittedPacket.context.qa, undefined);
  assert.equal(omittedPacket.allowedActions.includes('ACCEPT'), false);
  assert.equal(omittedPacket.allowedActions.includes('ACCEPT_AND_NEXT'), false);
  assert.equal(omittedContext.reviewActions.includes('ACCEPT_RESULT'), false);
  assert.ok(omittedContext.warnings.some((warning) => /no current valid PASS/.test(warning)));

  const displayed = await verifyingTask({ fullContract: true });
  const displayedAttempt = await writeAttempt(displayed.task.taskId, displayed.run.runId, 'PASS');
  const displayedRecord = JSON.parse(fs.readFileSync(qaFile(displayedAttempt.qaAttemptId), 'utf8'));
  displayedRecord.qaAttemptNumber = 2;
  fs.writeFileSync(qaFile(displayedAttempt.qaAttemptId), JSON.stringify(displayedRecord));
  const displayedDelivery = plantDelivery(displayed.task.taskId, displayed.run.runId);
  const displayedPacket = packets.buildPmFinalGatePacket(ROOT, project, displayedDelivery.deliveryId);
  assert.equal(displayedPacket.context.qa.status, 'PASS');
  assert.equal(displayedPacket.allowedActions.includes('ACCEPT'), false);
  assert.ok(displayedPacket.context.warnings.some((warning) => /IDENTITY_MISMATCH/.test(warning)));

  const adapter = new FakePmAdapter([fence('PM_JUDGMENT v1', {
    decision: 'ACCEPT', retry: 'NONE', reason: 'displayed pass is not durable',
    contract_hash: displayedPacket.context.task.contract_hash ?? '',
    context_hash: displayedPacket.contextHash,
  })]);
  const auditDir = path.join(ROOT, 'audit-displayed');
  const stateFile = path.join(ROOT, 'state-displayed.json');
  fs.mkdirSync(auditDir, { recursive: true });
  const result = await roleLoop.processFinalGate({
    dataRoot: ROOT, project, roleConfig: roleConfig(), pmAdapter: adapter,
    dispatchHook: async () => { throw new Error('dispatch must not run'); },
    auditDir, stateFile,
  }, displayedDelivery.deliveryId);
  assert.equal(result.outcome, 'BLOCKED');
  assert.match(result.reason, /sequence/);
  assert.equal(gt.getTask(ROOT, project, displayed.task.taskId).pmState, 'VERIFYING');
  assert.equal(acceptedEvents(displayed.task.taskId).length, 0);
  assert.equal(fs.readFileSync(displayedDelivery.file, 'utf8'), displayedDelivery.body);
});

test('a rejected ACCEPT does not emit an event, continue a plan, or dispatch a successor', async () => {
  const current = await verifyingTask();
  await writeAttempt(current.task.taskId, current.run.runId, 'FAIL');
  const successor = await makeTask({ contracted: false, executionState: 'READY' });
  const bindings = [current.task, successor].map((task) => ({
    taskId: task.taskId,
    workerId: 'r3-worker',
    workspaceRoot: workspace,
    scopeFingerprint: retryAuth.computeTaskScopeFingerprint(gt.getTask(ROOT, project, task.taskId)),
  }));
  const created = await plans.createExecutionPlan(ROOT, project, {
    title: 'r3 reject plan', orderedTaskIds: [current.task.taskId, successor.taskId], taskBindings: bindings,
  });
  const started = await plans.startExecutionPlan(ROOT, project, created.planId, {
    expectedState: 'PLANNED',
    activeTaskId: current.task.taskId,
    ownerAuthorization: {
      authorizationId: `owner-go:${created.planId}`,
      approvedAt: new Date().toISOString(),
      approvedBy: 'OWNER',
      planScopeFingerprint: plans.computeExecutionPlanScopeFingerprint(created),
      taskScopeFingerprints: Object.fromEntries(created.taskBindings.map((binding) => [binding.taskId, binding.scopeFingerprint])),
    },
  });
  assert.equal(started.state, 'RUNNING');
  const planFile = plans.executionPlanPath(ROOT, project, created.planId);
  const planBefore = fs.readFileSync(planFile, 'utf8');
  const successorBefore = gt.getTask(ROOT, project, successor.taskId).linkedRuns.length;
  await assert.rejects(
    () => actions.acceptTaskResult(acceptInput(gt.getTask(ROOT, project, current.task.taskId), current.run.runId)),
    (err) => err.reason === 'NOT_PASS',
  );
  assert.equal(fs.readFileSync(planFile, 'utf8'), planBefore);
  assert.equal(plans.getExecutionPlan(ROOT, project, created.planId).state, 'RUNNING');
  assert.equal(plans.getExecutionPlan(ROOT, project, created.planId).activeTaskId, current.task.taskId);
  assert.equal(gt.getTask(ROOT, project, successor.taskId).linkedRuns.length, successorBefore);
  assert.equal(gt.getTask(ROOT, project, current.task.taskId).pmState, 'VERIFYING');
  assert.equal(acceptedEvents(current.task.taskId).length, 0);
  assert.equal(events.listEvents(ROOT, project, { taskId: successor.taskId }).events.length, 0);
});

test('evidence token and floor judgments stay pure and unchanged', () => {
  const prose = 'node scripts/founder-brief.mjs --self-test 실행 결과';
  const observed = evidenceGate.checkRequiredEvidence(
    { required_evidence: [prose] },
    [{ evidenceId: 'EV-1', type: 'ADAPTER_OBSERVATION', trustLevel: 'OBSERVED', status: 'INFO' }],
  );
  assert.equal(observed.satisfied, false);
  assert.match(evidenceGate.describeUnmetRequirement(observed.unmet[0]), /floor: VERIFIED evidence absent/);
  const failed = evidenceGate.checkRequiredEvidence(
    { required_evidence: [prose] },
    [{ evidenceId: 'EV-2', type: 'TEST', trustLevel: 'VERIFIED', status: 'FAIL' }],
  );
  assert.equal(failed.satisfied, false);
  const floor = evidenceGate.checkRequiredEvidence(
    { required_evidence: [prose] },
    [{ evidenceId: 'EV-3', type: 'QA', trustLevel: 'VERIFIED', status: 'PASS' }],
  );
  assert.equal(floor.satisfied, true);
  assert.deepEqual(evidenceGate.evidenceGateJudgmentRows(floor), [{ requirementId: 'REQ-1', requirement: prose, rule: 'floor' }]);
  const tokenText = 'TEST/VERIFIED machine-proof of the --self-test run';
  const token = evidenceGate.checkRequiredEvidence(
    { required_evidence: [tokenText] },
    [{ evidenceId: 'EV-4', type: 'QA', trustLevel: 'VERIFIED', status: 'PASS' }],
  );
  assert.equal(token.satisfied, false);
  assert.match(evidenceGate.describeUnmetRequirement(token.unmet[0]), /requires TEST\/VERIFIED/);
  assert.deepEqual(evidenceGate.evidenceGateJudgmentRows(token), [{ requirementId: 'REQ-1', requirement: tokenText, rule: 'token' }]);
});

class FakePmAdapter {
  constructor(scripted) {
    this.id = 'fake-pm';
    this.scripted = [...scripted];
    this.sessions = new Map();
    this.pending = new Map();
  }
  async health() { return { ok: true }; }
  capabilities() {
    return { persistentSession: true, structuredInput: true, structuredOutput: true, readWorkspace: true, writeWorkspace: false, shell: false, subscriptionAuth: false, freeTier: true };
  }
  authMode() { return { mode: 'free' }; }
  async ensureSession({ sessionKey }) {
    if (!this.sessions.has(sessionKey)) this.sessions.set(sessionKey, `ses-${sessionKey}`);
    return { sessionId: this.sessions.get(sessionKey), created: true };
  }
  async send(sessionId, envelope) {
    const requestId = `req-${this.pending.size + 1}`;
    const text = envelope.kind === 'PM_PREAMBLE' ? '' : (this.scripted.shift() ?? '');
    this.pending.set(requestId, { text });
    return { requestId };
  }
  async collect(_sessionId, requestId) {
    return this.pending.get(requestId);
  }
  async interrupt() {}
  async resume() { return { ok: true }; }
  sessionIdentity(sessionId) { return { adapterId: this.id, sessionId }; }
}

function fence(header, obj) {
  return '```json\n' + header + '\n' + JSON.stringify(obj) + '\n```';
}

function roleConfig() {
  return {
    schema_version: 'role-config.v1',
    project,
    assignments: [
      {
        roleId: 'pm', runtimeAdapterId: 'fake-pm', model: 'nemotron-3.5-lightning-free',
        workspace: { project, workspaceRoot: workspace }, sessionPolicy: 'persistent', permissionProfile: 'read-only',
        capabilityRequirements: {}, zeroExtraBilling: true, fallbackChain: [], enabled: true,
      },
    ],
    graph: [],
  };
}
