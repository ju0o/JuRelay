/**
 * UX-V3 Goal list scope: dash.goals carry projectId; widget filters to selected project.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as os from 'node:os';

const repo = path.resolve(import.meta.dirname, '..');
const dist = (p) => path.join(repo, 'dist/server', p);
const dashTools = await import(dist('mcp/dashboard-tools.js'));
const widget = await import(dist('mcp/app/pm-widget-resource.js'));
const src = await import('node:fs').then((fs) =>
  fs.readFileSync(path.join(repo, 'src/mcp/app/pm-widget-resource.ts'), 'utf8'),
);

/** Mirror of widget filterGoalsForSelectedProject (keep in sync). */
function filterGoalsForSelectedProject(goals, selectedProjectId) {
  const pid = selectedProjectId ? String(selectedProjectId) : '';
  if (!pid) return [];
  const out = [];
  for (const g of goals || []) {
    if (!g) continue;
    const gp = g.projectId;
    if (typeof gp !== 'string' || !gp.trim()) continue;
    if (gp.trim() !== pid) continue;
    out.push(g);
  }
  out.sort((a, b) => String(a.goalId || '').localeCompare(String(b.goalId || '')));
  return out;
}

test('widget source pins filter + stale scope guard', () => {
  assert.match(src, /function filterGoalsForSelectedProject/);
  assert.match(src, /goalScopeProjectId/);
  assert.match(src, /scopeStillCurrent/);
  assert.match(widget.PM_WIDGET_RESOURCE_URI, /^ui:\/\/agent-relay\/pm-widget-[0-9a-f]{8}$/);
  assert.notEqual(widget.PM_WIDGET_CONTENT_FINGERPRINT, 'fa975ba3');
});

test('filter: exact projectId only; never guess null/legacy', () => {
  const goals = [
    { goalId: 'GOAL-0001', title: 'other', status: 'ACTIVE', projectId: 'agent-relay' },
    { goalId: 'GOAL-0022', title: 'safe', status: 'ACTIVE', projectId: 'jucontroller' },
    { goalId: 'GOAL-0026', title: 'readme', status: 'PLANNING', projectId: 'jucontroller' },
    { goalId: 'GOAL-LEG', title: 'legacy', status: 'ACTIVE', projectId: null },
    { goalId: 'GOAL-MISS', title: 'missing', status: 'ACTIVE' },
  ];
  assert.deepEqual(
    filterGoalsForSelectedProject(goals, 'jucontroller').map((g) => g.goalId),
    ['GOAL-0022', 'GOAL-0026'],
  );
  assert.equal(filterGoalsForSelectedProject(goals, '').length, 0);
  assert.equal(filterGoalsForSelectedProject(goals, 'nope').length, 0);
  assert.equal(filterGoalsForSelectedProject([], 'jucontroller').length, 0);
});

test('live dash.goals expose projectId; jucontroller scopes to exactly 4', async () => {
  const dataRoot = path.join(os.homedir(), '.local/share/AgentRelay/data');
  const tools = dashTools.buildDashboardTools({ dataRoot, project: 'ws' });
  const getDash = tools.find((t) => t.name === 'relay_pm_get_dashboard');
  assert.ok(getDash);
  const dash = await getDash.handler({});
  assert.ok(Array.isArray(dash.goals));
  assert.ok(dash.goals.length >= 4);
  for (const g of dash.goals) {
    assert.ok(Object.prototype.hasOwnProperty.call(g, 'projectId'));
  }
  const ju = filterGoalsForSelectedProject(dash.goals, 'jucontroller');
  assert.equal(ju.length, 4, `got ${ju.map((g) => g.goalId).join(',')}`);
  assert.deepEqual(
    ju.map((g) => g.goalId),
    ['GOAL-0022', 'GOAL-0024', 'GOAL-0025', 'GOAL-0026'],
  );
  const byId = Object.fromEntries(ju.map((g) => [g.goalId, g]));
  assert.equal(byId['GOAL-0022'].status, 'ACTIVE');
  assert.equal(byId['GOAL-0024'].status, 'ABANDONED');
  assert.equal(byId['GOAL-0025'].status, 'PLANNING');
  assert.equal(byId['GOAL-0026'].status, 'PLANNING');
  assert.match(byId['GOAL-0022'].title, /실작업 안전 확인/);
  assert.doesNotMatch(byId['GOAL-0022'].title, /공개 저장소/);
  for (let i = 1; i <= 8; i++) {
    assert.ok(!ju.some((g) => g.goalId === `GOAL-000${i}`));
  }
});
