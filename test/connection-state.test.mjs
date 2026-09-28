import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  automationEnabledFromStatus,
  automationFailureLine,
  automationResultText,
  automationToggleLabel,
  automationToggleOp,
  classifyConnectionFailure,
  connectionStatusText,
  connectionSwitchSentence,
  connectionViewFromLoadError,
  connectionViewFromStatus,
} from "../dist/server/shared/connectionState.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appSrc = fs.readFileSync(path.join(here, "..", "src", "frontend", "App.tsx"), "utf8");
const css = fs.readFileSync(path.join(here, "..", "src", "frontend", "style.css"), "utf8");

const OFFLINE = "작업 PC(ASUS)에 연결할 수 없습니다. 꺼져 있거나 네트워크가 끊겼을 수 있어요. 켜지면 자동으로 다시 불러옵니다.";
const REMOTE = "작업 PC는 켜져 있는데 요청을 처리하다 오류가 났어요. 잠시 후 자동으로 다시 불러와요. 계속되면 원문 보기로 알려 주세요.";
const BAD_REPLY = "작업 PC의 응답을 읽지 못했습니다. 잠시 후 자동으로 다시 시도합니다.";

test("offline message is offline, anything else is an error while the PC is on", () => {
  assert.equal(classifyConnectionFailure(OFFLINE), "offline");
  assert.equal(classifyConnectionFailure(REMOTE), "error");
  assert.equal(classifyConnectionFailure(BAD_REPLY), "error");
  assert.equal(classifyConnectionFailure("something else failed"), "error");
});

test("status text is connected, offline, or unreadable — never 확인 중 after a failure", () => {
  assert.equal(connectionStatusText("ok"), "작업 PC 연결됨 · 방금 확인");
  assert.equal(connectionStatusText("offline"), "작업 PC에 연결할 수 없어요");
  assert.equal(connectionStatusText("error"), "작업 PC는 켜져 있는데 상태를 읽지 못했어요");
  assert.equal(connectionSwitchSentence(OFFLINE), "작업 PC에 연결할 수 없어요");
  assert.equal(connectionSwitchSentence(REMOTE), "작업 PC는 켜져 있는데 상태를 읽지 못했어요");
  assert.equal(connectionSwitchSentence(BAD_REPLY), "작업 PC는 켜져 있는데 상태를 읽지 못했어요");
  for (const message of [OFFLINE, REMOTE, BAD_REPLY]) {
    assert.equal(connectionSwitchSentence(message).includes("확인 중"), false);
  }
});

test("a failed screen-data load becomes the switch sentence", () => {
  const offline = connectionViewFromLoadError(OFFLINE, true);
  assert.equal(offline.phase, "offline");
  assert.equal(offline.enabled, true);
  assert.equal(offline.statusText, connectionSwitchSentence(OFFLINE));

  const remote = connectionViewFromLoadError(REMOTE, null);
  assert.equal(remote.phase, "error");
  assert.equal(remote.statusText, "작업 PC는 켜져 있는데 상태를 읽지 못했어요");
  assert.equal(remote.statusText.includes("확인 중"), false);
  assert.equal(automationToggleLabel(remote.enabled, remote.phase), "자동 실행 켜기");

  const bad = connectionViewFromLoadError(BAD_REPLY, null);
  assert.equal(bad.statusText, connectionSwitchSentence(BAD_REPLY));
  assert.equal(bad.phase, "error");
});

test("automationToggleLabel(null, 'ok') offers to turn automation on", () => {
  assert.equal(automationToggleLabel(null, "ok"), "자동 실행 켜기");
  assert.equal(automationToggleLabel(null, "checking"), "자동 실행 확인 중");
  assert.equal(automationToggleLabel(true, "ok"), "자동 실행 끄기");
  assert.equal(automationToggleLabel(false, "ok"), "자동 실행 켜기");
  assert.equal(automationToggleLabel(null, "offline"), "자동 실행 켜기");
  assert.equal(automationToggleLabel(null, "error"), "자동 실행 켜기");
  assert.equal(automationToggleLabel(true, "ok").includes("켜짐"), false);
  assert.equal(automationToggleLabel(false, "ok").includes("꺼짐"), false);
});

test("the click matches the action label, and null calls automationOn", () => {
  assert.equal(automationToggleLabel(null, "ok"), "자동 실행 켜기");
  assert.equal(automationToggleOp(null), "controlRoom:automationOn");
  assert.equal(automationToggleLabel(false, "ok"), "자동 실행 켜기");
  assert.equal(automationToggleOp(false), "controlRoom:automationOn");
  assert.equal(automationToggleLabel(true, "ok"), "자동 실행 끄기");
  assert.equal(automationToggleOp(true), "controlRoom:automationOff");
  assert.equal(automationResultText("controlRoom:automationOn"), "켰어요 ✓");
  assert.equal(automationResultText("controlRoom:automationOff"), "껐어요 ✓");
});

test("missing always.mode is unknown, known modes parse", () => {
  assert.equal(automationEnabledFromStatus({ mode: "always" }), null);
  assert.equal(automationEnabledFromStatus({}), null);
  assert.equal(automationEnabledFromStatus({ always: {} }), null);
  assert.equal(automationEnabledFromStatus({ always: { mode: "always" } }), true);
  assert.equal(automationEnabledFromStatus({ always: { mode: "stop" } }), false);
  const view = connectionViewFromStatus({ always: { mode: "always" } });
  assert.equal(view.phase, "ok");
  assert.equal(view.enabled, true);
  assert.equal(view.statusText, "작업 PC 연결됨 · 방금 확인");
  const missing = connectionViewFromStatus({ mode: "x" });
  assert.equal(missing.enabled, null);
  assert.equal(automationToggleLabel(missing.enabled, missing.phase), "자동 실행 켜기");
  assert.equal(automationToggleOp(missing.enabled), "controlRoom:automationOn");
});

test("null status is treated as off and offers to turn automation on", () => {
  const missing = connectionViewFromStatus(null);
  assert.equal(missing.phase, "ok");
  assert.equal(missing.enabled, null);
  assert.equal(automationToggleLabel(missing.enabled, missing.phase), "자동 실행 켜기");
  assert.equal(automationToggleOp(missing.enabled), "controlRoom:automationOn");
});

test("toggle failure shows the Korean message inline and keeps raw detail aside", () => {
  const line = automationFailureLine(REMOTE, "Traceback: boom");
  assert.equal(line.text, REMOTE);
  assert.equal(line.raw, "Traceback: boom");
  assert.equal(line.text.includes("Traceback"), false);
  const noRaw = automationFailureLine(OFFLINE);
  assert.equal(noRaw.text, OFFLINE);
  assert.equal(noRaw.raw, undefined);
});

test("top bar uses the helpers and does not return early when mode is missing", () => {
  assert.match(appSrc, /automationToggleOp\(enabled\)/);
  assert.match(appSrc, /const label = phase === 'checking' \? shellToggleLabel\(enabled, phase\) : automationToggleLabel\(enabled, phase\);/);
  assert.match(appSrc, /connectionSwitchSentence\(message\)/);
  assert.match(appSrc, /controlRoom:automationStatus/);
  assert.match(appSrc, /op === 'controlRoom:automationOn'/);
  assert.match(appSrc, /controlRoom:automationOff/);
  assert.match(appSrc, /<ConnectionBar \/>/);
  assert.match(appSrc, /원문 보기/);
  assert.doesNotMatch(appSrc, /if\s*\(\s*enabled\s*===\s*null\s*\)\s*return/);
  assert.match(css, /\.conn-toggle\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.conn-toggle\.attention\s*\{[^}]*var\(--conn-attention\)/);
  const connCss = css.slice(css.indexOf(".conn-cluster"));
  assert.equal(connCss.includes("var(--danger)"), false);
  assert.equal(connCss.includes("color: red"), false);
});
