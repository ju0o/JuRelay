import assert from "node:assert/strict";
import test from "node:test";
import { ControlRoomError, runControlRoom, runGatesList, configureRunLocation } from "../dist/server/backend/controlRoom.js";

// 이 시험은 다른 컴퓨터(SSH) 위치를 가정한다 — 별칭은 시험이 직접 넣는다(코드 기본값이 아니다).
configureRunLocation({ kind: "ssh", alias: "asus" });

const fail = (props) => async () => { throw Object.assign(new Error("x"), props); };

test("ssh connected but remote command failed -> REMOTE_FAILED with last 400 chars of stderr", async () => {
  const stderr = "a".repeat(500) + "Traceback: boom";
  for (const run of [
    (exec) => runControlRoom("board", exec),
    (exec) => runGatesList(exec),
  ]) {
    const err = await run(fail({ code: 1, stderr })).catch((e) => e);
    assert.ok(err instanceof ControlRoomError);
    assert.equal(err.code, "REMOTE_FAILED");
    assert.match(err.message, /작업 PC\(asus\)는 켜져 있는데/);
    assert.equal(err.detail.length, 400);
    assert.ok(err.detail.endsWith("Traceback: boom"));
  }
  const tb = await runControlRoom("board", fail({ stderr: "Traceback (most recent call last)" })).catch((e) => e);
  assert.equal(tb.code, "REMOTE_FAILED");
});

test("255 / ETIMEDOUT / ENOENT stay offline", async () => {
  for (const props of [{ code: 255, stderr: "ssh: connect to host asus" }, { code: "ETIMEDOUT" }, { code: "ENOENT" }]) {
    const err = await runControlRoom("approvals", fail(props)).catch((e) => e);
    assert.equal(err.code, "EXEC_FAILED");
    assert.match(err.message, /연결할 수 없습니다/);
    assert.equal(err.detail, undefined);
  }
});
