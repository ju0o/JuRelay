/**
 * UX-V3 Founder-first — work/activity/more shell + READY prefer pins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const distMod = await import(path.join(repo, 'dist/server/mcp/app/pm-widget-resource.js'));
const src = readFileSync(path.join(repo, 'src/mcp/app/pm-widget-resource.ts'), 'utf8');
const html = distMod.pmWidgetHtml('https://example.invalid/w');

test('fingerprint reminted away from 02A-R2 9f4ab921', () => {
  assert.notEqual(distMod.PM_WIDGET_CONTENT_FINGERPRINT, '9f4ab921');
  assert.notEqual(distMod.PM_WIDGET_CONTENT_FINGERPRINT, '70c18571');
  assert.notEqual(distMod.PM_WIDGET_CONTENT_FINGERPRINT, '519c1794');
  assert.match(distMod.PM_WIDGET_RESOURCE_URI, /^ui:\/\/agent-relay\/pm-widget-[0-9a-f]{8}$/);
  assert.equal(distMod.PM_WIDGET_CONTENT_FINGERPRINT.length, 8);
});

test('V3 shell: v3Nav + panel-work/activity/more', () => {
  assert.match(html, /id="v3Nav"/);
  assert.match(html, /data-v3="work"/);
  assert.match(html, /data-v3="activity"/);
  assert.match(html, /data-v3="more"/);
  assert.match(html, /id="panel-work"/);
  assert.match(html, /id="panel-activity"/);
  assert.match(html, /id="panel-more"/);
  assert.match(html, /작업/);
  assert.match(html, /활동/);
  assert.match(html, /더보기/);
  assert.match(src, /function showV3Panel/);
  assert.match(html, /\.v3-nav/);
  assert.match(html, /\.v3-panel\.on/);
});

test('projectDash stays in work; activity keeps tabs/now/task/inbox; more keeps morePanel+goal panes', () => {
  const workSlice = html.slice(html.indexOf('id="panel-work"'), html.indexOf('id="panel-activity"'));
  assert.match(workSlice, /id="projectDash"/);
  assert.match(workSlice, /id="pdTaskPrev"/);
  assert.match(workSlice, /id="pdCounts"/);
  assert.doesNotMatch(workSlice, /id="tabs"/);

  const actSlice = html.slice(html.indexOf('id="panel-activity"'), html.indexOf('id="panel-more"'));
  assert.match(actSlice, /id="tabs"/);
  assert.match(actSlice, /id="pane-now"/);
  assert.match(actSlice, /id="pane-task"/);
  assert.match(actSlice, /id="inbox"/);
  assert.match(actSlice, /id="update"/);
  assert.doesNotMatch(actSlice, /id="morePanel"/);
  assert.doesNotMatch(actSlice, /id="pipe"/);

  const moreStart = html.indexOf('id="panel-more"');
  const moreEnd = html.indexOf('<!-- #panel-more -->');
  const moreSlice = html.slice(moreStart, moreEnd > moreStart ? moreEnd : html.length);
  assert.match(moreSlice, /id="morePanel"/);
  assert.match(moreSlice, /id="pipe"/);
  assert.match(moreSlice, /id="pane-goal"/);
  assert.match(moreSlice, /id="pane-proto"/);
  assert.match(moreSlice, /id="pane-design"/);
  assert.match(moreSlice, /class="dbg"/);
});

test('pane siblings preserved; exactly one pipe; 5 data-tab ids intact', () => {
  assert.equal((html.match(/id="pipe"/g) || []).length, 1);
  const nowSlice = html.slice(html.indexOf('id="pane-now"'), html.indexOf('id="pane-task"'));
  assert.equal((nowSlice.match(/id="pipe"/g) || []).length, 0);
  for (const tab of ['now', 'task', 'goal', 'proto', 'design']) {
    assert.match(html, new RegExp('data-tab="' + tab + '"'));
    assert.match(html, new RegExp('id="pane-' + tab + '"'));
  }
  const re = /id="pane-now"[\s\S]*?<\/div>\s*<div class="tabpane" id="pane-task"/;
  assert.match(html, re);
});

test('READY prefer: pickPrimaryReadyTask + affordance/source pins', () => {
  assert.match(src, /function pickPrimaryReadyTask\(view\)/);
  assert.match(src, /isRunnableReadyTask\(view\.task\)/);
  assert.match(src, /view\.recentTasks/);
  assert.match(src, /pickPrimaryReadyTask\(view\)/);
  assert.match(src, /var readyTask = pickPrimaryReadyTask\(view\)/);
  // Default task-tab selection prefers first runnable READY when no user selection.
  assert.match(src, /readyIdx < 0 && isRunnableReadyTask/);
  assert.match(src, /!selectedTaskId && readyIdx >= 0/);
  // Critical controls unchanged
  for (const id of ['tpRun', 'tpAgentSel', 'tpModelSel', 'tpApproveChk', 'tpSaveSel', 'bootTitle']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
});

test('02A-R2 fixes retained (accent-panel, container 380, path-reveal)', () => {
  assert.match(html, /--accent-panel-bg/);
  assert.match(html, /@container arwidget \(max-width:380px\)/);
  assert.match(html, /id="tpWorkspaceReveal"/);
  assert.match(html, /id="tpScopeReveal"/);
  assert.match(src, /function summarizePathDisplay/);
  assert.doesNotMatch(html, /body \{[^}]*overflow-wrap:\s*anywhere/s);
});
