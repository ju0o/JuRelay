// The board must be able to tell "waiting its turn" apart from "dead" (2026-09-29).
//
// Six QA tasks against maxQa 4 looked exactly like six dead agents: activeQa[].pid was always null, and
// nothing on the board said two of them were simply queued for a slot. These tests cover the two facts
// the board needs, and the pid path that makes a live worker verifiable.
import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const { PortfolioRunner } = await import(path.resolve(here, "../../src/v2/portfolio-runner/index.mjs"));

// `inQa` is how many tasks sit in QA; `slotsHeld` is how many of them actually hold a slot, which can
// never exceed maxQa. Passing inQa alone is the reported bug: six in QA, four slots, two waiting.
function runnerWith({ maxQa = 4, inQa = maxQa, slotsHeld = null, stallMs = 60_000 } = {}) {
  const runner = Object.create(PortfolioRunner.prototype);
  runner.manifest = { maxQa };
  runner.stallMs = stallMs;
  runner._stallTaskId = "PID-1";
  const state = { activeQa: Array.from({ length: inQa }, (_, i) => ({ taskId: `T${i}`, pid: null, workspace: "/tmp", owner: "agent-relay", managed: true })) };
  runner._qaActive = Math.min(slotsHeld ?? inQa, maxQa);
  return { runner, state };
}

test("capacity reports active vs waiting so a queue is not shown as a stall", () => {
  const { runner, state } = runnerWith({ maxQa: 4, inQa: 6, slotsHeld: 4 });
  const cap = runner.qaCapacity(state);
  assert.deepEqual(cap, { qaActive: 4, qaWaiting: 2, qaTotal: 6, maxQa: 4 });
  assert.equal(cap.qaTotal, 6, "all six are in QA");
  assert.equal(cap.qaActive, 4, "four hold a slot");
  assert.equal(cap.qaWaiting, 2, "two are queued, not dead");
  assert.equal(cap.qaActive + cap.qaWaiting, cap.qaTotal, "every QA task is accounted for");
});

test("capacity never invents a wait when the queue is empty", () => {
  for (const n of [0, 1, 2, 4]) {
    const { runner, state } = runnerWith({ maxQa: 4, inQa: n });
    const cap = runner.qaCapacity(state);
    assert.equal(cap.qaWaiting, 0, `${n} in QA with maxQa 4 means nobody waits`);
    assert.equal(cap.qaActive, n);
  }
});

test("maxQa is reported so the board can show the limit it is measured against", () => {
  const { runner, state } = runnerWith({ maxQa: 3, inQa: 5, slotsHeld: 3 });
  const cap = runner.qaCapacity(state);
  assert.equal(cap.maxQa, 3);
  assert.equal(cap.qaWaiting, 2, "5 tasks against 3 slots leaves 2 waiting");
});

test("a live child's pid reaches the caller through startStallWatch", async () => {
  const { runner } = runnerWith({ maxQa: 1, inQa: 1, stallMs: 60_000 });
  let seen = null;
  const watch = runner.startStallWatch({ workspace: null }, { attempts: 0, onChild: (child) => { seen = child?.pid ?? null; } });
  // A real process, so the pid is a real pid and not a stub.
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 200)"], { stdio: "ignore" });
  watch.onChild(child);
  assert.equal(typeof seen, "number", "onChild must receive the live pid");
  assert.equal(seen, child.pid);
  assert.equal(watch.child, child, "the watchdog still tracks the child itself");
  watch.stop();
  child.kill("SIGTERM");
  await new Promise((r) => child.once("close", r));
});

test("a throwing caller hook cannot break the run", async () => {
  const { runner } = runnerWith({ maxQa: 1, inQa: 1, stallMs: 60_000 });
  const watch = runner.startStallWatch({ workspace: null }, { attempts: 0, onChild: () => { throw new Error("board write failed"); } });
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 200)"], { stdio: "ignore" });
  assert.doesNotThrow(() => watch.onChild(child), "a failed status write must not kill the worker");
  assert.equal(watch.child, child);
  watch.stop();
  child.kill("SIGTERM");
  await new Promise((r) => child.once("close", r));
});
