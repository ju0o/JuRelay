/**
 * UX-VISUAL-02A — light contrast, 380px responsive, shared inbox project origin.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const distMod = await import(path.join(repo, 'dist/server/mcp/app/pm-widget-resource.js'));
const src = readFileSync(path.join(repo, 'src/mcp/app/pm-widget-resource.ts'), 'utf8');
const pmTools = readFileSync(path.join(repo, 'src/mcp/pm-tools.ts'), 'utf8');
const html = distMod.pmWidgetHtml('https://example.invalid/w');

test('reminted away from 02 baseline 519c1794', () => {
  assert.notEqual(distMod.PM_WIDGET_CONTENT_FINGERPRINT, '519c1794');
  assert.notEqual(distMod.PM_WIDGET_CONTENT_FINGERPRINT, 'c7f1fa3f');
  assert.match(distMod.PM_WIDGET_RESOURCE_URI, /^ui:\/\/agent-relay\/pm-widget-[0-9a-f]{8}$/);
});

test('A: taskprev uses accent-panel tokens (no hardcoded #121a2a fill)', () => {
  assert.match(html, /--accent-panel-bg/);
  assert.match(html, /\.taskprev[^}]*background:var\(--accent-panel-bg\)/s);
  assert.match(html, /\.taskprev[^}]*color:var\(--accent-panel-fg\)/s);
  assert.doesNotMatch(html, /\.taskprev \{[^}]*background:#121a2a/);
  assert.match(html, /body\[data-theme="light"\][^}]*--accent-panel-bg:#e8effc/s);
  assert.match(html, /body\[data-theme="dark"\][^}]*--accent-panel-bg:#121a2a/s);
  assert.match(html, /\.pdash-next[^}]*background:var\(--accent-panel-bg\)/s);
});

test('B: body keeps keep-all; no overflow-wrap:anywhere on body; header nowrap', () => {
  assert.match(html, /word-break:\s*keep-all/);
  assert.doesNotMatch(html, /body \{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(html, /\.app \{[^}]*white-space:nowrap/s);
  assert.match(html, /\.lang button \{[^}]*white-space:nowrap/s);
  assert.match(html, /@media \(max-width:380px\)/);
  assert.match(html, /\.pdash-head \.tt|\.pdash-card \.tt[^}]*-webkit-line-clamp:\s*2/s);
});

test('C: shared inbox labeled; project origin rendered; enrichment on list tool', () => {
  assert.match(html, /전체 프로젝트 · PM 수신함/);
  assert.match(html, /id="inbox"/);
  assert.match(html, /소속 미확인/);
  assert.match(src, /taskProjectId/);
  assert.match(src, /deliveryProjectLabel/);
  assert.match(pmTools, /taskProjectId/);
  assert.match(pmTools, /taskProjectName/);
  assert.match(pmTools, /inboxLabel/);
  assert.match(pmTools, /never invented|소속 미확인/i);
});

test('wake / claim / 5-tab contracts preserved', () => {
  assert.ok(html.includes('relay_pm_claim_wake'));
  assert.ok(html.includes('ui/initialize'));
  for (const tab of ['now', 'task', 'goal', 'proto', 'design']) {
    assert.match(html, new RegExp('data-tab="' + tab + '"'));
    assert.match(html, new RegExp('id="pane-' + tab + '"'));
  }
  assert.match(html, /id="v3Nav"/);
  for (const v3 of ['work', 'activity', 'more']) {
    assert.match(html, new RegExp('data-v3="' + v3 + '"'));
  }
  assert.match(html, /id="tpRun"/);
  assert.match(html, /id="tpAgentSel"/);
});
