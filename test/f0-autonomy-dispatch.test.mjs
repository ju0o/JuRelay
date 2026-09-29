/**
 * F0 auto-advance through the PRODUCTION dispatch path.
 *
 * No direct recordOutcome calls here: every decision below is produced by
 * handleChildExit inside dispatcher.ts. Proof is runIds growing in the
 * linked runs (real redispatch), worker swaps in run meta, and wake files.
 *
 * Scenarios (Founder order workers in isolated TEST_ROOT):
 *   S1: 5 tasks × clean exit → 5 real dispatches, 0 interventions, 0 wakes.
 *   S2: fail once (provider) → auto retry, run2 executes → 0 interventions.
 *   S3: always fail → retry, fallback swap, wake-pm → 1 intervention, 1 wake.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const TEST_ROOT = path.join(os.tmpdir(), `arl-f0-disp-${process.pid}-${Date.now()}`);
fs.mkdirSync(TEST_ROOT, { recursive: true });

let passed = 0;
let failed = 0;
const check = (cond, m) => {
  if (cond) { passed++; console.log('  PASS  ' + m); }
  else { failed++; console.log('  FAIL  ' + m); process.exitCode = 1; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(label, fn, timeoutMs = 45000) {
  const start = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout: ${label}`);
    await sleep(250);
  }
}

const gt = await import('../dist/server/backend/goal-task.js');
const disp = await import('../dist/server/backend/dispatcher.js');
const wr = await import('../dist/server/backend/worker-registry.js');
const wakeq = await import('../dist/server/backend/wake-queue.js');
const fsKernel = await import('../dist/server/backend/fs.js');
const captureSvc = await import('../dist/server/backend/capture-service.js');
const pmTools = await import('../dist/server/mcp/pm-tools.js');
const testFix = await import('../dist/server/integrations/test-fixture/watch.js');
testFix.ensureTestFixtureAdapterRegistered();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX_SCRIPTED = path.resolve(__dirname, 'fixtures/workers/exit-scripted.mjs');
const NODE = process.execPath;
const project = 'F0DispProj';
const tools = pmTools.buildAllPmTools({ dataRoot: TEST_ROOT, project });
const get = (name) => tools.find((t) => t.name === name);

const WORKSPACE = path.join(TEST_ROOT, '_workspace');
fs.mkdirSync(WORKSPACE, { recursive: true });
// Zero-exit workers retain their observation slot by design (the adapter may
// still observe RESPONSE_COMPLETE), so each dispatch gets its own workspace
// (same pattern as the G5C suite's WORKSPACE/WORKSPACE_B).
function workspaceFor(name) {
  const dir = path.join(TEST_ROOT, `_workspace_${name}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function resetProcessLocal() {
  disp._resetDispatcherStateForTests();
  await captureSvc._resetCaptureServiceForTests();
  testFix.ensureTestFixtureAdapterRegistered();
}

function registerWorker(workerId) {
  wr.writeWorkerRegistryRecord(TEST_ROOT, {
    schemaVersion: 'G.2',
    workerId,
    displayName: workerId,
    launchCommand: NODE,
    launchArgsPrefix: [FIX_SCRIPTED],
    capabilities: ['fixture'],
    observationAdapterId: 'test-fixture',
  });
}
for (const id of ['builder-codex', 'builder-opencode', 'builder-cline']) registerWorker(id);

const CONTRACT = {
  goal: 'F0 dispatch proof goal',
  reason: 'F0 auto-advance integration',
  scope: 'Narrow F0 scope',
  completionCriteria: ['done when worker exits'],
};

async function createAndDispatch(title, workerId, wsName) {
  const inc = await get('relay_pm_create_task').handler({ ...CONTRACT, title });
  const res = await get('relay_pm_dispatch_owner_approved').handler({
    taskId: inc.task.taskId, workerId, workspaceRoot: workspaceFor(wsName), expectedExecutionState: 'READY',
  });
  return { taskId: inc.task.taskId, runId: res.runId };
}

function linkedRuns(taskId) {
  return gt.getTask(TEST_ROOT, project, taskId).linkedRuns || [];
}
function runMetaWorker(runId, taskId) {
  const folder = linkedRuns(taskId).find((r) => r.runId === runId)?.folder;
  if (!folder) return null;
  return fsKernel.readRunMeta(folder);
}
function pendingWakes() {
  return wakeq.listPendingWakes(TEST_ROOT, project);
}

// ── S1: five clean dispatches, zero interventions ──
console.log('\n-- S1: 5 real dispatches --');
{
  await resetProcessLocal();
  process.env.ARL_EXIT_PLAN = '0';
  process.env.ARL_STDERR = '';
  process.env.ARL_COUNT_FILE = path.join(TEST_ROOT, 'count-s1');
  const runIds = new Set();
  for (let i = 0; i < 5; i++) {
    const { taskId, runId } = await createAndDispatch(`F0 S1 task ${i}`, 'builder-codex', `s1-${i}`);
    runIds.add(runId);
    const t = await waitFor(`S1 task ${i} RUNNING`, async () => {
      const rec = gt.getTask(TEST_ROOT, project, taskId);
      return rec.executionState === 'RUNNING' ? rec : null;
    });
    check(t.linkedRuns.length === 1, `S1 task ${i} exactly one run`);
  }
  check(runIds.size === 5, `S1 five distinct runIds (got ${runIds.size})`);
  check(pendingWakes().length === 0, 'S1 zero wake records, zero interventions');
  await resetProcessLocal();
}

// ── S2: provider failure once → auto retry runs again ──
console.log('\n-- S2: fail once, auto retry --');
{
  await resetProcessLocal();
  process.env.ARL_EXIT_PLAN = '1,0';
  process.env.ARL_STDERR = 'Service temporarily overloaded, try again later';
  process.env.ARL_COUNT_FILE = path.join(TEST_ROOT, 'count-s2');
  const { taskId } = await createAndDispatch('F0 S2 task', 'builder-codex', 's2');
  const runs = await waitFor('S2 second run linked', async () => {
    const lr = linkedRuns(taskId);
    return lr.length >= 2 ? lr : null;
  });
  check(runs.length === 2, `S2 two linked runs (retry executed, got ${runs.length})`);
  check(runs[0].runId !== runs[1].runId, 'S2 runId advanced (new run, not replay)');
  const meta2 = runMetaWorker(runs[1].runId, taskId);
  check(meta2?.workerId === 'builder-codex', 'S2 retry same worker');
  check(meta2?.autoAdvance?.decision === 'retry', `S2 run meta marks autoAdvance=retry (got ${meta2?.autoAdvance?.decision})`);
  const t = gt.getTask(TEST_ROOT, project, taskId);
  check(t.executionState === 'RUNNING', `S2 task RUNNING, not FAILED (got ${t.executionState})`);
  check(pendingWakes().length === 0, 'S2 zero wake records (retry is log-only)');
  await resetProcessLocal();
}

// ── S3: always fail → retry, fallback swap, wake-pm ──
console.log('\n-- S3: always fail -> swap -> wake --');
{
  await resetProcessLocal();
  process.env.ARL_EXIT_PLAN = '1';
  process.env.ARL_STDERR = 'Service temporarily overloaded, try again later';
  process.env.ARL_COUNT_FILE = path.join(TEST_ROOT, 'count-s3');
  const { taskId } = await createAndDispatch('F0 S3 task', 'builder-codex', 's3');
  const done = await waitFor('S3 task FAILED terminal', async () => {
    const rec = gt.getTask(TEST_ROOT, project, taskId);
    return rec.executionState === 'FAILED' ? rec : null;
  }, 90000);
  check(!!done, 'S3 task ends FAILED after 3 attempts');
  const runs = linkedRuns(taskId);
  check(runs.length === 3, `S3 three linked runs (got ${runs.length})`);
  const ids = runs.map((r) => r.runId);
  check(new Set(ids).size === 3, `S3 three distinct runIds (${ids.join(',')})`);
  const w1 = runMetaWorker(runs[0].runId, taskId)?.workerId;
  const w2 = runMetaWorker(runs[1].runId, taskId)?.workerId;
  const w3 = runMetaWorker(runs[2].runId, taskId)?.workerId;
  check(w1 === 'builder-codex', `S3 run1 worker builder-codex (got ${w1})`);
  check(w2 === 'builder-codex', `S3 run2 worker builder-codex, retry same (got ${w2})`);
  check(w3 === 'builder-opencode', `S3 run3 worker swapped to builder-opencode (got ${w3})`);
  const d3 = runMetaWorker(runs[2].runId, taskId)?.autoAdvance?.decision;
  check(d3 === 'fallback', `S3 run3 meta marks autoAdvance=fallback (got ${d3})`);
  const wakes = pendingWakes().filter((w) => w.payload.taskId === taskId);
  check(wakes.length === 1, `S3 exactly 1 wake record (got ${wakes.length})`);
  check(wakes[0]?.payload.nextRecommendedAction === 'needs-human', 'S3 wake is needs-human (1 intervention)');
  await resetProcessLocal();
}

delete process.env.ARL_EXIT_PLAN;
delete process.env.ARL_STDERR;
delete process.env.ARL_COUNT_FILE;
fs.rmSync(TEST_ROOT, { recursive: true, force: true });

console.log(`\nF0-AUTONOMY-DISPATCH complete. Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
