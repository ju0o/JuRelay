/**
 * R01-SELECTION-SAFETY-01 — draft-only Agent/Model selection,
 * explicit save / approve / dispatch separation, canonical clear,
 * CANCELLED ≠ 완료 label contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(import.meta.dirname, '..');
const dist = (p) => path.join(repo, 'dist/server', p);
const srcPath = path.join(repo, 'src/mcp/app/pm-widget-resource.ts');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX_EXIT0 = path.resolve(__dirname, 'fixtures/workers/exit-zero-instant.mjs');
const NODE = process.execPath;

const widget = await import(dist('mcp/app/pm-widget-resource.js'));
const taskExec = await import(dist('backend/task-execution-config.js'));
const goalTask = await import(dist('backend/goal-task.js'));
const workerRegistry = await import(dist('backend/worker-registry.js'));
const wsConfig = await import(dist('workspace/config-v2.js'));
const uiState = await import(dist('backend/ui-state.js'));
const dispatchResolve = await import(dist('backend/dispatch-resolve.js'));
const v1Dispatch = await import(dist('backend/v1-dispatch.js'));
const disp = await import(dist('backend/dispatcher.js'));
const cap = await import(dist('backend/capture-service.js'));
const testFix = await import(dist('integrations/test-fixture/watch.js'));
const pmTools = await import(dist('mcp/pm-tools.js'));

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `arl-r01-sel-${prefix}-`));
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
    projectId: 'agent-relay',
    projectName: 'Agent-Relay',
  });
  return goalTask.createTask(dataRoot, 'ws', {
    goalId: goal.goalId,
    title,
    goal: title,
    reason: 'r01-sel',
    scope: projectRoot,
    completionCriteria: ['done'],
    executionState: 'READY',
    projectId: 'agent-relay',
    projectName: 'Agent-Relay',
  });
}

function widgetSrc() {
  return readFileSync(srcPath, 'utf8');
}

// ── A: Draft-only selection (source contract) ───────────────────────────────

test('A: Agent/Model change handlers are draft-only (no set on change)', () => {
  const src = widgetSrc();
  // Root cause of the host bug: change → persistTpSelection. Must be gone.
  const agentHandler = src.slice(
    src.indexOf("if (tpAgentSel) tpAgentSel.addEventListener('change'"),
    src.indexOf("if (tpModelSel) tpModelSel.addEventListener('change'"),
  );
  const modelHandler = src.slice(
    src.indexOf("if (tpModelSel) tpModelSel.addEventListener('change'"),
    src.indexOf("if (tpApproveChk) tpApproveChk.addEventListener('change'"),
  );
  assert.match(agentHandler, /draftDirty = true/);
  assert.match(agentHandler, /selectionApproved = false/);
  assert.doesNotMatch(agentHandler, /persistTpSelection/);
  assert.doesNotMatch(agentHandler, /relay_pm_set_task_execution_config/);
  assert.doesNotMatch(agentHandler, /relay_pm_approve_task_execution/);
  assert.doesNotMatch(agentHandler, /relay_pm_dispatch_owner_approved/);

  assert.match(modelHandler, /draftDirty = true/);
  assert.match(modelHandler, /selectionApproved = false/);
  assert.doesNotMatch(modelHandler, /persistTpSelection/);
  assert.doesNotMatch(modelHandler, /relay_pm_set_task_execution_config/);
  assert.doesNotMatch(modelHandler, /relay_pm_approve_task_execution/);
  assert.doesNotMatch(modelHandler, /relay_pm_dispatch_owner_approved/);

  // Explicit save button is the only persist entry from UI controls.
  assert.match(src, /id="tpSaveSel"/);
  assert.match(src, /선택 저장/);
  const saveHandler = src.slice(
    src.indexOf("if (tpSaveSel) tpSaveSel.addEventListener('click'"),
    src.indexOf("if (tpClearSel) tpClearSel.addEventListener('click'"),
  );
  assert.match(saveHandler, /persistTpSelection/);
});

test('A: Agent change invalidates model draft + approval', () => {
  const src = widgetSrc();
  const agentHandler = src.slice(
    src.indexOf("if (tpAgentSel) tpAgentSel.addEventListener('change'"),
    src.indexOf("if (tpModelSel) tpModelSel.addEventListener('change'"),
  );
  assert.match(agentHandler, /pendingPreview\.modelId = ''/);
  assert.match(agentHandler, /loadTpModels\(tpAgentSel\.value, ''\)/);
  assert.match(agentHandler, /tpApproveChk\.checked = false/);
});

// ── B: Explicit save / approve / dispatch separation ────────────────────────

test('B: approve handler does not persist or dispatch', () => {
  const src = widgetSrc();
  const approveHandler = src.slice(
    src.indexOf("if (tpApproveChk) tpApproveChk.addEventListener('change'"),
    src.indexOf('function wireTaskRows'),
  );
  assert.match(approveHandler, /relay_pm_approve_task_execution/);
  assert.doesNotMatch(approveHandler, /persistTpSelection/);
  assert.doesNotMatch(approveHandler, /relay_pm_set_task_execution_config/);
  assert.doesNotMatch(approveHandler, /relay_pm_dispatch_owner_approved/);
  assert.match(approveHandler, /Approve only/);
});

test('B: explicitOwnerRun dispatches only when saved+approved; no set/approve inside', () => {
  const src = widgetSrc();
  const runFn = src.slice(
    src.indexOf('async function explicitOwnerRun'),
    src.indexOf('async function cancelReadyPrep'),
  );
  assert.match(runFn, /selectionMatchesSaved/);
  assert.match(runFn, /selectionApproved/);
  assert.match(runFn, /relay_pm_dispatch_owner_approved/);
  assert.doesNotMatch(runFn, /persistTpSelection/);
  assert.doesNotMatch(runFn, /relay_pm_set_task_execution_config/);
  assert.doesNotMatch(runFn, /relay_pm_approve_task_execution/);
});

test('B: prepareGoalAndTask seeds empty saved selection (no auto workerId)', () => {
  const src = widgetSrc();
  const prep = src.slice(
    src.indexOf('async function prepareGoalAndTask'),
    src.indexOf('async function explicitOwnerRun'),
  );
  assert.match(prep, /savedWorkerId: ''/);
  assert.match(prep, /savedModelId: ''/);
  assert.match(prep, /draftDirty: true/);
  assert.match(prep, /selectionApproved: false/);
  // Must not seed workerId from resolve eligibility (that would look like auto-select).
  assert.doesNotMatch(prep, /workerId: \(elig && elig\.workerId\)/);
});

// ── C: Canonical clear API ──────────────────────────────────────────────────

test('C: clearTaskExecutionConfig removes unapproved READY config only', async () => {
  const { dataRoot, projectRoot } = fixture();
  const task = await createReadyTask(dataRoot, projectRoot, 'clear-ok');
  const other = await createReadyTask(dataRoot, projectRoot, 'clear-other');

  taskExec.setTaskExecutionConfig(dataRoot, 'ws', {
    projectId: 'agent-relay',
    taskId: task.taskId,
    workerId: 'builder-fixture-a',
    modelId: 'test-model',
  });
  taskExec.setTaskExecutionConfig(dataRoot, 'ws', {
    projectId: 'agent-relay',
    taskId: other.taskId,
    workerId: 'builder-fixture-b',
    modelId: 'test-model',
  });

  const beforeOther = taskExec.getTaskExecutionConfig(dataRoot, 'ws', other.taskId);
  assert.ok(beforeOther);

  const cleared = taskExec.clearTaskExecutionConfig(
    dataRoot, 'ws', task.taskId, 'agent-relay',
  );
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.taskId, task.taskId);
  assert.equal(cleared.previous?.workerId, 'builder-fixture-a');
  assert.equal(taskExec.getTaskExecutionConfig(dataRoot, 'ws', task.taskId), null);

  // Other task untouched.
  const afterOther = taskExec.getTaskExecutionConfig(dataRoot, 'ws', other.taskId);
  assert.deepEqual(afterOther, beforeOther);

  // Idempotent when already absent.
  const again = taskExec.clearTaskExecutionConfig(dataRoot, 'ws', task.taskId, 'agent-relay');
  assert.equal(again.cleared, false);
  assert.equal(again.previous, null);
});

test('C: clear refuses approved / wrong projectId / frozen', async () => {
  const { dataRoot, hostRoot, projectRoot } = fixture();
  const task = await createReadyTask(dataRoot, projectRoot, 'clear-refuse');
  assert.equal(task.projectId, 'agent-relay');
  taskExec.setTaskExecutionConfig(dataRoot, 'ws', {
    projectId: 'agent-relay',
    taskId: task.taskId,
    workerId: 'builder-fixture-a',
    modelId: 'test-model',
  });

  assert.throws(
    () => taskExec.clearTaskExecutionConfig(dataRoot, 'ws', task.taskId, 'wrong-project'),
    (err) => err?.code === 'INVALID_ARGUMENT' && /projectId mismatch/.test(String(err.message)),
  );
  assert.ok(taskExec.getTaskExecutionConfig(dataRoot, 'ws', task.taskId));

  taskExec.approveTaskExecution(dataRoot, 'ws', task.taskId, 'OWNER_MCP');
  assert.throws(
    () => taskExec.clearTaskExecutionConfig(dataRoot, 'ws', task.taskId, 'agent-relay'),
    (err) => err?.code === 'INVALID_ARGUMENT' && /승인된/.test(String(err.message)),
  );

  // After dispatch freeze, clear must refuse (TASK_NOT_READY once dispatched).
  await v1Dispatch.dispatchV1OwnerApproved(dataRoot, 'ws', {
    taskId: task.taskId,
    workerId: 'builder-fixture-a',
    workspaceRoot: projectRoot,
    expectedExecutionState: 'READY',
  });
  assert.throws(
    () => taskExec.clearTaskExecutionConfig(dataRoot, 'ws', task.taskId, 'agent-relay'),
    (err) => err?.code === 'SELECTION_FROZEN' || err?.code === 'TASK_NOT_READY',
  );
  void hostRoot;
});

test('C: MCP tool relay_pm_clear_task_execution_config is registered', () => {
  const { dataRoot } = fixture();
  const tools = pmTools.buildAllPmTools({ dataRoot, project: 'ws' });
  const names = new Set(tools.map((t) => t.name));
  assert.ok(names.has('relay_pm_clear_task_execution_config'));
  assert.match(widgetSrc(), /relay_pm_clear_task_execution_config/);
  assert.match(widgetSrc(), /id="tpClearSel"/);
});

// ── D: CANCELLED ≠ 완료 ─────────────────────────────────────────────────────

test('D: isDoneTask excludes CANCELLED (source contract; no speculative label fix)', () => {
  const src = widgetSrc();
  const doneFn = src.slice(
    src.indexOf('function isDoneTask'),
    src.indexOf('function taskTitleOf'),
  );
  assert.match(doneFn, /pmState === 'ACCEPTED'/);
  assert.match(doneFn, /executionState === 'COMPLETED'/);
  assert.doesNotMatch(doneFn, /CANCELLED/);
  assert.doesNotMatch(doneFn, /ABANDONED/);

  const statusFn = src.slice(
    src.indexOf('function taskStatus(task)'),
    src.indexOf('function taskStatusLabel'),
  );
  // CANCELLED falls through to planned → 대기, never done.
  assert.match(statusFn, /isDoneTask/);
  assert.match(statusFn, /return 'planned'/);
});

// ── E: Approval / dispatch fail-closed + disk invariant on draft ────────────

test('E: model change on disk only via set; approve alone does not dispatch', async () => {
  const { dataRoot, hostRoot, projectRoot } = fixture();
  const task = await createReadyTask(dataRoot, projectRoot, 'disk');

  assert.equal(taskExec.getTaskExecutionConfig(dataRoot, 'ws', task.taskId), null);

  // Simulate "draft only" — UI would change selects without calling set.
  // Disk must stay empty until explicit set.
  assert.equal(taskExec.getTaskExecutionConfig(dataRoot, 'ws', task.taskId), null);

  const cfg = taskExec.setTaskExecutionConfig(dataRoot, 'ws', {
    projectId: 'agent-relay',
    taskId: task.taskId,
    workerId: 'builder-fixture-a',
    modelId: 'test-model',
  });
  assert.equal(cfg.ownerApproval.approved, false);

  // Changing selection again clears approval (set path).
  const cfg2 = taskExec.setTaskExecutionConfig(dataRoot, 'ws', {
    projectId: 'agent-relay',
    taskId: task.taskId,
    workerId: 'builder-fixture-b',
    modelId: 'test-model',
  });
  assert.equal(cfg2.workerId, 'builder-fixture-b');
  assert.equal(cfg2.ownerApproval.approved, false);

  // Unapproved resolve is blocked — approve alone does not spawn.
  const blocked = dispatchResolve.resolveOwnerDispatch({
    dataRoot, scope: 'ws', taskId: task.taskId, projectId: 'agent-relay',
    hostRoots: [hostRoot], includeCwdHostRoot: false,
  });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.blockers.includes('OWNER_APPROVAL_REQUIRED'));

  taskExec.approveTaskExecution(dataRoot, 'ws', task.taskId, 'OWNER_MCP');
  const afterApprove = goalTask.getTask(dataRoot, 'ws', task.taskId);
  assert.equal(afterApprove.executionState, 'READY');
  assert.equal((afterApprove.linkedRuns || []).length, 0);

  // Re-set after approve invalidates approval.
  taskExec.setTaskExecutionConfig(dataRoot, 'ws', {
    projectId: 'agent-relay',
    taskId: task.taskId,
    workerId: 'builder-fixture-a',
    modelId: 'test-model',
  });
  const afterReset = taskExec.getTaskExecutionConfig(dataRoot, 'ws', task.taskId);
  assert.equal(afterReset.ownerApproval.approved, false);

  await assert.rejects(
    () => v1Dispatch.dispatchV1OwnerApproved(dataRoot, 'ws', {
      taskId: task.taskId,
      workerId: 'builder-fixture-a',
      workspaceRoot: projectRoot,
      expectedExecutionState: 'READY',
    }),
    (err) => err?.code === 'OWNER_APPROVAL_REQUIRED' || /approv/i.test(String(err?.message || err)),
  );

  const still = goalTask.getTask(dataRoot, 'ws', task.taskId);
  assert.equal(still.executionState, 'READY');
  assert.equal((still.linkedRuns || []).length, 0);
});

// ── Tabs / fingerprint continuity ───────────────────────────────────────────

test('E: five tabs + Save/Clear controls present; fingerprint reminted', () => {
  const html = widget.getPmWidgetHtml
    ? widget.getPmWidgetHtml()
    : (() => {
        const src = widgetSrc();
        const m = src.match(/const WIDGET_HTML = `([\s\S]*?)`;/);
        assert.ok(m);
        return m[1];
      })();
  for (const tab of ['now', 'task', 'goal', 'proto', 'design']) {
    assert.match(html, new RegExp(`data-tab="${tab}"`));
  }
  assert.match(html, /id="tpSaveSel"/);
  assert.match(html, /id="tpClearSel"/);
  assert.match(html, /id="tpApproveChk"/);
  assert.match(widget.PM_WIDGET_RESOURCE_URI, /^ui:\/\/agent-relay\/pm-widget-[0-9a-f]{8}$/);
  // Must differ from prior R01-HOST-FIX fingerprint (9dc123b6) once HTML/script changed.
  assert.notEqual(widget.PM_WIDGET_CONTENT_FINGERPRINT, '9dc123b6');
  assert.notEqual(widget.PM_WIDGET_CONTENT_FINGERPRINT, 'b059f083');
});
