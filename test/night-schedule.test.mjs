import assert from "node:assert/strict";
import test from "node:test";
import {
  ControlRoomError,
  runControlRoomScheduleCancel,
  runControlRoomScheduleList,
  runControlRoomScheduleSet,
} from "../dist/server/backend/controlRoom.js";

const BASE = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "asus", "~/.agents/skills/auto-night-orchestrator/scripts/night"];
const ok = (calls) => async (...args) => {
  calls.push(args);
  return { stdout: '{"ok":true}', stderr: "" };
};

test("schedule ops run the fixed ssh argv with shell:false", async () => {
  const cases = [
    [(x) => runControlRoomScheduleSet("23:30", x), "23:30"],
    [(x) => runControlRoomScheduleSet("00:00", x), "00:00"],
    [(x) => runControlRoomScheduleList(x), "list"],
    [(x) => runControlRoomScheduleCancel(x), "cancel"],
  ];
  for (const [run, tail] of cases) {
    const calls = [];
    assert.deepEqual(await run(ok(calls)), { ok: true });
    assert.equal(calls[0][0], "ssh");
    assert.deepEqual(calls[0][1], [...BASE, "schedule", tail, "--json"]);
    assert.equal(calls[0][2].shell, false);
  }
});

test("scheduleSet rejects bad times before ssh runs", async () => {
  for (const bad of ["24:00", "9:30", "12:60", "12:5", "23:30; rm -rf /", "", "23:30\n", undefined, 1230]) {
    const calls = [];
    const err = await runControlRoomScheduleSet(bad, ok(calls)).catch((e) => e);
    assert.ok(err instanceof ControlRoomError, String(bad));
    assert.equal(err.code, "INVALID_INPUT");
    assert.match(err.message, /HH:MM/);
    assert.equal(calls.length, 0);
  }
});

test("schedule ops report offline", async () => {
  const offline = async () => {
    throw new Error("offline");
  };
  for (const p of [
    runControlRoomScheduleSet("23:30", offline),
    runControlRoomScheduleList(offline),
    runControlRoomScheduleCancel(offline),
  ]) {
    const err = await p.catch((e) => e);
    assert.ok(err instanceof ControlRoomError);
    assert.equal(err.code, "EXEC_FAILED");
    assert.match(err.message, /연결할 수 없습니다/);
  }
});
