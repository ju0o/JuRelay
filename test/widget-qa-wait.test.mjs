/**
 * The QA wait label on the widget pipeline, and the rule it must never break (2026-09-29).
 *
 * "검토 중" (laneNa) is the Founder's own column. Automatic QA queue depth is NOT folded into it:
 * mixing a machine queue into "사람이 봐야 함" would misreport what actually needs a human. The test
 * below fails if that mix ever reappears — the fix is always to move the number, never to accept it.
 *
 * The data source (runner → portfolio-live.json → dashboard → dash.portfolio) is covered by
 * portfolio-lane.test.mjs. This file guards the widget surface only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const src = fs.readFileSync(path.resolve(import.meta.dirname, '../src/mcp/app/pm-widget-resource.ts'), 'utf8');

test('the pipeline QA node carries a muted wait element', () => {
  assert.match(src, /id="pipeQaWait"/, 'a dedicated element exists for the wait count');
  assert.match(src, /class="pwait"/, 'it carries the muted class');
  assert.match(src, /\.pnode \.pwait \{[^}]*opacity/, 'it is dimmer than the review count');
  assert.match(src, /\.pnode \.pwait:empty \{[^}]*display:none/, 'an empty wait count is hidden entirely');
  assert.match(src, /'· ' \+ pipeQaWait \+ ' 대기'/, 'the label reads "· N 대기"');
});

test('★ the "검토 중" lane never receives QA slot information (founder-ux)', () => {
  const at = src.indexOf('id="laneNa"');
  assert.ok(at > 0, 'the lane header markup is locatable');
  const laneHead = src.slice(at - 400, at + 120);
  for (const forbidden of ['pwait', 'qaWaiting', 'portfolio-live', 'liveSnapshot', 'capacity']) {
    assert.ok(!laneHead.includes(forbidden), `laneNa must not reference ${forbidden}`);
  }
  const binding = src.slice(src.indexOf('function applyQaCapacity'), src.indexOf('function applyQaCapacity') + 700);
  assert.match(binding, /qaWaiting/, 'the wait count is bound to the pipeline node');
  assert.ok(!binding.includes('id="laneNa"'), 'applyQaCapacity must not touch the lane header');
});
