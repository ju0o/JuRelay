/* 승인 규칙 · 계획 · 작업 기록 — 위쪽 한 줄만 두고, 안쪽 제목과 닫기는 없다. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'src/frontend/App.tsx'), 'utf8');
const planSrc = fs.readFileSync(path.join(root, 'src/frontend/planStudio.tsx'), 'utf8');
const approvalSrc = fs.readFileSync(path.join(root, 'src/frontend/approvals.tsx'), 'utf8');
const copySrc = fs.readFileSync(path.join(root, 'src/frontend/components.tsx'), 'utf8');

/**
 * @param {string} src
 * @param {string} start
 * @param {string} end
 */
function sliceBetween(src, start, end) {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from + start.length);
  assert.ok(from !== -1 && to !== -1, `missing ${start} .. ${end}`);
  return src.slice(from, to);
}

const approvals = sliceBetween(app, 'function ApprovalsPanel', '// Plan Studio는 전용 뷰');
const plan = sliceBetween(planSrc, '<main className="control-room plan-studio">', '</main>');
const records = sliceBetween(app, '<AutoWorklog />', '{showQuickDf');
const topbar = sliceBetween(app, 'className="topbar-row"', 'className="shell-main"');

/** @param {string} surface @param {string} name */
function assertNoSecondTitle(surface, name) {
  assert.equal(surface.includes('control-room-head'), false, `${name} inner head`);
  assert.equal(surface.includes('record-head'), false, `${name} record head`);
  assert.doesNotMatch(surface, /<h1[\s>]/, `${name} second h1`);
  assert.doesNotMatch(surface, /<h2[\s>]/, `${name} second h2`);
  assert.equal(surface.includes('>닫기<'), false, `${name} 닫기 button`);
}

test('승인 규칙, 계획, 작업 기록 render no second title and no 닫기', () => {
  assertNoSecondTitle(approvals, '승인 규칙');
  assertNoSecondTitle(plan, '계획');
  assertNoSecondTitle(records, '작업 기록');
  assertNoSecondTitle(approvalSrc, 'approvals.tsx');

  assert.match(topbar, /<h1>\{headerTitle\}<\/h1>/);
  assert.match(topbar, /<p className="shell-lead">\{pageCopy\.lead\}<\/p>/);
  assert.doesNotMatch(topbar, /<h2[\s>]/);
  assert.equal(topbar.includes('>닫기<'), false);

  assert.match(copySrc, /title: '승인 규칙', lead: '알아서 진행해도 되는 규칙을 여기서 확인해요\.'/);
  assert.match(copySrc, /title: '계획', lead: '목표와 작업 순서를 보고, 이대로 진행할지 정해 주세요\.'/);
  assert.match(copySrc, /title: '작업 기록', lead: 'AI에게 준 지시와 받은 결과를 날짜별로 볼 수 있어요\.'/);
  assert.equal(app.includes('알아서 진행해도 되는 규칙이에요. 고치거나, 아래에 새 규칙을 추가해 주세요.'), false);
  assert.equal(planSrc.includes('목표와 작업 순서를 보고, PM에게 바꿔 달라고 말할 수 있어요.'), false);
  assert.equal(app.includes('작업 기록 — AI에게 준 지시와 받은 결과를 날짜별로 모아 둬요'), false);
});
