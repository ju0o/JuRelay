/**
 * OWNER-02A — optional explicit workerId on WorkspaceConfigV2 bindings.
 * Isolated fixtures only; no Goals/Tasks/Runs; other project lanes untouched.
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
const dispatchResolve = await import(dist('backend/dispatch-resolve.js'));
const workerRegistry = await import(dist('backend/worker-registry.js'));
const wsConfig = await import(dist('workspace/config-v2.js'));
const goalTask = await import(dist('backend/goal-task.js'));

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `arl-owner02a-${prefix}-`));
}

function writeWorker(root, workerId, extra = {}) {
  workerRegistry.writeWorkerRegistryRecord(root, {
    schemaVersion: 'G.2',
    workerId,
    displayName: workerId,
    launchCommand: process.execPath,
    launchArgsPrefix: ['-e', 'process.exit(0)'],
    observationAdapterId: 'claude-code',
    capabilities: [],
    role: 'implementation',
    ...extra,
  });
}

function writeWorkspace(hostRoot, lanes) {
  fs.mkdirSync(path.join(hostRoot, '.agent-relay'), { recursive: true });
  const rpB = { sessionPolicy: 'per-task', permissionProfile: 'write-workspace' };
  const rpQ = { sessionPolicy: 'per-task', permissionProfile: 'read-only' };
  const rpP = { sessionPolicy: 'persistent', permissionProfile: 'read-only' };
  const config = {
    schemaVersion: 'workspace.v2',
    concurrency: { maxActiveBuilders: 2, maxActiveQa: 1 },
    lanes: lanes.map((lane) => ({
      id: lane.id,
      label: lane.label || lane.id,
      root: lane.root,
      goal: lane.goal || 'fixture',
      pm: lane.pm || { runtime: 'chatgpt', model: 'default', roleProfile: rpP },
      builder: lane.builder || { runtime: 'claude', model: 'team', roleProfile: rpB },
      ...(lane.builders ? { builders: lane.builders } : {}),
      qa: lane.qa || { runtime: 'cline', model: 'default', roleProfile: rpQ },
      qaFallback: { runtime: 'cursor', model: 'default' },
    })),
  };
  wsConfig.writeWorkspaceConfigV2(hostRoot, config);
}

function fixture() {
  const dataRoot = tmp('data');
  const hostRoot = tmp('host');
  const jcRoot = path.join(hostRoot, 'JuControler');
  const otherRoot = path.join(hostRoot, 'Other');
  fs.mkdirSync(jcRoot, { recursive: true });
  fs.mkdirSync(otherRoot, { recursive: true });
  writeWorkspace(hostRoot, [
    { id: 'jucontroller', root: jcRoot, builder: { runtime: 'claude', model: 'team', roleProfile: { sessionPolicy: 'per-task', permissionProfile: 'write-workspace' } } },
    { id: 'other-proj', root: otherRoot, builder: { runtime: 'opencode', model: 'default', roleProfile: { sessionPolicy: 'per-task', permissionProfile: 'write-workspace' } } },
  ]);
  writeWorker(dataRoot, 'builder-claude-live');
  writeWorker(dataRoot, 'builder-claude-pro');
  writeWorker(dataRoot, 'builder-opencode', { observationAdapterId: 'opencode', capabilities: ['opencode'] });
  return { dataRoot, hostRoot, jcRoot, otherRoot };
}

function countGoalsTasks(dataRoot) {
  let goals = 0;
  let tasks = 0;
  try { goals = goalTask.listGoals(dataRoot, 'ws').length; } catch { /* empty */ }
  try { tasks = goalTask.listTasks(dataRoot, 'ws', undefined).length; } catch { /* empty */ }
  return { goals, tasks };
}

test('claude twin candidates without workerId → BUILDER_AMBIGUOUS (no arbitrary pick)', () => {
  const { dataRoot, hostRoot } = fixture();
  const before = countGoalsTasks(dataRoot);
  const resolved = dispatchResolve.resolveOwnerDispatch({
    dataRoot,
    scope: 'ws',
    projectId: 'jucontroller',
    hostRoots: [hostRoot],
    includeCwdHostRoot: false,
  });
  assert.equal(resolved.ok, false);
  assert.ok(resolved.blockers.includes('BUILDER_AMBIGUOUS'), `blockers=${resolved.blockers}`);
  assert.equal(resolved.workerId, null);
  assert.equal(resolved.desiredBuilder, 'claude');
  assert.equal(resolved.projectDesiredBuilder, 'claude');
  const mapped = dispatchResolve.mapBuilderToWorker(dataRoot, 'claude');
  assert.equal(mapped.ok, false);
  assert.equal(mapped.reason, 'ambiguous');
  assert.deepEqual(mapped.candidates.sort(), ['builder-claude-live', 'builder-claude-pro']);
  assert.deepEqual(countGoalsTasks(dataRoot), before);
});

test('explicit workerId persists, reloads, and resolves uniquely', () => {
  const { dataRoot, hostRoot, otherRoot } = fixture();
  const before = countGoalsTasks(dataRoot);
  const otherBefore = profileMod.getProjectProfile(
    { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false },
    'other-proj',
  );

  const set = assignment.setProjectAssignments(
    { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false },
    {
      projectId: 'jucontroller',
      pm: { runtime: 'chatgpt', model: 'default' },
      builders: [{ workerId: 'builder-claude-pro', runtime: 'claude', model: 'team' }],
      qa: [{ runtime: 'cline', model: 'default' }],
    },
  );
  assert.equal(set.ok, true);
  assert.equal(set.store, 'WORKSPACE_CONFIG');
  assert.equal(set.sideEffects.goalsCreated, 0);
  assert.equal(set.sideEffects.tasksCreated, 0);
  assert.equal(set.sideEffects.runsCreated, 0);
  assert.equal(set.sideEffects.workersSpawned, 0);

  const raw = JSON.parse(
    fs.readFileSync(path.join(hostRoot, '.agent-relay', 'workspace-config.json'), 'utf8'),
  );
  const lane = raw.lanes.find((l) => l.id === 'jucontroller');
  assert.equal(lane.builder.workerId, 'builder-claude-pro');
  assert.equal(lane.builder.runtime, 'claude');
  assert.equal(lane.builder.model, 'team');
  const otherLane = raw.lanes.find((l) => l.id === 'other-proj');
  assert.equal(otherLane.builder.runtime, 'opencode');
  assert.equal(otherLane.builder.workerId, undefined);

  const got = assignment.getProjectAssignments(
    { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false },
    'jucontroller',
  );
  assert.equal(got.builders[0].workerId, 'builder-claude-pro');
  assert.equal(got.builders[0].runtime, 'claude');
  assert.equal(got.pm.runtime, 'chatgpt');
  assert.equal(got.qa[0].runtime, 'cline');
  assert.equal(got.workspacePath, path.resolve(path.join(hostRoot, 'JuControler')));

  const resolved = dispatchResolve.resolveOwnerDispatch({
    dataRoot,
    scope: 'ws',
    projectId: 'jucontroller',
    hostRoots: [hostRoot],
    includeCwdHostRoot: false,
  });
  // No Task in this fixture on purpose (zero Goal/Task/Run). Builder map must still uniquify.
  assert.equal(resolved.desiredBuilder, 'builder-claude-pro');
  assert.equal(resolved.projectDesiredBuilder, 'builder-claude-pro');
  assert.equal(resolved.workerId, 'builder-claude-pro');
  assert.ok(!resolved.blockers.includes('BUILDER_AMBIGUOUS'), `blockers=${resolved.blockers}`);
  assert.ok(!resolved.blockers.includes('UNKNOWN_BUILDER'), `blockers=${resolved.blockers}`);
  assert.ok(resolved.blockers.includes('NO_TASK'));
  assert.ok(!resolved.blockers.includes('TASK_EXECUTION_SELECTION_REQUIRED'));

  const otherAfter = profileMod.getProjectProfile(
    { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false },
    'other-proj',
  );
  assert.equal(otherAfter.builders[0].runtime, otherBefore.builders[0].runtime);
  assert.equal(otherAfter.workspacePath, otherRoot);
  assert.deepEqual(countGoalsTasks(dataRoot), before);
});

test('unknown workerId rejected; no workspace rewrite', () => {
  const { dataRoot, hostRoot } = fixture();
  const beforeRaw = fs.readFileSync(path.join(hostRoot, '.agent-relay', 'workspace-config.json'), 'utf8');
  assert.throws(
    () => assignment.setProjectAssignments(
      { dataRoot, scope: 'ws', hostRoots: [hostRoot], includeCwdHostRoot: false },
      {
        projectId: 'jucontroller',
        pm: { runtime: 'chatgpt' },
        builders: [{ workerId: 'does-not-exist-worker' }],
        qa: [{ runtime: 'cline' }],
      },
    ),
    (err) => err?.code === 'UNKNOWN_WORKER',
  );
  const afterRaw = fs.readFileSync(path.join(hostRoot, '.agent-relay', 'workspace-config.json'), 'utf8');
  assert.equal(afterRaw, beforeRaw);
});
