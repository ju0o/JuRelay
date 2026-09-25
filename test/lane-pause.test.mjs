import assert from "node:assert/strict";
import test from "node:test";
import { ControlRoomError, runControlRoomPause } from "../dist/server/backend/controlRoom.js";

const BASE = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "asus", "~/.agents/skills/auto-night-orchestrator/scripts/night"];

test("pause runs the fixed ssh argv with shell:false", async () => {
  let call;
  const value = await runControlRoomPause("agent-relay", async (...args) => {
    call = args;
    return { stdout: '{"ok":true}', stderr: "" };
  });
  assert.deepEqual(value, { ok: true });
  assert.equal(call[0], "ssh");
  assert.deepEqual(call[1], [...BASE, "roadmap", "pause", "'agent-relay'", "--json"]);
  assert.deepEqual(call[2], { shell: false, timeout: 10_000 });
});

test("pause rejects an invalid project id before ssh runs", async () => {
  let ran = false;
  const err = await runControlRoomPause("a; rm -rf /", async () => {
    ran = true;
    return { stdout: "{}", stderr: "" };
  }).catch((e) => e);
  assert.ok(err instanceof ControlRoomError);
  assert.equal(err.code, "INVALID_INPUT");
  assert.equal(ran, false);
});

test("pause reports offline", async () => {
  const err = await runControlRoomPause("agent-relay", async () => {
    throw new Error("offline");
  }).catch((e) => e);
  assert.ok(err instanceof ControlRoomError);
  assert.equal(err.code, "EXEC_FAILED");
  assert.match(err.message, /연결할 수 없습니다/);
});
