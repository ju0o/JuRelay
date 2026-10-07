/**
 * P1.8C-02 — Project agent assignment (desired roles, zero execution).
 *
 * Cases A–O per WBS. Mutation tests use isolated fixture dataRoot/hostRoot only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const dist = (p) => path.join(repo, 'dist/server', p);

const assignment = await import(dist('backend/project-assignment.js'));
const profileMod = await import(dist('backend/project-profile.js'));
const uiState = await import(dist('backend/ui-state.js'));
const goalTask = await import(dist('backend/goal-task.js'));
const workerRegistry = await import(dist('backend/worker-registry.js'));
const wsConfig = await import(dist('workspace/config-v2.js'));
const pmTools = await import(dist('mcp/pm-tools.js'));
const appServer = await import(dist('mcp/app-server.js'));
const widget = await import(dist('mcp/app/pm-widget-resource.js'));

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `arl-p18c02-${prefix}-`));
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
        runtime: 'codex',
        model: 'default',
        roleProfile: { sessionPolicy: 'per-task', permissionProfile: 'write-workspace' },
      },
      ...(lane.builders ? { builders: lane.builders } : {}),
      qa: lane.qa || {
        runtime: 'codex',
        model: 'default',
        roleProfile: { sessionPolicy: 'per-task', permissionProfile: 'read-only' },
      },
      ...(lane.qas ? { qas: lane.qas } : {}),
      qaFallback: lane.qaFallback || { runtime: 'codex', model: 'default' },
    })),
  };
  wsConfig.writeWorkspaceConfigV2(hostRoot, config);
  return config;
}

function writeRole(root, projectKey, workspaceRoot, overrides = {}) {
  const dir = path.join(root, '_relay', 'roles');
  fs.mkdirSync(dir, { recursive: true });
  const assignments = overrides.assignments || [
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
      runtimeAdapterId: 'builder-codex',
      provider: 'codex',
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
      runtimeAdapterId: 'qa-codex',
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
  ];
  const config = {
    schema_version: 'role-config.v1',
    project: projectKey,
    assignments,
    graph: [
      { from: 'pm', to: 'builder', envelope: 'TASK_CONTRACT' },
      { from: 'builder', to: 'qa', envelope: 'RESULT' },
      { from: 'qa', to: 'pm', envelope: 'PASS' },
    ],
  };
  fs.writeFileSync(path.join(dir, `${projectKey}.json`), `${JSON.stringify(config, null, 2)}\n`);
}

function writeWorker(root, workerId, extra = {}) {
  workerRegistry.writeWorkerRegistryRecord(root, {
    schemaVersion: 'G.2',
    workerId,
    displayName: workerId,
    launchCommand: process.execPath,
    launchArgsPrefix: ['-e', 'process.exit(0)'],
    capabilities: ['fixture'],
    ...extra,
  });
}

function countGoals(root, project) {
  try { return goalTask.listGoals(root, project).length; } catch { return 0; }
}
function countTasks(root, project) {
  try { return goalTask.listTasks(root, project, undefined).length; } catch { return 0; }
}

function fixturePair(prefix) {
  const dataRoot = tmp(`${prefix}-data`);
  const hostRoot = tmp(`${prefix}-host`);
  const projectRoot = path.join(hostRoot, 'proj');
  fs.mkdirSync(projectRoot, { recursive: true });
  return { dataRoot, hostRoot, projectRoot };
}

// ── A ───────────────────────────────────────────────────────────────────────

test('CASE A read current Agent Relay assignments from workspace.v2', () => {
  const dataRoot = tmp('a');
  // Use the real repo workspace config via hostRoots (read-only).
  const listed = profileMod.listProjectProfiles({
    dataRoot,
    scope: 'ws',
    hostRoots: [repo],
    includeCwdHostRoot: false,
  });
  const profile = listed.profiles.find((p) => p.projectId === 'agent-relay');
  assert.ok(profile);
  const view = assignment.getProjectAssignments(
    { dataRoot, scope: 'ws', hostRoots: [repo], includeCwdHostRoot: false },
    'agent-relay',
  );
  assert.equal(view.store, 'WORKSPACE_CONFIG');
  assert.equal(view.pm?.runtime, 'chatgpt');
  assert.ok(view.builders.some((b) => b.runtime === 'opencode'));
  assert.ok(view.qa.some((q) => q.runtime === 'cline' || q.runtime === 'codex' || q.runtime));
  assert.ok(Array.isArray(view.availableWorkers));
});

// ── B / C / D ───────────────────────────────────────────────────────────────

test('CASE B fixture Builder Codex → OpenCode persists and reloads', () => {
  const { dataRoot, hostRoot, projectRoot } = fixturePair('b');
  writeWorkspace(hostRoot, [{
    id: 'fixture-b',
    root: projectRoot,
    builder: {
      runtime: 'codex',
      model: 'default',
      roleProfile: { sessionPolicy: 'per-task', permissionProfile: 'write-workspace' },
    },
  }]);
  writeWorker(dataRoot, 'builder-opencode');

  const input = { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false };
  const before = assignment.getProjectAssignments(input, 'fixture-b');
  assert.equal(before.builders[0].runtime, 'codex');

  const result = assignment.setProjectAssignments(input, {
    projectId: 'fixture-b',
    pm: { runtime: 'chatgpt', model: 'default' },
    builders: [{ runtime: 'opencode', model: 'default' }],
    qa: [{ runtime: 'codex', model: 'default' }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.store, 'WORKSPACE_CONFIG');
  assert.equal(result.assignment.builders[0].runtime, 'opencode');

  const reloaded = assignment.getProjectAssignments(input, 'fixture-b');
  assert.equal(reloaded.builders[0].runtime, 'opencode');
  const lane = wsConfig.readWorkspaceConfigV2(hostRoot).lanes.find((l) => l.id === 'fixture-b');
  assert.equal(lane.builder.runtime, 'opencode');
});

test('CASE C multiple Builders persist in deterministic order', () => {
  const { dataRoot, hostRoot, projectRoot } = fixturePair('c');
  writeWorkspace(hostRoot, [{ id: 'fixture-c', root: projectRoot }]);
  const input = { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false };
  assignment.setProjectAssignments(input, {
    projectId: 'fixture-c',
    pm: { runtime: 'chatgpt' },
    builders: [
      { runtime: 'opencode', model: 'default' },
      { runtime: 'codex', model: 'luna' },
      { runtime: 'claude', model: 'team' },
    ],
    qa: [{ runtime: 'cline' }],
  });
  const view = assignment.getProjectAssignments(input, 'fixture-c');
  assert.deepEqual(
    view.builders.map((b) => `${b.runtime}:${b.model}`),
    ['opencode:default', 'codex:luna', 'claude:team'],
  );
  const lane = wsConfig.readWorkspaceConfigV2(hostRoot).lanes.find((l) => l.id === 'fixture-c');
  assert.equal(lane.builder.runtime, 'opencode');
  assert.equal(lane.builders.length, 3);
  assert.equal(lane.builders[0].runtime, 'opencode');
});

test('CASE D QA assignment persists', () => {
  const { dataRoot, hostRoot, projectRoot } = fixturePair('d');
  writeWorkspace(hostRoot, [{
    id: 'fixture-d',
    root: projectRoot,
    qa: {
      runtime: 'codex',
      model: 'default',
      roleProfile: { sessionPolicy: 'per-task', permissionProfile: 'read-only' },
    },
  }]);
  const input = { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false };
  assignment.setProjectAssignments(input, {
    projectId: 'fixture-d',
    pm: { runtime: 'chatgpt' },
    builders: [{ runtime: 'opencode' }],
    qa: [{ runtime: 'cline', model: 'default' }],
  });
  assert.equal(assignment.getProjectAssignments(input, 'fixture-d').qa[0].runtime, 'cline');
});

// ── E / F ───────────────────────────────────────────────────────────────────

test('CASE E unknown Worker rejected', () => {
  const { dataRoot, hostRoot, projectRoot } = fixturePair('e');
  writeWorkspace(hostRoot, [{ id: 'fixture-e', root: projectRoot }]);
  const input = { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false };
  const before = wsConfig.readWorkspaceConfigV2(hostRoot);
  assert.throws(
    () => assignment.setProjectAssignments(input, {
      projectId: 'fixture-e',
      pm: { runtime: 'chatgpt' },
      builders: [{ workerId: 'made-up-agent-123' }],
      qa: [{ runtime: 'codex' }],
    }),
    (err) => err?.code === 'UNKNOWN_WORKER',
  );
  assert.deepEqual(wsConfig.readWorkspaceConfigV2(hostRoot), before, 'no partial write');
});

test('CASE F malformed assignment causes zero partial writes', () => {
  const { dataRoot, hostRoot, projectRoot } = fixturePair('f');
  writeWorkspace(hostRoot, [{
    id: 'fixture-f',
    root: projectRoot,
    builder: {
      runtime: 'codex',
      model: 'default',
      roleProfile: { sessionPolicy: 'per-task', permissionProfile: 'write-workspace' },
    },
  }]);
  const input = { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false };
  const before = JSON.stringify(wsConfig.readWorkspaceConfigV2(hostRoot));
  assert.throws(
    () => assignment.setProjectAssignments(input, {
      projectId: 'fixture-f',
      pm: { runtime: 'chatgpt' },
      builders: 'not-an-array',
      qa: [{ runtime: 'codex' }],
    }),
    (err) => err?.code === 'MALFORMED_ASSIGNMENT',
  );
  assert.equal(JSON.stringify(wsConfig.readWorkspaceConfigV2(hostRoot)), before);
});

// ── G / H / I / J ───────────────────────────────────────────────────────────

test('CASE G assignment creates zero Goal/Task/Run/spawn side effects', () => {
  const { dataRoot, hostRoot, projectRoot } = fixturePair('g');
  writeWorkspace(hostRoot, [{ id: 'fixture-g', root: projectRoot }]);
  const input = { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false };
  const goalsBefore = countGoals(dataRoot, 'ws');
  const tasksBefore = countTasks(dataRoot, 'ws');
  const workersBefore = workerRegistry.listWorkerRegistryRecords(dataRoot).length;
  const hostSnap = fs.readFileSync(path.join(hostRoot, '.agent-relay', 'workspace-config.json'), 'utf8');

  const result = assignment.setProjectAssignments(input, {
    projectId: 'fixture-g',
    pm: { runtime: 'chatgpt' },
    builders: [{ runtime: 'opencode' }],
    qa: [{ runtime: 'cline' }],
  });
  assert.deepEqual(result.sideEffects, {
    goalsCreated: 0,
    tasksCreated: 0,
    runsCreated: 0,
    workersSpawned: 0,
    tmuxOpened: 0,
    workspacePathChanged: false,
    selectedProjectIdChanged: false,
  });
  assert.equal(countGoals(dataRoot, 'ws'), goalsBefore);
  assert.equal(countTasks(dataRoot, 'ws'), tasksBefore);
  assert.equal(workerRegistry.listWorkerRegistryRecords(dataRoot).length, workersBefore);
  // Only workspace-config.json content may change (canonical assignment store).
  assert.notEqual(
    fs.readFileSync(path.join(hostRoot, '.agent-relay', 'workspace-config.json'), 'utf8'),
    hostSnap,
  );
  assert.equal(fs.existsSync(path.join(dataRoot, '_relay', 'agent-assignments.json')), false);
  assert.equal(fs.existsSync(path.join(dataRoot, '_relay', 'project-profile.json')), false);
});

test('CASE H assignment does not alter workspacePath', () => {
  const { dataRoot, hostRoot, projectRoot } = fixturePair('h');
  writeWorkspace(hostRoot, [{ id: 'fixture-h', root: projectRoot }]);
  const input = { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false };
  const before = assignment.getProjectAssignments(input, 'fixture-h').workspacePath;
  assert.throws(
    () => assignment.setProjectAssignments(input, {
      projectId: 'fixture-h',
      pm: { runtime: 'chatgpt', workspaceRoot: path.join(hostRoot, 'other') },
      builders: [{ runtime: 'opencode' }],
      qa: [{ runtime: 'codex' }],
    }),
    (err) => err?.code === 'WORKSPACE_PATH_CONFLICT',
  );
  const result = assignment.setProjectAssignments(input, {
    projectId: 'fixture-h',
    pm: { runtime: 'chatgpt' },
    builders: [{ runtime: 'opencode' }],
    qa: [{ runtime: 'codex' }],
  });
  assert.equal(result.assignment.workspacePath, before);
  assert.equal(result.sideEffects.workspacePathChanged, false);
  assert.equal(
    wsConfig.readWorkspaceConfigV2(hostRoot).lanes.find((l) => l.id === 'fixture-h').root,
    projectRoot,
  );
});

test('CASE I assignment does not alter selectedProjectId', () => {
  const { dataRoot, hostRoot, projectRoot } = fixturePair('i');
  writeWorkspace(hostRoot, [
    { id: 'fixture-i', root: projectRoot },
    { id: 'juplan', root: path.join(hostRoot, 'juplan') },
  ]);
  fs.mkdirSync(path.join(hostRoot, 'juplan'), { recursive: true });
  const input = { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false };
  profileMod.selectProject(input, 'juplan');
  assert.equal(uiState.loadUiState(dataRoot).selectedProjectId, 'juplan');
  assignment.setProjectAssignments(input, {
    projectId: 'fixture-i',
    pm: { runtime: 'chatgpt' },
    builders: [{ runtime: 'opencode' }],
    qa: [{ runtime: 'codex' }],
  });
  assert.equal(uiState.loadUiState(dataRoot).selectedProjectId, 'juplan');
});

test('CASE J project selection does not alter assignment', () => {
  const { dataRoot, hostRoot, projectRoot } = fixturePair('j');
  writeWorkspace(hostRoot, [
    { id: 'fixture-j', root: projectRoot },
    { id: 'other-j', root: path.join(hostRoot, 'other') },
  ]);
  fs.mkdirSync(path.join(hostRoot, 'other'), { recursive: true });
  const input = { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false };
  assignment.setProjectAssignments(input, {
    projectId: 'fixture-j',
    pm: { runtime: 'chatgpt' },
    builders: [{ runtime: 'opencode', model: 'keep-me' }],
    qa: [{ runtime: 'cline' }],
  });
  const before = JSON.stringify(wsConfig.readWorkspaceConfigV2(hostRoot));
  profileMod.selectProject(input, 'other-j');
  assert.equal(JSON.stringify(wsConfig.readWorkspaceConfigV2(hostRoot)), before);
  assert.equal(
    assignment.getProjectAssignments(input, 'fixture-j').builders[0].model,
    'keep-me',
  );
});

// ── K / L / M ───────────────────────────────────────────────────────────────

test('CASE K derived ProjectProfile reflects assignment immediately', () => {
  const { dataRoot, hostRoot, projectRoot } = fixturePair('k');
  writeWorkspace(hostRoot, [{ id: 'fixture-k', root: projectRoot }]);
  const input = { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false };
  assignment.setProjectAssignments(input, {
    projectId: 'fixture-k',
    pm: { runtime: 'chatgpt' },
    builders: [{ runtime: 'claude', model: 'team' }],
    qa: [{ runtime: 'grok' }],
  });
  const profile = profileMod.getProjectProfile(input, 'fixture-k');
  assert.equal(profile.builders[0].runtime, 'claude');
  assert.equal(profile.builders[0].model, 'team');
  assert.equal(profile.qa[0].runtime, 'grok');
  assert.equal(profile.pm.runtime, 'chatgpt');
});

test('CASE L availableWorkers remains availability only', () => {
  const { dataRoot, hostRoot, projectRoot } = fixturePair('l');
  writeWorkspace(hostRoot, [{ id: 'fixture-l', root: projectRoot }]);
  writeWorker(dataRoot, 'builder-opencode');
  writeWorker(dataRoot, 'qa-codex', { role: 'qa' });
  const input = { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false };
  assignment.setProjectAssignments(input, {
    projectId: 'fixture-l',
    pm: { runtime: 'chatgpt' },
    builders: [{ runtime: 'opencode' }],
    qa: [{ runtime: 'codex' }],
  });
  const view = assignment.getProjectAssignments(input, 'fixture-l');
  assert.ok(view.availableWorkers.includes('builder-opencode'));
  assert.ok(view.availableWorkers.includes('qa-codex'));
  assert.equal(
    view.builders.some((b) => b.runtimeAdapterId === 'builder-opencode' && !b.runtime),
    false,
  );
  // Availability list is not copied into assigned roles as fabricated membership.
  assert.ok(view.builders.every((b) => b.source === 'WORKSPACE_CONFIG'));
});

test('CASE M UNCONFIGURED project cannot gain fabricated assignment configuration', () => {
  const dataRoot = tmp('m');
  fs.mkdirSync(path.join(dataRoot, '_relay'), { recursive: true });
  fs.writeFileSync(
    path.join(dataRoot, '_relay', 'projects.json'),
    JSON.stringify({ schemaVersion: 1, projects: { 'bare-c02': 'Bare C02' } }),
    'utf8',
  );
  const input = { dataRoot, scope: 'ws', includeCwdHostRoot: false };
  const profile = profileMod.getProjectProfile(input, 'bare-c02');
  assert.equal(profile.profileState, 'UNCONFIGURED');
  assert.throws(
    () => assignment.setProjectAssignments(input, {
      projectId: 'bare-c02',
      pm: { runtime: 'chatgpt' },
      builders: [{ runtime: 'opencode' }],
      qa: [{ runtime: 'codex' }],
    }),
    (err) => err?.code === 'PROJECT_CONFIGURATION_REQUIRED',
  );
  assert.equal(fs.existsSync(path.join(dataRoot, '_relay', 'roles', 'bare-c02.json')), false);
  assert.equal(fs.existsSync(path.join(dataRoot, '_relay', 'agent-assignments.json')), false);
});

// ── N / O + MCP / RoleConfig path ───────────────────────────────────────────

test('CASE N C01 aggregation regression still passes basic invariants', () => {
  const dataRoot = tmp('n');
  const listed = profileMod.listProjectProfiles({
    dataRoot,
    scope: 'ws',
    hostRoots: [repo],
    includeCwdHostRoot: false,
  });
  assert.ok(listed.profiles.some((p) => p.projectId === 'agent-relay' && !p.legacy));
  assert.ok(listed.profiles.some((p) => p.projectId === 'ws' && p.profileState === 'LEGACY'));
});

test('CASE O production widget contract unchanged', () => {
  const tools = appServer.buildAppTools({ dataRoot: tmp('o'), project: 'ws' });
  const opener = tools.find((t) => t.name === 'relay_pm_open_widget');
  assert.ok(opener);
  assert.equal(opener._meta.ui.resourceUri, widget.PM_WIDGET_RESOURCE_URI);
  assert.equal(tools.some((t) => t.name === 'relay_pm_open_widget_probe'), false);
  assert.ok(tools.some((t) => t.name === 'relay_pm_get_project_assignments'));
  assert.ok(tools.some((t) => t.name === 'relay_pm_set_project_assignments'));
});

test('MCP get/set assignments + dashboard assignment summary', async () => {
  const { dataRoot, hostRoot, projectRoot } = fixturePair('mcp');
  writeWorkspace(hostRoot, [{ id: 'fixture-mcp', root: projectRoot }]);
  // MCP ctx has no hostRoots — put a role config so ROLE_CONFIG path works,
  // and also ensure workspace is discoverable via role workspaceRoot walk-up.
  writeRole(dataRoot, 'fixture-mcp', projectRoot);

  const { get } = pm(dataRoot, 'ws');
  // Prefer WORKSPACE_CONFIG when lane is discoverable from role workspaceRoot.
  const got = await get('relay_pm_get_project_assignments').handler({ projectId: 'fixture-mcp' });
  assert.ok(got.assignment);
  assert.ok(got.assignment.store === 'WORKSPACE_CONFIG' || got.assignment.store === 'ROLE_CONFIG');

  const set = await get('relay_pm_set_project_assignments').handler({
    projectId: 'fixture-mcp',
    pm: { runtime: 'chatgpt' },
    builders: [{ runtime: 'opencode' }],
    qa: [{ runtime: 'cline' }],
  });
  assert.equal(set.ok, true);
  assert.equal(set.sideEffects.workersSpawned, 0);

  const dash = await get('relay_pm_get_dashboard').handler({ projectId: 'fixture-mcp' });
  assert.ok(dash.assignment);
  assert.equal(dash.assignment.pm, 'chatgpt');
  // WORKSPACE_CONFIG stores runtime labels; ROLE_CONFIG may surface runtimeAdapterId.
  assert.ok(
    dash.assignment.builders.includes('opencode')
      || dash.assignment.builders.includes('builder-opencode'),
    `builders=${JSON.stringify(dash.assignment.builders)}`,
  );
});

test('ROLE_CONFIG-owned project updates RoleConfig without inventing workspace.v2', () => {
  const dataRoot = tmp('role');
  const wsRoot = tmp('role-ws');
  writeRole(dataRoot, 'role-only', wsRoot);
  writeWorker(dataRoot, 'builder-opencode');
  const input = { dataRoot, scope: 'ws', includeCwdHostRoot: false };
  // No hostRoots and no workspace.v2 near wsRoot → ROLE_CONFIG owner.
  const result = assignment.setProjectAssignments(input, {
    projectId: 'role-only',
    pm: { runtime: 'chatgpt' },
    builders: [{ workerId: 'builder-opencode', runtime: 'opencode' }],
    qa: [{ runtime: 'codex' }],
  });
  assert.equal(result.store, 'ROLE_CONFIG');
  const raw = JSON.parse(fs.readFileSync(path.join(dataRoot, '_relay', 'roles', 'role-only.json'), 'utf8'));
  const builder = raw.assignments.find((a) => a.roleId === 'builder');
  assert.equal(builder.runtimeAdapterId, 'builder-opencode');
  assert.equal(builder.workspace.workspaceRoot, wsRoot);
  assert.equal(fs.existsSync(path.join(wsRoot, '.agent-relay', 'workspace-config.json')), false);
});

test('QA-tagged worker rejected as Builder when role metadata proves incompatibility', () => {
  const { dataRoot, hostRoot, projectRoot } = fixturePair('compat');
  writeWorkspace(hostRoot, [{ id: 'fixture-compat', root: projectRoot }]);
  writeWorker(dataRoot, 'qa-only-worker', { role: 'qa' });
  const input = { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false };
  assert.throws(
    () => assignment.setProjectAssignments(input, {
      projectId: 'fixture-compat',
      pm: { runtime: 'chatgpt' },
      builders: [{ workerId: 'qa-only-worker' }],
      qa: [{ runtime: 'codex' }],
    }),
    (err) => err?.code === 'ROLE_COMPATIBILITY',
  );
});
