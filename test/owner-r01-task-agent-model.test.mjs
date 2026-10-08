/**
 * P2-OWNER-R01 — per-Task Agent/model selection wiring (offline fixtures).
 *
 * Covers:
 *   - set selection does not change workspace-config assignment
 *   - two tasks different agent/model
 *   - unsupported model fail-closed
 *   - resolve without selection blocked
 *   - approve required before ok resolve
 *   - owner dispatch freezes selection + RunMeta.model
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
const FIX_EXIT0 = path.resolve(__dirname, 'fixtures/workers/exit-zero-instant.mjs');
const NODE = process.execPath;

const dispatchResolve = await import(dist('backend/dispatch-resolve.js'));
const goalTask = await import(dist('backend/goal-task.js'));
const workerRegistry = await import(dist('backend/worker-registry.js'));
const wsConfig = await import(dist('workspace/config-v2.js'));
const uiState = await import(dist('backend/ui-state.js'));
const taskExec = await import(dist('backend/task-execution-config.js'));
const catalog = await import(dist('backend/agent-model-catalog.js'));
const disp = await import(dist('backend/dispatcher.js'));
const cap = await import(dist('backend/capture-service.js'));
const v1Dispatch = await import(dist('backend/v1-dispatch.js'));
const fsMeta = await import(dist('backend/fs.js'));
const assignment = await import(dist('backend/project-assignment.js'));
const testFix = await import(dist('integrations/test-fixture/watch.js'));
const pmTools = await import(dist('mcp/pm-tools.js'));

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `arl-owner-r01-${prefix}-`));
}

function writeWorker(root, workerId, extra = {}) {
  workerRegistry.writeWorkerRegistryRecord(root, {
    schemaVersion: 'G.2',
    workerId,
    displayName: workerId,
    launchCommand: NODE,
    launchArgsPrefix: [FIX_EXIT0],
    capabilities: ['fixture'],
    observationAdapterId: 'test-fixture',
    role: 'implementation',
    ...extra,
  });
}

function writeWorkspace(hostRoot, lanes) {
  fs.mkdirSync(path.join(hostRoot, '.agent-relay'), { recursive: true });
  const rpB = { sessionPolicy: 'per-task', permissionProfile: 'write-workspace' };
  const rpQ = { sessionPolicy: 'per-task', permissionProfile: 'read-only' };
  const rpP = { sessionPolicy: 'persistent', permissionProfile: 'read-only' };
  wsConfig.writeWorkspaceConfigV2(hostRoot, {
    schemaVersion: 'workspace.v2',
    concurrency: { maxActiveBuilders: 2, maxActiveQa: 1 },
    lanes: lanes.map((lane) => ({
      id: lane.id,
      label: lane.label || lane.id,
      root: lane.root,
      goal: lane.goal || 'fixture',
      pm: lane.pm || { runtime: 'chatgpt', model: 'default', roleProfile: rpP },
      builder: lane.builder || {
        runtime: 'opencode',
        model: 'default',
        roleProfile: rpB,
        ...(lane.builderWorkerId ? { workerId: lane.builderWorkerId } : {}),
      },
      qa: lane.qa || { runtime: 'cline', model: 'default', roleProfile: rpQ },
      qaFallback: { runtime: 'cursor', model: 'default' },
    })),
  });
}

function fixture() {
  const dataRoot = tmp('data');
  const hostRoot = tmp('host');
  const projectRoot = path.join(hostRoot, 'Agent-Relay');
  fs.mkdirSync(projectRoot, { recursive: true });
  writeWorkspace(hostRoot, [{
    id: 'agent-relay',
    root: projectRoot,
    builderWorkerId: 'builder-fixture-a',
  }]);
  uiState.saveSelectedProjectId(dataRoot, 'agent-relay');
  writeWorker(dataRoot, 'builder-fixture-a');
  writeWorker(dataRoot, 'builder-fixture-b');
  testFix.ensureTestFixtureAdapterRegistered();
  disp._resetDispatcherStateForTests();
  cap._resetCaptureServiceForTests();
  return { dataRoot, hostRoot, projectRoot };
}

async function createReadyTask(dataRoot, projectRoot, title) {
  const goal = await goalTask.createGoal(dataRoot, 'ws', {
    title: `Goal ${title}`,
    goalStatement: title,
    permissionPolicy: { mode: 'PLAN' },
  });
  return goalTask.createTask(dataRoot, 'ws', {
    goalId: goal.goalId,
    title,
    goal: title,
    reason: 'r01',
    scope: projectRoot,
    completionCriteria: ['done'],
    executionState: 'READY',
  });
}

test('fixture catalog exposes test-model for test-fixture workers', () => {
  const { dataRoot } = fixture();
  const worker = workerRegistry.loadWorkerRegistryRecord(dataRoot, 'builder-fixture-a');
  const cat = catalog.listModelsForWorker(dataRoot, worker);
  assert.equal(cat.supportsExplicitModel, true);
  assert.ok(cat.models.some((m) => m.modelId === 'test-model'));
  assert.equal(catalog.isModelAllowedForWorker(dataRoot, worker, 'test-model'), true);
  assert.equal(catalog.isModelAllowedForWorker(dataRoot, worker, 'invented-model'), false);
});

test('set selection does not change workspace-config assignment', async () => {
  const { dataRoot, hostRoot, projectRoot } = fixture();
  const beforeRaw = fs.readFileSync(path.join(hostRoot, '.agent-relay', 'workspace-config.json'), 'utf8');
  const beforeAssign = assignment.getProjectAssignments(
    { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false },
    'agent-relay',
  );

  const task = await createReadyTask(dataRoot, projectRoot, 'sel');

  taskExec.setTaskExecutionConfig(dataRoot, 'ws', {
    projectId: 'agent-relay',
    taskId: task.taskId,
    workerId: 'builder-fixture-b',
    modelId: 'test-model',
  });

  const afterRaw = fs.readFileSync(path.join(hostRoot, '.agent-relay', 'workspace-config.json'), 'utf8');
  assert.equal(afterRaw, beforeRaw);
  const afterAssign = assignment.getProjectAssignments(
    { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false },
    'agent-relay',
  );
  assert.equal(afterAssign.builders[0].workerId, beforeAssign.builders[0].workerId);
  assert.equal(afterAssign.builders[0].runtime, beforeAssign.builders[0].runtime);
});

test('two tasks can select different agent/model; unsupported model fail-closed', async () => {
  const { dataRoot, projectRoot } = fixture();
  const t1 = await createReadyTask(dataRoot, projectRoot, 't1');
  const t2 = await createReadyTask(dataRoot, projectRoot, 't2');

  const c1 = taskExec.setTaskExecutionConfig(dataRoot, 'ws', {
    projectId: 'agent-relay', taskId: t1.taskId, workerId: 'builder-fixture-a', modelId: 'test-model',
  });
  const c2 = taskExec.setTaskExecutionConfig(dataRoot, 'ws', {
    projectId: 'agent-relay', taskId: t2.taskId, workerId: 'builder-fixture-b', modelId: 'test-model',
  });
  assert.equal(c1.workerId, 'builder-fixture-a');
  assert.equal(c2.workerId, 'builder-fixture-b');
  assert.equal(c1.ownerApproval.approved, false);
  assert.equal(c2.ownerApproval.approved, false);

  assert.throws(
    () => taskExec.setTaskExecutionConfig(dataRoot, 'ws', {
      projectId: 'agent-relay',
      taskId: t1.taskId,
      workerId: 'builder-fixture-a',
      modelId: 'totally-invented-model',
    }),
    (err) => err?.code === 'UNSUPPORTED_MODEL',
  );
  assert.throws(
    () => taskExec.setTaskExecutionConfig(dataRoot, 'ws', {
      projectId: 'agent-relay',
      taskId: t2.taskId,
      workerId: 'builder-fixture-b',
      modelId: 'nope/fake',
    }),
    (err) => err?.code === 'UNSUPPORTED_MODEL',
  );
});

test('resolve without selection blocked; approve required before ok', async () => {
  const { dataRoot, hostRoot, projectRoot } = fixture();
  const task = await createReadyTask(dataRoot, projectRoot, 'r');

  const missing = dispatchResolve.resolveOwnerDispatch({
    dataRoot, scope: 'ws', taskId: task.taskId, projectId: 'agent-relay',
    hostRoots: [hostRoot], includeCwdHostRoot: false,
  });
  assert.equal(missing.ok, false);
  assert.ok(missing.blockers.includes('TASK_EXECUTION_SELECTION_REQUIRED'));
  assert.equal(missing.workerId, null);
  assert.equal(missing.projectDesiredBuilder, 'builder-fixture-a');

  taskExec.setTaskExecutionConfig(dataRoot, 'ws', {
    projectId: 'agent-relay', taskId: task.taskId, workerId: 'builder-fixture-b', modelId: 'test-model',
  });
  const unapproved = dispatchResolve.resolveOwnerDispatch({
    dataRoot, scope: 'ws', taskId: task.taskId, projectId: 'agent-relay',
    hostRoots: [hostRoot], includeCwdHostRoot: false,
  });
  assert.equal(unapproved.ok, false);
  assert.ok(unapproved.blockers.includes('OWNER_APPROVAL_REQUIRED'));
  assert.equal(unapproved.workerId, 'builder-fixture-b');
  assert.equal(unapproved.selectionApproved, false);
  assert.equal(unapproved.modelId, 'test-model');

  taskExec.approveTaskExecution(dataRoot, 'ws', task.taskId, 'OWNER_MCP');
  const ok = dispatchResolve.resolveOwnerDispatch({
    dataRoot, scope: 'ws', taskId: task.taskId, projectId: 'agent-relay',
    hostRoots: [hostRoot], includeCwdHostRoot: false,
  });
  assert.equal(ok.ok, true, `blockers=${ok.blockers.join(',')}`);
  assert.equal(ok.workerId, 'builder-fixture-b');
  assert.equal(ok.desiredBuilder, 'builder-fixture-b');
  assert.equal(ok.projectDesiredBuilder, 'builder-fixture-a');
  assert.equal(ok.modelId, 'test-model');
  assert.equal(ok.selectionApproved, true);
});

test('owner dispatch freezes selection and writes RunMeta.model', async () => {
  const { dataRoot, hostRoot, projectRoot } = fixture();
  const task = await createReadyTask(dataRoot, projectRoot, 'd');
  taskExec.setTaskExecutionConfig(dataRoot, 'ws', {
    projectId: 'agent-relay', taskId: task.taskId, workerId: 'builder-fixture-a', modelId: 'test-model',
  });
  taskExec.approveTaskExecution(dataRoot, 'ws', task.taskId, 'OWNER_MCP');

  await assert.rejects(
    () => v1Dispatch.dispatchV1OwnerApproved(dataRoot, 'ws', {
      taskId: task.taskId,
      workerId: 'builder-fixture-b',
      workspaceRoot: projectRoot,
      expectedExecutionState: 'READY',
    }),
    (err) => err?.code === 'WORKER_MISMATCH',
  );

  const result = await v1Dispatch.dispatchV1OwnerApproved(dataRoot, 'ws', {
    taskId: task.taskId,
    workerId: 'builder-fixture-a',
    workspaceRoot: projectRoot,
    expectedExecutionState: 'READY',
  });
  assert.ok(result.runId);
  const frozen = taskExec.getTaskExecutionConfig(dataRoot, 'ws', task.taskId);
  assert.ok(frozen?.selectionFrozenAt);
  assert.equal(frozen?.runId, result.runId);
  assert.equal(frozen?.effectiveModel, 'test-model');

  const linked = goalTask.getTask(dataRoot, 'ws', task.taskId).linkedRuns[0];
  const meta = fsMeta.readRunMeta(linked.folder);
  assert.equal(meta.model, 'test-model');
  assert.equal(meta.selectionSource, 'TASK_EXECUTION_CONFIG');
  assert.equal(meta.workerId, 'builder-fixture-a');

  assert.throws(
    () => taskExec.setTaskExecutionConfig(dataRoot, 'ws', {
      projectId: 'agent-relay', taskId: task.taskId, workerId: 'builder-fixture-b', modelId: 'test-model',
    }),
    (err) => err?.code === 'SELECTION_FROZEN' || err?.code === 'TASK_NOT_READY',
  );
  void hostRoot;
});

test('MCP tools registered for R01 selection surface', () => {
  const { dataRoot } = fixture();
  const tools = pmTools.buildAllPmTools({ dataRoot, project: 'ws' });
  const names = new Set(tools.map((t) => t.name));
  for (const n of [
    'relay_pm_list_executable_agents',
    'relay_pm_list_agent_models',
    'relay_pm_get_task_execution_config',
    'relay_pm_set_task_execution_config',
    'relay_pm_approve_task_execution',
  ]) {
    assert.ok(names.has(n), `missing ${n}`);
  }
});

test('listExecutableAgents excludes Team/QA; list models for fixture worker', async () => {
  const { dataRoot } = fixture();
  writeWorker(dataRoot, 'qa-fixture', { role: 'qa', workerId: 'qa-fixture' });
  writeWorker(dataRoot, 'claude-code', { workerId: 'claude-code' });
  const agents = taskExec.listExecutableAgents(dataRoot);
  assert.ok(agents.some((a) => a.workerId === 'builder-fixture-a' && a.available));
  assert.ok(!agents.some((a) => a.workerId === 'qa-fixture' && a.available));
  const team = agents.find((a) => a.workerId === 'claude-code');
  if (team) assert.equal(team.available, false);

  const tools = pmTools.buildAllPmTools({ dataRoot, project: 'ws' });
  const listModels = tools.find((t) => t.name === 'relay_pm_list_agent_models');
  const catalogRes = await listModels.handler({ workerId: 'builder-fixture-a' });
  assert.ok(catalogRes.models.some((m) => m.modelId === 'test-model'));
});
