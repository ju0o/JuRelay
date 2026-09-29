import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { projectFromSearch, projectWindowKey, projectWindowTitle } from "../dist/server/shared/projectLabels.js";

const read = file => readFile(new URL("../" + file, import.meta.url), "utf8");

test("window key ignores case/space so a second click focuses instead of duplicating", () => {
  assert.equal(projectWindowKey(" JuPlan "), "juplan");
  assert.equal(projectWindowKey("juplan"), projectWindowKey("JUPLAN"));
});

test("window title is 'Agent Relay · <프로젝트 이름>' (unknown ids fall back to the id)", () => {
  assert.equal(projectWindowTitle("agent-relay"), "Agent Relay · agent-relay");
  assert.equal(projectWindowTitle("jucontroler-app"), "Agent Relay · jucontroler-app");
  assert.equal(projectWindowTitle("jutell"), "Agent Relay · JuTell");
  assert.equal(projectWindowTitle("other-lane"), "Agent Relay · other-lane");
});

test("projectFromSearch reads ?project=", () => {
  assert.equal(projectFromSearch("?project=juplan"), "juplan");
  assert.equal(projectFromSearch(""), "");
  assert.equal(projectFromSearch("?x=1"), "");
});

test("main validates the id, reuses preload options and keeps one window per key", async () => {
  const main = await read("src/backend/main.ts");
  assert.match(main, /ipcMain\.handle\('window:openProject'/);
  assert.match(main, /isValidProjectId\(projectId\)/);
  assert.match(main, /projectWindows\.get\(key\)/);
  assert.match(main, /existing\.focus\(\)/);
  assert.match(main, /webPreferences: WEB_PREFERENCES\(\)/);
  assert.match(main, /webPreferences: \{ \.\.\.WEB_PREFERENCES\(\)/);
  assert.match(await read("src/backend/preload.ts"), /ipcRenderer\.invoke\('window:openProject'/);
});

test("live status card has the founder-ux button with a three-line retryable error", async () => {
  const ui = await read("src/frontend/controlRoom.tsx");
  assert.match(ui, /이 프로젝트만 새 창으로/);
  assert.match(ui, /새 창을 열지 못했어요\./);
  assert.match(ui, /다시 시도/);
  assert.match(ui, /window\.relayApi\?\.openProjectWindow/);
});
