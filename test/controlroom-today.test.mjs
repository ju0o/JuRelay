/* R5/R6 관제실: 맨 위 '오늘 끝난 일' 카드 + '지금 일하는 AI' 한 줄,
   모델 사용량 접힌 details, 현재 작업 한국어 title(ID는 원문 보기),
   빈 레인은 전 단계 pending + '쉬는 중'.
   Backend pure helpers → dist/server/backend/controlRoom.js,
   렌더 규격 → src 소스 grep. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  currentTaskId,
  currentTaskTitle,
  elapsedKorean,
  hasCurrentWork,
  laneStageLabel,
  laneWorkerName,
  normalizeTodayDone,
  whoSegmentForLane,
  workingSummary,
} from "../dist/server/backend/controlRoom.js";

const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

test("normalizeTodayDone — board.todayDone 배열을 lane·taskId·title로", () => {
  assert.deepEqual(normalizeTodayDone(null), []);
  assert.deepEqual(normalizeTodayDone({}), []);
  const items = normalizeTodayDone({
    todayDone: [{ lane: "agent-relay", taskId: "T-1", title: "로그인 고치기" }],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].lane, "agent-relay");
  assert.equal(items[0].taskId, "T-1");
  assert.equal(items[0].title, "로그인 고치기");
});

test("normalizeTodayDone — lane별 doneToday도 모은다", () => {
  const items = normalizeTodayDone({
    lanes: [
      { project: "agent-relay", doneToday: ["T-9"] },
      { project: "juplan", todayDone: [{ taskId: "P-2", title: "계획 정리" }] },
    ],
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].lane, "agent-relay");
  assert.equal(items[0].title, "T-9");
  assert.equal(items[1].lane, "juplan");
  assert.equal(items[1].title, "계획 정리");
});

test("currentTaskTitle — 한국어 title 우선, 없으면 ID 폴백", () => {
  assert.equal(currentTaskTitle({ taskId: "T-1", title: "로그인 고치기" }), "로그인 고치기");
  assert.equal(currentTaskTitle({ taskId: "T-2" }), "T-2");
  assert.equal(currentTaskTitle({}), "");
  assert.equal(currentTaskId({ taskId: "T-1", title: "로그인 고치기" }), "T-1");
});

test("hasCurrentWork — title/ID 없으면 쉬는 중", () => {
  assert.equal(hasCurrentWork({ current: { taskId: "T-1" } }), true);
  assert.equal(hasCurrentWork({ current: { title: "할 일" } }), true);
  assert.equal(hasCurrentWork({ current: {} }), false);
  assert.equal(hasCurrentWork({}), false);
  assert.equal(hasCurrentWork(null), false);
});

test("elapsedKorean — 방금/분/시간/일 한국어 경과", () => {
  const now = Date.parse("2026-09-24T12:00:00+09:00");
  assert.equal(elapsedKorean(new Date(now - 10_000).toISOString(), now), "방금 시작");
  assert.equal(elapsedKorean(new Date(now - 12 * 60000).toISOString(), now), "12분째");
  assert.equal(elapsedKorean(new Date(now - 65 * 60000).toISOString(), now), "1시간 5분째");
  assert.equal(elapsedKorean("not-a-date", now), "");
});

test("whoSegment/workingSummary — 레인·단계·경과 한 줄, 없으면 쉬는 중", () => {
  const now = Date.parse("2026-09-24T12:00:00+09:00");
  const lane = {
    project: "agent-relay",
    current: { stage: 2, taskId: "T-1", title: "로그인 고치기", startedAt: new Date(now - 12 * 60000).toISOString() },
    workerChain: ["codex"],
  };
  const segment = whoSegmentForLane(lane, now);
  assert.ok(segment);
  assert.match(segment, /agent-relay/);
  assert.match(segment, /작업/);
  assert.match(segment, /12분째/);
  assert.match(segment, /codex/);
  assert.equal(whoSegmentForLane({ current: {} }, now), null);
  assert.match(workingSummary([lane], now), /지금 일하는 AI/);
  assert.match(workingSummary([lane], now), /12분째/);
  assert.match(workingSummary([], now), /쉬는 중/);
  assert.equal(laneStageLabel(2), "작업");
  assert.equal(laneWorkerName(lane), "codex");
});

test("controlRoom.tsx — 오늘 카드 + 지금 일하는 AI 한 줄이 맨 위", async () => {
  const source = await read("src/frontend/controlRoom.tsx");
  assert.match(source, /오늘 끝난 일/);
  assert.match(source, /aria-label="오늘 끝난 일"/);
  assert.match(source, /오늘 끝난 일은 아직 없어요/);
  assert.match(source, /지금 일하는 AI/);
  assert.match(source, /aria-label="지금 일하는 AI"/);
  assert.match(source, /쉬는 중/);
  const head = source.indexOf("<h1>관제실</h1>");
  const todayUse = source.indexOf("<TodayCard", head);
  const whoUse = source.indexOf("<WhoLine", head);
  const tabs = source.indexOf("control-tabs", head);
  assert.ok(head >= 0 && todayUse > head && whoUse > head, "today/who must render below header");
  assert.ok(todayUse < tabs && whoUse < tabs, "today/who must render above lane tabs");
});

test("controlRoom.tsx — 현재 작업은 title, ID는 원문 보기, 빈 레인은 pending", async () => {
  const source = await read("src/frontend/controlRoom.tsx");
  assert.match(source, /currentTitleOf/);
  assert.match(source, /ID: \{taskId\}/);
  assert.match(source, /working \? flowState\(stageValue, index\) : 'pending'/);
  assert.match(source, /단계: \{stage\}/);
  assert.doesNotMatch(source, /label\(current\.taskId, '지금 하는 일 없음'\)/);
});

test("모델 사용량은 접힌 details", async () => {
  const approvals = await read("src/frontend/approvals.tsx");
  assert.match(approvals, /<details/);
  assert.match(approvals, /<summary>모델 사용량/);
  assert.doesNotMatch(approvals, /<section className="model-usage"/);
  const room = await read("src/frontend/controlRoom.tsx");
  assert.match(room, /<TodayCard board=\{board\} \/>/);
  assert.match(room, /<WhoLine board=\{board\} \/>/);
});

/* 라이브 상태 카드: 지금 하는 일·여기까지 끝남·확인 상태·대표님 할 일·다음 단계.
   실제 TSX를 번들해 렌더한다(소스 grep 아님). */
async function loadControlRoom() {
  const { build } = await import("esbuild");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { createRequire } = await import("node:module");
  const out = await build({
    entryPoints: [new URL("src/frontend/controlRoom.tsx", root).pathname],
    bundle: true, write: false, platform: "node", format: "cjs", logLevel: "silent",
  });
  const dir = await mkdtemp(`${tmpdir()}/controlroom-`);
  try {
    const file = `${dir}/controlRoom.cjs`;
    await writeFile(file, out.outputFiles[0].text);
    return createRequire(file)(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function renderCard(lane, now) {
  const { LiveStatusCard } = await loadControlRoom();
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(React.createElement(LiveStatusCard, { lane, now }));
}

const surface = (html) => html.replace(/<details>.*?<\/details>/gs, "").replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'");

test("라이브 상태 카드 — 일하는 레인의 다섯 항목을 쉬운 한국어로, ID는 접어 둔다", async () => {
  const now = Date.parse("2026-09-26T12:00:00+09:00");
  const html = await renderCard({
    project: "agent-relay",
    current: { stage: 3, taskId: "T-77", title: "영수증 화면 쉽게", startedAt: new Date(now - 12 * 60000).toISOString() },
    workerChain: ["codex"],
    qaChain: ["claude"],
    counts: { VERIFIED_DONE: 4 },
    todayDone: [{ taskId: "T-70", title: "로그인 고치기", finishedAt: new Date(now - 3 * 60000).toISOString() }],
  }, now);
  const text = surface(html);
  assert.match(text, /지금 하는 일/);
  assert.match(text, /가 '영수증 화면 쉽게' 검사하는 중 · 12분째/);
  assert.match(text, /여기까지 끝남/);
  assert.match(text, /5단계 중 2단계 끝남 \(계획 → 만들기\)/);
  assert.match(text, /마지막으로 끝난 일: '로그인 고치기' · 3분 전/);
  assert.match(text, /확인 상태\s+일부 확인\s+· 지금까지 끝난 작업 4개는 확인됨/);
  assert.match(text, /대표님 할 일\s+없음/);
  assert.match(text, /다음 단계\s+이 단계가 끝나면 알아서 '시험' 단계로/);
  assert.match(text, /지금 하실 일은 없어요/);
  assert.doesNotMatch(text, /T-77|T-70|VERIFIED_DONE|\d{4}-\d{2}-\d{2}T/);
  assert.match(html, /<details><summary>원문 보기<\/summary>.*T-77/s);
});

test("라이브 상태 카드 — 사람 확인 대기는 '결정 필요' + 한 개의 버튼", async () => {
  const html = await renderCard({
    project: "agent-relay",
    current: { stage: 5, taskId: "T-9", title: "설정 화면 정리" },
    workerChain: ["codex"],
    humanGate: { gateId: "G-1", ask: "이대로 반영할까요?" },
  });
  const text = surface(html);
  assert.match(text, /대표님 할 일\s+결정 필요/);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.match(text, /답하러 가기/);
  assert.match(text, /대표님이 답하시면 바로 이어서 진행해요/);
  assert.doesNotMatch(text, /G-1|T-9/);
});

test("라이브 상태 카드 — 쉬는 레인은 이유와 다음 단계를 말한다", async () => {
  const text = surface(await renderCard({ project: "agent-relay", workerChain: ["codex"] }));
  assert.match(text, /지금 하는 일이 없어요\. 쉬는 중이에요\./);
  assert.match(text, /확인 상태\s+확인하지 못함/);
  assert.match(text, /새 작업이 정해지면 알아서 시작해요/);
  assert.match(text, /대표님 할 일\s+없음/);
});

test("controlRoom.tsx — LaneView가 라이브 상태 카드를 그린다", async () => {
  const source = await read("src/frontend/controlRoom.tsx");
  assert.match(source, /<LiveStatusCard lane=\{lane\} \/>/);
});
