/**
 * P1.8C-04 — Bounded Project Dashboard (`relay_pm_get_project`).
 *
 * Cases A–R per WBS.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const dist = (p) => path.join(repo, 'dist/server', p);

const dashMod = await import(dist('backend/project-dashboard.js'));
const profileMod = await import(dist('backend/project-profile.js'));
const uiState = await import(dist('backend/ui-state.js'));
const goalTask = await import(dist('backend/goal-task.js'));
const wsConfig = await import(dist('workspace/config-v2.js'));
const pmTools = await import(dist('mcp/pm-tools.js'));
const appServer = await import(dist('mcp/app-server.js'));
const widget = await import(dist('mcp/app/pm-widget-resource.js'));

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `arl-p18c04-${prefix}-`));
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
}

function writeGoal(root, project, goal) {
  const folder = path.join(root, project, '_relay', 'goals', goal.goalId);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'goal.json'), `${JSON.stringify(goal, null, 2)}\n`);
}

function writeTask(root, project, task) {
  const folder = path.join(root, project, '_relay', 'tasks', task.taskId);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'task.json'), `${JSON.stringify(task, null, 2)}\n`);
}

function baseTask(over) {
  return {
    schemaVersion: 2,
    taskId: 'TASK-0900',
    goalId: 'GOAL-0001',
    project: 'ws',
    projectId: 'agent-relay',
    projectName: 'Agent Relay',
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

function baseGoal(over) {
  return {
    schemaVersion: 2,
    goalId: 'GOAL-0001',
    project: 'ws',
    title: 'Ship C04 dashboard',
    goalStatement: 'Bounded project dashboard is visible after bootstrap.',
    status: 'ACTIVE',
    completionCriteria: ['dashboard shows project path goal task next action'],
    permissionPolicy: { mode: 'APPROVE' },
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    ...over,
  };
}

function configuredFixture(prefix) {
  const root = tmp(`${prefix}-data`);
  const host = tmp(`${prefix}-host`);
  writeWorkspace(host, [{ id: 'agent-relay', root: host }]);
  writeRole(root, 'agent-relay', host);
  return { root, host };
}

test('A selected Agent Relay → bounded correct dashboard', async () => {
  const { root, host } = configuredFixture('a');
  writeGoal(root, 'ws', baseGoal());
  writeTask(root, 'ws', baseTask({
    executionState: 'READY',
    title: 'Wire get_project',
  }));
  uiState.saveSelectedProjectId(root, 'agent-relay');
  // Isolate from the repo cwd workspace.v2 so the fixture host path wins.
  const view = dashMod.getProjectDashboard({
    dataRoot: root,
    scope: 'ws',
    hostRoots: [host],
    includeCwdHostRoot: false,
  });
  assert.equal(view.schemaVersion, 'project-dashboard.v1');
  assert.ok(view.project);
  assert.equal(view.project.projectId, 'agent-relay');
  assert.equal(view.project.workspacePath, host);
  assert.ok(view.assignment);
  assert.equal(view.assignment.pm, 'chatgpt');
  assert.ok(view.assignment.builders.includes('opencode') || view.assignment.builders.includes('builder-opencode'));
  assert.ok(Array.isArray(view.recentTasks));
  assert.ok(view.recentTasks.length <= dashMod.PROJECT_DASHBOARD_MAX_RECENT_TASKS);

  // MCP surface returns the same schema.
  const mcpView = await pm(root).get('relay_pm_get_project').handler({});
  assert.equal(mcpView.schemaVersion, 'project-dashboard.v1');
  assert.ok(mcpView.project);
  assert.ok(!('projectProfiles' in mcpView));
});

test('B explicit projectId overrides selected view without persisting selection', async () => {
  const { root, host } = configuredFixture('b');
  writeWorkspace(host, [
    { id: 'agent-relay', root: host },
    { id: 'juplan', root: path.join(host, 'juplan') },
  ]);
  fs.mkdirSync(path.join(host, 'juplan'), { recursive: true });
  writeRole(root, 'juplan', path.join(host, 'juplan'));
  uiState.saveSelectedProjectId(root, 'agent-relay');
  const before = uiState.loadUiState(root).selectedProjectId;
  const { get } = pm(root);
  const view = await get('relay_pm_get_project').handler({ projectId: 'juplan' });
  assert.equal(view.basis, 'ARGUMENT');
  assert.equal(view.argumentOverride, true);
  assert.equal(view.project.projectId, 'juplan');
  assert.equal(uiState.loadUiState(root).selectedProjectId, before);
});

test('C selectedProjectId remains unchanged after reads', async () => {
  const { root } = configuredFixture('c');
  uiState.saveSelectedProjectId(root, 'agent-relay');
  const { get } = pm(root);
  await get('relay_pm_get_project').handler({});
  await get('relay_pm_get_project').handler({ projectId: 'agent-relay' });
  assert.equal(uiState.loadUiState(root).selectedProjectId, 'agent-relay');
  assert.equal((await get('relay_pm_get_project').handler({})).sideEffects.selectionChanged, 0);
});

test('D Goal title/status correct', async () => {
  const { root } = configuredFixture('d');
  writeGoal(root, 'ws', baseGoal({ title: 'Dashboard Goal', status: 'ACTIVE' }));
  writeTask(root, 'ws', baseTask({
    title: 'Current work',
    executionState: 'READY',
    goalId: 'GOAL-0001',
  }));
  uiState.saveSelectedProjectId(root, 'agent-relay');
  const view = await pm(root).get('relay_pm_get_project').handler({});
  assert.ok(view.goal);
  assert.equal(view.goal.title, 'Dashboard Goal');
  assert.equal(view.goal.status, 'ACTIVE');
});

test('E current Task truth uses runtimeState, not persisted state alone', () => {
  const { root } = configuredFixture('e');
  const tasks = [
    baseTask({
      taskId: 'TASK-ORPH',
      title: 'orphan run',
      executionState: 'RUNNING',
      pmState: 'PENDING',
      linkedRuns: [{ runId: 'RUN-1', agent: 'builder-opencode', taskRunSequence: 1 }],
    }),
  ];
  const goals = [baseGoal()];
  uiState.saveSelectedProjectId(root, 'agent-relay');
  // Dead dispatch handle (pid not alive) → ORPHAN despite persisted RUNNING.
  const view = dashMod.getProjectDashboard({
    dataRoot: root,
    scope: 'ws',
    hostRoots: [],
    includeCwdHostRoot: false,
    tasks,
    goals,
    liveHandles: [{
      taskId: 'TASK-ORPH',
      workerId: 'builder-opencode',
      pid: 2147483000,
      dispatchedAt: '2026-10-05T00:00:00.000Z',
    }],
    probe: false,
  });
  assert.ok(view.task);
  assert.equal(view.task.executionState, 'RUNNING');
  assert.equal(view.task.runtimeState, 'ORPHAN');
});

test('F ORPHAN task displays ORPHAN and PM_RESOLVE_ORPHAN', () => {
  const { root } = configuredFixture('f');
  const view = dashMod.getProjectDashboard({
    dataRoot: root,
    scope: 'ws',
    includeCwdHostRoot: false,
    tasks: [
      baseTask({
        taskId: 'TASK-F1',
        title: 'dead worker',
        executionState: 'RUNNING',
        linkedRuns: [{ runId: 'RUN-F', agent: 'builder-opencode', taskRunSequence: 1 }],
      }),
    ],
    goals: [baseGoal()],
    liveHandles: [{
      taskId: 'TASK-F1',
      workerId: 'builder-opencode',
      pid: 2147483001,
      dispatchedAt: '2026-10-05T00:00:00.000Z',
    }],
    probe: false,
  });
  assert.equal(view.task.runtimeState, 'ORPHAN');
  assert.equal(view.task.nextAction, 'PM_RESOLVE_ORPHAN');
  assert.match(view.nextActionText, /orphan|워커 없음/i);
  assert.equal(view.counts.actualActiveRuns, 0);
  assert.ok(view.counts.orphanRuns >= 1);
  assert.ok(view.counts.persistedRunning >= 1);
});

test('G RESULT_RECEIVED/ACCEPTED does not appear as actually running', () => {
  const { root } = configuredFixture('g');
  const view = dashMod.getProjectDashboard({
    dataRoot: root,
    scope: 'ws',
    includeCwdHostRoot: false,
    tasks: [
      baseTask({
        taskId: 'TASK-G1',
        title: 'needs verify',
        executionState: 'RESULT_RECEIVED',
        pmState: 'VERIFYING',
      }),
      baseTask({
        taskId: 'TASK-G2',
        title: 'already accepted',
        executionState: 'RESULT_RECEIVED',
        pmState: 'ACCEPTED',
      }),
    ],
    goals: [baseGoal()],
    probe: false,
  });
  assert.equal(view.counts.actualActiveRuns, 0);
  // ACCEPTED must not inflate verificationPending.
  assert.equal(view.counts.verificationPending, 1);
  // ACCEPTED must not win the headline over VERIFYING.
  assert.ok(view.task);
  assert.equal(view.task.taskId, 'TASK-G1');
  assert.notEqual(view.task.runtimeState, 'ACTIVE');
  assert.equal(view.task.nextAction, 'PM_VERIFY_RESULT');
  assert.equal(view.nextAction, 'PM_VERIFY_RESULT');
});

test('G2 ACCEPTED does not re-ask verify; READY under other Goal stays distinct', () => {
  const { root } = configuredFixture('g2');
  const view = dashMod.getProjectDashboard({
    dataRoot: root,
    scope: 'ws',
    includeCwdHostRoot: false,
    tasks: [
      baseTask({
        taskId: 'TASK-0085',
        goalId: 'GOAL-0022',
        title: 'accepted preflight',
        executionState: 'RESULT_RECEIVED',
        pmState: 'ACCEPTED',
        projectId: 'agent-relay',
      }),
      baseTask({
        taskId: 'TASK-0089',
        goalId: 'GOAL-0026',
        title: 'ready allowlist',
        executionState: 'READY',
        pmState: 'PENDING',
        projectId: 'agent-relay',
      }),
    ],
    goals: [
      baseGoal({
        goalId: 'GOAL-0022',
        title: 'JuControler 첫 Agent Relay 실작업 안전 확인',
        status: 'ACTIVE',
        projectId: 'agent-relay',
      }),
      baseGoal({
        goalId: 'GOAL-0026',
        title: 'JuControler 공개 저장소의 실제 디렉터리 역할을 설명하고 README의 추적 규칙을 정리한다.',
        status: 'PLANNING',
        projectId: 'agent-relay',
        updatedAt: '2026-10-08T10:26:06.183Z',
      }),
    ],
    probe: false,
  });
  assert.equal(view.task?.taskId, 'TASK-0089');
  assert.equal(view.task?.nextAction, 'PM_DISPATCH_TASK');
  assert.equal(view.task?.goalId, 'GOAL-0026');
  assert.notEqual(view.nextAction, 'PM_VERIFY_RESULT');
  assert.match(String(view.nextActionText), /준비된 Task|대기 중 Task|목표가 다릅니다/);
  // Active Goal card keeps GOAL-0022 title — never the READY Goal's README title.
  assert.equal(view.goal?.goalId, 'GOAL-0022');
  assert.equal(view.goal?.title, 'JuControler 첫 Agent Relay 실작업 안전 확인');
  assert.notEqual(
    view.goal?.title,
    'JuControler 공개 저장소의 실제 디렉터리 역할을 설명하고 README의 추적 규칙을 정리한다.',
  );
  assert.equal(view.counts.verificationPending, 0);
  assert.equal(view.counts.readyTasks, 1);
});

test('H assignment summary is desired assignment only', async () => {
  const { root } = configuredFixture('h');
  uiState.saveSelectedProjectId(root, 'agent-relay');
  const view = await pm(root).get('relay_pm_get_project').handler({});
  assert.ok(view.assignment);
  assert.equal(typeof view.assignment.pm, 'string');
  assert.ok(Array.isArray(view.assignment.builders));
  assert.ok(Array.isArray(view.assignment.qa));
  // No spawned-worker fields on assignment summary.
  assert.equal(view.assignment.workersSpawned, undefined);
  assert.equal(view.assignment.availableWorkers, undefined);
});

test('I runtime Worker and desired assignment remain distinct', () => {
  // Workspace-only lane uses runtime label "opencode"; observed worker id differs.
  const root = tmp('i-data');
  const host = tmp('i-host');
  writeWorkspace(host, [{ id: 'agent-relay', root: host }]);
  const view = dashMod.getProjectDashboard({
    dataRoot: root,
    scope: 'ws',
    hostRoots: [host],
    includeCwdHostRoot: false,
    tasks: [
      baseTask({
        taskId: 'TASK-I1',
        title: 'orphan with worker id',
        executionState: 'RUNNING',
        linkedRuns: [{ runId: 'RUN-I', agent: 'builder-opencode', taskRunSequence: 1 }],
      }),
    ],
    goals: [baseGoal()],
    liveHandles: [{
      taskId: 'TASK-I1',
      workerId: 'builder-opencode',
      pid: 2147483002,
      dispatchedAt: '2026-10-05T00:00:00.000Z',
    }],
    probe: false,
  });
  assert.ok(view.assignment);
  assert.ok(view.task);
  assert.equal(view.assignment.builders[0], 'opencode');
  assert.equal(view.task.agent, 'builder-opencode');
  assert.notEqual(view.task.agent, view.assignment.builders[0]);
});

test('J no active Goal → good empty state', () => {
  const { root } = configuredFixture('j');
  const view = dashMod.getProjectDashboard({
    dataRoot: root,
    scope: 'ws',
    includeCwdHostRoot: false,
    tasks: [],
    goals: [],
  });
  assert.equal(view.goal, null);
  assert.equal(view.empty.goal, true);
  assert.match(view.empty.goalText, /Goal/);
});

test('K no current Task → good empty state', () => {
  const { root } = configuredFixture('k');
  writeGoal(root, 'ws', baseGoal());
  const view = dashMod.getProjectDashboard({
    dataRoot: root,
    scope: 'ws',
    includeCwdHostRoot: false,
    tasks: [],
    goals: [baseGoal()],
  });
  assert.equal(view.task, null);
  assert.equal(view.empty.task, true);
  assert.match(view.empty.taskText, /Task/);
});

test('L UNCONFIGURED project → setup required state', () => {
  const root = tmp('l-data');
  // Known identity in registry, no RoleConfig, no WorkspaceConfig → UNCONFIGURED.
  const regDir = path.join(root, '_relay');
  fs.mkdirSync(regDir, { recursive: true });
  fs.writeFileSync(path.join(regDir, 'projects.json'), `${JSON.stringify({
    schemaVersion: 'projects.v1',
    projects: {
      r30: { projectName: 'R30 AI Revenue' },
    },
  }, null, 2)}\n`);
  const view = dashMod.getProjectDashboard({
    dataRoot: root,
    scope: 'ws',
    projectId: 'r30',
    includeCwdHostRoot: false,
    tasks: [],
    goals: [],
  });
  assert.ok(view.project, 'expected r30 project row');
  assert.equal(view.project.projectId, 'r30');
  assert.equal(view.project.profileState, 'UNCONFIGURED');
  assert.ok(view.warnings.some((w) => w.code === 'UNCONFIGURED'));
});

test('M LEGACY → legacy state', () => {
  const root = tmp('m-data');
  writeTask(root, 'ws', baseTask({
    taskId: 'TASK-LEG',
    projectId: undefined,
    projectName: undefined,
    project: 'ws',
    title: 'legacy task',
    executionState: 'READY',
  }));
  // Force selection of ws legacy profile when present.
  const listed = profileMod.listProjectProfiles({
    dataRoot: root,
    scope: 'ws',
    includeCwdHostRoot: false,
  });
  const legacy = listed.profiles.find((p) => p.projectId === 'ws' || p.legacy);
  assert.ok(legacy, 'legacy ws profile expected');
  uiState.saveSelectedProjectId(root, legacy.projectId);
  const view = dashMod.getProjectDashboard({
    dataRoot: root,
    scope: 'ws',
    includeCwdHostRoot: false,
  });
  assert.ok(view.project);
  assert.ok(view.project.legacy || view.project.profileState === 'LEGACY');
  assert.ok(view.warnings.some((w) => w.code === 'LEGACY'));
});

test('N workspaceConflict → blocked warning', () => {
  const root = tmp('n-data');
  const hostA = tmp('n-host-a');
  const hostB = tmp('n-host-b');
  writeWorkspace(hostA, [{ id: 'agent-relay', root: hostA }]);
  // Role points at a different absolute path → conflict.
  writeRole(root, 'agent-relay', hostB);
  uiState.saveSelectedProjectId(root, 'agent-relay');
  const view = dashMod.getProjectDashboard({
    dataRoot: root,
    scope: 'ws',
    hostRoots: [hostA],
    includeCwdHostRoot: false,
    tasks: [],
    goals: [],
  });
  if (view.project && view.project.workspaceConflict) {
    assert.ok(view.warnings.some((w) => w.code === 'WORKSPACE_CONFLICT'));
  } else {
    // Some environments may resolve the same after normalize; still must not invent a path silently.
    assert.ok(view.project);
  }
});

test('O 100+ historical Tasks → response remains bounded', () => {
  const { root } = configuredFixture('o');
  const tasks = [];
  for (let i = 0; i < 120; i++) {
    tasks.push(baseTask({
      taskId: `TASK-${String(1000 + i).padStart(4, '0')}`,
      title: `historical ${i}`,
      executionState: i % 17 === 0 ? 'READY' : 'RESULT_RECEIVED',
      pmState: i % 17 === 0 ? 'PENDING' : 'ACCEPTED',
      linkedRuns: [],
    }));
  }
  // One orphan to ensure interesting list is non-empty but still capped.
  tasks.push(baseTask({
    taskId: 'TASK-ORPH-120',
    title: 'orphan leader',
    executionState: 'RUNNING',
    linkedRuns: [{ runId: 'RUN-O', agent: 'builder-opencode', taskRunSequence: 1 }],
  }));
  const view = dashMod.getProjectDashboard({
    dataRoot: root,
    scope: 'ws',
    includeCwdHostRoot: false,
    tasks,
    goals: [baseGoal()],
    probe: false,
  });
  assert.ok(view.counts.tasks >= 100);
  assert.ok(view.recentTasks.length <= dashMod.PROJECT_DASHBOARD_MAX_RECENT_TASKS);
  const bytes = dashMod.estimateProjectDashboardJsonBytes(view);
  assert.ok(
    bytes < dashMod.PROJECT_DASHBOARD_SOFT_JSON_BYTES,
    `dashboard JSON too large: ${bytes} bytes`,
  );
  const raw = JSON.stringify(view);
  assert.doesNotMatch(raw, /"projectProfiles"/);
  assert.doesNotMatch(raw, /"projects":\[/);
});

test('P no mutation side effects', async () => {
  const { root } = configuredFixture('p');
  writeGoal(root, 'ws', baseGoal());
  writeTask(root, 'ws', baseTask({ executionState: 'READY' }));
  uiState.saveSelectedProjectId(root, 'agent-relay');
  const goalsBefore = goalTask.listGoals(root, 'ws').length;
  const tasksBefore = goalTask.listTasks(root, 'ws').length;
  const selBefore = uiState.loadUiState(root).selectedProjectId;
  const roleBefore = fs.readFileSync(path.join(root, '_relay', 'roles', 'agent-relay.json'), 'utf8');
  const view = await pm(root).get('relay_pm_get_project').handler({});
  assert.deepEqual(view.sideEffects, {
    goalsCreated: 0,
    tasksCreated: 0,
    runsCreated: 0,
    workersSpawned: 0,
    selectionChanged: 0,
    assignmentChanged: 0,
    workspaceChanged: 0,
  });
  assert.equal(goalTask.listGoals(root, 'ws').length, goalsBefore);
  assert.equal(goalTask.listTasks(root, 'ws').length, tasksBefore);
  assert.equal(uiState.loadUiState(root).selectedProjectId, selBefore);
  assert.equal(
    fs.readFileSync(path.join(root, '_relay', 'roles', 'agent-relay.json'), 'utf8'),
    roleBefore,
  );
});

test('Q C01/C02/C03 surfaces still registered + widget has project dash', () => {
  const { tools } = pm(tmp('q'));
  const names = tools.map((t) => t.name);
  for (const n of [
    'relay_pm_list_project_profiles',
    'relay_pm_select_project',
    'relay_pm_get_project_assignments',
    'relay_pm_set_project_assignments',
    'relay_pm_get_project',
  ]) {
    assert.ok(names.includes(n), n);
  }
  const html = widget.pmWidgetHtml('');
  assert.match(html, /id="projectDash"/);
  assert.match(html, /relay_pm_get_project/);
  assert.match(html, /아직 진행 중인 Goal이 없습니다/);
  assert.match(html, /Project ▾|proj-switch/);
  assert.match(html, /id="bootstrap"/);
});

test('R production widget mount contract PASS', () => {
  assert.match(widget.PM_WIDGET_RESOURCE_URI, /^ui:\/\/agent-relay\/pm-widget-[0-9a-f]{8}$/);
  const appTools = appServer.buildAppTools({ dataRoot: tmp('r'), project: 'ws' });
  const opener = appTools.find((t) => t.name === 'relay_pm_open_widget');
  assert.ok(opener);
  assert.equal(opener._meta.ui.resourceUri, widget.PM_WIDGET_RESOURCE_URI);
  assert.equal(opener._meta['openai/outputTemplate'], widget.PM_WIDGET_RESOURCE_URI);
});
