import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { worklogRows, worklogVerdictLine } from '../dist/server/shared/worklog.js';

// night-board.py: finished tasks live on the root done array, QA text on lane.channel starts with ACCEPT:
const board = {
  done: [
    { lane: 'agent-relay', taskId: 'AGENTRELAY-OLD', title: '어제 고친 일', at: new Date(2026, 8, 25, 23, 0).toISOString() },
    { lane: 'agent-relay', taskId: 'AGENTRELAY-A', title: '영수증 화면 쉽게', at: new Date(2026, 8, 26, 9, 5).toISOString() },
    { lane: 'agent-relay', taskId: 'AGENTRELAY-B', title: '작업 기록 자동으로', at: new Date(2026, 8, 26, 14, 10).toISOString() },
    { lane: 'juplan', taskId: 'JUPLAN-7', title: '계획 저장 고치기', at: new Date(2026, 8, 26, 11, 0).toISOString() },
  ],
  lanes: [
    {
      id: 'agent-relay',
      channel: [
        { taskId: 'AGENTRELAY-A', kind: 'scope', text: '영수증 화면을 쉬운 말로 바꿔 주세요' },
        { taskId: 'AGENTRELAY-A', kind: 'result', text: '영수증 화면 글자를 쉬운 말로 바꿨어요' },
        { taskId: 'AGENTRELAY-A', kind: 'qa', text: 'ACCEPT: 화면 글자가 쉬워졌어요' },
        { taskId: 'AGENTRELAY-B', kind: 'scope', text: 'Add an automatic list at the top of the work log.' },
        { taskId: 'AGENTRELAY-B', kind: 'result', text: 'RESULT_PACKET: {"status":"IMPLEMENTED"}' },
        { taskId: 'AGENTRELAY-B', kind: 'qa', text: 'REQUEST_CHANGES: fix copy' },
      ],
    },
    { id: 'juplan', channel: [] },
  ],
};

test('rows for the chosen date only, newest first', () => {
  const rows = worklogRows(board, '2026-09-26');
  assert.deepEqual(rows.map(r => r.line), [
    'agent-relay · 작업 기록 자동으로 · 오후 2:10',
    'juplan · 계획 저장 고치기 · 오전 11:00',
    'agent-relay · 영수증 화면 쉽게 · 오전 9:05',
  ]);
  assert.deepEqual(worklogRows(board, '2026-09-25').map(r => r.line), ['agent-relay · 어제 고친 일 · 오후 11:00']);
  assert.deepEqual(worklogRows(board, '2026-09-24'), []);
  assert.deepEqual(worklogRows(null, '2026-09-26'), []);
});

test('지시 → 결과 in plain Korean, raw only under 원문', () => {
  const [b, j, a] = worklogRows(board, '2026-09-26');
  assert.equal(a.ask, '영수증 화면을 쉬운 말로 바꿔 주세요');
  assert.equal(a.result, '영수증 화면 글자를 쉬운 말로 바꿨어요 · 검사 통과');
  assert.equal(b.ask, "'작업 기록 자동으로' 작업을 맡겼어요");
  assert.equal(b.result, '작업을 끝냈어요 · 검사에서 고칠 점이 나왔어요');
  assert.equal(j.result, '작업을 끝냈어요');
  assert.match(b.raw, /AGENTRELAY-B/);
  assert.match(b.raw, /Add an automatic list/);
  for (const row of [a, b, j]) {
    const surface = `${row.line}\n${row.ask}\n${row.result}\n${row.copyText}`;
    assert.doesNotMatch(surface, /AGENTRELAY-|JUPLAN-|RESULT_PACKET|REQUEST_CHANGES|APPROVE|ACCEPT|\d{4}-\d{2}-\d{2}T/);
  }
  assert.equal(a.copyText, `${a.line}\n지시: ${a.ask}\n결과: ${a.result}`);
});

test('verdict words map to plain lines', () => {
  assert.equal(worklogVerdictLine('APPROVE'), '검사 통과');
  assert.equal(worklogVerdictLine('ACCEPT'), '검사 통과');
  assert.equal(worklogVerdictLine('ACCEPT: 화면 글자가 쉬워졌어요'), '검사 통과');
  assert.equal(worklogVerdictLine('request_changes'), '검사에서 고칠 점이 나왔어요');
  assert.equal(worklogVerdictLine('뭔지 모름'), '');
});

test('root done fills the list even when lanes have no done array', () => {
  const onlyRoot = {
    done: [{ lane: 'agent-relay', taskId: 'AGENTRELAY-A', title: '보드에 끝난 일', at: new Date(2026, 8, 26, 8, 30).toISOString() }],
    lanes: [{ id: 'agent-relay', channel: [{ taskId: 'AGENTRELAY-A', kind: 'qa', text: 'ACCEPT: 확인했어요' }] }],
  };
  const [row] = worklogRows(onlyRoot, '2026-09-26');
  assert.equal(row.line, 'agent-relay · 보드에 끝난 일 · 오전 8:30');
  assert.equal(row.result, '작업을 끝냈어요 · 검사 통과');
  assert.doesNotMatch(`${row.line}\n${row.result}`, /ACCEPT|AGENTRELAY-/);
  const onlyLanes = {
    lanes: [{ id: 'agent-relay', done: [{ taskId: 'AGENTRELAY-Z', title: '레인에만 있는 일', at: new Date(2026, 8, 26, 8, 0).toISOString() }] }],
  };
  assert.equal(worklogRows(onlyLanes, '2026-09-26')[0].line, 'agent-relay · 레인에만 있는 일 · 오전 8:00');
});

test('작업 기록 shows the auto list first and folds the old notebook', async () => {
  const app = await readFile(new URL('../src/frontend/App.tsx', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../src/frontend/worklog.tsx', import.meta.url), 'utf8');
  const auto = app.indexOf('<AutoWorklog />');
  const manual = app.indexOf('<summary>직접 적는 기록 (예전 방식)</summary>');
  assert.ok(auto > 0 && manual > auto && app.indexOf('<RecordLog', manual) > manual);
  assert.match(ui, /WORKLOG_REFRESH_MS = 30_000/);
  assert.match(ui, /복사했어요 ✓/);
  assert.match(ui, /원문 보기/);
  assert.match(ui, /지시 → 결과/);
});
