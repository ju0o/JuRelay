/**
 * S6: orphan recovery through the PRODUCTION dispatch path.
 *
 * A real worker is launched and then SIGSTOP-ed, so the process is still alive
 * but says nothing — the exact shape of TASK-0044. The detector must:
 *   1. stay silent while the worker talks (output moving),
 *   2. stay silent while the process is provably alive and fresh,
 *   3. stay silent while QA owns the clock,
 *   4. after heartbeatStaleMs × graceRuns, take the Run over: kill → retry,
 *   5. and if it keeps stalling, escalate to one wake for the human.
 *
 * Timing is compressed via ARL_HEARTBEAT_STALE_MS / ARL_ORPHAN_CHECK_MS /
 * ARL_ORPHAN_GRACE, which the dispatcher reads at module load.
 */
process.env['ARL_HEARTBEAT_STALE_MS'] = process.env.ARL_HEARTBEAT_STALE_MS ?? '30000';
process.env['ARL_ORPHAN_CHECK_MS'] = process.env.ARL_ORPHAN_CHECK_MS ?? '2000';
process.env['ARL_ORPHAN_GRACE'] = process.env.ARL_ORPHAN_GRACE ?? '2';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const TEST_ROOT = path.join(os.tmpdir(), `arl-orphan-${process.pid}-${Date.now()}`);
// A leftover pid file from an earlier run would be SIGSTOPped instead of ours.
fs.rmSync(path.join(os.tmpdir(), 'arl-silent-pids'), { recursive: true, force: true });
const WS = path.join(TEST_ROOT, 'ws');
fs.mkdirSync(WS, { recursive: true });

let passed = 0;
let failed = 0;
const check = (cond, m) => {
  if (cond) { passed++; console.log('  PASS  ' + m); }
  else { failed++; console.log('  FAIL  ' + m); process.exitCode = 1; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/server');
const od = await import(`${dist}/backend/orphan-detector.js`);
const adv = await import(`${dist}/backend/auto-advance.js`);
const gt = await import(`${dist}/backend/goal-task.js`);
const wr = await import(`${dist}/backend/worker-registry.js`);
const wakeq = await import(`${dist}/backend/wake-queue.js`);
const disp = await import(`${dist}/backend/dispatcher.js`);
const captureSvc = await import(`${dist}/backend/capture-service.js`);
const pmTools = await import(`${dist}/mcp/pm-tools.js`);
const testFix = await import(`${dist}/integrations/test-fixture/watch.js`);
testFix.ensureTestFixtureAdapterRegistered();

disp._resetDispatcherStateForTests();
await captureSvc._resetCaptureServiceForTests();

// ── Part 1: pure detector + false-positive guards ──
console.log('\n-- Part 1: detector unit + false-positive guards --');
const NOW = Date.parse('2026-09-29T10:00:00Z');
const sig = (over = {}) => ({
  taskId: 'T1', runId: 'R1', workerId: 'builder-x',
  lastHeartbeatAtMs: NOW - 20 * 60 * 1000,
  lastOutputAtMs: null, processAlive: false, qaPending: false, ...over,
});

check(od.DEFAULT_ORPHAN_CONFIG.heartbeatStaleMs === 15 * 60 * 1000, 'default heartbeatStaleMs = 15분');
check(od.DEFAULT_ORPHAN_CONFIG.checkIntervalMs === 2 * 60 * 1000, 'default checkIntervalMs = 2분');
check(od.DEFAULT_ORPHAN_CONFIG.graceRuns === 3, 'default graceRuns = 3');

let v = od.evaluateOrphan(sig({ processAlive: true, lastHeartbeatAtMs: NOW - 10 * 1000 }), od.DEFAULT_ORPHAN_CONFIG, NOW);
check(!v.orphan && v.reason === 'alive', '가드1: 프로세스 살아있고 heartbeat 있음 → 미감지');
v = od.evaluateOrphan(sig({ lastOutputAtMs: NOW - 60 * 1000 }), od.DEFAULT_ORPHAN_CONFIG, NOW);
check(!v.orphan && v.reason === 'output-moving', '가드2: 최근 output 변화 → 미감지');
v = od.evaluateOrphan(sig({ qaPending: true }), od.DEFAULT_ORPHAN_CONFIG, NOW);
check(!v.orphan && v.reason === 'qa-pending', '가드3: QA 대기 중 → 미감지');
v = od.evaluateOrphan(sig({ staleChecks: 0 }), od.DEFAULT_ORPHAN_CONFIG, NOW);
check(!v.orphan && v.reason === 'grace-not-met', '1회차 스윕 → 유예(미감지)');
v = od.evaluateOrphan(sig({ staleChecks: 1 }), od.DEFAULT_ORPHAN_CONFIG, NOW);
check(!v.orphan, '2회차 스윕 → 유예(미감지)');
v = od.evaluateOrphan(sig({ staleChecks: 2 }), od.DEFAULT_ORPHAN_CONFIG, NOW);
check(v.orphan && v.staleChecks === 3, '3회 연속 → orphan 확정');
check(v.staleMinutes === 20, `무응답 분 표시 ${v.staleMinutes}분`);

check(adv.recordOutcome(TEST_ROOT, 'p', { taskId: 'A', kind: 'orphan' }).action === 'retry', 'auto-advance: orphan 1회 → retry');
check(adv.recordOutcome(TEST_ROOT, 'p', { taskId: 'A', kind: 'orphan', fallbackAvailable: true }).action === 'fallback', 'auto-advance: orphan 2회 → fallback');
const w = adv.recordOutcome(TEST_ROOT, 'p', { taskId: 'A', kind: 'orphan', fallbackAvailable: true });
check(w.action === 'wake-pm' && w.humanRequired, 'auto-advance: orphan 3회 → wake-pm (사람 개입)');

// ── Part 2: production dispatch path, real stalled worker ──
console.log('\n-- Part 2: 실제 멈춘 워커 (SIGSTOP) --');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(__dirname, 'fixtures/workers/silent-forever.mjs');
wr.writeWorkerRegistryRecord(TEST_ROOT, {
  schemaVersion: 'G.2', workerId: 'builder-silent', displayName: 'silent',
  launchCommand: process.execPath, launchArgsPrefix: [FIX],
  capabilities: ['fixture'], observationAdapterId: 'test-fixture',
});

const project = 'orphanProj';
const tools = pmTools.buildAllPmTools({ dataRoot: TEST_ROOT, project });
const get = (n) => tools.find((t) => t.name === n);
const inc = await get('relay_pm_create_task').handler({
  title: 'orphan e2e', goal: 'g', reason: 'r', scope: 's', completionCriteria: ['c'],
});
const taskId = inc.task.taskId;
const d = await get('relay_pm_dispatch_owner_approved').handler({
  taskId, workerId: 'builder-silent', workspaceRoot: WS, expectedExecutionState: 'READY',
});
check(!!d.runId, `dispatch 성공 runId=${(d.runId || '').slice(0, 8)}`);

// Wait for RUNNING, then silence the worker: alive but mute.
let rec = null;
for (let i = 0; i < 60; i++) {
  rec = gt.getTask(TEST_ROOT, project, taskId);
  if (rec.executionState === 'RUNNING') break;
  await sleep(500);
}
check(rec.executionState === 'RUNNING', `RUNNING 진입 (${rec.executionState})`);

// RUNNING is recorded before the child has necessarily written its pid file.
const PID_DIR = path.join(os.tmpdir(), 'arl-silent-pids');
let pid = 0;
for (let i = 0; i < 40; i++) {
  const f = fs.existsSync(PID_DIR) ? fs.readdirSync(PID_DIR).filter((n) => n.endsWith('.pid'))[0] : null;
  if (f) { pid = Number(f.replace('.pid', '')); break; }
  await sleep(500);
}
check(pid > 0, `워커 pid=${pid} 확인 (SIGSTOP 대상)`);
if (pid > 0) process.kill(pid, 'SIGSTOP');
console.log(`  .. 워커 SIGSTOP (살아있으나 무응답) — stale ${process.env.ARL_HEARTBEAT_STALE_MS}ms, grace ${process.env.ARL_ORPHAN_GRACE}`);

const t0 = Date.now();
let after = null;
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  const t = gt.getTask(TEST_ROOT, project, taskId);
  if ((t.linkedRuns || []).length >= 2) { after = t; break; }
}
const elapsed = Math.round((Date.now() - t0) / 1000);
check(!!after, `orphan 감지 후 실제 재실행까지 ${elapsed}s`);
if (after) {
  const ids = after.linkedRuns.map((r) => r.runId);
  check(ids.length >= 2 && new Set(ids).size === ids.length, `runId 증가 ${ids.map((i2) => i2.slice(0, 8)).join('→')}`);
  const m2 = JSON.parse(fs.readFileSync(path.join(after.linkedRuns[1].folder, 'meta.json'), 'utf8'));
  check(m2.autoAdvance?.decision === 'retry' || m2.autoAdvance?.decision === 'fallback',
    `run2 meta autoAdvance=${m2.autoAdvance?.decision}`);
  const counters = JSON.parse(fs.readFileSync(path.join(TEST_ROOT, project, '_relay', 'auto-advance.json'), 'utf8'));
  check((counters.counters[taskId] ?? 0) >= 1, `orphan 카운터 ${counters.counters[taskId]}`);
  check(wakeq.listPendingWakes(TEST_ROOT, project).length === 0, 'retry 경로 wake 0건 (무소음)');
}

if (pid > 0) { try { process.kill(pid, 'SIGCONT'); } catch { /* gone */ } }
disp.stopOrphanSweepForTests();
fs.rmSync(path.join(os.tmpdir(), 'arl-silent-pids'), { recursive: true, force: true });
fs.rmSync(TEST_ROOT, { recursive: true, force: true });
console.log(`\nS6-ORPHAN complete. Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
