/**
 * P1.8C-03 — First-run Bootstrap UX.
 *
 * Cases A–Q per WBS. Gate logic is unit-tested from bootstrap-gate;
 * widget contract + C01/C02 persistence + zero-execution are integration-tested.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const dist = (p) => path.join(repo, 'dist/server', p);

const gate = await import(dist('mcp/app/bootstrap-gate.js'));
const profileMod = await import(dist('backend/project-profile.js'));
const uiState = await import(dist('backend/ui-state.js'));
const goalTask = await import(dist('backend/goal-task.js'));
const workerRegistry = await import(dist('backend/worker-registry.js'));
const assignment = await import(dist('backend/project-assignment.js'));
const wsConfig = await import(dist('workspace/config-v2.js'));
const pmTools = await import(dist('mcp/pm-tools.js'));
const appServer = await import(dist('mcp/app-server.js'));
const widget = await import(dist('mcp/app/pm-widget-resource.js'));

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `arl-p18c03-${prefix}-`));
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

function writeRole(root, projectKey, workspaceRoot) {
  const dir = path.join(root, '_relay', 'roles');
  fs.mkdirSync(dir, { recursive: true });
  const config = {
    schema_version: 'role-config.v1',
    project: projectKey,
    assignments: [
      {
        roleId: 'pm',
        runtimeAdapterId: 'chatgpt',
        provider: 'openai',
        model: 'default',
        workspace: { project: projectKey, workspaceRoot },
        sessionPolicy: 'persistent',
        permissionProfile: 'read-only',
        capabilityRequirements: {},
        zeroExtraBilling: true,
        fallbackChain: [],
        enabled: true,
      },
      {
        roleId: 'builder',
        runtimeAdapterId: 'builder-opencode',
        provider: 'opencode',
        model: 'default',
        workspace: { project: projectKey, workspaceRoot },
        sessionPolicy: 'per-task',
        permissionProfile: 'write-workspace',
        capabilityRequirements: {},
        zeroExtraBilling: true,
        fallbackChain: [],
        enabled: true,
      },
      {
        roleId: 'qa',
        runtimeAdapterId: 'qa-cline',
        provider: 'cline',
        model: 'default',
        workspace: { project: projectKey, workspaceRoot },
        sessionPolicy: 'per-task',
        permissionProfile: 'read-only',
        capabilityRequirements: {},
        zeroExtraBilling: true,
        fallbackChain: [],
        enabled: true,
      },
    ],
  };
  fs.writeFileSync(path.join(dir, `${projectKey}.json`), `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

function countGoalsTasks(root, project) {
  let goals = 0;
  let tasks = 0;
  try { goals = goalTask.listGoals(root, project).length; } catch { goals = 0; }
  try { tasks = goalTask.listTasks(root, project).length; } catch { tasks = 0; }
  return { goals, tasks };
}

// —— Gate unit cases ——

test('A first run, no persisted selection → bootstrap shown', () => {
  assert.equal(gate.needsFirstRunBootstrap(null, null), true);
  assert.equal(gate.needsFirstRunBootstrap('', null), true);
  assert.equal(gate.needsFirstRunBootstrap(undefined, undefined), true);
});

test('B valid persisted CONFIGURED selection → bootstrap skipped', () => {
  const profile = {
    projectId: 'agent-relay',
    profileState: 'CONFIGURED',
    workspaceConfigured: true,
    workspacePath: '/home/x/Agent-Relay',
    workspaceConflict: false,
    legacy: false,
  };
  assert.equal(gate.needsFirstRunBootstrap('agent-relay', profile), false);
});

test('D LEGACY cannot be completed as normal bootstrap target', () => {
  const legacy = {
    projectId: 'ws',
    profileState: 'LEGACY',
    legacy: true,
    workspaceConfigured: true,
    workspacePath: '/tmp/ws',
  };
  assert.equal(gate.needsFirstRunBootstrap('ws', legacy), true);
  assert.deepEqual(gate.canCompleteBootstrapAsTarget(legacy), {
    ok: false,
    reason: 'LEGACY_NOT_ALLOWED',
  });
  const ready = gate.evaluateBootstrapReady(legacy, {
    pm: { runtime: 'chatgpt' },
    builders: [{ runtime: 'opencode' }],
    qa: [{ runtime: 'cline' }],
  });
  assert.equal(ready.ready, false);
  assert.ok(ready.blockers.includes('LEGACY_NOT_ALLOWED'));
});

test('E CONFIGURED project displays exact existing workspace', () => {
  const pathExact = '/home/skkse12/Desktop/Projects/Core/Agent-Relay';
  const d = gate.workspaceDisplayForProfile({
    projectId: 'agent-relay',
    profileState: 'CONFIGURED',
    workspaceConfigured: true,
    workspacePath: pathExact,
    workspaceConflict: false,
  });
  assert.equal(d.kind, 'PATH');
  assert.equal(d.workspacePath, pathExact);
});

test('F UNCONFIGURED project never receives invented workspace', () => {
  const d = gate.workspaceDisplayForProfile({
    projectId: 'r30-ai-revenue',
    profileState: 'UNCONFIGURED',
    workspaceConfigured: false,
    workspacePath: null,
  });
  assert.equal(d.kind, 'WORKSPACE_CONFIGURATION_REQUIRED');
  assert.equal(d.workspacePath, null);
});

test('G workspaceConflict blocks readiness', () => {
  const profile = {
    projectId: 'agent-relay',
    profileState: 'PARTIAL',
    workspaceConfigured: true,
    workspacePath: '/a',
    workspaceConflict: true,
    pm: { runtime: 'chatgpt' },
    builders: [{ runtime: 'opencode' }],
    qa: [{ runtime: 'cline' }],
  };
  assert.equal(gate.needsFirstRunBootstrap('agent-relay', profile), true);
  const ready = gate.evaluateBootstrapReady(profile);
  assert.equal(ready.ready, false);
  assert.ok(ready.blockers.includes('WORKSPACE_CONFLICT'));
  assert.equal(gate.workspaceDisplayForProfile(profile).kind, 'WORKSPACE_CONFLICT');
});

test('ready gate requires PM + builder + QA', () => {
  const profile = {
    projectId: 'agent-relay',
    profileState: 'CONFIGURED',
    workspaceConfigured: true,
    workspacePath: '/x',
    workspaceConflict: false,
  };
  assert.equal(
    gate.evaluateBootstrapReady(profile, { pm: null, builders: [], qa: [] }).ready,
    false,
  );
  const ok = gate.evaluateBootstrapReady(profile, {
    pm: { runtime: 'chatgpt' },
    builders: [{ runtime: 'opencode' }],
    qa: [{ runtime: 'cline' }],
  });
  assert.equal(ok.ready, true);
  assert.equal(ok.state, 'BOOTSTRAP_READY');
});

// —— Integration / persistence ——

test('C Agent Relay and legacy ws shown separately', () => {
  const root = tmp('legacy-sep');
  const host = tmp('host-legacy-sep');
  writeTaskFile(root, 'ws', {
    schemaVersion: 2,
    taskId: 'TASK-0901',
    goalId: 'GOAL-0001',
    project: 'ws',
    title: 'legacy task',
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
  });
  writeWorkspace(host, [{ id: 'agent-relay', root: host }]);
  writeRole(root, 'agent-relay', host);
  const listed = profileMod.listProjectProfiles({
    dataRoot: root,
    scope: 'ws',
    hostRoots: [host],
    includeCwdHostRoot: false,
  });
  const ids = listed.profiles.map((p) => p.projectId);
  assert.ok(ids.includes('agent-relay'), 'canonical agent-relay present');
  assert.ok(ids.includes('ws'), 'legacy ws present');
  const legacy = listed.profiles.find((p) => p.projectId === 'ws');
  const canon = listed.profiles.find((p) => p.projectId === 'agent-relay');
  assert.equal(legacy.profileState, 'LEGACY');
  assert.notEqual(canon.profileState, 'LEGACY');
  assert.notEqual(canon.projectId, legacy.projectId);
});

function writeTaskFile(root, project, task) {
  const folder = path.join(root, project, '_relay', 'tasks', task.taskId);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'task.json'), `${JSON.stringify(task, null, 2)}\n`);
}

test('H assignment read is correct + I assignment change uses C02', async () => {
  const root = tmp('assign');
  const host = tmp('host-assign');
  writeWorkspace(host, [{ id: 'fixture-c03', root: host }]);
  const input = { dataRoot: root, scope: 'ws', hostRoots: [host], includeCwdHostRoot: false };

  const got = assignment.getProjectAssignments(input, 'fixture-c03');
  assert.ok(got.pm);
  assert.ok(Array.isArray(got.builders));
  assert.ok(Array.isArray(got.qa));
  assert.ok(Array.isArray(got.availableWorkers));
  assert.equal(got.store, 'WORKSPACE_CONFIG');

  const beforeGoals = countGoalsTasks(root, 'ws');
  const set = assignment.setProjectAssignments(input, {
    projectId: 'fixture-c03',
    pm: { runtime: 'chatgpt', model: 'default' },
    builders: [{ runtime: 'codex', model: 'default' }],
    qa: [{ runtime: 'cline', model: 'default' }],
  });
  assert.equal(set.ok, true);
  assert.equal(set.store, 'WORKSPACE_CONFIG');
  assert.equal(set.assignment.builders[0].runtime, 'codex');
  assert.equal(set.sideEffects.goalsCreated, 0);
  assert.equal(set.sideEffects.tasksCreated, 0);
  assert.equal(set.sideEffects.runsCreated, 0);
  assert.equal(set.sideEffects.workersSpawned, 0);
  assert.equal(set.sideEffects.tmuxOpened, 0);

  // MCP tool surface exposes the same C02 handlers (catalog covered in Q).
  const { get } = pm(root);
  assert.ok(get('relay_pm_get_project_assignments'));
  assert.ok(get('relay_pm_set_project_assignments'));

  const afterGoals = countGoalsTasks(root, 'ws');
  assert.deepEqual(afterGoals, beforeGoals);
});

test('J availableWorkers not rendered as assigned (gate + widget contract)', () => {
  const html = widget.pmWidgetHtml('');
  assert.match(html, /할당됨/);
  assert.match(html, /사용 가능\(후보\)/);
  assert.match(html, /availableWorkers/);
  // Widget must not treat availableWorkers array as the assigned chip source.
  assert.match(html, /boot-assigned/);
  assert.match(html, /boot-avail/);
  assert.equal(
    gate.bindingDisplayName(null),
    '(없음)',
  );
});

test('K completing bootstrap persists selectedProjectId + L/M zero execution', async () => {
  const root = tmp('select');
  const host = tmp('host-select');
  writeWorkspace(host, [{ id: 'agent-relay', root: host }]);
  writeRole(root, 'agent-relay', host);
  const { get } = pm(root);
  const before = countGoalsTasks(root, 'ws');
  const workersBefore = workerRegistry.listWorkerRegistryRecords(root).length;

  const selected = await get('relay_pm_select_project').handler({ projectId: 'agent-relay' });
  assert.equal(selected.ok, true);
  assert.equal(selected.selectedProjectId, 'agent-relay');
  assert.equal(selected.sideEffects.goalsCreated, 0);
  assert.equal(selected.sideEffects.tasksCreated, 0);
  assert.equal(selected.sideEffects.workersSpawned, 0);

  const persisted = uiState.loadUiState(root);
  assert.equal(persisted.selectedProjectId, 'agent-relay');

  const after = countGoalsTasks(root, 'ws');
  assert.deepEqual(after, before);
  assert.equal(workerRegistry.listWorkerRegistryRecords(root).length, workersBefore);
  assert.deepEqual(gate.BOOTSTRAP_ZERO_SIDE_EFFECTS, {
    goalsCreated: 0,
    tasksCreated: 0,
    runsCreated: 0,
    workersSpawned: 0,
    tmuxOpened: 0,
    shellStarted: 0,
    gitMutations: 0,
  });
});

test('N reload after completion goes directly to selected project', async () => {
  const root = tmp('reload');
  const host = tmp('host-reload');
  writeWorkspace(host, [{ id: 'agent-relay', root: host }]);
  writeRole(root, 'agent-relay', host);
  uiState.saveSelectedProjectId(root, 'agent-relay');
  const listed = profileMod.listProjectProfiles({
    dataRoot: root,
    scope: 'ws',
    hostRoots: [host],
    includeCwdHostRoot: false,
  });
  const selected = listed.profiles.find((p) => p.projectId === listed.selectedProjectId);
  assert.equal(listed.selectedProjectId, 'agent-relay');
  assert.equal(gate.needsFirstRunBootstrap(listed.selectedProjectId, selected), false);
});

test('O invalid/deleted selected project safely returns to bootstrap', () => {
  const root = tmp('orphan-sel');
  uiState.saveSelectedProjectId(root, 'agent-relay');
  // Corrupt the file to an unknown id without going through normalize on save path:
  // saveSelectedProjectId normalizes; write raw ui-state with a deleted id.
  const uiPath = path.join(root, '_relay', 'ui-state.json');
  fs.mkdirSync(path.dirname(uiPath), { recursive: true });
  fs.writeFileSync(
    uiPath,
    `${JSON.stringify({
      schemaVersion: 'ui-state.v1',
      selectedProjectId: 'deleted-project-xyz',
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
  const listed = profileMod.listProjectProfiles({
    dataRoot: root,
    scope: 'ws',
    hostRoots: [],
    includeCwdHostRoot: false,
  });
  // listProjectProfiles clears unknown selection from the effective view
  const selected = listed.profiles.find((p) => p.projectId === listed.selectedProjectId) || null;
  // Either selection is nullified, or profile missing → bootstrap required
  assert.equal(
    gate.needsFirstRunBootstrap(listed.selectedProjectId, selected),
    true,
  );
});

test('P production widget canonical URI scheme unchanged (single hashed production widget)', () => {
  assert.match(widget.PM_WIDGET_RESOURCE_URI, /^ui:\/\/agent-relay\/pm-widget-[0-9a-f]{8}$/);
  assert.equal(widget.PM_WIDGET_RESOURCE_URI.split('-').at(-1), widget.PM_WIDGET_CONTENT_FINGERPRINT);
  const html = widget.pmWidgetHtml('');
  // Still one production widget — bootstrap is inside it, not a second resource.
  assert.match(html, /id="bootstrap"/);
  assert.match(html, /Project ▾|proj-switch/);
  assert.doesNotMatch(html, /ui:\/\/agent-relay\/pm-widget-debug/);
});

test('widget bootstrap wires C01/C02 tools only', () => {
  const html = widget.pmWidgetHtml('');
  assert.match(html, /relay_pm_list_project_profiles/);
  assert.match(html, /relay_pm_select_project/);
  assert.match(html, /relay_pm_get_project_assignments/);
  assert.match(html, /relay_pm_set_project_assignments/);
  assert.match(html, /BOOTSTRAP_READY/);
  assert.match(html, /WORKSPACE_CONFIGURATION_REQUIRED/);
  assert.match(html, /LEGACY/);
  // Zero-execution copy on the surface
  assert.match(html, /지금은 작업이 시작되지 않아요|Goal \/ Task \/ Worker는 만들지 않아요/);
});

test('Q existing C01/C02 tool catalog still registered', () => {
  const { tools } = pm(tmp('catalog'));
  const names = tools.map((t) => t.name);
  for (const n of [
    'relay_pm_list_project_profiles',
    'relay_pm_get_project_profile',
    'relay_pm_select_project',
    'relay_pm_get_project_assignments',
    'relay_pm_set_project_assignments',
  ]) {
    assert.ok(names.includes(n), n);
  }
  const appTools = appServer.buildAppTools({ dataRoot: tmp('catalog-app'), project: 'ws' });
  const opener = appTools.find((t) => t.name === 'relay_pm_open_widget');
  assert.ok(opener, 'relay_pm_open_widget');
  assert.equal(opener._meta.ui.resourceUri, widget.PM_WIDGET_RESOURCE_URI);
});
