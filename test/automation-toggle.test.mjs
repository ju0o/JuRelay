import assert from "node:assert/strict";
import test from "node:test";
import { ControlRoomError, runControlRoomAutomationOff, runControlRoomAutomationOn, runControlRoomAutomationStatus } from "../dist/server/backend/controlRoom.js";

const BASE = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "asus", "~/.agents/skills/auto-night-orchestrator/scripts/night"];
const cases = [
  ["status", runControlRoomAutomationStatus, "status"],
  ["on", runControlRoomAutomationOn, "always"],
  ["off", runControlRoomAutomationOff, "stop"],
];

for (const [name, run, verb] of cases) {
  test(`automation ${name} runs the fixed ssh argv with shell:false`, async () => {
    let call;
    const value = await run(async (...args) => {
      call = args;
      return { stdout: '{"mode":"x"}', stderr: "" };
    });
    assert.deepEqual(value, { mode: "x" });
    assert.equal(call[0], "ssh");
    assert.deepEqual(call[1], [...BASE, verb, "--json"]);
    assert.deepEqual(call[2], { shell: false, timeout: 10_000 });
  });

  test(`automation ${name} reports offline and invalid JSON`, async () => {
    const offline = await run(async () => { throw new Error("offline"); }).catch((e) => e);
    assert.ok(offline instanceof ControlRoomError);
    assert.equal(offline.code, "EXEC_FAILED");
    assert.match(offline.message, /연결할 수 없습니다/);

    const invalid = await run(async () => ({ stdout: "nope", stderr: "" })).catch((e) => e);
    assert.ok(invalid instanceof ControlRoomError);
    assert.equal(invalid.code, "INVALID_JSON");
    assert.match(invalid.message, /응답을 읽지 못했습니다/);
  });
}
