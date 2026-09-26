import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("settings night schedule card books an end time and cancels only after inline confirm", async () => {
  const src = await readFile(new URL("../src/frontend/App.tsx", import.meta.url), "utf8");
  const room = await readFile(new URL("../src/backend/controlRoom.ts", import.meta.url), "utf8");
  const start = src.indexOf("const SCHEDULE_TIME_PATTERN = ");
  assert.ok(start >= 0, "SCHEDULE_TIME_PATTERN missing from the card");
  const block = src.slice(start);
  assert.ok(block.includes("function NightScheduleCard"), "NightScheduleCard missing");

  const pageStart = src.indexOf('className="settings-page"');
  const pageEnd = src.indexOf("function ProjectManager");
  const page = src.slice(pageStart, pageEnd);
  const hubAt = page.indexOf("<HubPromoteCard />");
  const cardAt = page.indexOf("<NightScheduleCard />");
  const devAt = page.indexOf("고급 (개발용)");
  assert.ok(hubAt >= 0 && cardAt > hubAt, "card sits after HubPromoteCard");
  assert.ok(cardAt - hubAt < 80, "card is next to HubPromoteCard");
  assert.ok(devAt > cardAt, "card stays above 고급 (개발용)");

  const literal = (text) => {
    const match = text.match(/SCHEDULE_TIME_PATTERN = (\/\^[\s\S]*?\/);/);
    assert.ok(match, "HH:MM pattern literal missing");
    return match[1];
  };
  assert.equal(literal(block), literal(room));
  assert.match(block, /SCHEDULE_TIME_PATTERN\.test\(hm\)/);
  assert.match(block, /type="time"/);
  assert.match(block, /op: 'controlRoom:scheduleList'/);
  assert.match(block, /op: 'controlRoom:scheduleSet', time: picked/);
  assert.match(block, /op: 'controlRoom:scheduleCancel'/);
  assert.match(block, /예약했어요 ✓/);
  assert.match(block, /취소했어요 ✓/);
  assert.match(block, /\$\{hm\}에 끝나도록 예약됨/);
  assert.match(block, /예약된 밤 작업이 없어요 — 끝나는 시각을 골라 예약하세요/);
  assert.match(block, /laneErrorLines\('예약하지', message\)/);
  assert.match(block, /laneErrorLines\('취소하지', message\)/);
  assert.match(block, /원문 보기/);
  assert.match(block, /다시 시도/);
  const stopAt = block.indexOf(">그만두기</button>");
  const goAt = block.indexOf(">이대로 취소</button>");
  assert.ok(stopAt >= 0 && goAt > stopAt, "safe 그만두기 comes before 이대로 취소");
  assert.match(block, /btn primary" type="button" onClick=\{\(\) => setConfirming\(false\)\}>그만두기/);
  assert.match(block, /void cancel\(\)\}>이대로 취소/);
  assert.match(block, /onClick=\{\(\) => setConfirming\(true\)\}/);
  assert.doesNotMatch(block, /window\.confirm/);
  assert.doesNotMatch(block, /\b(alert|confirm|prompt)\(/);

  const css = await readFile(new URL("../src/frontend/style.css", import.meta.url), "utf8");
  const cssStart = css.indexOf("설정 → 밤 작업 예약");
  assert.ok(cssStart >= 0, "night schedule styles missing");
  const cssBlock = css.slice(cssStart, css.indexOf("상단바: 작업 PC 연결", cssStart));
  assert.match(cssBlock, /\.night-schedule \.btn \{[^}]*min-height: 44px/);
  assert.match(cssBlock, /\.night-schedule input\[type="time"\] \{[^}]*min-height: 44px/);
  assert.match(cssBlock, /\.night-schedule \.night-note\.err \{ color: var\(--night-warn\); \}/);
  assert.match(cssBlock, /data-theme="light"\] \.night-schedule \{ --night-warn: #8a4b00/);
  assert.doesNotMatch(cssBlock, /--danger|#e06c5f|#ff453a|#ff0000|color:\s*red/);
});
