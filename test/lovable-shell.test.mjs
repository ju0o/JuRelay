/* Lovable shell — rail order, toggle label, and one failure line per connection state.
   Helpers live in components.tsx; connection sentences stay in connectionState. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { connectionStatusText } from '../dist/server/shared/connectionState.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const components = fs.readFileSync(path.join(root, 'src/frontend/components.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/frontend/App.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/frontend/style.css'), 'utf8');

function loadShellHelpers() {
  const start = components.indexOf('/* SHELL_HELPERS_START */');
  const end = components.indexOf('/* SHELL_HELPERS_END */');
  assert.ok(start !== -1 && end > start, 'shell helper block missing');
  let block = components.slice(start, end).replace(/\/\* SHELL_HELPERS_START \*\//, '');
  block = block.replace(/^export /gm, '');
  block = block.replace(/\(([^)]*)\)/g, (_, params) => {
    const names = params.split(',').map((part) => part.trim().split(':')[0].trim()).filter(Boolean);
    return `(${names.join(', ')})`;
  });
  block = block.replace(/\)\s*:\s*[^{]+\{/g, ') {');
  return new Function('connectionStatusText', `${block}\nreturn { shellNavItems, shellToggleLabel, shellFailureLine, shellEnvLine };`)(connectionStatusText);
}

const { shellNavItems, shellToggleLabel, shellFailureLine, shellEnvLine } = loadShellHelpers();

test('rail lists 관제실, 계획, 승인 규칙, 작업 기록, 설정 in that order', () => {
  assert.deepEqual(shellNavItems().map((item) => item.label), [
    '관제실',
    '계획',
    '승인 규칙',
    '작업 기록',
    '설정',
  ]);
  const navStart = app.indexOf('<nav className="rail-nav"');
  const navEnd = app.indexOf('</nav>', navStart);
  const nav = app.slice(navStart, navEnd);
  const labels = ['>관제실<', '>계획<', '>승인 규칙<', '>작업 기록<', '>설정<'];
  let at = -1;
  for (const label of labels) {
    const next = nav.indexOf(label);
    assert.ok(next > at, `rail missing or out of order: ${label}`);
    at = next;
  }
});

test('toggle label is 켜짐, 꺼짐, or 확인 중', () => {
  assert.equal(shellToggleLabel(true, 'ok'), '자동 실행 켜짐');
  assert.equal(shellToggleLabel(false, 'ok'), '자동 실행 꺼짐');
  assert.equal(shellToggleLabel(null, 'ok'), '자동 실행 꺼짐');
  assert.equal(shellToggleLabel(null, 'offline'), '자동 실행 꺼짐');
  assert.equal(shellToggleLabel(true, 'error'), '자동 실행 켜짐');
  assert.equal(shellToggleLabel(null, 'checking'), '자동 실행 확인 중');
  assert.equal(shellToggleLabel(true, 'checking'), '자동 실행 확인 중');
  assert.match(app, /shellToggleLabel\(enabled, phase\)/);
});

test('failure line is a different Korean sentence for each connection state', () => {
  const ok = shellFailureLine('ok');
  const offline = shellFailureLine('offline');
  const error = shellFailureLine('error');
  assert.equal(ok, connectionStatusText('ok'));
  assert.equal(offline, connectionStatusText('offline'));
  assert.equal(error, connectionStatusText('error'));
  assert.equal(ok, '작업 PC 연결됨 · 방금 확인');
  assert.equal(offline, '작업 PC에 연결할 수 없어요');
  assert.equal(error, '작업 PC는 켜져 있는데 상태를 읽지 못했어요');
  assert.equal(new Set([ok, offline, error]).size, 3);
  assert.equal(shellFailureLine('checking').includes('확인'), true);
  assert.match(app, /shellFailureLine\(view\.phase\)/);
  assert.match(app, />다시 시도</);
});

test('env line uses live labels and does not invent a sample machine', () => {
  assert.equal(shellEnvLine(['ASUS (이 컴퓨터)'], 'ok'), '실행 환경: ASUS (이 컴퓨터)');
  assert.equal(shellEnvLine(['MainPC', '클라우드'], 'ok'), '실행 환경: MainPC · 클라우드');
  assert.equal(shellEnvLine([], 'checking'), '실행 환경: 확인하고 있어요');
  assert.equal(shellEnvLine([], 'offline'), '실행 환경: 작업 PC에 연결할 수 없어요');
  assert.equal(shellEnvLine([], 'error'), '실행 환경: 작업 PC는 켜져 있는데 환경을 읽지 못했어요');
  assert.equal(shellEnvLine([], 'ok'), '실행 환경: 아직 알려진 곳이 없어요');
  assert.equal(shellEnvLine(['  ', ''], 'offline'), '실행 환경: 작업 PC에 연결할 수 없어요');
  assert.match(app, /shellEnvLine\(envLabels, envPhase\)/);
  assert.match(app, /controlRoom:envs/);
});

test('shell tokens, fixed rail, and phone wrap are in the stylesheet', () => {
  for (const token of ['#0b0d10', '#12151a', '#232830', '#7dd3c0', '#e8c170', 'Noto Sans KR', '14px']) {
    assert.ok(css.includes(token), `missing ${token}`);
  }
  assert.match(css, /\.rail\s*\{[^}]*width:\s*220px/);
  assert.match(css, /\.rail-link\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /@media\s*\(\s*max-width:\s*720px\s*\)[\s\S]*?\.shell\s*\{[^}]*flex-direction:\s*column/);
  const railCss = css.slice(css.indexOf('.rail-conn'));
  const railBlock = railCss.slice(0, railCss.indexOf('.shell-col'));
  assert.equal(railBlock.includes('var(--danger)'), false);
  assert.equal(railBlock.includes('color: red'), false);
  assert.match(app, /AI 팀 자동 실행/);
  assert.match(app, /고급 \(개발용\)/);
  assert.match(app, /<h4>개발 도구<\/h4>/);
});
