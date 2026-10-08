/**
 * P2-OWNER-R00 — project registration & workspace path picker.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';

const repo = path.resolve(import.meta.dirname, '..');
const dist = (p) => path.join(repo, 'dist/server', p);
const srcWidget = path.join(repo, 'src/mcp/app/pm-widget-resource.ts');

const browse = await import(dist('backend/workspace-browse.js'));
const reg = await import(dist('backend/project-registration.js'));
const profile = await import(dist('backend/project-profile.js'));
const wsConfig = await import(dist('workspace/config-v2.js'));
const goalTask = await import(dist('backend/goal-task.js'));
const pmTools = await import(dist('mcp/pm-tools.js'));
const widget = await import(dist('mcp/app/pm-widget-resource.js'));

const CORE = path.join(os.homedir(), 'Desktop', 'Projects', 'Core');
const TEAM = path.join(os.homedir(), 'Desktop', 'Projects', 'Team');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `arl-r00-${prefix}-`));
}

function seedHost(hostRoot, lanes) {
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
        runtime: 'claude',
        model: 'pro',
        workerId: 'builder-fixture',
        roleProfile: rpB,
      },
      qa: lane.qa || { runtime: 'cline', model: 'default', roleProfile: rpQ },
      qaFallback: { runtime: 'cursor', model: 'default' },
    })),
  });
}

function fixtureHost() {
  const dataRoot = tmp('data');
  const hostRoot = tmp('host');
  const projectRoot = path.join(hostRoot, 'DemoProj');
  fs.mkdirSync(projectRoot, { recursive: true });
  // Place a registerable folder under real Core allowlist via symlink into tmp? 
  // Tests that need allowlist use real Core/Team. Registration tests use custom browseRoots.
  seedHost(hostRoot, [{
    id: 'demo-proj',
    label: 'Demo',
    root: projectRoot,
  }]);
  return { dataRoot, hostRoot, projectRoot };
}

test('browse roots exist for Core and Team', () => {
  const roots = browse.listBrowseRoots();
  const core = roots.find((r) => r.rootId === 'core');
  const team = roots.find((r) => r.rootId === 'team');
  assert.ok(core);
  assert.ok(team);
  assert.equal(core.exists, fs.existsSync(CORE));
  assert.equal(team.exists, fs.existsSync(TEAM));
});

test('browse lists directories one level under Core', () => {
  assert.ok(fs.existsSync(CORE));
  const res = browse.browseDirectories({ absolutePath: CORE });
  assert.equal(res.path, fs.realpathSync(CORE));
  assert.ok(Array.isArray(res.entries));
  assert.ok(res.entries.every((e) => e.isDirectory === true));
  assert.ok(res.entries.some((e) => e.name === 'Agent-Relay' || e.name === 'JuControler'));
});

test('outside allowlist / missing / traversal fail', () => {
  assert.throws(
    () => browse.resolveAndValidatePath('/tmp'),
    (err) => err?.code === 'OUTSIDE_ALLOWLIST',
  );
  assert.throws(
    () => browse.resolveAndValidatePath(path.join(CORE, 'no-such-folder-r00-xyz')),
    (err) => err?.code === 'NOT_FOUND',
  );
  // Literal ".." segment must be rejected before realpath collapse.
  assert.throws(
    () => browse.resolveAndValidatePath(CORE + '/../..'),
    (err) => err?.code === 'OUTSIDE_ALLOWLIST' || err?.code === 'INVALID_ARGUMENT',
  );
  // Resolved escape outside both Core and Team.
  assert.throws(
    () => browse.resolveAndValidatePath(path.resolve(CORE, '..', '..')),
    (err) => err?.code === 'OUTSIDE_ALLOWLIST',
  );
});

test('symlink escape outside allowlist fails', () => {
  const trap = tmp('symlink');
  const outside = path.join(trap, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  // Put a symlink inside Core? We must not write into production Core.
  // Use custom browse roots pointing at trap/allowed and symlink to outside.
  const allowed = path.join(trap, 'allowed');
  fs.mkdirSync(allowed, { recursive: true });
  const link = path.join(allowed, 'escape');
  fs.symlinkSync(outside, link);
  const roots = [{ rootId: 't', label: 't', path: allowed }];
  assert.throws(
    () => browse.resolveAndValidatePath(link, roots),
    (err) => err?.code === 'OUTSIDE_ALLOWLIST',
  );
});

test('register project + profile re-list PARTIAL; duplicates fail', () => {
  const { dataRoot, hostRoot } = fixtureHost();
  const folder = tmp('newproj');
  fs.mkdirSync(folder, { recursive: true });
  const roots = [{ rootId: 'x', label: 'x', path: folder }];
  // Register the folder itself as workspace under custom allowlist root=parent
  const parent = path.dirname(folder);
  const browseRoots = [{ rootId: 'x', label: 'x', path: parent }];
  // Ensure parent is the allowlist and folder is inside
  const preview = reg.previewRegisterProject({
    dataRoot,
    scope: 'ws',
    hostRoot,
    projectName: 'New Thing',
    workspacePath: folder,
    projectId: 'new-thing',
    browseRoots,
  });
  assert.equal(preview.projectId, 'new-thing');
  assert.equal(preview.profileStateAfter, 'PARTIAL');

  assert.throws(
    () => reg.registerProject({
      dataRoot, scope: 'ws', hostRoot,
      projectName: 'New Thing', workspacePath: folder, projectId: 'new-thing',
      browseRoots, confirm: false,
    }),
    (err) => err?.code === 'CONFIRM_REQUIRED',
  );

  const result = reg.registerProject({
    dataRoot, scope: 'ws', hostRoot,
    projectName: 'New Thing', workspacePath: folder, projectId: 'new-thing',
    browseRoots, confirm: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.sideEffects.workersSpawned, 0);
  assert.equal(result.sideEffects.agentAutoSelected, 0);
  assert.equal(result.profile.profileState, 'PARTIAL');
  assert.equal(result.profile.workspacePath, fs.realpathSync(folder));
  assert.ok(!(result.profile.builders || []).some((b) => b && b.workerId));

  const listed = profile.listProjectProfiles({
    dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false,
  });
  assert.ok(listed.profiles.some((p) => p.projectId === 'new-thing' && p.profileState === 'PARTIAL'));

  assert.throws(
    () => reg.registerProject({
      dataRoot, scope: 'ws', hostRoot,
      projectName: 'Dup', workspacePath: folder, projectId: 'new-thing',
      browseRoots, confirm: true,
    }),
    (err) => err?.code === 'DUPLICATE_PROJECT_ID',
  );

  const other = path.join(parent, `other-${process.pid}`);
  fs.mkdirSync(other, { recursive: true });
  // Same workspace path different id
  assert.throws(
    () => reg.registerProject({
      dataRoot, scope: 'ws', hostRoot,
      projectName: 'Other', workspacePath: folder, projectId: 'other-id',
      browseRoots, confirm: true,
    }),
    (err) => err?.code === 'DUPLICATE_WORKSPACE',
  );
});

test('path change happy path; READY task blocks; scopes unchanged', async () => {
  const { dataRoot, hostRoot, projectRoot } = fixtureHost();
  const nextFolder = tmp('nextpath');
  fs.mkdirSync(nextFolder, { recursive: true });
  const browseRoots = [
    { rootId: 'a', label: 'a', path: path.dirname(projectRoot) },
    { rootId: 'b', label: 'b', path: path.dirname(nextFolder) },
  ];
  // Widen allowlist to both parents
  const combinedRoot = tmp('allow');
  // Use custom roots that include both folders' parents — already set.

  const before = profile.getProjectProfile({
    dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false,
  }, 'demo-proj');
  assert.ok(before);
  assert.equal(before.profileState, 'CONFIGURED');

  const changed = reg.setProjectWorkspacePath({
    dataRoot,
    scope: 'ws',
    projectId: 'demo-proj',
    workspacePath: nextFolder,
    hostRoot,
    browseRoots: [{ rootId: 'n', label: 'n', path: path.dirname(nextFolder) }],
  });
  assert.equal(changed.nextPath, fs.realpathSync(nextFolder));
  assert.equal(changed.sideEffects.taskScopesRewritten, 0);

  // Create READY task then path change must fail
  const goal = await goalTask.createGoal(dataRoot, 'ws', {
    title: 'g',
    goalStatement: 'g',
    permissionPolicy: { mode: 'PLAN' },
    projectId: 'demo-proj',
    projectName: 'Demo',
  });
  const task = await goalTask.createTask(dataRoot, 'ws', {
    goalId: goal.goalId,
    title: 't',
    goal: 't',
    reason: 'r00',
    scope: projectRoot,
    completionCriteria: ['done'],
    executionState: 'READY',
    projectId: 'demo-proj',
    projectName: 'Demo',
  });
  const scopeBefore = task.scope;
  const againFolder = tmp('blocked');
  fs.mkdirSync(againFolder, { recursive: true });
  assert.throws(
    () => reg.setProjectWorkspacePath({
      dataRoot,
      scope: 'ws',
      projectId: 'demo-proj',
      workspacePath: againFolder,
      hostRoot,
      browseRoots: [{ rootId: 'n', label: 'n', path: path.dirname(againFolder) }],
    }),
    (err) => err?.code === 'PATH_CHANGE_BLOCKED',
  );
  const taskAfter = goalTask.getTask(dataRoot, 'ws', task.taskId);
  assert.equal(taskAfter.scope, scopeBefore);
});

test('existing project select MCP tools registered; widget contracts', () => {
  const { dataRoot } = fixtureHost();
  const tools = pmTools.buildAllPmTools({
    dataRoot,
    project: 'ws',
    goalLoop: { workspaceRoot: repo, workerId: 'x' },
  });
  const names = new Set(tools.map((t) => t.name));
  for (const n of [
    'relay_pm_list_project_profiles',
    'relay_pm_select_project',
    'relay_pm_list_workspace_browse_roots',
    'relay_pm_browse_workspace_directories',
    'relay_pm_preview_register_project',
    'relay_pm_register_project',
    'relay_pm_set_project_workspace_path',
  ]) {
    assert.ok(names.has(n), `missing ${n}`);
  }

  const src = readFileSync(srcWidget, 'utf8');
  assert.match(src, /relay_pm_browse_workspace_directories/);
  assert.match(src, /relay_pm_register_project/);
  assert.match(src, /relay_pm_set_project_workspace_path/);
  assert.match(src, /id="tpProject"/);
  assert.match(src, /id="tpComputer"/);
  assert.match(src, /실행 컴퓨터는 ASUS/);
  assert.match(src, /등록 승인/);
  // select_project must remain the switch path (no register on mere select)
  assert.match(src, /relay_pm_select_project/);

  assert.match(widget.PM_WIDGET_RESOURCE_URI, /^ui:\/\/agent-relay\/pm-widget-[0-9a-f]{8}$/);
  assert.notEqual(widget.PM_WIDGET_CONTENT_FINGERPRINT, '870bd581');
});

test('list/select existing project still works on fixture', () => {
  const { dataRoot, hostRoot, projectRoot } = fixtureHost();
  const listed = profile.listProjectProfiles({
    dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false,
  });
  assert.ok(listed.profiles.some((p) => p.projectId === 'demo-proj'));
  const sel = profile.selectProject({
    dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false,
  }, 'demo-proj');
  assert.equal(sel.ok, true);
  assert.equal(sel.selectedProjectId, 'demo-proj');
  assert.equal(sel.sideEffects.goalsCreated, 0);
  assert.equal(sel.sideEffects.tasksCreated, 0);
  assert.equal(sel.sideEffects.dispatches, 0);
  assert.equal(sel.sideEffects.workersSpawned, 0);
  void projectRoot;
});
