/**
 * UX-V3 Project Switcher: accessible button-menu opens/closes, switches explicitly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
const repo = path.resolve(import.meta.dirname, '..');
const distMod = await import(path.join(repo, 'dist/server/mcp/app/pm-widget-resource.js'));
const src = readFileSync(path.join(repo, 'src/mcp/app/pm-widget-resource.ts'), 'utf8');
const html = distMod.pmWidgetHtml('https://example.invalid/w');
test('switcher is accessible button-menu, hidden by default', () => {
  assert.match(html, /id="projSwitch"/);
  assert.match(html, /id="projSwitchLabel"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /id="projSwitchMenu"/);
  assert.match(html, /role="menu"/);
  assert.match(html, /hidden/);
  assert.doesNotMatch(html, /<details class="proj-switch/);
  assert.match(src, /function setProjectSwitchOpen/);
  assert.match(src, /function isProjectSwitchOpen/);
  assert.match(src, /\.proj-menu\[hidden\]/);
});
test('switcher supports ESC/outside-click/keyboard + explicit switch contract', () => {
  assert.match(src, /aria-checked/);
  assert.match(src, /menuitemradio/);
  assert.match(src, /ArrowDown/);
  assert.match(src, /relay_pm_select_project/);
  assert.match(src, /explicit no-op on current project/);
  assert.match(src, /project switch ok/);
  assert.match(src, /\uD504\uB85C\uC81D\uD2B8 \uC804\uD658 \uC2E4\uD328/);
  assert.match(html, /ui:\/\/agent-relay\/pm-widget-[0-9a-f]{8}/);
});
