/**
 * QA slot pressure on the PM widget (2026-09-29).
 *
 * Six tasks sat in QA with maxQa 4. Two were queued for a slot, not dead — but the board could not say
 * so: the dashboard had no QA numbers at all, so a healthy queue looked like stalled agents.
 *
 * The rule this file exists to protect: "검토 중" (laneNa) is the Founder's own column. Automatic QA
 * queue depth must never be mixed into it. T6 fails if that ever happens.
 *
 * Data flows runner → qa-capacity.json → relay_pm_get_dashboard → widget. The dashboard must never read
 * state.json: it is ~10 MB and the widget polls every couple of seconds (T7).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');

function dataRootWith(capacity) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-dash-'));
  const dir = path.join(root, 'portfolio-execution');
  fs.mkdirSync(dir, { recursive: true });
  if (capacity !== undefined) fs.writeFileSync(path.join(dir, 'qa-capacity.json'), JSON.stringify(capacity, null, 2));
  return root;
}

async function dashboard(root) {
  const { buildDashboardTools } = await import(path.join(repo, 'dist/server/mcp/dashboard-tools.js'));
  const tools = buildDashboardTools({ dataRoot: root, project: 'ws' });
  const tool = tools.find((t) => t.name === 'relay_pm_get_dashboard');
  return tool.handler({});
}

const widget = () => fs.readFileSync(path.join(repo, 'src/mcp/app/pm-widget-resource.ts'), 'utf8');

test('T1 the dashboard reports QA capacity when the runner mirror exists', async () => {
  const root = dataRootWith({ qaActive: 4, qaWaiting: 2, qaTotal: 6, maxQa: 4, updatedAt: '2026-09-29T00:00:00.000Z' });
  const dash = await dashboard(root);
  assert.deepEqual(
    { qaActive: dash.qa.qaActive, qaWaiting: dash.qa.qaWaiting, qaTotal: dash.qa.qaTotal, maxQa: dash.qa.maxQa },
    { qaActive: 4, qaWaiting: 2, qaTotal: 6, maxQa: 4 },
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('T2 an existing payload keeps every previous field', async () => {
  const root = dataRootWith({ qaActive: 1, qaWaiting: 0, qaTotal: 1, maxQa: 4 });
  const dash = await dashboard(root);
  for (const key of ['project', 'agents', 'tasks', 'goals', 'pendingDeliveries', 'qa']) {
    assert.ok(key in dash, `the widget already reads ${key}; it must not disappear`);
  }
  assert.equal(dash.project, 'ws');
  fs.rmSync(root, { recursive: true, force: true });
});

test('T3 a missing mirror degrades to null, never an exception', async () => {
  const root = dataRootWith(undefined);
  const dash = await dashboard(root);
  assert.equal(dash.qa, null, 'no reading is honest; the widget keeps its own count');
  assert.ok(Array.isArray(dash.agents), 'the rest of the dashboard still works');
  fs.rmSync(root, { recursive: true, force: true });
});

test('T4 corrupt or partial mirrors are ignored rather than trusted', async () => {
  for (const bad of ['{ not json', JSON.stringify({ qaActive: 'four', qaWaiting: 1 }), JSON.stringify({})]) {
    const root = dataRootWith(undefined);
    fs.writeFileSync(path.join(root, 'portfolio-execution', 'qa-capacity.json'), bad);
    const dash = await dashboard(root);
    assert.equal(dash.qa, null, `garbage must not reach the Founder: ${bad.slice(0, 20)}`);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('T5 the widget shows the wait count in a muted element beside the review count', () => {
  const src = widget();
  assert.match(src, /id="pipeQaWait"/, 'a dedicated element exists for the wait count');
  assert.match(src, /class="pwait"/, 'it carries the muted class');
  assert.match(src, /\.pnode \.pwait \{[^}]*opacity/, 'it is dimmer than the review count');
  assert.match(src, /\.pnode \.pwait:empty \{[^}]*display:none/, 'an empty wait count is hidden entirely');
  assert.match(src, /'· ' \+ pipeQaWait \+ ' 대기'/, 'the label is "· N 대기"');
});

test('T6 ★ the "검토 중" lane never receives QA slot information (founder-ux)', () => {
  const src = widget();
  // The Founder's own column: 자동 QA 대기 must not appear here. If this test ever fails, the fix is
  // to move the number, never to accept the mix.
  const laneHead = src.slice(src.indexOf('id="laneNa"') - 400, src.indexOf('id="laneNa"') + 120);
  assert.ok(laneHead.length > 0, 'the lane header markup is locatable');
  for (const forbidden of ['pwait', 'qaWaiting', 'qa-capacity', 'capacity']) {
    assert.ok(!laneHead.includes(forbidden), `laneNa must not reference ${forbidden}`);
  }
  // And the wait count is bound only to the pipeline node, through applyQaCapacity.
  const binding = src.slice(src.indexOf('function applyQaCapacity'), src.indexOf('function applyQaCapacity') + 600);
  assert.match(binding, /qaWaiting/, 'the wait count belongs to the pipeline node');
  assert.ok(
    !/id="laneNa"/.test(src.slice(src.indexOf('function applyQaCapacity'), src.indexOf('function applyQaCapacity') + 600)),
    'applyQaCapacity must not touch the lane header',
  );
  assert.match(src, /applyQaCapacity\(\(dash && dash\.qa\) \|\| null\)/, 'capacity comes from the dashboard only');
});

test('T7 the dashboard never reads the 10 MB state.json', () => {
  const src = fs.readFileSync(path.join(repo, 'src/mcp/dashboard-tools.ts'), 'utf8');
  const code = src
    .split('\n')
    .map((line) => line.replace(/^\s*(\*|\/\/).*/, ''))
    .join('\n');
  assert.ok(!code.includes('state.json'), 'state.json must not appear in executable code');
  const reads = [...code.matchAll(/readFileSync\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(
    reads.some((r) => r.includes('qa-capacity.json')),
    'it reads the small capacity mirror',
  );
  assert.ok(!reads.some((r) => r.includes('state.json')), 'and never the state snapshot');
});
