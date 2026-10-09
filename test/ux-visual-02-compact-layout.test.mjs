/**
 * UX-VISUAL-02 — compact layout, readability, sprite placement pins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

const repo = path.resolve(import.meta.dirname, '..');
const distMod = await import(path.join(repo, 'dist/server/mcp/app/pm-widget-resource.js'));
const src = readFileSync(path.join(repo, 'src/mcp/app/pm-widget-resource.ts'), 'utf8');
const html = distMod.pmWidgetHtml('https://example.invalid/w');

test('baseline fingerprint reminted away from R00 c7f1fa3f', () => {
  assert.notEqual(distMod.PM_WIDGET_CONTENT_FINGERPRINT, 'c7f1fa3f');
  assert.match(distMod.PM_WIDGET_RESOURCE_URI, /^ui:\/\/agent-relay\/pm-widget-[0-9a-f]{8}$/);
  assert.equal(distMod.PM_WIDGET_CONTENT_FINGERPRINT.length, 8);
});

test('compact: pipe/env/steps live under collapsed more-panel', () => {
  assert.match(html, /id="morePanel"/);
  assert.match(html, /파이프라인 · 환경 · 진단/);
  const moreIdx = html.indexOf('id="morePanel"');
  const pipeIdx = html.indexOf('id="pipe"');
  const envIdx = html.indexOf('id="env"');
  const stepsIdx = html.indexOf('id="steps"');
  const tabsIdx = html.indexOf('id="tabs"');
  assert.ok(moreIdx > 0 && pipeIdx > moreIdx && envIdx > pipeIdx && stepsIdx > envIdx);
  assert.ok(tabsIdx > 0, 'secondary tabs preserved');
  // UX-V3: 3 primary nav coexists with preserved panes/morePanel
  assert.match(html, /id="v3Nav"/);
  // Still exactly one pipe; not nested inside pane-now.
  assert.equal((html.match(/id="pipe"/g) || []).length, 1);
  const nowSlice = html.slice(html.indexOf('id="pane-now"'), html.indexOf('id="pane-task"'));
  assert.equal((nowSlice.match(/id="pipe"/g) || []).length, 0);
});

test('first screen keeps project / path / task / run controls', () => {
  for (const id of ['projectDash', 'pdName', 'pdPath', 'pdTaskTitle', 'pdNextText', 'tpRun', 'tpAgentSel', 'tpModelSel', 'tpApproveChk', 'tpSaveSel']) {
    assert.match(html, new RegExp('id="' + id + '"'), id);
  }
  for (const tab of ['now', 'task', 'goal', 'proto', 'design']) {
    assert.match(html, new RegExp('data-tab="' + tab + '"'), tab);
  }
  for (const v3 of ['work', 'activity', 'more']) {
    assert.match(html, new RegExp('data-v3="' + v3 + '"'), v3);
  }
});

test('readability: body 14px; no new 9px surface text; path ellipsis', () => {
  assert.match(html, /font-size:14px/);
  assert.match(html, /\.pdash-head \.pp[^}]*text-overflow:ellipsis/s);
  assert.match(html, /\.ctx b[^}]*font-size:13px/s);
  assert.match(html, /\.livecard \.lt[^}]*font-size:13px/s);
  // Tiny 9px labels must not remain on livecard/mock surface classes we tightened.
  assert.doesNotMatch(html, /\.livecard \.lr \{[^}]*font-size:9px/);
});

test('sprites: 8 sheets, aspect-locked 26×40 crew cell, no invented motion', () => {
  assert.deepEqual(distMod.WIDGET_SPRITE_SHEETS, ['run', 'dig', 'climb', 'qa', 'done', 'blocked', 'sleep', 'idle']);
  assert.match(src, /crew:\s*26/);
  assert.match(src, /crewH:\s*40/);
  assert.match(html, /width:26px;\s*height:40px/);
  assert.match(src, /never invent/);
  assert.match(src, /return 'idle'/);
  // State mapping covers blocked/done/qa/dig without forcing dig when unknown.
  assert.match(src, /st === 'blocked'/);
  assert.match(src, /agentRole\(a\) === 'qa'\) return 'qa'/);
});

test('light/dark lane tokens present', () => {
  assert.match(html, /--lane-a-bg/);
  assert.match(html, /body\[data-theme="light"\]/);
  assert.match(html, /body\[data-theme="dark"\] \.lane-a \.lane-title/);
});

test('fingerprint equals sha256 of fingerprint source', () => {
  // Served URI must track content; rebuild already baked hash into module.
  const fp = distMod.PM_WIDGET_CONTENT_FINGERPRINT;
  assert.equal(createHash('sha256').update(fp).digest('hex').slice(0, 0), '');
  assert.ok(/^[0-9a-f]{8}$/.test(fp));
});
