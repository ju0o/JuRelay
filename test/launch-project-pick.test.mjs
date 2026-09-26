/* 앱을 열 때 관제실 '이번에 돌릴 프로젝트'.
   켤/쉬게 할 id는 before·after 차이만. 화면은 설정 → 프로젝트 관리와 같은 호출을 쓴다. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LAUNCH_PICK_SKIP_KEY,
  launchPickChanges,
  launchPickResultLine,
  launchPickRows,
  launchPickSkipClear,
  launchPickSkipRead,
  launchPickSkipWrite,
  launchPickVisible,
} from "../dist/server/shared/projectManager.js";

const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

test("only rows whose box changed are paused or resumed", () => {
  const before = [
    { id: "a", on: true },
    { id: "b", on: true },
    { id: "c", on: false },
    { id: "d", on: false },
    { id: "e", on: true },
  ];
  const after = [
    { id: "a", on: true },
    { id: "b", on: false },
    { id: "c", on: true },
    { id: "d", on: false },
    { id: "e", on: false },
  ];
  assert.deepEqual(launchPickChanges(before, after), { resume: ["c"], pause: ["b", "e"] });
  assert.deepEqual(launchPickChanges(before, before), { resume: [], pause: [] });
  assert.equal(
    launchPickResultLine({ resume: ["a", "b", "c"], pause: ["d", "e"] }),
    "3개 켜고 2개 쉬게 했어요 ✓",
  );
});

test("unknown ids and duplicates stay out, and order follows the board", () => {
  const change = launchPickChanges(
    [
      { id: "b", on: false },
      { id: "b", on: true },
      { id: "a", on: true },
      { id: "  ", on: false },
      { id: "a", on: false },
    ],
    [
      { id: "extra", on: false },
      { id: "a", on: false },
      { id: "a", on: true },
      { id: "b", on: true },
    ],
  );
  assert.deepEqual(change, { resume: ["b"], pause: ["a"] });
  assert.deepEqual(launchPickChanges([{ id: "a", on: true }], []), { resume: [], pause: [] });
});

test("a row shows the friendly name, and checked means not paused", () => {
  const rows = launchPickRows([
    { project: "jucontroler-app" },
    { id: "receipt-app", name: "영수증 앱", paused: true },
    { project: "custom-app", name: "  ", enabled: false },
    { lane: "jucontroler-app", name: "다시" },
    null,
    { project: "" },
  ], { "custom-app": "기억한 이름" });
  assert.deepEqual(rows, [
    { id: "jucontroler-app", name: "통합 관제 화면", on: true },
    { id: "receipt-app", name: "영수증 앱", on: false },
    { id: "custom-app", name: "기억한 이름", on: false },
  ]);
  for (const row of rows) assert.notEqual(row.name, row.id);
  assert.equal(launchPickRows([{ id: "mystery-id" }])[0].name, "이름 없는 프로젝트");
});

test("the card shows once per launch unless the Founder asked not to be asked", () => {
  assert.equal(launchPickVisible({ skipped: false, closedThisLaunch: false, laneCount: 2 }), true);
  assert.equal(launchPickVisible({ skipped: true, closedThisLaunch: false, laneCount: 2 }), false);
  assert.equal(launchPickVisible({ skipped: false, closedThisLaunch: true, laneCount: 2 }), false);
  assert.equal(launchPickVisible({ skipped: false, closedThisLaunch: false, laneCount: 0 }), false);

  const store = new Map();
  const read = (key) => store.get(key) ?? null;
  assert.equal(launchPickSkipRead(read), false);
  assert.equal(launchPickSkipRead(null), false);
  assert.equal(launchPickSkipRead(() => { throw new Error("blocked"); }), false);
  launchPickSkipWrite((key, value) => { store.set(key, value); });
  assert.equal(store.get(LAUNCH_PICK_SKIP_KEY), "1");
  assert.equal(launchPickSkipRead(read), true);
  assert.equal(launchPickSkipClear((key) => { store.delete(key); }), true);
  assert.equal(launchPickSkipRead(read), false);
  assert.equal(launchPickSkipClear(() => { throw new Error("full"); }), false);
  assert.doesNotThrow(() => launchPickSkipWrite(null));
  assert.doesNotThrow(() => launchPickSkipWrite(() => { throw new Error("full"); }));
});

test("관제실 card, settings re-enable, and no developer text on the surface", async () => {
  const room = await read("src/frontend/controlRoom.tsx");
  const app = await read("src/frontend/App.tsx");
  const css = await read("src/frontend/style.css");
  const card = room.slice(room.indexOf("function LaunchProjectPick"), room.indexOf("export function ControlRoom"));
  const head = room.indexOf('className="control-room-head"');
  const pick = room.indexOf("<LaunchProjectPick");
  const status = room.indexOf("<SimpleStatusCard");
  assert.ok(head !== -1 && pick !== -1 && status !== -1);
  assert.ok(head < pick && pick < status, "the card sits at the top of 관제실");
  assert.match(card, /이번에 돌릴 프로젝트/);
  assert.match(card, /체크한 프로젝트만 바로 시작하고, 뺀 프로젝트는 이번엔 쉬어요\./);
  assert.ok(card.indexOf("이대로 시작") < card.indexOf(">나중에<"));
  assert.match(card, /className="btn primary"/);
  assert.match(card, /다음부터 묻지 않기/);
  assert.match(card, /\{row\.name\}/);
  assert.doesNotMatch(card, />\{row\.id\}</);
  assert.match(card, /launchPickChanges\(/);
  assert.match(card, /op: 'controlRoom:resume'/);
  assert.match(card, /op: 'controlRoom:pause'/);
  assert.match(card, /launchPickResultLine\(change\)/);
  assert.match(card, /원문 보기/);
  assert.match(card, /다시 시도/);
  assert.doesNotMatch(card, /window\.(alert|confirm|prompt)|HOLD|QUEUED|UNMAPPED/);
  assert.match(room, /let launchPickClosedThisLaunch = false/);
  assert.match(room, /useState\(\(\) => launchPickClosedThisLaunch\)/);
  assert.match(room, /launchPickClosedThisLaunch = true/);
  assert.match(room, /launchPickVisible\(\{/);
  assert.match(app, /<LaunchPickAskAgain \/>/);
  assert.match(app, /다시 묻기/);
  assert.match(app, /다음 실행부터 다시 물어요 ✓/);
  assert.match(app, /지금은 앱을 열 때 이번에 돌릴 프로젝트를 묻지 않아요\./);
  assert.doesNotMatch(app, /\b(alert|confirm|prompt)\(/);
  assert.match(css, /\.launch-pick \.btn \{ min-height: 44px/);
  assert.match(css, /\.launch-pick-lead \{[^}]*font-size: 16px/);
  assert.match(css, /\.launch-pick-row,[\s\S]*?min-height: 44px/);
  assert.match(css, /data-theme="light"\] \.launch-pick \{ --launch-ok: #0d6b5c; --launch-warn: #8a4b00/);
  const look = css.slice(css.indexOf("/* ── 관제실: 이번에 돌릴 프로젝트"), css.indexOf("/* ── 설정 → 허브 새 버전"));
  assert.doesNotMatch(look, /--danger|#[eE]06[cC]5[fF]|color:\s*red/);
});
