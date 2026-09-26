import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { scopeBoard } = createRequire(import.meta.url)("../../dist/server/shared/projectScope.js");

function fixture() {
  const juplan = {
    id: "juplan",
    project: "JuPlan",
    holds: [{ taskId: "P-1", reason: "결정" }],
    todayDone: [{ taskId: "P-0", title: "계획 정리" }],
  };
  const jutell = { id: "jutell", project: "jutell", holds: [{ reason: "다른 세션" }], todayDone: [{ title: "보고서" }] };
  const juai = { id: "juai", project: "juai", holds: [], todayDone: [] };
  const marketplace = { id: "ai-agent-marketplace", project: "ai-agent-marketplace" };
  const juradar = { id: "juradar", project: "juradar" };
  const board = {
    lanes: [juplan, jutell, juai, marketplace, juradar],
    holds: [
      { project: "Juplan", taskId: "P-1", reason: "결정" },
      { lane: "jutell", reason: "다른 세션" },
      { projectId: "juai", reason: "대기" },
    ],
    todayDone: [
      { lane: "JuPlan", taskId: "P-0", title: "계획 정리" },
      { project: "juradar", title: "레이더" },
      { lane: "ai-agent-marketplace", title: "장터" },
    ],
    tokenFindings: [
      { project: "juplan", kind: "spike", text: "늘었어요" },
      { lane: "juai", kind: "leak", text: "샘" },
    ],
    workRecords: [
      { projectId: "juplan", title: "작업 기록" },
      { lane: "juradar", title: "다른 기록" },
    ],
    routing: { pool: true },
  };
  return { board, juplan, jutell, juai, marketplace, juradar };
}

test("scopeBoard keeps only the chosen lane's lanes, holds and todayDone", () => {
  const { board, juplan } = fixture();
  const scoped = scopeBoard(board, "juplan");

  assert.deepEqual(scoped.lanes, [juplan]);
  assert.equal(scoped.lanes[0], juplan);
  assert.deepEqual(scoped.holds, [{ project: "Juplan", taskId: "P-1", reason: "결정" }]);
  assert.deepEqual(scoped.todayDone, [{ lane: "JuPlan", taskId: "P-0", title: "계획 정리" }]);
  assert.deepEqual(scoped.tokenFindings, [{ project: "juplan", kind: "spike", text: "늘었어요" }]);
  assert.deepEqual(scoped.workRecords, [{ projectId: "juplan", title: "작업 기록" }]);
  assert.equal(scoped.routing, board.routing);
});

test("scopeBoard matches lane id or project ignoring case", () => {
  const { board, jutell } = fixture();
  const scoped = scopeBoard(board, "JuTell");
  assert.deepEqual(scoped.lanes, [jutell]);
  assert.equal(scoped.lanes[0], jutell);
  assert.deepEqual(scoped.holds, [{ lane: "jutell", reason: "다른 세션" }]);
});

test("empty projectId returns the board unchanged", () => {
  const { board } = fixture();
  assert.equal(scopeBoard(board, ""), board);
  assert.equal(scopeBoard(board, "   "), board);
});

test("scopeBoard does not change the input, including other sessions' lanes", () => {
  const { board, juplan, jutell, juai, marketplace, juradar } = fixture();
  const snapshot = JSON.parse(JSON.stringify(board));
  scopeBoard(board, "juplan");
  assert.deepEqual(board, snapshot);
  assert.equal(board.lanes[0], juplan);
  assert.equal(board.lanes[1], jutell);
  assert.equal(board.lanes[2], juai);
  assert.equal(board.lanes[3], marketplace);
  assert.equal(board.lanes[4], juradar);
  assert.deepEqual(board.lanes.map(lane => lane.id), ["juplan", "jutell", "juai", "ai-agent-marketplace", "juradar"]);
});
