import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ControlRoomError,
  runControlRoomApprovalAdd,
  runControlRoomApprovalEdit,
  runControlRoomApprovalRemove,
  configureRunLocation,
} from "../dist/server/backend/controlRoom.js";

// 이 시험은 다른 컴퓨터(SSH) 위치를 가정한다 — 별칭은 시험이 직접 넣는다(코드 기본값이 아니다).
configureRunLocation({ kind: "ssh", alias: "asus" });

const BASE = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "asus", "~/.agents/skills/auto-night-orchestrator/scripts/night"];
const RULE = '{"kind":"approval-rule","ok":true,"rule":{"id":"A-12"}}';

function fake() {
  const calls = [];
  const exec = async (...args) => { calls.push(args); return { stdout: RULE, stderr: "" }; };
  return { calls, exec };
}

test("approvalEdit runs approvals edit <id> <summary> --json", async () => {
  const { calls, exec } = fake();
  const value = await runControlRoomApprovalEdit("A-12", "로그인 고치기", exec);
  assert.equal(value.ok, true);
  assert.deepEqual(calls[0][1], [...BASE, "approvals", "edit", "A-12", "'로그인 고치기'", "--json"]);
  assert.equal(calls[0][2].shell, false);
});

test("approvalRemove runs approvals remove <id> --json", async () => {
  const { calls, exec } = fake();
  await runControlRoomApprovalRemove("A-1234", exec);
  assert.deepEqual(calls[0][1], [...BASE, "approvals", "remove", "A-1234", "--json"]);
});

test("approvalAdd passes --json", async () => {
  const { calls, exec } = fake();
  await runControlRoomApprovalAdd("bug-fix", "fix login", exec);
  assert.deepEqual(calls[0][1], [...BASE, "approvals", "add", "'bug-fix'", "'fix login'", "--source", "app", "--json"]);
});

test("edit/remove reject bad ids and summaries without running ssh", async () => {
  const { calls, exec } = fake();
  for (const run of [
    () => runControlRoomApprovalEdit("A-1", "ok", exec),
    () => runControlRoomApprovalEdit("A-12; rm -rf ~", "ok", exec),
    () => runControlRoomApprovalEdit("A-12", "", exec),
    () => runControlRoomApprovalRemove("B-12", exec),
    () => runControlRoomApprovalRemove("A-12345", exec),
  ]) {
    const err = await run().catch(e => e);
    assert.ok(err instanceof ControlRoomError);
    assert.equal(err.code, "INVALID_INPUT");
  }
  assert.equal(calls.length, 0);
});

test("saveEdit uses approvalEdit with the rule id, never approvalAdd", async () => {
  const src = await readFile(new URL("../src/frontend/approvals.tsx", import.meta.url), "utf8");
  const saveEdit = src.slice(src.indexOf("async function saveEdit"), src.indexOf("function askDelete"));
  assert.match(saveEdit, /op: 'controlRoom:approvalEdit', id: ruleId/);
  assert.doesNotMatch(saveEdit, /controlRoom:approvalAdd/);
  assert.match(saveEdit, /고쳤어요 ✓/);
  const remove = src.slice(src.indexOf("async function remove"), src.indexOf("if (gone)"));
  assert.match(remove, /op: 'controlRoom:approvalRemove', id: ruleId/);
});
