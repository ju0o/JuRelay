import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("settings hub card confirms inline, then calls promoteHub, never window.confirm", async () => {
  const src = await readFile(new URL("../src/frontend/App.tsx", import.meta.url), "utf8");
  const start = src.indexOf("function HubPromoteCard");
  assert.ok(start >= 0, "HubPromoteCard missing");
  const block = src.slice(start);

  const pageStart = src.indexOf('className="settings-page"');
  const pageEnd = src.indexOf("function ProjectManager");
  const page = src.slice(pageStart, pageEnd);
  const managerAt = page.indexOf("<ProjectManager ");
  const cardAt = page.indexOf("<HubPromoteCard />");
  assert.ok(managerAt >= 0 && cardAt > managerAt, "card sits after ProjectManager");
  assert.ok(cardAt - managerAt < 120, "card is next to ProjectManager");

  assert.match(block, /op: 'controlRoom:promoteHub'/);
  assert.match(block, /반영했어요 ✓/);
  assert.match(block, /laneErrorLines\('반영하지', message\)/);
  assert.match(block, /원문 보기/);
  assert.match(block, /다시 시도/);
  const stopAt = block.indexOf(">그만두기</button>");
  const goAt = block.indexOf(">이대로 반영</button>");
  assert.ok(stopAt >= 0 && goAt > stopAt, "safe 그만두기 comes before 이대로 반영");
  assert.match(block, /void promote\(\)\}>이대로 반영/);
  assert.match(block, /onClick=\{\(\) => setConfirming\(true\)\}/);
  assert.doesNotMatch(block, /window\.confirm/);
  assert.doesNotMatch(block, /\b(alert|confirm|prompt)\(/);

  const css = await readFile(new URL("../src/frontend/style.css", import.meta.url), "utf8");
  const cssStart = css.indexOf("설정 → 허브 새 버전 반영");
  assert.ok(cssStart >= 0, "hub promote styles missing");
  const cssBlock = css.slice(cssStart, css.indexOf("상단바: 작업 PC 연결", cssStart));
  assert.match(cssBlock, /\.hub-promote \.btn \{[^}]*min-height: 44px/);
  assert.match(cssBlock, /\.hub-promote \.hub-note\.err \{ color: var\(--hub-warn\); \}/);
  assert.match(cssBlock, /data-theme="light"\] \.hub-promote \{ --hub-warn: #8a4b00/);
  assert.doesNotMatch(cssBlock, /--danger|#e06c5f|#ff453a|#ff0000|color:\s*red/);
});
