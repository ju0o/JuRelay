/**
 * The portfolio lane, and what the board can say about it (2026-09-29).
 *
 * The portfolio is the main rail; ws is developer mode. Portfolio workers are deliberately NOT merged
 * into the ws worker registry (Founder decision: registry integration would distort the structure), so
 * `agents` — which comes from that registry — cannot describe them. The board could show neither the
 * title, nor the AI, nor whether the process was alive. That is what "Agent 13개 전부 idle" was: a
 * missing lane, not a dead agent.
 *
 * Data flows runner → portfolio-live.json → relay_pm_get_dashboard → widget. T7 guards the 10 MB
 * state.json: this tool is polled continuously, so the dashboard must never read it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const engine = path.resolve(repo, '../Agent-Relay-worktrees/engine');

const { PortfolioRunner } = await import(path.join(engine, 'src/v2/portfolio-runner/index.mjs'));

function runner() {
  const r = Object.create(PortfolioRunner.prototype);
  r.manifest = { maxQa: 4 };
  r._stallTaskId = 'T';
  return r;
}

const sample = (over = {}) => ({
  taskId: 'JUAI-CHECK-BOOT-RECOVERY',
  title: '부팅 복구 확인',
  projectId: 'juai',
  phase: 'qa',
  pid: null,
  runtime: 'opencode',
  model: 'opencode/nemotron-3-ultra-free',
  workerId: 'juai-qa-JUAI-CHECK-BOOT-RECOVERY',
  workspace: '/tmp/ws',
  startedAt: '2026-09-29T15:00:00.000Z',
  ...over,
});

function dataRootWith(live) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-lane-'));
  const dir = path.join(root, 'portfolio-execution');
  fs.mkdirSync(dir, { recursive: true });
  if (live !== undefined) fs.writeFileSync(path.join(dir, 'portfolio-live.json'), JSON.stringify(live, null, 2));
  return root;
}

async function dashboard(root) {
  const { buildDashboardTools } = await import(path.join(repo, 'dist/server/mcp/dashboard-tools.js'));
  return buildDashboardTools({ dataRoot: root, project: 'ws' }).find((t) => t.name === 'relay_pm_get_dashboard').handler({});
}

test('T1 the runner records the human title of a live task', () => {
  const e = runner().liveEntry({ taskId: 'JUAI-CHECK-BOOT-RECOVERY', title: '부팅 복구 확인' }, { id: 'juai' }, '/tmp/ws', 'qa');
  assert.equal(e.title, '부팅 복구 확인', 'the board needs the Korean title, not an id');
  assert.equal(e.taskId, 'JUAI-CHECK-BOOT-RECOVERY');
  assert.equal(e.projectId, 'juai');
});

test('T2 the entry carries the AI on the task', () => {
  const e = runner().liveEntry({ taskId: 'T1', title: 'x' }, { id: 'juai' }, '/tmp/ws', 'qa', { runtime: 'opencode', model: 'nemotron' });
  assert.equal(e.runtime, 'opencode');
  assert.equal(e.model, 'nemotron');
});

test('T3 the entry carries a worker id the board can name', () => {
  const qa = runner().liveEntry({ taskId: 'T1', title: 'x' }, { id: 'juai' }, '/tmp/ws', 'qa');
  const build = runner().liveEntry({ taskId: 'T1', title: 'x' }, { id: 'juai' }, '/tmp/ws', 'build');
  assert.equal(qa.workerId, 'juai-qa-T1');
  assert.equal(build.workerId, 'juai-build-T1');
  assert.notEqual(qa.workerId, build.workerId, 'the same task in two phases is two workers');
});

test('T4 the entry carries a start time and a pid slot', () => {
  const e = runner().liveEntry({ taskId: 'T1', title: 'x' }, { id: 'juai' }, '/tmp/ws', 'build');
  assert.ok(e.startedAt && !Number.isNaN(Date.parse(e.startedAt)), 'startedAt is a real timestamp');
  assert.equal(e.pid, null, 'pid is unknown until the child spawns, not invented');
  assert.equal(e.managed, true);
  assert.equal(e.owner, 'agent-relay');
});

test('T6 a missing title falls back to the taskId, never a blank card', () => {
  for (const t of [{ taskId: 'T1' }, { taskId: 'T1', title: '' }, { taskId: 'T1', title: '   ' }, { taskId: 'T1', title: 42 }]) {
    const e = runner().liveEntry(t, { id: 'juai' }, '/tmp/ws', 'qa');
    assert.equal(e.title, 'T1', `title fallback for ${JSON.stringify(t.title)}`);
  }
});

test('T5/T8 the dashboard returns the portfolio lane, and the old qa-capacity file is gone', async () => {
  const root = dataRootWith({
    qaActive: 4, qaWaiting: 2, qaTotal: 6, maxQa: 4,
    builders: [sample({ phase: 'build', taskId: 'JUTELL-SCENARIO-U', title: '중요하지 않은 시나리오', runtime: 'codex', workerId: 'jutell-build-JUTELL-SCENARIO-U', alive: true })],
    qa: [sample()],
    updatedAt: '2026-09-29T15:00:00.000Z',
  });
  const dash = await dashboard(root);
  assert.equal(dash.portfolio.qaActive, 4);
  assert.equal(dash.portfolio.qaWaiting, 2);
  assert.equal(dash.portfolio.builders.length, 1);
  assert.equal(dash.portfolio.qa.length, 1);
  assert.equal(dash.portfolio.builders[0].title, '중요하지 않은 시나리오');
  assert.equal(dash.portfolio.qa[0].runtime, 'opencode');
  assert.equal(dash.portfolio.qa[0].alive, null, 'alive is reported as unknown, not guessed');
  // T8: the one-file design, and every pre-existing field preserved.
  for (const k of ['project', 'agents', 'tasks', 'goals', 'pendingDeliveries', 'portfolio']) assert.ok(k in dash, k);
  assert.ok(!('qa' in dash), 'the interim `qa` key is gone; portfolio replaced it');
  assert.ok(!fs.existsSync(path.join(root, 'portfolio-execution', 'qa-capacity.json')), 'no second file to keep in sync');
  fs.rmSync(root, { recursive: true, force: true });
});

test('T6b unreadable or partial mirrors degrade to null instead of a broken card', async () => {
  for (const bad of [undefined, '{ not json', JSON.stringify({ qaActive: 'four' }), JSON.stringify({ qaActive: 1, qaWaiting: 0, qa: [{ nope: 1 }] })]) {
    const root = dataRootWith(bad);
    const dash = await dashboard(root);
    assert.ok(dash.portfolio === null || dash.portfolio.qa.every((e) => e.taskId), `garbage must not surface: ${String(bad).slice(0, 24)}`);
    assert.ok(Array.isArray(dash.agents), 'the rest of the dashboard still works');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('T7 ★ the dashboard never reads the 10 MB state.json', () => {
  const code = fs
    .readFileSync(path.join(repo, 'src/mcp/dashboard-tools.ts'), 'utf8')
    .split('\n')
    .map((line) => line.replace(/^\s*(\*|\/\/).*/, ''))
    .join('\n');
  assert.ok(!code.includes('state.json'), 'state.json must not appear in executable code');
  const reads = [...code.matchAll(/readFileSync\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(reads.some((r) => r.includes('portfolio-live.json')), 'it reads the small live mirror');
  assert.ok(!reads.some((r) => r.includes('state.json')));
});

test('the live mirror reports a dead pid honestly', () => {
  // A pid that cannot exist: the mirror must say alive:false, not assume the task is fine.
  const snap = runner().liveSnapshot({ activeBuilders: [], activeQa: [{ ...sample(), pid: 2 ** 30 }] });
  assert.equal(snap.qa[0].alive, false, 'an impossible pid is dead, not unknown');
  assert.equal(snap.qa[0].title, '부팅 복구 확인');
  const unknown = runner().liveSnapshot({ activeBuilders: [], activeQa: [{ ...sample(), pid: null }] });
  assert.equal(unknown.qa[0].alive, null, 'no pid means unknown');
});
