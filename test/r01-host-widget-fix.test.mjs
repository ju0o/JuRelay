/**
 * R01-HOST-FIX — widget tab DOM nesting, READY Task select affordance,
 * and no auto defaultModelId selection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const repo = path.resolve(import.meta.dirname, '..');
const dist = (p) => path.join(repo, 'dist/server', p);
const srcPath = path.join(repo, 'src/mcp/app/pm-widget-resource.ts');

const widget = await import(dist('mcp/app/pm-widget-resource.js'));

function extractHtml() {
  // Served HTML after fingerprint substitution.
  return widget.getPmWidgetHtml
    ? widget.getPmWidgetHtml()
    : (() => {
        // Fallback: resources content from module export if present.
        if (typeof widget.PM_WIDGET_HTML === 'string') return widget.PM_WIDGET_HTML;
        // Read from served resource builder used by tests.
        const src = readFileSync(srcPath, 'utf8');
        const m = src.match(/const WIDGET_HTML = `([\s\S]*?)`;/);
        assert.ok(m, 'WIDGET_HTML template found in source');
        return m[1];
      })();
}

function parsePanes(html) {
  // Lightweight structure: find tabpane ids and ensure pane-task is not nested in pane-now.
  const nowOpen = html.indexOf('id="pane-now"');
  const taskOpen = html.indexOf('id="pane-task"');
  const goalOpen = html.indexOf('id="pane-goal"');
  const protoOpen = html.indexOf('id="pane-proto"');
  const designOpen = html.indexOf('id="pane-design"');
  assert.ok(nowOpen > 0 && taskOpen > nowOpen && goalOpen > taskOpen);
  assert.ok(protoOpen > goalOpen && designOpen > protoOpen);

  // From pane-now start to pane-task start, count div depth after opening pane-now.
  const slice = html.slice(nowOpen, taskOpen);
  assert.equal((slice.match(/id="pipe"/g) || []).length, 0, 'no duplicate pipe inside pane-now');
  assert.match(slice, /id="lanes"/);
  assert.match(slice, /id="nowcard"/);

  // Duplicate id="pipe" overall must be exactly 1 (the preserved top pipe).
  const pipes = html.match(/id="pipe"/g) || [];
  assert.equal(pipes.length, 1, 'exactly one pipe id');

  // Tab buttons exist.
  assert.match(html, /data-tab="now"/);
  assert.match(html, /data-tab="task"/);
  assert.match(html, /data-tab="goal"/);
  assert.match(html, /data-tab="proto"/);
  assert.match(html, /data-tab="design"/);
}

test('A: tabpanes are siblings; pane-now has no nested pane-task / duplicate pipe', () => {
  const html = extractHtml();
  parsePanes(html);
  // pane-task must appear as its own tabpane open after pane-now closed.
  const re = /id="pane-now"[\s\S]*?<\/div>\s*<div class="tabpane" id="pane-task"/;
  assert.match(html, re);
});

test('B: Task rows are selectable buttons with task id affordance', () => {
  const src = readFileSync(srcPath, 'utf8');
  assert.match(src, /async function openExistingTask/);
  assert.match(src, /relay_pm_get_task/);
  assert.match(src, /relay_pm_get_goal/);
  assert.match(src, /relay_pm_get_task_execution_config/);
  assert.match(src, /data-task-id=/);
  assert.match(src, /wireTaskRows/);
  assert.match(src, /isRunnableReadyTask/);
  // Must not create Goal/Task inside openExistingTask.
  const openFn = src.slice(src.indexOf('async function openExistingTask'), src.indexOf('async function prepareGoalAndTask'));
  assert.doesNotMatch(openFn, /relay_pm_create_goal/);
  assert.doesNotMatch(openFn, /relay_pm_create_task/);
  assert.doesNotMatch(openFn, /relay_pm_dispatch_owner_approved/);
});

test('C: loadTpModels does not auto-select defaultModelId', () => {
  const src = readFileSync(srcPath, 'utf8');
  assert.doesNotMatch(src, /sel\.value = catalog\.defaultModelId/);
  assert.match(src, /never auto-select catalog\.defaultModelId/);
  assert.match(src, /참고 기본값\(자동 선택 안 함\)/);
  assert.match(src, /Agent change invalidates prior model \+ approval/);
});

test('widget fingerprint changes with this HTML/script fix', () => {
  assert.match(widget.PM_WIDGET_RESOURCE_URI, /^ui:\/\/agent-relay\/pm-widget-[0-9a-f]{8}$/);
  assert.notEqual(widget.PM_WIDGET_CONTENT_FINGERPRINT, 'b059f083');
});
