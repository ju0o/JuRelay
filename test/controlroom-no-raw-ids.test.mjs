import assert from 'node:assert/strict';
import test from 'node:test';
import { controlRoomWorkingItems, controlRoomWorkingRows } from '../dist/server/shared/types.js';
import { aiDisplayName, coolingItemText, holdBadgeText, localClockLabel, projectDisplayName } from '../dist/server/shared/projectLabels.js';

test('task without a Korean title shows 새 작업 and keeps the id apart', () => {
  const lanes = [{ project: 'juceipt', current: { stage: 2, taskId: 'JUCEIPT-CODEX-TOOL-MASKING' }, workerChain: ['codex'] }];
  const [row] = controlRoomWorkingRows(lanes);
  assert.equal(row, 'juceipt · 작업 · Codex · 새 작업 (이름 짓는 중)');
  assert.doesNotMatch(row, /JUCEIPT-CODEX/);
  assert.equal(controlRoomWorkingItems(lanes)[0].taskId, 'JUCEIPT-CODEX-TOOL-MASKING');
});

test('runtime ids become friendly names', () => {
  const names = { cursor: 'Cursor', codex: 'Codex', opencode: 'OpenCode', 'claude-team': 'Claude Team', 'claude-pro': 'Claude Pro', grok: 'Grok', cline: 'Cline', 'opencode-free': '무료 모델' };
  for (const [id, name] of Object.entries(names)) assert.equal(aiDisplayName(id), name);
});

test('cooling time is local HH:MM, not ISO', () => {
  const iso = '2026-09-25T12:12:00Z';
  const d = new Date(iso);
  const local = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  assert.equal(localClockLabel(iso), local);
  assert.equal(coolingItemText('opencode', iso), 'OpenCode (' + local + '까지 쉼)');
  assert.equal(coolingItemText('cline', '20:28'), 'Cline (20:28까지 쉼)');
  assert.equal(coolingItemText('cline', 'soon'), 'Cline (잠시 쉼)');
  const [line] = controlRoomWorkingRows([], { cooling: [{ runtime: 'opencode', until: iso }] });
  assert.doesNotMatch(line, /T\d\d:|2026/);
});

test('lane tab name and hold badge', () => {
  assert.equal(projectDisplayName('jutell'), 'jutell');
  assert.equal(projectDisplayName('JUTELL'), 'JUTELL');
  assert.equal(projectDisplayName('other'), 'other');
  assert.equal(holdBadgeText(2), '멈춘 작업 2');
  assert.equal(holdBadgeText(0), '멈춘 작업 1');
});
