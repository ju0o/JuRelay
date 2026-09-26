/* 관제실 숫자 타일과 자리 막대는 같은 수를 본다.
   사용 중 = 보드에서 RUNNING 또는 QA 인 작업 수.
   전체 = capacity.maxBuilders. capacity 가 없으면 자리 막대는 숨기고 타일만 남긴다.
   capacity.busy 는 쓰지 않는다. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { countWorkingTasks, sharedSeatsView } = createRequire(import.meta.url)(
  path.join(root, "dist/server/shared/projectScope.js"),
);

async function loadStats() {
  const { build } = await import("esbuild");
  const out = await build({
    entryPoints: [path.join(root, "src/frontend/controlRoom.tsx")],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
  });
  const dir = await mkdtemp(path.join(tmpdir(), "seats-match-"));
  try {
    const file = path.join(dir, "controlRoom.cjs");
    await writeFile(file, out.outputFiles[0].text);
    return createRequire(file)(file).crTopStats;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const crTopStats = await loadStats();

function workingTile(board) {
  return crTopStats(board).find((stat) => stat.label === "지금 일하는 AI").value;
}

/** The live mismatch: tile said 5, seat bar said 0 of 11, because busy was stale. */
function mismatchBoard() {
  return {
    capacity: { maxBuilders: 11, busy: 0, lowMemory: false, freeMb: 8192 },
    lanes: [
      { id: "a", state: "RUNNING", counts: { RUNNING: 2, QUEUED: 1 }, current: { state: "RUNNING", title: "영수증 화면 쉽게" } },
      { id: "b", state: "RUNNING", counts: { RUNNING: 1 }, current: { state: "RUNNING", title: "명령 결과" } },
      { id: "c", state: "RUNNING", counts: { QA: 2, HOLD: 1 }, current: { state: "QA", title: "검사" } },
      { id: "d", state: "RUNNING", counts: { QUEUED: 4 }, current: { state: "QUEUED", title: "대기" } },
      { id: "e", state: "RUNNING" },
      { id: "f", state: "IDLE" },
    ],
  };
}

test("stat tile and seat bar agree on RUNNING and QA tasks, ignoring capacity.busy", () => {
  const board = mismatchBoard();
  const snapshot = JSON.parse(JSON.stringify(board));
  const working = countWorkingTasks(board);
  const seats = sharedSeatsView(board, "");
  assert.equal(working, 5);
  assert.equal(seats.max, 11);
  assert.equal(seats.busy, working);
  assert.equal(workingTile(board), seats.busy);
  assert.equal(seats.line, "전체 AI 자리 11개 중 5개 사용 중");
  assert.equal(seats.percent, 45);
  assert.doesNotMatch(seats.line, /RUNNING|QA|maxBuilders|busy/);
  assert.deepEqual(board, snapshot);
});

test("a top-level task list is the same count, and lane flags are not extra seats", () => {
  const board = {
    capacity: { maxBuilders: 11, busy: 9 },
    tasks: [
      { state: "RUNNING" },
      { state: "RUNNING" },
      { state: "QA" },
      { status: "QA" },
      { state: "RUNNING" },
      { state: "QUEUED" },
      { state: "HOLD" },
      { state: "REQUEST_CHANGES" },
      { state: "VERIFIED_DONE" },
    ],
    lanes: [{ state: "RUNNING", counts: { RUNNING: 9 } }],
  };
  const seats = sharedSeatsView(board, "");
  assert.equal(countWorkingTasks(board), 5);
  assert.equal(seats.busy, 5);
  assert.equal(workingTile(board), 5);
  assert.equal(seats.line, "전체 AI 자리 11개 중 5개 사용 중");
});

test("counts and current for the same lane are not added twice", () => {
  const board = {
    capacity: { maxBuilders: 4 },
    lanes: [{ counts: { RUNNING: 1 }, current: { state: "RUNNING", title: "하나만" } }],
  };
  assert.equal(countWorkingTasks(board), 1);
  assert.equal(sharedSeatsView(board, "").busy, 1);
  assert.equal(workingTile(board), 1);
});

test("missing capacity keeps the tile and hides the seat bar", () => {
  const board = { lanes: [{ counts: { RUNNING: 3, QA: 1 } }] };
  assert.equal(sharedSeatsView(board, ""), null);
  assert.equal(sharedSeatsView({ lanes: board.lanes, capacity: null }, ""), null);
  assert.equal(sharedSeatsView({ lanes: board.lanes, capacity: { busy: 4 } }, ""), null);
  assert.equal(countWorkingTasks(board), 4);
  assert.equal(workingTile(board), 4);
});

test("the screen reads both numbers from the same helper", async () => {
  const source = await readFile(path.join(root, "src/frontend/controlRoom.tsx"), "utf8");
  const statsFn = source.slice(source.indexOf("export function crTopStats"), source.indexOf("function CrTopGuide"));
  assert.match(statsFn, /countWorkingTasks\(board\)/);
  assert.doesNotMatch(statsFn, /controlRoomWorkingItems/);
  assert.match(source, /sharedSeatsView\(board, only\)/);
  assert.match(source, /\{seats && <SharedSeatsCard view=\{seats\} \/>\}/);
});
