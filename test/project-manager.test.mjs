import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ControlRoomError, runControlRoomLaneAdd } from "../dist/server/backend/controlRoom.js";
import {
  decodeLaneNames, encodeLaneNames, isLaneOn, laneErrorKind, laneErrorLines, laneErrorRaw, laneResultRaw, laneRowLabel, laneRowName,
  newLaneIdFor, newLaneProblem, suggestLaneId,
} from "../dist/server/shared/projectManager.js";

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

const OFFLINE = "작업 PC(ASUS)에 연결할 수 없습니다. 꺼져 있거나 네트워크가 끊겼을 수 있어요. 켜지면 자동으로 다시 불러옵니다.";
const REMOTE = "작업 PC는 켜져 있는데 요청을 처리하다 오류가 났어요. 잠시 후 자동으로 다시 불러와요. 계속되면 원문 보기로 알려 주세요.";
const BAD_REPLY = "작업 PC의 응답을 읽지 못했습니다. 잠시 후 자동으로 다시 시도합니다.";

test("error is three lines and tells offline from failure", () => {
  const off = laneErrorLines("추가하지", OFFLINE);
  assert.equal(off.length, 3);
  assert.equal(off[0], "추가하지 못했어요.");
  assert.match(off[1], /꺼져 있거나 네트워크/);
  assert.match(off[2], /ASUS를 켠 뒤/);
  const remote = laneErrorLines("켜지", REMOTE);
  assert.match(remote[1], /켜져 있는데/);
  assert.match(remote[2], /잠시 뒤/);
  assert.match(laneErrorLines("추가하지", "오류")[2], /잠시 뒤/);
  assert.equal(laneErrorKind(OFFLINE), "offline");
  assert.equal(laneErrorKind(REMOTE), "remote-failed");
  assert.equal(laneErrorKind(BAD_REPLY), "bad-reply");
  assert.equal(laneErrorKind("프로젝트 이름을 적어 주세요."), "other");
});

test("line 2 never promises an auto-reload this screen does not do, nor names the wrong failure", () => {
  for (const message of [OFFLINE, REMOTE, BAD_REPLY]) {
    const lines = laneErrorLines("쉬게 하지", message);
    for (const line of lines) {
      assert.doesNotMatch(line, /자동으로/, line);
      assert.doesNotMatch(line, /화면 자료/, line);
    }
  }
  // 입력 검사처럼 이미 쉬운 한국어인 메시지는 그대로 보여 준다.
  assert.equal(laneErrorLines("추가하지", "프로젝트 이름을 적어 주세요.")[1], "프로젝트 이름을 적어 주세요.");
});

test("backend text goes under 원문 보기 together with stderr", () => {
  assert.equal(laneErrorRaw(OFFLINE, "ssh: connect to host asus port 22"), `${OFFLINE}\nssh: connect to host asus port 22`);
  assert.equal(laneErrorRaw(REMOTE, undefined), REMOTE);
  assert.equal(laneErrorRaw("", "  "), undefined);
  assert.equal(laneErrorRaw(undefined, undefined), undefined);
  assert.equal(laneResultRaw({ ok: true }), '{\n  "ok": true\n}');
  assert.equal(laneResultRaw(undefined), "undefined");
});

test("remembered Korean names survive a round trip and ignore broken storage", () => {
  const text = encodeLaneNames({ "receipt-app": "영수증 앱" });
  assert.deepEqual(decodeLaneNames(text), { "receipt-app": "영수증 앱" });
  assert.deepEqual(decodeLaneNames(null), {});
  assert.deepEqual(decodeLaneNames("not json"), {});
  assert.deepEqual(decodeLaneNames('["a"]'), {});
  assert.deepEqual(decodeLaneNames('{"x": 1, "y": " ", "z": " 이름 "}'), { z: "이름" });
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
  assert.match(block, /rawView\(laneErrorRaw\(loadError\.message, loadError\.detail\)\)/);
  // 실패 시 백엔드 문구는 화면 줄이 아니라 원문 보기로만 간다.
  assert.match(block, /laneErrorRaw\(message, \(e as \{ detail\?: string \}\)\?\.detail\)/);
  assert.match(block, /laneErrorRaw\(message, \(err as \{ detail\?: string \}\)\?\.detail\)/);
  // 파일 경로가 화면에 예시로 나오지 않는다(원문 보기 밖).
  assert.doesNotMatch(block, /placeholder="\/home/);
  assert.doesNotMatch(block, /\/home\/…/);
  assert.match(block, /placeholder="ASUS에 있는 프로젝트 폴더 위치"/);
  const css = await readFile(new URL("../src/frontend/style.css", import.meta.url), "utf8");
  assert.match(css, /\.project-manager \.btn \{ min-height: 44px/);
  assert.match(css, /\.project-manager \.inline-confirm p \{ font-size: 16px/);
  assert.match(css, /data-theme="light"\] \.project-manager \{ --pm-warn: #8a4b00/);
  assert.match(css, /\.pm-raw-summary \{ min-height: 44px/);
  assert.doesNotMatch(block, /\b(alert|confirm|prompt)\(/);
  // 화면 파일에는 JSON.stringify가 없다(원문 만들기는 공용 도우미로).
  assert.doesNotMatch(src, /JSON\.stringify/);
  assert.match(block, /laneResultRaw\(raw\)/);
});

test("lead and result lines beat .modcard p (13px gray): 16px, done reads teal", async () => {
  const css = await readFile(new URL("../src/frontend/style.css", import.meta.url), "utf8");
  // .modcard p 는 (0,1,1); 이 규칙은 (0,2,1)로 더 세다.
  assert.match(css, /\.modcard \.project-manager p, \.project-manager p \{ font-size: 16px; color: inherit;/);
  assert.match(css, /\.modcard \.project-manager p\.pm-lead, \.project-manager p\.pm-lead \{ [^}]*color: var\(--fg\)/);
  assert.match(css, /\.pm-note\.ok \{ color: var\(--accent\); \}/);
  assert.match(css, /\.pm-note\.err \{ color: var\(--pm-warn\); \}/);
  const modcardP = css.match(/\.modcard p\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(modcardP, /font-size: 13px/, "guard assumes .modcard p is still 13px gray");
});
