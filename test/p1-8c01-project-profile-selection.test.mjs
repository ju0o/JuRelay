/**
 * P1.8C-01 — ProjectProfile aggregation + selection persistence.
 *
 * Cases:
 *   A  ws scope → canonical agent-relay / Agent Relay (no ws task rewrite)
 *   B  historical ws remains LEGACY, not merged into agent-relay
 *   C  configured fixture → CONFIGURED + workspace path
 *   D  known identity, no workspace → UNCONFIGURED
 *   E  select A, reload → still A
 *   F  persisted A + explicit B request → B for request, A remains persisted
 *   G  select → 0 Goals / Tasks / dispatches / workers / workspace mutations
 *   H  invalid selected id falls back safely
 *   I  worker registry appears as availability only
 *   J  P1.8A list_projects / dashboard / ORPHAN still compatible
 *   K  relay_pm_open_widget + widget resource contract unchanged
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const dist = (p) => path.join(repo, 'dist/server', p);

const identity = await import(dist('backend/project-identity.js'));
const profileMod = await import(dist('backend/project-profile.js'));
const uiState = await import(dist('backend/ui-state.js'));
const goalTask = await import(dist('backend/goal-task.js'));
const workerRegistry = await import(dist('backend/worker-registry.js'));
const pmTools = await import(dist('mcp/pm-tools.js'));
const appServer = await import(dist('mcp/app-server.js'));
const widget = await import(dist('mcp/app/pm-widget-resource.js'));

function dataRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `arl-p18c01-${prefix}-`));
}

function pm(root, project) {
  const tools = pmTools.buildAllPmTools({ dataRoot: root, project });
  const get = (name) => {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `tool ${name} is registered`);
    return tool;
  };
  return { tools, get };
}

function writeTaskFile(root, project, task) {
  const folder = path.join(root, project, '_relay', 'tasks', task.taskId);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'task.json'), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
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

function writeWorkspaceConfig(hostRoot, lanes) {
  const dir = path.join(hostRoot, '.agent-relay');
  fs.mkdirSync(dir, { recursive: true });
  const config = {
    schemaVersion: 'workspace.v2',
    concurrency: { maxActiveBuilders: 1, maxActiveQa: 1 },
    lanes: lanes.map((lane) => ({
      id: lane.id,
      label: lane.label || lane.id,
      root: lane.root,
      goal: lane.goal || 'test goal',
      pm: {
        runtime: 'chatgpt',
        model: 'default',
        roleProfile: { sessionPolicy: 'persistent', permissionProfile: 'read-only' },
      },
      builder: {
        runtime: 'opencode',
        model: 'default',
        roleProfile: { sessionPolicy: 'per-task', permissionProfile: 'write-workspace' },
      },
      qa: {
        runtime: 'codex',
        model: 'default',
        roleProfile: { sessionPolicy: 'per-task', permissionProfile: 'read-only' },
      },
      qaFallback: { runtime: 'codex', model: 'default' },
    })),
  };
  fs.writeFileSync(path.join(dir, 'workspace-config.json'), `${JSON.stringify(config, null, 2)}\n`);
  return hostRoot;
}

function writeRoleConfig(root, projectKey, workspaceRoot) {
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
        runtimeAdapterId: 'opencode-command',
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
        runtimeAdapterId: 'codex',
        provider: 'codex',
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
    graph: [
      { from: 'pm', to: 'builder', envelope: 'TASK_CONTRACT' },
      { from: 'builder', to: 'qa', envelope: 'RESULT' },
      { from: 'qa', to: 'pm', envelope: 'PASS' },
    ],
  };
  fs.writeFileSync(path.join(dir, `${projectKey}.json`), `${JSON.stringify(config, null, 2)}\n`);
}

function writeWorker(root, workerId) {
  workerRegistry.writeWorkerRegistryRecord(root, {
    schemaVersion: 'G.2',
    workerId,
    displayName: workerId,
    launchCommand: process.execPath,
    launchArgsPrefix: ['-e', 'process.exit(0)'],
    capabilities: ['fixture'],
  });
}

function countGoals(root, project) {
  try {
    return goalTask.listGoals(root, project).length;
  } catch {
    return 0;
  }
}

function countTasks(root, project) {
  try {
    return goalTask.listTasks(root, project, undefined).length;
  } catch {
    return 0;
  }
}

function snapshotTree(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d, rel = '') => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, r);
      else out.push({ path: r, size: st.size, mtimeMs: st.mtimeMs });
    }
  };
  walk(dir);
  return out;
}

// ── A / B ───────────────────────────────────────────────────────────────────

test('CASE A ws scope resolves canonical agent-relay profile without rewriting ws tasks', () => {
  const root = dataRoot('a');
  writeTaskFile(root, 'ws', baseTask({
    taskId: 'TASK-LEGACY-1',
    // historical: no projectId
  }));
  const listed = profileMod.listProjectProfiles({
    dataRoot: root,
    scope: 'ws',
    includeCwdHostRoot: false,
    runtimeProjects: [
      {
        projectId: 'ws',
        projectName: 'ws',
        legacy: true,
        genericBucket: true,
        identitySource: 'RECORD_LEGACY',
        scope: 'ws',
        activeGoal: null,
        activeTask: null,
        agent: null,
        model: null,
        executionState: 'PLANNED',
        runtimeState: 'IDLE',
        lastActivityAt: null,
        nextAction: 'NONE',
        nextActionText: '',
        counts: { tasks: 1, persistedRunning: 0, activeRuns: 0, staleRuns: 0, orphanRuns: 0, readyTasks: 0, verificationPending: 0 },
        tasks: [],
      },
    ],
  });
  const canonical = listed.profiles.find((p) => p.projectId === 'agent-relay');
  assert.ok(canonical, 'canonical agent-relay profile exists');
  assert.equal(canonical.projectName, 'Agent Relay');
  assert.equal(canonical.legacy, false);
  assert.notEqual(canonical.profileState, 'LEGACY');

  // Historical task file untouched.
  const persisted = JSON.parse(
    fs.readFileSync(path.join(root, 'ws', '_relay', 'tasks', 'TASK-LEGACY-1', 'task.json'), 'utf8'),
  );
  assert.equal(persisted.project, 'ws');
  assert.equal(persisted.projectId, undefined);
});

test('CASE B historical ws remains LEGACY and is not merged into agent-relay', () => {
  const root = dataRoot('b');
  const listed = profileMod.listProjectProfiles({
    dataRoot: root,
    scope: 'ws',
    includeCwdHostRoot: false,
    runtimeProjects: [
      {
        projectId: 'ws',
        projectName: 'ws',
        legacy: true,
        genericBucket: true,
        identitySource: 'RECORD_LEGACY',
        scope: 'ws',
        activeGoal: null,
        activeTask: null,
        agent: null,
        model: null,
        executionState: null,
        runtimeState: 'IDLE',
        lastActivityAt: null,
        nextAction: 'NONE',
        nextActionText: '',
        counts: { tasks: 0, persistedRunning: 0, activeRuns: 0, staleRuns: 0, orphanRuns: 0, readyTasks: 0, verificationPending: 0 },
        tasks: [],
      },
    ],
  });
  const legacy = listed.profiles.find((p) => p.projectId === 'ws');
  const canonical = listed.profiles.find((p) => p.projectId === 'agent-relay');
  assert.ok(legacy, 'legacy ws profile present');
  assert.ok(canonical, 'canonical profile present');
  assert.equal(legacy.profileState, 'LEGACY');
  assert.equal(legacy.legacy, true);
  assert.notEqual(canonical.projectId, legacy.projectId);
  assert.equal(legacy.workspacePath, null, 'legacy does not invent a workspace');
});

// ── C / D ───────────────────────────────────────────────────────────────────

test('CASE C configured project with workspace evidence → CONFIGURED', () => {
  const root = dataRoot('c');
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-p18c01-host-c-'));
  const wsRoot = path.join(host, 'jubrain');
  fs.mkdirSync(wsRoot, { recursive: true });
  writeWorkspaceConfig(host, [{ id: 'jubrain', label: 'JuBrain', root: wsRoot }]);
  writeRoleConfig(root, 'jubrain', wsRoot);

  const listed = profileMod.listProjectProfiles({
    dataRoot: root,
    scope: 'ws',
    hostRoots: [host],
    includeCwdHostRoot: false,
  });
  const p = listed.profiles.find((x) => x.projectId === 'jubrain');
  assert.ok(p);
  assert.equal(p.profileState, 'CONFIGURED');
  assert.equal(p.workspaceConfigured, true);
  assert.equal(p.workspaceConflict, false);
  assert.equal(p.workspacePath, path.resolve(wsRoot));
  assert.ok(
    p.workspacePathSource === 'WORKSPACE_CONFIG' || p.workspacePathSource === 'ROLE_CONFIG',
  );
  assert.ok(p.pm);
  assert.ok(p.builders.length >= 1);
  assert.ok(p.qa.length >= 1);
});

test('CASE D known identity with no workspace evidence → UNCONFIGURED', () => {
  const root = dataRoot('d');
  fs.mkdirSync(path.join(root, '_relay'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '_relay', 'projects.json'),
    JSON.stringify({
      schemaVersion: 1,
      projects: { 'bare-project': 'Bare Project' },
    }),
    'utf8',
  );
  const listed = profileMod.listProjectProfiles({
    dataRoot: root,
    scope: 'ws',
    includeCwdHostRoot: false,
  });
  const p = listed.profiles.find((x) => x.projectId === 'bare-project');
  assert.ok(p);
  assert.equal(p.profileState, 'UNCONFIGURED');
  assert.equal(p.workspacePath, null);
  assert.equal(p.workspacePathSource, 'NONE');
  assert.equal(p.workspaceConfigured, false);
});

test('workspace path conflict → PARTIAL + workspaceConflict', () => {
  const root = dataRoot('conflict');
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-p18c01-host-x-'));
  const laneRoot = path.join(host, 'lane-root');
  const roleRoot = path.join(host, 'role-root');
  fs.mkdirSync(laneRoot, { recursive: true });
  fs.mkdirSync(roleRoot, { recursive: true });
  writeWorkspaceConfig(host, [{ id: 'split-proj', label: 'Split', root: laneRoot }]);
  writeRoleConfig(root, 'split-proj', roleRoot);

  const p = profileMod.getProjectProfile(
    { dataRoot: root, scope: 'ws', hostRoots: [host], includeCwdHostRoot: false },
    'split-proj',
  );
  assert.ok(p);
  assert.equal(p.workspaceConflict, true);
  assert.equal(p.profileState, 'PARTIAL');
  assert.equal(p.workspacePath, null);
});

// ── E / F / G / H ───────────────────────────────────────────────────────────

test('CASE E selection persistence survives reload', () => {
  const root = dataRoot('e');
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-p18c01-host-e-'));
  const wsRoot = path.join(host, 'alpha');
  fs.mkdirSync(wsRoot, { recursive: true });
  writeWorkspaceConfig(host, [{ id: 'alpha', root: wsRoot }]);
  writeRoleConfig(root, 'alpha', wsRoot);

  const input = { dataRoot: root, scope: 'ws', hostRoots: [host], includeCwdHostRoot: false };
  const sel = profileMod.selectProject(input, 'alpha');
  assert.equal(sel.ok, true);
  assert.equal(sel.selectedProjectId, 'alpha');

  const reloaded = uiState.loadUiState(root);
  assert.equal(reloaded.selectedProjectId, 'alpha');
  const listed = profileMod.listProjectProfiles({ ...input, selectedProjectId: undefined });
  assert.equal(listed.selectedProjectId, 'alpha');
  assert.equal(listed.profiles.find((p) => p.projectId === 'alpha')?.selected, true);
});

test('CASE F explicit override wins for the request; persisted selection remains', async () => {
  const root = dataRoot('f');
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-p18c01-host-f-'));
  const aRoot = path.join(host, 'alpha');
  const bRoot = path.join(host, 'beta');
  fs.mkdirSync(aRoot, { recursive: true });
  fs.mkdirSync(bRoot, { recursive: true });
  writeWorkspaceConfig(host, [
    { id: 'alpha', root: aRoot },
    { id: 'beta', root: bRoot },
  ]);
  writeRoleConfig(root, 'alpha', aRoot);
  writeRoleConfig(root, 'beta', bRoot);

  const input = { dataRoot: root, scope: 'ws', hostRoots: [host], includeCwdHostRoot: false };
  profileMod.selectProject(input, 'alpha');

  const { get } = pm(root, 'ws');
  const dash = await get('relay_pm_get_dashboard').handler({ projectId: 'beta' });
  assert.equal(dash.selectedProjectId, 'beta');
  assert.equal(dash.selectedProjectBasis, 'ARGUMENT');
  assert.equal(dash.selectedProjectProfile?.projectId, 'beta');

  // Persisted selection unchanged.
  assert.equal(uiState.loadUiState(root).selectedProjectId, 'alpha');
  const dashDefault = await get('relay_pm_get_dashboard').handler({});
  assert.equal(dashDefault.selectedProjectId, 'alpha');
  assert.equal(dashDefault.selectedProjectBasis, 'SELECTED');
});

test('CASE G selecting a project creates zero Goals/Tasks/dispatches/workers/workspace mutations', () => {
  const root = dataRoot('g');
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-p18c01-host-g-'));
  const wsRoot = path.join(host, 'gamma');
  fs.mkdirSync(wsRoot, { recursive: true });
  writeWorkspaceConfig(host, [{ id: 'gamma', root: wsRoot }]);
  writeRoleConfig(root, 'gamma', wsRoot);

  const goalsBefore = countGoals(root, 'ws');
  const tasksBefore = countTasks(root, 'ws');
  const workersBefore = workerRegistry.listWorkerRegistryRecords(root).length;
  const hostBefore = snapshotTree(host);
  const rolesBefore = snapshotTree(path.join(root, '_relay', 'roles'));

  const result = profileMod.selectProject(
    { dataRoot: root, scope: 'ws', hostRoots: [host], includeCwdHostRoot: false },
    'gamma',
  );
  assert.deepEqual(result.sideEffects, {
    goalsCreated: 0,
    tasksCreated: 0,
    dispatches: 0,
    workersSpawned: 0,
    workspaceMutations: 0,
  });

  assert.equal(countGoals(root, 'ws'), goalsBefore);
  assert.equal(countTasks(root, 'ws'), tasksBefore);
  assert.equal(workerRegistry.listWorkerRegistryRecords(root).length, workersBefore);
  assert.deepEqual(snapshotTree(host), hostBefore, 'workspace host files unchanged');
  assert.deepEqual(snapshotTree(path.join(root, '_relay', 'roles')), rolesBefore, 'role configs unchanged');

  // Only ui-state.json should appear under _relay as new selection state.
  assert.ok(fs.existsSync(uiState.uiStatePath(root)));
});

test('CASE H invalid selected project falls back safely', async () => {
  const root = dataRoot('h');
  uiState.saveSelectedProjectId(root, 'does-not-exist-project');
  // Force a bogus raw file that normalizes but is unknown.
  fs.writeFileSync(
    uiState.uiStatePath(root),
    JSON.stringify({
      schemaVersion: 1,
      selectedProjectId: 'ghost-project',
      updatedAt: new Date().toISOString(),
    }),
    'utf8',
  );

  const listed = profileMod.listProjectProfiles({
    dataRoot: root,
    scope: 'ws',
    includeCwdHostRoot: false,
  });
  assert.ok(listed.profiles.some((p) => p.projectId === 'agent-relay'));
  assert.equal(
    listed.profiles.filter((p) => p.selected).length,
    0,
    'unknown persisted id must not mark any profile selected',
  );

  const resolved = profileMod.resolveProjectSelection({
    profiles: listed.profiles,
    runtimeProjects: [],
    persistedSelectedProjectId: 'ghost-project',
    scopeIdentity: listed.scopeIdentity,
  });
  assert.equal(resolved.basis, 'SCOPE');
  assert.equal(resolved.selectedProjectId, 'agent-relay');

  const { get } = pm(root, 'ws');
  const dash = await get('relay_pm_get_dashboard').handler({});
  assert.equal(dash.selectedProjectBasis, 'SCOPE');
  assert.equal(dash.selectedProjectId, 'agent-relay');
});

// ── I ───────────────────────────────────────────────────────────────────────

test('CASE I worker registry is availability only — no fabricated assignment', () => {
  const root = dataRoot('i');
  writeWorker(root, 'builder-opencode');
  writeWorker(root, 'qa-codex');

  const listed = profileMod.listProjectProfiles({
    dataRoot: root,
    scope: 'ws',
    includeCwdHostRoot: false,
  });
  const canonical = listed.profiles.find((p) => p.projectId === 'agent-relay');
  assert.ok(canonical);
  assert.ok(canonical.availableWorkers.includes('builder-opencode'));
  assert.ok(canonical.availableWorkers.includes('qa-codex'));
  // Availability must not become pm/builders/qa assignment.
  assert.equal(canonical.builders.some((b) => b.runtimeAdapterId === 'builder-opencode'), false);
  assert.equal(
    canonical.builders.every((b) => b.source === 'ROLE_CONFIG' || b.source === 'WORKSPACE_CONFIG'),
    true,
  );
});

// ── J / K + MCP tools ───────────────────────────────────────────────────────

test('CASE J P1.8A list_projects / dashboard / ORPHAN remain compatible', async () => {
  const root = dataRoot('j');
  const { get } = pm(root, 'ws');
  const intake = await get('relay_pm_create_task').handler({
    title: 'P1.8C-01 orphan fixture',
    goal: 'Intended outcome',
    reason: 'PM finalized contract reason',
    scope: 'Narrow scope',
    completionCriteria: ['done when the worker result is received'],
    projectId: 'juintake',
    projectName: 'JuIntake',
  });
  const orphanFolder = path.join(root, 'ws', '2026-10-05', 'worker-test', '01');
  fs.mkdirSync(orphanFolder, { recursive: true });
  fs.writeFileSync(
    path.join(orphanFolder, 'meta.json'),
    JSON.stringify({
      runId: 'orphan-run-c01',
      taskId: intake.task.taskId,
      goalId: intake.task.goalId,
      taskRunSequence: 1,
      workerId: 'builder-opencode',
    }),
    'utf8',
  );
  writeTaskFile(root, 'ws', {
    ...intake.task,
    executionState: 'RUNNING',
    nextTaskRunSequence: 2,
    linkedRuns: [{
      runId: 'orphan-run-c01',
      folder: orphanFolder,
      taskRunSequence: 1,
      agent: 'builder-opencode',
    }],
    updatedAt: new Date().toISOString(),
  });

  const listed = await get('relay_pm_list_projects').handler({});
  assert.ok(Array.isArray(listed.projects));
  assert.equal(listed.projectIdentity.projectId, 'agent-relay');
  const ju = listed.projects.find((p) => p.projectId === 'juintake');
  assert.ok(ju, `juintake missing: ${JSON.stringify(listed.projects.map((p) => p.projectId))}`);
  assert.equal(ju.runtimeState, 'ORPHAN');

  const dash = await get('relay_pm_get_dashboard').handler({});
  assert.ok(dash.projectIdentity);
  assert.ok(Array.isArray(dash.projects));
  assert.ok('summary' in dash);
  assert.ok(Array.isArray(dash.projectProfiles), 'additive projectProfiles');
  assert.ok('selectedProjectId' in dash);
  assert.ok('selectedProjectProfile' in dash);
  // Existing keys still present.
  assert.ok('agents' in dash);
  assert.ok('tasks' in dash);
  assert.ok('goals' in dash);
});

test('CASE K production widget opener + resource contract unchanged', () => {
  const tools = appServer.buildAppTools({ dataRoot: dataRoot('k'), project: 'ws' });
  const opener = tools.find((t) => t.name === 'relay_pm_open_widget');
  assert.ok(opener);
  assert.equal(opener._meta.ui.resourceUri, widget.PM_WIDGET_RESOURCE_URI);
  assert.equal(opener._meta['openai/outputTemplate'], widget.PM_WIDGET_RESOURCE_URI);
  assert.equal(
    tools.some((t) => t.name === 'relay_pm_open_widget_probe'),
    false,
    'probe tool must stay removed',
  );
});

test('MCP select / list / get profile tools', async () => {
  const root = dataRoot('mcp');
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-p18c01-host-mcp-'));
  const wsRoot = path.join(host, 'delta');
  fs.mkdirSync(wsRoot, { recursive: true });
  writeWorkspaceConfig(host, [{ id: 'delta', root: wsRoot }]);
  writeRoleConfig(root, 'delta', wsRoot);

  const { get, tools } = pm(root, 'ws');
  assert.ok(tools.some((t) => t.name === 'relay_pm_list_project_profiles'));
  assert.ok(tools.some((t) => t.name === 'relay_pm_get_project_profile'));
  assert.ok(tools.some((t) => t.name === 'relay_pm_select_project'));

  // list may not see hostRoots via MCP ctx — select still works once role exists
  // because role workspaceRoot discovers the host.
  const listed = await get('relay_pm_list_project_profiles').handler({});
  assert.ok(listed.profiles.some((p) => p.projectId === 'delta'));

  const got = await get('relay_pm_get_project_profile').handler({ projectId: 'delta' });
  assert.equal(got.profile.projectId, 'delta');

  const selected = await get('relay_pm_select_project').handler({ projectId: 'delta' });
  assert.equal(selected.ok, true);
  assert.equal(selected.selectedProjectId, 'delta');
  assert.deepEqual(selected.sideEffects.goalsCreated, 0);

  await assert.rejects(
    () => get('relay_pm_select_project').handler({ projectId: 'no-such-project' }),
    /not found|unknown/i,
  );
});

test('no ProjectProfile.json duplicate store is created by selection', () => {
  const root = dataRoot('nostore');
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-p18c01-host-ns-'));
  const wsRoot = path.join(host, 'epsilon');
  fs.mkdirSync(wsRoot, { recursive: true });
  writeWorkspaceConfig(host, [{ id: 'epsilon', root: wsRoot }]);
  writeRoleConfig(root, 'epsilon', wsRoot);
  profileMod.selectProject(
    { dataRoot: root, scope: 'ws', hostRoots: [host], includeCwdHostRoot: false },
    'epsilon',
  );
  assert.equal(fs.existsSync(path.join(root, '_relay', 'ProjectProfile.json')), false);
  assert.equal(fs.existsSync(path.join(root, '_relay', 'project-profiles.json')), false);
  assert.ok(fs.existsSync(path.join(root, '_relay', 'ui-state.json')));
});
