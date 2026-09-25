import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PortfolioRunner } from "../../src/v2/portfolio-runner/index.mjs";

// R-09: a dependent task never queues while its dependency is on HOLD; it queues once the dependency (or its -R2) is done.
test("dependsOn waits for VERIFIED_DONE of the dependency or its redesign", async () => {
  const root = await mkdtemp(join(tmpdir(), "deps-"));
  const tasks = [{ taskId: "T2", scope: "api" }, { taskId: "T3", scope: "ui", dependsOn: ["T2"] }];
  const runner = new PortfolioRunner({ manifest: { projects: [{ id: "p", active: true, tasks }] }, statePath: join(root, "state.json"), worktreeRoot: join(root, "w") });
  const state = { tasks: [{ taskId: "T2", projectId: "p", state: "HOLD" }] };
  runner.queueNext(state);
  assert.equal(state.tasks.some((t) => t.taskId === "T3"), false);
  state.tasks.push({ taskId: "T2-R2", projectId: "p", state: "VERIFIED_DONE" });
  runner.queueNext(state);
  assert.equal(state.tasks.find((t) => t.taskId === "T3")?.state, "QUEUED");
});
