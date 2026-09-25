import assert from "node:assert/strict";
import test from "node:test";
import { ControlRoomError, PROMOTE_TIMEOUT, runControlRoomPromoteHub } from "../dist/server/backend/controlRoom.js";

const BASE = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "asus", "~/.agents/skills/auto-night-orchestrator/scripts/night"];

test("promoteHub runs the fixed ssh argv with shell:false and the longer timeout", async () => {
  let call;
  const value = await runControlRoomPromoteHub(async (...args) => {
    call = args;
    return { stdout: '{"ok":true,"hub":"asus"}', stderr: "" };
  });
  assert.deepEqual(value, { ok: true, hub: "asus" });
  assert.equal(call[0], "ssh");
  assert.deepEqual(call[1], [...BASE, "promote", "hub", "--json"]);
  assert.deepEqual(call[2], { shell: false, timeout: PROMOTE_TIMEOUT });
  assert.ok(PROMOTE_TIMEOUT > 10_000);
});

test("promoteHub reports offline as EXEC_FAILED", async () => {
  const err = await runControlRoomPromoteHub(async () => {
    throw Object.assign(new Error("offline"), { code: 255 });
  }).catch((e) => e);
  assert.ok(err instanceof ControlRoomError);
  assert.equal(err.code, "EXEC_FAILED");
  assert.match(err.message, /연결할 수 없습니다/);
});

test("promoteHub reports a remote failure as REMOTE_FAILED", async () => {
  const err = await runControlRoomPromoteHub(async () => {
    throw Object.assign(new Error("failed"), { code: 1, stderr: "boom" });
  }).catch((e) => e);
  assert.ok(err instanceof ControlRoomError);
  assert.equal(err.code, "REMOTE_FAILED");
  assert.match(err.message, /켜져 있는데/);
});
