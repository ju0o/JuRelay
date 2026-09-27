import assert from "node:assert/strict";
import test from "node:test";
import {
  ControlRoomError,
  MAX_PLAN_REQUEST_TEXT_LENGTH,
  PLAN_REQUEST_TIMEOUT,
  runPlanStudioRequest,
  shQuote,
  configureRunLocation,
} from "../dist/server/backend/controlRoom.js";

// 이 시험은 다른 컴퓨터(SSH) 위치를 가정한다 — 별칭은 시험이 직접 넣는다(코드 기본값이 아니다).
configureRunLocation({ kind: "ssh", alias: "asus" });

const BASE = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "asus", "~/.agents/skills/auto-night-orchestrator/scripts/night"];

test("planStudio:request uses night plan request with quoted argv, shell:false, long timeout", async () => {
  let call;
  const text = "영수증 화면 쉽게; echo hi";
  const value = await runPlanStudioRequest("agent-relay", text, async (...args) => {
    call = args;
    return { stdout: '{"tasks":[{"id":"T1"}]}', stderr: "" };
  });

  assert.deepEqual(value, { tasks: [{ id: "T1" }] });
  assert.equal(call[0], "ssh");
  assert.deepEqual(call[1], [...BASE, "plan", "request", shQuote("agent-relay"), shQuote(text), "--json"]);
  assert.equal(call[2].shell, false);
  assert.equal(call[2].timeout, PLAN_REQUEST_TIMEOUT);
  assert.ok(call[2].timeout > 10_000);
});

test("planStudio:request rejects empty or too-long text before ssh runs", async () => {
  let spawned = 0;
  const fake = async () => {
    spawned += 1;
    return { stdout: "{}", stderr: "" };
  };

  const empty = await runPlanStudioRequest("agent-relay", "", fake).catch((e) => e);
  assert.ok(empty instanceof ControlRoomError);
  assert.equal(empty.code, "INVALID_INPUT");
  assert.equal(empty.operation, "planStudio:request");
  assert.match(empty.message, /[가-힣]/);

  const tooLong = await runPlanStudioRequest("agent-relay", "가".repeat(MAX_PLAN_REQUEST_TEXT_LENGTH + 1), fake).catch((e) => e);
  assert.ok(tooLong instanceof ControlRoomError);
  assert.equal(tooLong.code, "INVALID_INPUT");
  assert.equal(tooLong.operation, "planStudio:request");
  assert.match(tooLong.message, /[가-힣]/);

  const notString = await runPlanStudioRequest("agent-relay", null, fake).catch((e) => e);
  assert.ok(notString instanceof ControlRoomError);
  assert.equal(notString.code, "INVALID_INPUT");

  const badProject = await runPlanStudioRequest("", "할 일", fake).catch((e) => e);
  assert.ok(badProject instanceof ControlRoomError);
  assert.equal(badProject.code, "INVALID_INPUT");
  assert.equal(badProject.operation, "planStudio:request");

  assert.equal(spawned, 0);
});

test("planStudio:request reports offline when ssh cannot connect", async () => {
  const err = await runPlanStudioRequest("agent-relay", "영수증 화면 쉽게", async () => {
    throw new Error("offline");
  }).catch((e) => e);
  assert.ok(err instanceof ControlRoomError);
  assert.equal(err.code, "EXEC_FAILED");
  assert.equal(err.operation, "planStudio:request");
  assert.match(err.message, /연결할 수 없습니다/);
});
