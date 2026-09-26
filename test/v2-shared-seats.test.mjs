import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const { scopeBoard, sharedSeatsView } = createRequire(import.meta.url)("../dist/server/shared/projectScope.js");
const read = file => readFile(new URL("../" + file, import.meta.url), "utf8");

const SURFACE = /QUEUED|HOLD|maxBuilders|lowMemory|freeMb|taskId|[0-9]{4}-[0-9]{2}-[0-9]{2}T/;

function board() {
  return {
    capacity: { maxBuilders: 2, busy: 0, lowMemory: false, freeMb: 4096 },
    lanes: [
      { id: "juplan", project: "JuPlan", state: "QUEUED", tasks: [{ taskId: "P-1", state: "QUEUED" }, { state: "RUNNING" }, { state: "QA" }] },
      { id: "jutell", project: "jutell", state: "RUNNING" },
      { id: "juai", project: "juai", holds: [] },
      { id: "ai-agent-marketplace", project: "ai-agent-marketplace" },
      { id: "juradar", project: "juradar" },
    ],
  };
}

test("shared seats used count is RUNNING or QA tasks, and the total is maxBuilders", () => {
  const source = board();
  const view = sharedSeatsView(source, "");
  assert.equal(source.capacity.busy, 0);
  assert.equal(view.line, "전체 AI 자리 2개 중 2개 사용 중");
  assert.equal(view.max, 2);
  assert.equal(view.busy, 2);
  assert.equal(view.percent, 100);
  assert.equal(view.waiting, null);
  assert.equal(view.memory, null);
  assert.match(view.raw, /maxBuilders/);
  assert.doesNotMatch(view.line, SURFACE);
});

test("project window says it is next when its lane is QUEUED and no seat is free", () => {
  const view = sharedSeatsView(board(), "JuPlan");
  assert.equal(view.waiting, "이 프로젝트는 다음 차례예요");
  assert.equal(view.line, "전체 AI 자리 2개 중 2개 사용 중");
  assert.doesNotMatch(`${view.line} ${view.waiting}`, SURFACE);
});

test("a free seat or another session's queue does not say this project is next", () => {
  const open = board();
  open.lanes[0].tasks = [{ taskId: "P-1", state: "QUEUED" }, { state: "RUNNING" }];
  assert.equal(sharedSeatsView(open, "juplan").waiting, null);
  assert.equal(sharedSeatsView(open, "juplan").busy, 1);
  assert.equal(sharedSeatsView(open, "juplan").percent, 50);
  const full = board();
  assert.equal(sharedSeatsView(full, "jutell").waiting, null);
  assert.equal(sharedSeatsView(full, "").waiting, null);
});

test("low memory is an amber sentence with remaining GB, and is omitted without a real number", () => {
  const low = board();
  low.capacity = { maxBuilders: 2, busy: 2, lowMemory: true, freeMb: 1536 };
  const view = sharedSeatsView(low, "juplan");
  assert.equal(view.memory, "RAM이 부족해서 새 작업을 잠시 멈췄어요 (남은 1.5 GB)");
  assert.doesNotMatch(view.memory, SURFACE);
  const whole = board();
  whole.lanes[0].tasks = [{ state: "QUEUED" }, { state: "RUNNING" }];
  whole.capacity = { maxBuilders: 2, busy: 0, lowMemory: true, freeMb: 2048 };
  assert.equal(sharedSeatsView(whole, "").memory, "RAM이 부족해서 새 작업을 잠시 멈췄어요 (남은 2 GB)");
  assert.equal(sharedSeatsView(whole, "").line, "전체 AI 자리 2개 중 1개 사용 중");
  const missing = board();
  missing.capacity = { maxBuilders: 2, busy: 2, lowMemory: true };
  assert.equal(sharedSeatsView(missing, "juplan").memory, null);
  assert.equal(sharedSeatsView(missing, "juplan").line, "전체 AI 자리 2개 중 2개 사용 중");
});

test("missing or unusable capacity shows nothing and never guesses", () => {
  assert.equal(sharedSeatsView({ lanes: [], maxBuilders: 2, busy: 1 }, "juplan"), null);
  assert.equal(sharedSeatsView({ capacity: null, lanes: [{ id: "juplan", state: "QUEUED" }] }, "juplan"), null);
  assert.equal(sharedSeatsView({ capacity: { maxBuilders: "2", busy: 1 } }, "juplan"), null);
  const staleBusy = sharedSeatsView({ capacity: { maxBuilders: 2, busy: -1 }, lanes: [] }, "");
  assert.equal(staleBusy.busy, 0);
  assert.equal(staleBusy.line, "전체 AI 자리 2개 중 0개 사용 중");
  assert.equal(sharedSeatsView(null, "juplan"), null);
  assert.equal(sharedSeatsView({}, ""), null);
});

test("queued work is read from the lane, not invented, and other lanes stay untouched", () => {
  const source = board();
  const snapshot = JSON.parse(JSON.stringify(source));
  const view = sharedSeatsView(source, "juplan");
  assert.equal(view.waiting, "이 프로젝트는 다음 차례예요");
  assert.deepEqual(source, snapshot);
  assert.deepEqual(source.lanes.map(lane => lane.id), ["juplan", "jutell", "juai", "ai-agent-marketplace", "juradar"]);

  const byTask = {
    capacity: { maxBuilders: 1, busy: 0, lowMemory: false, freeMb: 1024 },
    lanes: [{ id: "juplan", tasks: [{ state: "QUEUED", taskId: "SECRET" }, { state: "RUNNING" }] }, { id: "juradar", state: "QUEUED" }],
  };
  const queued = sharedSeatsView(byTask, "juplan");
  assert.equal(queued.waiting, "이 프로젝트는 다음 차례예요");
  assert.doesNotMatch(`${queued.line} ${queued.waiting} ${queued.memory}`, /SECRET|QUEUED/);
  assert.equal(sharedSeatsView(byTask, "juradar").waiting, "이 프로젝트는 다음 차례예요");
  assert.equal(byTask.lanes[1].state, "QUEUED");
});

test("scopeBoard keeps shared capacity and does not change other sessions", () => {
  const source = board();
  const snapshot = JSON.parse(JSON.stringify(source));
  const scoped = scopeBoard(source, "juplan");
  assert.equal(scoped.capacity, source.capacity);
  assert.deepEqual(scoped.lanes.map(lane => lane.id), ["juplan"]);
  assert.equal(scoped.lanes[0], source.lanes[0]);
  assert.deepEqual(source, snapshot);
  assert.equal(sharedSeatsView(scoped, "juplan").waiting, "이 프로젝트는 다음 차례예요");
  assert.equal(scopeBoard(source, "").capacity, source.capacity);
});

test("the screen uses the helper, folds raw capacity, and paints waiting in amber", async () => {
  const [ui, css] = await Promise.all([read("src/frontend/controlRoom.tsx"), read("src/frontend/style.css")]);
  assert.match(ui, /sharedSeatsView\(board, only\)/);
  assert.match(ui, /전체 AI 자리 <strong className="shared-seats-count">\{view\.max\}<\/strong>개 중 <strong className="shared-seats-count">\{view\.busy\}<\/strong>개 사용 중/);
  assert.match(ui, /view\.waiting/);
  assert.match(ui, /view\.memory/);
  assert.match(ui, /<summary>원문 보기<\/summary>/);
  assert.match(ui, /capacity: \(next as Record<string, unknown> \| null\)\?\.capacity/);
  const card = ui.slice(ui.indexOf("function SharedSeatsCard"), ui.indexOf("function laneSelectKey"));
  assert.doesNotMatch(card, /QUEUED|HOLD|maxBuilders|window\.alert|window\.confirm/);
  assert.match(css, /\.shared-seats-memory[\s\S]*#E8C270/);
  assert.match(css, /#7a4a00/);
  assert.match(css, /font-size: 16px/);
  assert.match(css, /min-height: 44px/);
  const block = css.slice(css.indexOf(".shared-seats {"), css.indexOf(".control-tabs"));
  assert.doesNotMatch(block, /--danger|#[eE]06[cC]5[fF]|#[fF][fF]453[aA]/);
});
