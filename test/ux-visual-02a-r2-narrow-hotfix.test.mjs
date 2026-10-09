/**
 * UX-VISUAL-02A-R2 — narrow layout final hotfix pins.
 * FIX1: 380/320 작업 시작 full-width; FIX2: path reveal; FIX3: boot-card .bp no break-all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const distMod = await import(path.join(repo, 'dist/server/mcp/app/pm-widget-resource.js'));
const src = readFileSync(path.join(repo, 'src/mcp/app/pm-widget-resource.ts'), 'utf8');
const html = distMod.pmWidgetHtml('https://example.invalid/w');

test('reminted away from 02A baseline 70c18571', () => {
  assert.notEqual(distMod.PM_WIDGET_CONTENT_FINGERPRINT, '70c18571');
  assert.notEqual(distMod.PM_WIDGET_CONTENT_FINGERPRINT, '519c1794');
  assert.notEqual(distMod.PM_WIDGET_CONTENT_FINGERPRINT, 'c7f1fa3f');
  assert.match(distMod.PM_WIDGET_RESOURCE_URI, /^ui:\/\/agent-relay\/pm-widget-[0-9a-f]{8}$/);
});

test('FIX1: narrow action row stacks full-width; min-height 44; click handler intact', () => {
  assert.match(html, /\.card \{[^}]*container-type:\s*inline-size/s);
  assert.match(html, /@container arwidget \(max-width:380px\)[\s\S]*?\.taskprev \.row \{[^}]*flex-direction:\s*column/s);
  assert.match(html, /@media \(max-width:380px\)[\s\S]*?\.taskprev \.row \{[^}]*flex-direction:\s*column/s);
  assert.match(html, /@container arwidget \(max-width:380px\)[\s\S]*?\.taskprev \.row button \{[^}]*width:\s*100%/s);
  assert.match(html, /\.taskprev \.row button \{[^}]*min-height:\s*44px/);
  assert.match(html, /id="tpRun"/);
  assert.match(src, /tpRun\.addEventListener\('click',\s*function\s*\(\)\s*\{\s*explicitOwnerRun\(\)/);
  // Must not "PASS" by clipping the primary control
  assert.doesNotMatch(html, /\.taskprev \.row button\.primary[^}]*overflow:\s*hidden/);
});

test('FIX2: tpWorkspace/tpScope path-reveal with keyboard-friendly details', () => {
  assert.match(html, /id="tpWorkspaceReveal"/);
  assert.match(html, /id="tpScopeReveal"/);
  assert.match(html, /id="tpWorkspaceFull"/);
  assert.match(html, /id="tpScopeFull"/);
  assert.match(html, /전체 경로 보기/);
  assert.match(html, /경로 접기/);
  assert.match(src, /function summarizePathDisplay/);
  assert.match(src, /function setPathReveal/);
  assert.match(src, /setPathReveal\('tpWorkspaceReveal'/);
  assert.match(src, /setPathReveal\('tpScopeReveal'/);
  // Display-only: no workspace mutation from path reveal helpers
  assert.doesNotMatch(src, /setPathReveal[\s\S]{0,400}relay_pm_set_project_workspace_path/);
  assert.doesNotMatch(src, /summarizePathDisplay[\s\S]{0,200}callTool\(/);
});

test('FIX3: boot-card .bp drops break-all; path-reveal + project name keep-all', () => {
  assert.match(html, /\.boot-card \.bp \{[^}]*text-overflow:\s*ellipsis/s);
  assert.match(html, /\.boot-card \.bp \{[^}]*word-break:\s*normal/s);
  assert.doesNotMatch(html, /\.boot-card \.bp \{[^}]*word-break:\s*break-all/s);
  assert.match(html, /\.boot-card \.bn \{[^}]*word-break:\s*keep-all/s);
  assert.match(src, /function buildBootPathReveal/);
  assert.match(src, /buildBootPathReveal\(p\.workspacePath\)/);
  // Card is div+role=option so details can nest; selection preserved
  assert.match(src, /createElement\('div'\)/);
  assert.match(src, /setAttribute\('role',\s*'option'\)/);
  assert.match(src, /stopPropagation/);
});

test('02A light contrast + shared inbox still present (no regression)', () => {
  assert.match(html, /--accent-panel-bg/);
  assert.match(html, /전체 프로젝트 · PM 수신함/);
  assert.match(html, /body\[data-theme="light"\][^}]*--accent-panel-bg:#e8effc/s);
  for (const tab of ['now', 'task', 'goal', 'proto', 'design']) {
    assert.match(html, new RegExp('data-tab="' + tab + '"'));
  }
  assert.match(html, /id="tpAgentSel"/);
  assert.match(html, /id="tpApproveChk"/);
});

test('summarizePathDisplay keeps long path readable without mutating string source', () => {
  const m = src.match(/var PATH_SUMMARY_MAX = (\d+);\s*function summarizePathDisplay\(full\) \{([\s\S]*?)\n      \}\n      function setPathReveal/);
  assert.ok(m, 'summarizePathDisplay present');
  const summarize = new Function(`
    var PATH_SUMMARY_MAX = ${m[1]};
    function summarizePathDisplay(full) { ${m[2]} }
    return summarizePathDisplay;
  `)();
  const long = '/home/skkse12/Desktop/Projects/Core/JuControler';
  const out = summarize(long);
  assert.ok(out.length < long.length, 'summary shorter than full');
  assert.match(out, /JuControler$/);
  assert.match(out, /…/);
  assert.equal(summarize('short'), 'short');
  assert.equal(summarize(''), '');
  assert.equal(long, '/home/skkse12/Desktop/Projects/Core/JuControler', 'source path string unchanged');
});
