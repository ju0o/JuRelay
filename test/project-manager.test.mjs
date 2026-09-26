import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ControlRoomError, runControlRoomLaneAdd } from "../dist/server/backend/controlRoom.js";
import { isLaneOn, laneErrorLines, laneRowLabel, laneRowName, newLaneIdFor, newLaneProblem, suggestLaneId } from "../dist/server/shared/projectManager.js";

const BASE = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "asus", "~/.agents/skills/auto-night-orchestrator/scripts/night"];

test("row label and on/off from a board lane", () => {
  assert.equal(laneRowLabel(true), "켜짐 · ASUS 켤 때 자동으로 돌아요");
  assert.equal(laneRowLabel(false), "쉬는 중");
  assert.equal(isLaneOn({ project: "x" }), true);
  assert.equal(isLaneOn({ project: "x", paused: true }), false);
  assert.equal(isLaneOn({ project: "x", enabled: false }), false);
  assert.equal(isLaneOn(null), false);
});

test("id suggestion", () => {
  assert.equal(suggestLaneId("Receipt App"), "receipt-app");
  assert.equal(suggestLaneId("  JuPlan 2!  "), "juplan-2");
  assert.equal(suggestLaneId("영수증 앱"), "");
  assert.equal(suggestLaneId("9lives"), "lives");
  assert.equal(suggestLaneId(42), "");
});

test("row name never shows the english id", () => {
  assert.equal(laneRowName("receipt-app", "영수증 앱"), "영수증 앱");
  assert.equal(laneRowName("jucontroler-app"), "통합 관제 화면");
  assert.equal(laneRowName("receipt-app"), "이름 없는 프로젝트");
  assert.equal(laneRowName("receipt-app", "  "), "이름 없는 프로젝트");
});

test("id is always made for the user, even from a Korean-only name", () => {
  assert.equal(newLaneIdFor("Receipt App"), "receipt-app");
  assert.equal(newLaneIdFor("Receipt App", ["receipt-app"]), "receipt-app-2");
  assert.equal(newLaneIdFor("영수증 앱"), "project-2");
  assert.equal(newLaneIdFor("영수증 앱", ["project-2"]), "project-3");
  assert.equal(newLaneProblem({ id: newLaneIdFor("영수증 앱"), path: "/a", name: "영수증 앱" }), null);
});

test("new lane validation", () => {
  const ok = { id: "receipt-app", path: "/home/a/receipt", name: "영수증 앱" };
  assert.equal(newLaneProblem(ok), null);
  assert.match(newLaneProblem({ ...ok, name: " " }), /이름/);
  assert.match(newLaneProblem({ ...ok, path: "relative/dir" }), /전체 경로/);
  assert.match(newLaneProblem({ ...ok, path: "/a\nb" }), /전체 경로/);
  assert.match(newLaneProblem({ ...ok, id: "Bad Id" }), /짧은 이름/);
  assert.match(newLaneProblem(ok, ["receipt-app"]), /이미 있는/);
});

test("error is three lines and tells offline from failure", () => {
  const off = laneErrorLines("추가하지", "작업 PC(ASUS)에 연결할 수 없습니다.");
  assert.equal(off.length, 3);
  assert.match(off[2], /ASUS를 켠 뒤/);
  assert.match(laneErrorLines("추가하지", "오류")[2], /잠시 뒤/);
});

test("laneAdd runs the fixed ssh argv, quoted, shell:false, 30s", async () => {
  let call;
  const value = await runControlRoomLaneAdd("receipt-app", "/home/a/it's", "영수증 앱", async (...args) => {
    call = args;
    return { stdout: JSON.stringify({ ok: true }), stderr: "" };
  });
  assert.deepEqual(value, { ok: true });
  assert.equal(call[0], "ssh");
  assert.deepEqual(call[1], [...BASE, "lane", "add", "'receipt-app'", "'/home/a/it'\\''s'", "'영수증 앱'", "--json"]);
  assert.deepEqual(call[2], { shell: false, timeout: 30_000 });
});

test("laneAdd rejects bad input before ssh runs", async () => {
  let ran = false;
  const exec = async () => { ran = true; return { stdout: "{}", stderr: "" }; };
  for (const args of [["a; rm", "/x", "n"], ["ok-id", "no-slash", "n"], ["ok-id", "/x", ""]]) {
    const err = await runControlRoomLaneAdd(...args, exec).catch((e) => e);
    assert.ok(err instanceof ControlRoomError);
    assert.equal(err.code, "INVALID_INPUT");
  }
  assert.equal(ran, false);
});

test("settings screen wires the manager with Korean confirm, no native dialogs", async () => {
  const src = await readFile(new URL("../src/frontend/App.tsx", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("function ProjectManager"), src.indexOf("function UpdateSection"));
  assert.match(block, /계속 돌리기/);
  assert.ok(block.indexOf("계속 돌리기") < block.indexOf("쉬게 하기"));
  assert.match(block, /켰어요 ✓/);
  assert.match(block, /쉬게 했어요 ✓/);
  assert.match(block, /추가했어요 ✓ · 곧 첫 계획을 세워요/);
  assert.match(block, /원문 보기/);
  assert.doesNotMatch(block, /laneRowName\(lane\.id\)/);
  assert.match(block, /고급 \(개발용\)/);
  assert.match(block, /rawView\(loadError\.detail/);
  const css = await readFile(new URL("../src/frontend/style.css", import.meta.url), "utf8");
  assert.match(css, /\.project-manager \.btn \{ min-height: 44px/);
  assert.match(css, /\.project-manager \.inline-confirm p \{ font-size: 16px/);
  assert.match(css, /data-theme="light"\] \.project-manager \{ --pm-warn: #8a4b00/);
  assert.doesNotMatch(block, /\b(alert|confirm|prompt)\(/);
});
