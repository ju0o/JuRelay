// T1–T7 for the runChain stall watchdog (2026-09-29).
//
// The point of these tests is that a stall is detected by EVIDENCE OF WORK, not by elapsed time.
// A heartbeat model passes a "still alive" test and fails T6; it also fails T2, because a heartbeat
// keeps ticking while a worker rewrites byte-identical files forever. Here:
//   T1 real progress resets the stall clock
//   T2 mtime-only churn is NOT progress            (the heartbeat killer)
//   T3 a real stall is killed before the 30-min timeout
//   T4 output-only progress counts (a quiet but talking worker is not hung)
//   T5 the retry ladder ends at FOUNDER_GATE, not an infinite loop
//   T6 a worker that keeps working is NEVER killed  (no false positives — the T6 gate)
//   T7 a real child process, really killed, kill actually at the stall moment
//
// T7 uses real spawn/timers against a real git workspace. ARL_STALL_MS is scaled to seconds so the
// timing is real and observable, never mocked.
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const spawnChild = spawn;

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = path.resolve(here, "../..");
const { ProgressTracker, hashFileSet } = await import(path.join(engine, "src/v2/portfolio-runner/progress-tracker.mjs"));
const { PortfolioRunner, gitTrackedFiles, parseResultPacket } = await import(path.join(engine, "src/v2/portfolio-runner/index.mjs"));

const STALLING = path.join(here, "../fixtures/workers/silent-after-output.mjs");
const WORKING = path.join(here, "../fixtures/workers/keeps-working.mjs");

async function workspace() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "arl-stall-"));
  await fsp.mkdir(path.join(dir, "src"), { recursive: true });
  await fsp.writeFile(path.join(dir, "src/a.js"), "export const a = 1;\n");
  const git = async (...args) => execFileAsync("git", args, { cwd: dir });
  await git("init", "-q");
  await git("config", "user.email", "t@t");
  await git("config", "user.name", "t");
  await git("add", "-A");
  await git("commit", "-qm", "base");
  return dir;
}

/** A runner with only the bits the watchdog touches. */
function runnerWith(stallMs) {
  const runner = Object.create(PortfolioRunner.prototype);
  runner.stallMs = stallMs;
  runner.stallPollMs = Math.max(50, Math.floor(stallMs / 4));
  runner._stallTaskId = "T7-STALL";
  return runner;
}

test("T1 real progress keeps resetting the stall clock", () => {
  let now = 0;
  const t = new ProgressTracker({ taskId: "T1", stallMs: 1000, now: () => now });
  t.record("file-hash", { hash: "h1" });
  now = 900;
  assert.equal(t.evaluate(), null, "still inside the stall window");
  t.record("git-head", { head: "abc" });   // new work
  now = 1800;
  assert.equal(t.evaluate(), null, "a new commit must reset the clock");
  now = 2750;
  const d = t.evaluate();
  assert.equal(d.action, "retry", "only 750ms since the last progress");
});

test("T2 mtime-only churn is NOT progress (the heartbeat killer)", async () => {
  const dir = await workspace();
  const file = path.join(dir, "src/a.js");
  const paths = await gitTrackedFiles(dir);
  assert.ok(paths.length > 0, "the watchdog must find tracked source files");

  const before = hashFileSet(await (await import(path.join(engine, "src/v2/portfolio-runner/progress-tracker.mjs"))).hashFiles(paths));
  // Rewrite byte-identical content many times. mtime moves every single time; content never does.
  for (let i = 0; i < 5; i += 1) { await fsp.writeFile(file, "export const a = 1;\n"); await new Promise((r) => setTimeout(r, 5)); }
  const after = hashFileSet(await (await import(path.join(engine, "src/v2/portfolio-runner/progress-tracker.mjs"))).hashFiles(paths));
  assert.equal(after, before, "identical content must hash identically");
  assert.notEqual(fs.statSync(file).mtimeMs, undefined);

  const t = new ProgressTracker({ taskId: "T2", stallMs: 1, now: () => 10_000 });
  t.record("file-hash", { hash: before });
  t.state.lastProgressAtMs = 0;   // pretend the last real progress was long ago
  // The same hash again = "touched but unchanged". A heartbeat would call this alive; we do not.
  assert.equal(t.record("file-hash", { hash: before }), null, "an unchanged file is not progress");
  assert.equal(t.record("mtime", { mtimeMs: Date.now() }), null, "mtime is not a progress kind at all");
  assert.equal(t.record("heartbeat", {}), null, "heartbeat is never progress");
  assert.equal(t.record("pane-text", {}), null);
  assert.equal(t.record("spinner", {}), null);
  assert.equal(t.evaluate().action, "retry", "no progress was recorded, so it is stalled");
  await fsp.rm(dir, { recursive: true, force: true });
});

test("T3 a real stall is caught before the 30-minute adapter timeout", async () => {
  let now = 0;
  const t = new ProgressTracker({ taskId: "T3", stallMs: 20 * 60_000, now: () => now });
  t.record("file-hash", { hash: "h1" });
  assert.equal(t.evaluate(), null);
  now = 20 * 60_000;                       // exactly the stall threshold
  const d = t.evaluate();
  assert.equal(d.action, "retry");
  assert.ok(d.idleMs < 30 * 60_000, "the stall must be judged before the adapter's 30-minute kill");
  assert.match(d.reason, /no meaningful progress/);
});

test("T4 output-only progress counts — a quiet but talking worker is not hung", () => {
  let now = 0;
  const t = new ProgressTracker({ taskId: "T4", stallMs: 1000, now: () => now });
  t.record("output", { chars: 0 });
  assert.equal(t.evaluate(), null, "zero bytes is not evidence");
  assert.ok(t.record("output", { chars: 12 }), "the first output establishes the clock");
  now = 900;
  t.record("output", { chars: 5 });
  now = 1800;
  assert.equal(t.evaluate(), null, "continued output resets the stall window");
  assert.ok(t.state.outputSeen >= 17, "output bytes are accumulated as evidence");
});

test("T5 the ladder ends at FOUNDER_GATE after the retry budget", () => {
  let now = 0;
  const t = new ProgressTracker({ taskId: "T5", stallMs: 1000, maxRetries: 3, now: () => now });
  t.record("file-hash", { hash: "h1" });
  const actions = [];
  for (let i = 0; i < 5; i += 1) { now += 1000; actions.push(t.evaluate()?.action ?? null); }
  assert.deepEqual(actions.slice(0, 3), ["retry", "retry", "retry"]);
  assert.equal(actions[3], "founder-gate", "the 4th stall hands over to a human");
  assert.equal(actions[4], "founder-gate", "and it stays there — no infinite retry loop");
});

test("T6 a worker that keeps working is NEVER killed (no false positives)", async () => {
  const dir = await workspace();
  const runner = runnerWith(1500);
  const watch = runner.startStallWatch({ workspace: dir }, { attempts: 0 });
  const keepGoing = setInterval(async () => {
    const verdict = watch.tracker.evaluate();
    if (verdict) assert.fail(`a working worker must never be judged stalled (got ${verdict.action})`);
  }, 100);
  // Real file content churn + real output: exactly what a busy worker does.
  let n = 0;
  const churn = setInterval(() => {
    n += 1;
    fs.writeFileSync(path.join(dir, "src/a.js"), `export const a = ${n};\n`);
    watch.onOutput(20);
  }, 200);
  await new Promise((r) => setTimeout(r, 4000));   // > 2x the stall window
  clearInterval(churn); clearInterval(keepGoing);
  watch.stop();
  assert.equal(watch.stalled, false, "a worker with real progress must not be killed");
  assert.ok(watch.tracker.state.outputSeen > 0, "output was recorded as evidence");
  await fsp.rm(dir, { recursive: true, force: true });
});

test("T7 real process E2E: a genuinely stalled child is killed AT the stall moment", async () => {
  const dir = await workspace();
  const STALL_MS = 2000;
  const ADAPTER_TIMEOUT = 30 * 60_000;      // the backstop that must NOT be what fires
  const runner = runnerWith(STALL_MS);
  const watch = runner.startStallWatch({ workspace: dir }, { attempts: 0 });
  watch.onChild({ killed: false, kill(sig) { this.killed = true; this.signal = sig; } });
  watch.onOutput(64);                        // it said something, then went quiet

  const spawned = Date.now();
  // A real child that prints and then hangs — the T7 subject, actually executed.
  const child = spawnChild(process.execPath, [STALLING, "3"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  watch.onChild(child);
  let bytes = 0;
  child.stdout.on("data", (c) => { bytes += c.length; watch.onOutput(c.length); });
  child.stderr.on("data", (c) => { bytes += c.length; watch.onOutput(c.length); });
  const exited = new Promise((resolve) => child.once("close", (code, sig) => resolve({ code, sig })));

  const outcome = await exited;
  const killedAt = Date.now() - spawned;
  watch.stop();

  assert.ok(bytes > 0, "the child really did produce output before going silent");
  assert.equal(watch.stalled, true, "the watchdog must judge this a stall");
  assert.equal(watch.action, "retry", "with a fresh attempt budget it retries");
  assert.equal(outcome.sig, "SIGTERM", "the child is really terminated, not left hanging");
  assert.ok(
    killedAt < ADAPTER_TIMEOUT,
    `killed at ${killedAt}ms — the stall watchdog (${STALL_MS}ms), not the ${ADAPTER_TIMEOUT}ms adapter timeout`
  );
  // The window matters: it must be near the stall threshold, not an instant kill and not the 30-min backstop.
  assert.ok(killedAt >= STALL_MS * 0.5, `not killed instantly (${killedAt}ms) — the baseline sample is respected`);
  assert.ok(killedAt < STALL_MS * 8, `not killed long after the stall (${killedAt}ms vs ${STALL_MS}ms)`);

  // After the budget is spent, the same stall is a human decision, not another retry.
  const spent = runner.startStallWatch({ workspace: dir }, { attempts: 3 });
  spent.onChild({ killed: false, kill() { this.killed = true; } });
  spent.onOutput(64);
  await new Promise((r) => setTimeout(r, STALL_MS * 1.6));
  assert.equal(spent.stalled, true);
  assert.equal(spent.action, "founder-gate", "attempts >= 3 stops retrying and escalates to a human");
  spent.stop();
  await fsp.rm(dir, { recursive: true, force: true });
});
