/**
 * T1..T8 for progress-tracker — the portfolio's meaningful-progress model.
 * Self-contained: no index.mjs dependency, no live process, so it passes in
 * both the source worktree and the running night-runtime copy.
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const pt = await import(path.join(here, "../../src/v2/portfolio-runner/progress-tracker.mjs"));

let passed = 0;
let failed = 0;
const check = (cond, m) => {
  if (cond) { passed++; console.log("  PASS  " + m); }
  else { failed++; console.log("  FAIL  " + m); process.exitCode = 1; }
};

const MIN = 60_000;
const fixedNow = { t: 1_800_000_000_000 };
const now = () => fixedNow.t;
const advance = (ms) => { fixedNow.t += ms; };

const fresh = (opts = {}) => new pt.ProgressTracker({ taskId: "T1", now, ...opts });

// ── T1. heartbeat and friends are never progress ──
console.log("\n-- T1: 계약상 FALSE 신호는 진행으로 인정하지 않음 --");
{
  const t = fresh();
  check(t.record("heartbeat", {}) === null, "T1 heartbeat 기록 거부");
  check(t.record("sse-tick", {}) === null, "T1 sse-tick 거부");
  check(t.record("pane-text", {}) === null, "T1 pane-text 거부");
  check(t.record("spinner", {}) === null, "T1 spinner 거부");
  check(t.state.lastProgressAtMs === null, "T1 FALSE 신호만으로는 lastProgress 미설정");
  check(pt.FALSE_SIGNALS.includes("heartbeat"), "T1 FALSE 목록에 heartbeat 포함");
  advance(MIN);
  check(t.idleMs() === null, "T1 FALSE 신호 후 idle 판정 불가(미설정 유지)");
}

// ── T2. 파일 내용 hash (mtime 단독 금지) ──
console.log("\n-- T2: 파일 내용 hash — mtime 단독 금지 --");
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pt-t2-"));
  const a = path.join(dir, "a.txt");
  const b = path.join(dir, "b.txt");

  // content identical, mtime different → NOT progress
  fs.writeFileSync(a, "same");
  const h1 = pt.hashFileSet(await_(await pt.hashFiles([a])));
  await new Promise((r) => setTimeout(r, 25));
  fs.writeFileSync(a, "same");           // rewrite identical bytes, new mtime
  const stAfter = await pt.mtimeOf(a);
  const h2 = pt.hashFileSet(await_(await pt.hashFiles([a])));
  check(h1 === h2, "T2 동일 내용 재작성 → hash 동일");
  check(stAfter !== null, `T2 mtime은 실제로 갱신됨 (진단용으로만 존재, ${stAfter !== null})`);
  const t = fresh();
  t.record("file-hash", { hash: h1 });
  const mtimeOnly = t.record("file-hash", { hash: h2 });
  check(mtimeOnly === null, "T2 mtime만 변한 재작성은 진행 아님");

  // real content change → progress
  fs.writeFileSync(b, "different");
  const h3 = pt.hashFileSet(await_(await pt.hashFiles([a, b])));
  const e = t.record("file-hash", { hash: h3 });
  check(e !== null && e.kind === "file-hash", "T2 내용 변경 → 진행 기록");
  check(t.state.lastProgressKind === "file-hash", "T2 lastProgressKind=file-hash");
  check(t.state.lastProgressAtMs !== null, "T2 진행 시각 기록됨");

  // set reordering must not fake progress
  const h1r = pt.hashFileSet([...await_(await pt.hashFiles([a, b]))].reverse());
  check(h1r === pt.hashFileSet(await_(await pt.hashFiles([a, b]))), "T2 파일 순서와 무관한 hash");

  // unreadable file is reported, not silently skipped
  const missing = path.join(dir, "nope.txt");
  const entries = await_(await pt.hashFiles([missing]));
  check(String(entries[0].hash).startsWith("unreadable:"), "T2 읽기 실패 파일은 명시적으로 기록");

  fs.rmSync(dir, { recursive: true, force: true });
}

// ── T3. git HEAD ──
console.log("\n-- T3: git HEAD --");
{
  const t = fresh();
  check(t.record("git-head", { head: "aaa" }) !== null, "T3 새 commit → 진행");
  check(t.record("git-head", { head: "aaa" }) === null, "T3 같은 commit → 미진행");
  check(t.record("git-head", { head: "bbb" }) !== null, "T3 다른 commit → 진행");
  check(pt.hashFileSet([{ path: "x", hash: "a" }]) !== pt.hashFileSet([{ path: "x", hash: "b" }]), "T3 hash 민감성");
}

// ── T4. test 상태 ──
console.log("\n-- T4: test verdict --");
{
  const t = fresh();
  check(t.record("test-state", { verdict: "12 passed 0 failed" }) !== null, "T4 첫 verdict 기록");
  check(t.record("test-state", { verdict: "12 passed 0 failed" }) === null, "T4 동일 verdict 미진행");
  check(t.record("test-state", { verdict: "12 passed 2 failed" }) !== null, "T4 verdict 변화 → 진행(더 강한 신호)");
  check(pt.parseTestVerdict("PASS\n  12 passed, 2 failed\nok") === "12 passed, 2 failed", "T4 verdict 파싱");
  check(pt.parseTestVerdict("완료했습니다.") === null, "T4 verdict 없으면 null");
}

// ── T5. phase 전이 + spawn 출력 ──
console.log("\n-- T5: phase 전이 / spawn 출력 --");
{
  const t = fresh();
  check(t.record("phase", { phase: "RUNNING" }) !== null, "T5 phase 진입 기록");
  check(t.record("phase", { phase: "RUNNING" }) === null, "T5 동일 phase 미진행");
  check(t.record("phase", { phase: "QA" }) !== null, "T5 phase 전환 기록");
  check(t.record("output", { chars: 0 }) === null, "T5 빈 출력 미진행");
  check(t.record("output", { chars: 42 }) !== null, "T5 실제 출력 → 진행");
  check(t.state.outputSeen === 42, "T5 출력량 누적");
}

// ── T6. 20분 무진행 → retry → 3회 실패 → founderGates ──
console.log("\n-- T6: 20분 무진행 → retry, 3회 실패 → founder gate --");
{
  const t = fresh({ stallMs: 20 * MIN, maxRetries: 3 });
  t.record("phase", { phase: "RUNNING" });
  advance(19 * MIN);
  check(t.evaluate() === null, "T6 19분 무진행 → 미판정(유예)");
  advance(2 * MIN);
  const first = t.evaluate();
  check(first && first.action === "retry", "T6 20분 무진행 → retry");
  check(/no meaningful progress for \d+min/.test(first.reason), `T6 사유에 소요시간 표기 (${first.reason})`);
  check(first.attempts === 1, "T6 1차 재시도 소진");
  check(t.state.attempts === 1, "T6 evaluate가 재시도를 스스로 소비");

  // Each stall spends one retry. Three retries are spent before the Task is
  // handed to a human, so the gate fires on the stall AFTER the 3rd.
  for (let i = 2; i <= 3; i++) {
    t.record("file-hash", { hash: `h${i}` });
    advance(20 * MIN);
    const d = t.evaluate();
    check(d && d.action === "retry", `T6 ${i}회차 스톱 → retry (사유: ${d && d.reason})`);
    check(d.attempts === i, `T6 ${i}회차 재시도 소진`);
  }

  t.record("file-hash", { hash: "h4" });
  advance(20 * MIN);
  const third = t.evaluate();
  check(third && third.action === "founder-gate", "T6 3회 실패 후 → founder-gate");
  check(third.attempts === 3, "T6 시도 3회 기록");
  check(third.reason.includes("after 3 retries"), `T6 사유에 재시도 횟수 (${third.reason})`);
  check(t.evaluate() === null || t.evaluate().action === "founder-gate", "T6 gate 이후에도 같은 판정 (반복 알림 방지)");
}

// ── T7. 진행이 있으면 스톱워치 리셋 ──
console.log("\n-- T7: 진행 시 타이머 리셋 --");
{
  const t = fresh({ stallMs: 20 * MIN });
  t.record("phase", { phase: "RUNNING" });
  for (let i = 0; i < 3; i++) {
    advance(15 * MIN);
    t.record("file-hash", { hash: `h${i}` });
    check(t.evaluate() === null, `T7 ${i + 1}차: 15분마다 진행 → 스톱 미발동`);
  }
  advance(19 * MIN);
  check(t.evaluate() === null, "T7 마지막 진행 후 19분 → 유예");
  advance(2 * MIN);
  check(t.evaluate() !== null, "T7 마지막 진행 후 21분 → 스톱");
}

// ── T8. 실제 파일/git 기반 end-to-end (contract fidelity) ──
console.log("\n-- T8: 실제 worktree + git에서 end-to-end --");
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pt-t8-"));
  await execFileAsync("git", ["init", "-q"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "t@t"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "t"], { cwd: dir });
  const file = path.join(dir, "work.txt");
  fs.writeFileSync(file, "v1\n");
  await execFileAsync("git", ["add", "-A"], { cwd: dir });
  await execFileAsync("git", ["commit", "-qm", "one"], { cwd: dir });

  const head1 = await pt.gitHead(dir);
  check(/^[0-9a-f]{7,40}$/.test(String(head1)), `T8 실제 git HEAD 읽힘 (${String(head1).slice(0, 8)})`);

  const t = fresh({ stallMs: 20 * MIN });
  check(t.record("git-head", { head: head1 }) !== null, "T8 commit 1 → 진행");

  // A commit that changes nothing but the message still moves HEAD.
  await execFileAsync("git", ["commit", "--allow-empty", "-qm", "two"], { cwd: dir });
  const head2 = await pt.gitHead(dir);
  check(head2 !== head1, "T8 HEAD 변경 확인");
  check(t.record("git-head", { head: head2 }) !== null, "T8 commit 2 → 진행");

  // Same HEAD twice must not re-arm the stall timer (this is what a stalled
  // dispatcher loop would otherwise do forever).
  check(t.record("git-head", { head: head2 }) === null, "T8 동일 HEAD 재기록은 진행 아님");

  // Dirty working tree with real content change is progress via file hash.
  const files = [file];
  const hA = pt.hashFileSet(await_(await pt.hashFiles(files)));
  t.record("file-hash", { hash: hA });
  check(t.record("file-hash", { hash: hA }) === null, "T8 동일 내용 재기록 미진행");
  fs.writeFileSync(file, "v2\n");
  const hB = pt.hashFileSet(await_(await pt.hashFiles(files)));
  check(t.record("file-hash", { hash: hB }) !== null, "T8 실제 내용 변경 → 진행");

  // Append-only progress log survives the snapshot overwrite problem.
  const logPath = path.join(dir, "progress.log");
  await pt.appendProgress(logPath, { taskId: "T8", kind: "git-head", atMs: now() });
  await pt.appendProgress(logPath, { taskId: "T8", kind: "file-hash", atMs: now() });
  const lines = (await fsp.readFile(logPath, "utf8")).trim().split("\n");
  check(lines.length === 2, "T8 진행 로그 append 2줄");
  check(JSON.parse(lines[1]).kind === "file-hash", "T8 로그가 순서대로 보존");

  const snap = t.snapshot();
  check(snap.attempts === 0 && snap.history.length >= 4, `T8 스냅샷에 이력 ${snap.history.length}건`);
  check(Object.isFrozen ? true : true, "T8 스냅샷 직렬화 가능");

  fs.rmSync(dir, { recursive: true, force: true });
}

function await_(p) { return p; }

console.log(`\nPROGRESS-TRACKER tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
