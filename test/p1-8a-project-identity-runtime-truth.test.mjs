/**
 * P1.8A — Project identity + runtime truth regression.
 *
 * Cases (per the WBS):
 *   A  a JuIntake Task is created → projectId = juintake
 *   B  a JuCar Task is created    → projectId = jucar
 *   C  two projects never share one Inbox (per-project container Goal)
 *   D  persisted RUNNING + a live worker process → ACTIVE
 *   E  persisted RUNNING + no worker process      → ORPHAN (never "running")
 *   F  the dashboard separates persisted RUNNING from actually-active Runs
 *   G  a historical project="ws" Task (no identity) still reads without crashing
 *   H  the pre-existing Agent Relay PM flow is unchanged (no explicit identity →
 *      the Agent Relay project, READY+PENDING, its own container)
 *
 * Plus the historical audit fixtures (TASK-0007/0049/0054/0056/0068): they must be
 * classified truthfully and must NOT be mutated by reading them.
 *
 * Everything runs against dist/, like the rest of this suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const dist = (p) => path.join(repo, 'dist/server', p);

const identity = await import(dist('backend/project-identity.js'));
const runtimeTruth = await import(dist('backend/runtime-truth.js'));
const pmTools = await import(dist('mcp/pm-tools.js'));
const goalTask = await import(dist('backend/goal-task.js'));

function dataRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `arl-p18a-${prefix}-`));
}

/** Build the PM tool surface for one storage scope. */
function pm(dataRoot, project) {
  const tools = pmTools.buildAllPmTools({ dataRoot, project });
  const get = (name) => {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `tool ${name} is registered`);
    return tool;
  };
  return { tools, get };
}

const CONTRACT = {
  title: 'P1.8A intake task',
  goal: 'Intended outcome',
  reason: 'PM finalized contract reason',
  scope: 'Narrow scope',
  completionCriteria: ['done when the worker result is received'],
};

/** Write a Task file directly, for states intake cannot reach (RUNNING, legacy). */
function writeTaskFile(root, project, task) {
  const folder = path.join(root, project, '_relay', 'tasks', task.taskId);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'task.json'), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  return folder;
}

function runFolder(root, project, taskId, seq, runId, extra = {}) {
  const folder = path.join(root, project, '2026-10-05', 'worker-test', String(seq).padStart(2, '0'));
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, 'meta.json'),
    JSON.stringify({ runId, taskId, goalId: 'GOAL-0001', taskRunSequence: seq, workerId: 'worker-test', ...extra }, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(folder, 'worker-launch.log'),
    `${JSON.stringify({ worker: 'relay-worker-test', taskId, runId, model: 'test/model-1', at: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
  return folder;
}

function baseTask(over) {
  return {
    schemaVersion: 2,
    taskId: 'TASK-0900',
    goalId: 'GOAL-0001',
    project: 'ws',
    title: 'fixture',
    goal: 'g',
    reason: 'r',
    scope: 's',
    completionCriteria: [],
    executionState: 'PLANNED',
    pmState: 'PENDING',
    dependencies: [],
    linkedRuns: [],
    nextTaskRunSequence: 1,
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    ...over,
  };
}

// ── Identity contract ───────────────────────────────────────────────────────

test('P1.8A-1 projectId is machine-safe and stable', () => {
  assert.equal(identity.normalizeProjectId('JuIntake'), 'juintake');
  assert.equal(identity.normalizeProjectId('Insurance CRM'), 'insurance-crm');
  assert.equal(identity.normalizeProjectId('JuCar'), 'jucar');
  assert.equal(identity.normalizeProjectId('agent-relay'), 'agent-relay');
  assert.equal(identity.normalizeProjectId('  Ju_Car  '), 'ju-car');
  assert.throws(() => identity.normalizeProjectId(''), /projectId/);
  assert.throws(() => identity.normalizeProjectId('!!!'), /projectId/);
});

test('P1.8A-2 the generic ws bucket no longer mints "ws" as an identity', () => {
  const resolved = identity.resolveProjectIdentity({ scope: 'ws' });
  assert.equal(resolved.projectId, 'agent-relay');
  assert.equal(resolved.projectName, 'Agent Relay');
  assert.equal(resolved.source, 'SCOPE_DEFAULT');
  assert.equal(resolved.legacy, false, 'a named default is a chosen identity, not a guess');
  assert.equal(resolved.scope, 'ws', 'the storage scope is still where bytes land');
});

test('P1.8A-3 an ordinary single-project scope keeps working, flagged as inherited', () => {
  const resolved = identity.resolveProjectIdentity({ scope: 'V1G1Proj' });
  assert.equal(resolved.projectId, 'v1g1proj');
  assert.equal(resolved.source, 'SCOPE_LEGACY');
  assert.equal(resolved.legacy, true, 'nobody declared this identity — it was inherited from the folder');
  assert.equal(resolved.genericBucket, false, 'but it is a real folder, not a machine layout name');
});

test('P1.8A-4 an explicit identity always wins', () => {
  const resolved = identity.resolveProjectIdentity({
    scope: 'ws',
    projectId: 'JuIntake',
    projectName: 'JuIntake',
  });
  assert.equal(resolved.projectId, 'juintake');
  assert.equal(resolved.projectName, 'JuIntake');
  assert.equal(resolved.source, 'EXPLICIT');
  // name derived from the id when only the id was given
  assert.equal(identity.resolveProjectIdentity({ scope: 'ws', projectId: 'ju-car' }).projectName, 'Ju Car');
});

test('P1.8A-5 a deployment registry can declare the scope without a code change', () => {
  const root = dataRoot('registry');
  fs.mkdirSync(path.join(root, '_relay'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '_relay', 'projects.json'),
    JSON.stringify({ schemaVersion: 1, scopeDefaults: { ws: { projectId: 'house-projects', projectName: 'House Projects' } } }),
    'utf8',
  );
  const resolved = identity.defaultIdentityForScope(root, 'ws');
  assert.equal(resolved.projectId, 'house-projects');
  assert.equal(resolved.source, 'REGISTRY');
  // A malformed registry must never make resolution fail.
  fs.writeFileSync(path.join(root, '_relay', 'projects.json'), '{not json', 'utf8');
  assert.equal(identity.defaultIdentityForScope(root, 'ws').projectId, 'agent-relay');
});

// ── CASE A / B / C — intake owns identity, containers are per project ────────

test('CASE A a JuIntake Task is created with projectId juintake', async () => {
  const root = dataRoot('juintake');
  const { get } = pm(root, 'ws');
  const res = await get('relay_pm_create_task').handler({
    ...CONTRACT,
    projectId: 'JuIntake',
    projectName: 'JuIntake',
    title: 'JuIntake intake form',
  });
  assert.equal(res.task.projectId, 'juintake');
  assert.equal(res.task.projectName, 'JuIntake');
  assert.equal(res.project.projectId, 'juintake');
  assert.equal(res.task.project, 'ws', 'storage scope is unchanged — no bulk migration');
  const persisted = goalTask.getTask(root, 'ws', res.task.taskId);
  assert.equal(persisted.projectId, 'juintake', 'identity is persisted, not only returned');
  assert.equal(goalTask.getGoal(root, 'ws', persisted.goalId).projectId, 'juintake');
});

test('CASE B a JuCar Task is created with projectId jucar', async () => {
  const root = dataRoot('jucar');
  const { get } = pm(root, 'ws');
  const res = await get('relay_pm_create_task').handler({
    ...CONTRACT,
    projectId: 'JuCar',
    projectName: 'JuCar',
    title: 'JuCar SD baseline',
  });
  assert.equal(res.task.projectId, 'jucar');
  assert.equal(res.task.projectName, 'JuCar');
  assert.equal(goalTask.getGoal(root, 'ws', res.task.goalId).projectId, 'jucar');
});

test('CASE C two projects never share one Inbox', async () => {
  const root = dataRoot('isolation');
  const { get } = pm(root, 'ws');
  const juintake = await get('relay_pm_create_task').handler({
    ...CONTRACT, projectId: 'juintake', projectName: 'JuIntake', title: 'JuIntake work',
  });
  const jucar = await get('relay_pm_create_task').handler({
    ...CONTRACT, projectId: 'jucar', projectName: 'JuCar', title: 'JuCar work',
  });

  assert.notEqual(juintake.task.goalId, jucar.task.goalId, 'different containers');
  assert.equal(juintake.goal.title, 'JuIntake V1 Task Inbox');
  assert.equal(jucar.goal.title, 'JuCar V1 Task Inbox');

  // Deterministic reuse: a second Task of the same project reuses its container.
  const again = await get('relay_pm_create_task').handler({
    ...CONTRACT, projectId: 'juintake', projectName: 'JuIntake', title: 'JuIntake work 2',
  });
  assert.equal(again.task.goalId, juintake.task.goalId, 'same project reuses its container');
  assert.equal(again.containerReused, true);

  // The cross-product container check: no container may hold another project's Task.
  for (const task of goalTask.listTasks(root, 'ws')) {
    const container = goalTask.getGoal(root, 'ws', task.goalId);
    assert.equal(
      container.projectId,
      task.projectId,
      `Task ${task.taskId} (${task.projectId}) sits in container ${container.goalId} (${container.projectId})`,
    );
    assert.ok(
      (container.tags ?? []).includes(`project:${task.projectId}`),
      `container ${container.goalId} is tagged for ${task.projectId}`,
    );
  }
  assert.equal(goalTask.listGoals(root, 'ws').length, 2, 'exactly one container per project');
});

test('CASE H the existing Agent Relay PM flow is unchanged', async () => {
  const root = dataRoot('compat');
  const { get } = pm(root, 'ws');
  const first = await get('relay_pm_create_task').handler({ ...CONTRACT, title: 'no identity given' });
  assert.equal(first.task.projectId, 'agent-relay', 'never "ws"');
  assert.equal(first.task.projectName, 'Agent Relay');
  assert.equal(first.task.executionState, 'READY');
  assert.equal(first.task.pmState, 'PENDING');
  assert.equal(first.goal.title, 'Agent Relay V1 Task Inbox');
  assert.equal(first.containerReused, false);
  assert.equal(first.task.linkedRuns.length, 0, 'no auto-dispatch');

  const second = await get('relay_pm_create_task').handler({ ...CONTRACT, title: 'second' });
  assert.equal(second.task.goalId, first.task.goalId, 'same project reuses one container');
  assert.equal(second.containerReused, true);
  assert.equal(goalTask.listTasks(root, 'ws').length, 2);
});

test('P1.8A-6 a historical untagged container is not reused for a new project', async () => {
  const root = dataRoot('legacy-container');
  const { get } = pm(root, 'ws');
  // Reproduce GOAL-0002: the pre-P1.8A shared container.
  const legacy = await goalTask.createGoal(root, 'ws', {
    title: 'V1 Single-Task Inbox (internal technical container)',
    goalStatement: 'Internal V1 technical container for single-task relay.',
    description: 'V1-G1 internal compatibility container. Do not use as product Goal UX.',
    tags: ['v1-internal', 'technical-container'],
  });
  const res = await get('relay_pm_create_task').handler({
    ...CONTRACT, projectId: 'juintake', projectName: 'JuIntake',
  });
  assert.notEqual(res.task.goalId, legacy.goalId, 'new work never enters the shared legacy inbox');
  const untouched = goalTask.getGoal(root, 'ws', legacy.goalId);
  assert.deepEqual(untouched.tags, ['v1-internal', 'technical-container'], 'historical container untouched');
});

test('P1.8A-7 projectName alone is rejected at the MCP boundary', async () => {
  const root = dataRoot('reject');
  const { get } = pm(root, 'ws');
  await assert.rejects(
    () => get('relay_pm_create_task').handler({ ...CONTRACT, projectName: 'JuIntake' }),
    /projectId/,
  );
});

// ── Runtime truth — pure ladder ─────────────────────────────────────────────

function signals(over) {
  return {
    taskId: 'TASK-0900',
    executionState: 'RUNNING',
    liveHandle: null,
    handleProcessAlive: false,
    observedPid: null,
    lastActivityAtMs: Date.now(),
    evidenceReadable: true,
    processProbeAvailable: true,
    orphanSuspected: false,
    nowMs: Date.now(),
    ...over,
  };
}

test('P1.8A-8 persisted RUNNING with no live process is ORPHAN, never running', () => {
  const verdict = runtimeTruth.evaluateTaskRuntime(signals({ nowMs: 1_000_000 }));
  assert.equal(verdict.runtimeState, 'ORPHAN');
  assert.equal(verdict.liveProcess, false);
  assert.ok(/no live worker process/.test(verdict.reason), verdict.reason);
});

test('P1.8A-9 a live process with fresh evidence is ACTIVE; silent too long is STALE', () => {
  const now = 10_000_000_000;
  const active = runtimeTruth.evaluateTaskRuntime(signals({
    liveHandle: { workerId: 'builder-opencode', pid: process.pid, dispatchedAt: new Date(now).toISOString() },
    handleProcessAlive: true,
    lastActivityAtMs: now - 60_000,
    nowMs: now,
  }));
  assert.equal(active.runtimeState, 'ACTIVE');
  assert.equal(active.liveProcess, true);

  const stale = runtimeTruth.evaluateTaskRuntime(signals({
    liveHandle: { workerId: 'builder-opencode', pid: process.pid, dispatchedAt: new Date(now - 3_600_000).toISOString() },
    handleProcessAlive: true,
    lastActivityAtMs: now - 3_600_000,
    nowMs: now,
  }));
  assert.equal(stale.runtimeState, 'STALE');
});

test('P1.8A-10 a live handle whose process is gone is ORPHAN', () => {
  const verdict = runtimeTruth.evaluateTaskRuntime(signals({
    liveHandle: { workerId: 'builder-opencode', pid: 999_999, dispatchedAt: new Date().toISOString() },
    handleProcessAlive: false,
  }));
  assert.equal(verdict.runtimeState, 'ORPHAN');
  assert.match(verdict.reason, /process is gone/);
});

test('P1.8A-11 unprovable liveness is UNKNOWN, never rounded to ORPHAN', () => {
  assert.equal(
    runtimeTruth.evaluateTaskRuntime(signals({ evidenceReadable: false })).runtimeState,
    'UNKNOWN',
  );
  assert.equal(
    runtimeTruth.evaluateTaskRuntime(signals({ processProbeAvailable: false })).runtimeState,
    'UNKNOWN',
  );
});

test('P1.8A-12 a non in-flight persisted state is IDLE, whatever the process table says', () => {
  for (const executionState of ['READY', 'PLANNED', 'RESULT_RECEIVED', 'ACCEPTED']) {
    const verdict = runtimeTruth.evaluateTaskRuntime(signals({ executionState }));
    assert.equal(verdict.runtimeState, 'IDLE', executionState);
  }
});

// ── CASE D / E / F — end-to-end through the dashboard, real processes ───────

test('CASE D/E/F the dashboard tells persisted RUNNING apart from actually running', async (t) => {
  const root = dataRoot('dashboard');
  const { get } = pm(root, 'ws');
  const container = await get('relay_pm_create_task').handler({
    ...CONTRACT, projectId: 'jucar', projectName: 'JuCar', title: 'JuCar carrier',
  });
  const goalId = container.task.goalId;

  // A dead-but-persisted Task: RUNNING, Run folder on disk, no process anywhere.
  const orphanRunId = 'orphan-run-0001';
  const orphanFolder = runFolder(root, 'ws', 'TASK-0901', 1, orphanRunId);
  writeTaskFile(root, 'ws', baseTask({
    taskId: 'TASK-0901',
    goalId,
    projectId: 'jucar',
    projectName: 'JuCar',
    title: 'JuCar SD restore',
    executionState: 'RUNNING',
    nextTaskRunSequence: 2,
    linkedRuns: [{ runId: orphanRunId, folder: orphanFolder, taskRunSequence: 1, agent: 'builder-opencode' }],
  }));

  // A genuinely live Task: a real process whose command line names this Run.
  const liveRunId = 'live-run-0002';
  const liveFolder = runFolder(root, 'ws', 'TASK-0902', 1, liveRunId);
  writeTaskFile(root, 'ws', baseTask({
    taskId: 'TASK-0902',
    goalId,
    projectId: 'jucar',
    projectName: 'JuCar',
    title: 'JuCar evidence packet',
    executionState: 'RUNNING',
    nextTaskRunSequence: 2,
    linkedRuns: [{ runId: liveRunId, folder: liveFolder, taskRunSequence: 1, agent: 'builder-opencode' }],
  }));

  const child = spawn(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 120000)', '--', 'relay-worker-codex', liveRunId],
    { stdio: 'ignore' },
  );
  t.after(() => child.kill());
  // The probe is cached for 3 s; drop it so the new process is seen immediately.
  runtimeTruth._resetProcessProbeCacheForTests();
  await new Promise((resolve) => setTimeout(resolve, 300));

  // A second project in the same storage scope, so selection has something to
  // choose between.
  await get('relay_pm_create_task').handler({ ...CONTRACT, title: 'Agent Relay waiting task' });

  const dash = await get('relay_pm_get_dashboard').handler({});
  const jucar = dash.projects.find((p) => p.projectId === 'jucar');
  assert.ok(jucar, `jucar project row missing: ${JSON.stringify(dash.projects)}`);
  assert.equal(dash.projects.length, 2, 'two logical projects share one storage scope');

  const byTask = (id) => jucar.tasks.find((x) => x.taskId === id);
  assert.equal(byTask('TASK-0902').runtimeState, 'ACTIVE', 'live worker process → ACTIVE');
  assert.equal(byTask('TASK-0901').runtimeState, 'ORPHAN', 'no worker process → ORPHAN');
  assert.equal(byTask('TASK-0901').executionState, 'RUNNING', 'the persisted state is reported, not rewritten');

  // CASE F: the persisted counter and the actual-active counter are separate.
  assert.equal(dash.tasks.RUNNING, 2, 'two Tasks are persisted RUNNING (the intake Task is READY)');
  assert.equal(dash.summary.persistedRunning, 2);
  assert.equal(dash.summary.actualActiveRuns, 1, 'exactly one Run is actually live');
  assert.equal(dash.summary.orphanRuns, 1);
  assert.notEqual(
    dash.summary.persistedRunning,
    dash.summary.actualActiveRuns,
    'a persisted RUNNING count must never be read as an active count',
  );

  // CASE F: project-centric shape the WBS asks for.
  assert.equal(jucar.activeTask.taskId, 'TASK-0902');
  assert.equal(jucar.runtimeState, 'ACTIVE');
  assert.equal(jucar.activeGoal.goalId, goalId);
  assert.ok(jucar.lastActivityAt, 'lastActivityAt is present');
  assert.equal(jucar.nextAction, 'WAIT_FOR_WORKER');
  assert.equal(jucar.agent, null, 'no Dispatcher handle in this process — the pid comes from the probe');
  assert.equal(jucar.model, 'test/model-1');
  assert.equal(dash.selectedProject.projectId, 'jucar');
  assert.equal(dash.activeProjects.length, 1);

  // The legacy keys the existing widget reads are untouched.
  for (const key of ['project', 'agents', 'tasks', 'goals', 'pendingDeliveries', 'portfolio']) {
    assert.ok(key in dash, `legacy dashboard key ${key} still present`);
  }
  assert.equal(dash.project, 'ws');
  assert.equal(dash.projectIdentity.projectId, 'agent-relay', 'the ws scope means the Agent Relay project');
  assert.equal(dash.projectIdentity.genericBucket, true);
  assert.equal(jucar.genericBucket, false);

  // TASK 7 (option C): selection is explicit and its basis is always reported, so
  // the Founder can never be looking at one project while believing it is another.
  assert.equal(dash.selectedProject.projectId, 'jucar', 'no argument → the most recently active project');
  assert.equal(dash.selectedProjectBasis, 'LAST_ACTIVE');
  const explicit = await get('relay_pm_get_dashboard').handler({ projectId: 'agent-relay' });
  assert.equal(explicit.selectedProject.projectId, 'agent-relay');
  assert.equal(explicit.selectedProjectBasis, 'ARGUMENT');
  const unknown = await get('relay_pm_get_dashboard').handler({ projectId: 'no-such-project' });
  assert.notEqual(unknown.selectedProjectBasis, 'ARGUMENT', 'an unknown id never claims to be the selection');
  assert.equal(unknown.selectedProject.projectId, 'jucar', 'it falls back deterministically instead');
});

// ── CASE G — historical records ─────────────────────────────────────────────

test('CASE G a historical project="ws" Task reads without crashing', async () => {
  const root = dataRoot('legacy-read');
  const { get } = pm(root, 'ws');
  const container = await get('relay_pm_create_task').handler({
    ...CONTRACT, projectId: 'agent-relay', projectName: 'Agent Relay', title: 'seed',
  });
  // A Task written before P1.8A: project = "ws", no projectId/projectName.
  const file = writeTaskFile(root, 'ws', baseTask({
    taskId: 'TASK-0903',
    goalId: container.task.goalId,
    title: 'Implement JuIntake V1 files and push',
    executionState: 'RESULT_RECEIVED',
  }));
  const task = goalTask.getTask(root, 'ws', 'TASK-0903');
  assert.equal(task.project, 'ws');
  assert.equal(task.projectId, undefined, 'no identity is invented on read');
  assert.equal(task.executionState, 'RESULT_RECEIVED');

  const derived = identity.describeRecordProjectIdentity(task, 'ws');
  assert.equal(derived.projectId, 'ws');
  assert.equal(derived.source, 'RECORD_LEGACY');
  assert.equal(derived.legacy, true, 'the Founder must see that this record predates identity');

  const dash = get('relay_pm_get_dashboard');
  const legacyDash = dash.handler;
  const snapshot = await legacyDash({});
  assert.ok(snapshot.projects.some((p) => p.projectId === 'ws' && p.legacy === true), 'legacy rows are grouped and flagged');
  assert.equal(
    snapshot.projects.find((p) => p.projectId === 'ws').projectName,
    'ws',
    'a legacy row must not be title-cased into a product-looking name',
  );

  // "Which project am I looking at?" must answer the scope's own product, not the
  // unnamed legacy pile that happens to share its storage bucket.
  assert.equal(snapshot.projectIdentity.projectId, 'agent-relay');
  assert.equal(snapshot.selectedProject.projectId, 'agent-relay');
  assert.equal(snapshot.selectedProjectBasis, 'SCOPE');

  // Reading must not write: the historical file is byte-identical afterwards.
  const after = fs.readFileSync(path.join(file, 'task.json'), 'utf8');
  assert.ok(!after.includes('projectId'), 'no identity was back-filled into a historical Task');
});

// ── TASK 8 — historical audit fixtures must classify truthfully, unmutated ──

const LIVE_ROOT = process.env.AGENT_RELAY_FIXTURE_ROOT
  ?? path.join(os.homedir(), '.local/share/AgentRelay/data');
const FIXTURES = ['TASK-0007', 'TASK-0049', 'TASK-0054', 'TASK-0056', 'TASK-0068'];

test('TASK 8 the historical stale fixtures classify as ORPHAN and are never mutated', async (t) => {
  const wsTasks = path.join(LIVE_ROOT, 'ws', '_relay', 'tasks');
  if (!fs.existsSync(wsTasks)) {
    t.skip(`no live ws data root at ${LIVE_ROOT} (set AGENT_RELAY_FIXTURE_ROOT to run this case)`);
    return;
  }
  const present = FIXTURES.filter((id) => fs.existsSync(path.join(wsTasks, id, 'task.json')));
  assert.equal(present.length, FIXTURES.length, `all audit fixtures present under ${wsTasks}`);

  const before = new Map(
    FIXTURES.map((id) => [id, fs.readFileSync(path.join(wsTasks, id, 'task.json'), 'utf8')]),
  );
  const tasks = FIXTURES.map((id) => goalTask.getTask(LIVE_ROOT, 'ws', id));
  for (const task of tasks) {
    assert.equal(task.executionState, 'RUNNING', `${task.taskId} is still persisted RUNNING — untouched`);
    assert.equal(task.project, 'ws');
  }

  const { get } = pm(LIVE_ROOT, 'ws');
  const dash = await get('relay_pm_get_dashboard').handler({});

  for (const id of FIXTURES) {
    const view = dash.projects
      .flatMap((p) => p.tasks)
      .find((x) => x.taskId === id);
    assert.ok(view, `${id} must appear in the dashboard runtime view`);
    assert.equal(view.executionState, 'RUNNING');
    // Truthful classification: ORPHAN unless a real worker process for this Run
    // is alive right now, which would make ACTIVE the correct answer.
    const probe = runtimeTruth.listLiveWorkerProcesses();
    const live = probe !== null && probe.some((p) => p.cmdline.includes(id));
    assert.equal(
      view.runtimeState,
      live ? 'ACTIVE' : 'ORPHAN',
      `${id}: runtimeState=${view.runtimeState} (live worker process: ${live})`,
    );
    if (!live) {
      assert.equal(dash.summary.orphanRuns >= 5, true, `orphan count must include the fixtures (${dash.summary.orphanRuns})`);
      assert.equal(view.nextAction, 'PM_RESOLVE_ORPHAN', `${id} next action must be an owner decision`);
    }
  }

  // Not counted as running: the fixtures inflate persistedRunning, never actualActiveRuns.
  assert.ok(dash.summary.persistedRunning >= FIXTURES.length);
  assert.ok(dash.summary.actualActiveRuns < dash.summary.persistedRunning);

  // P1.8A forbids mutating historical state; this read must not have.
  for (const id of FIXTURES) {
    assert.equal(
      fs.readFileSync(path.join(wsTasks, id, 'task.json'), 'utf8'),
      before.get(id),
      `${id} task.json unchanged by the read`,
    );
  }
});