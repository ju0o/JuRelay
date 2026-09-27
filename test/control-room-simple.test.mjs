/* 관제실 첫 화면: 상태 한 줄, 프로젝트 한 줄, 대표님이 고를 보류만.
   숫자는 보드 픽스처에서 만들고, 알아서 진행되는 보류는 빼 둔다. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTROL_ROOM_HOLD_PREVIEW,
  controlRoomFounderHoldPreview,
  controlRoomFounderHolds,
  controlRoomSimpleRows,
  controlRoomStatusSentence,
} from '../dist/server/shared/controlRoomSimple.js';

const NOW = Date.parse('2026-09-26T17:00:00+09:00');

const BOARD = {
  lanes: [
    {
      id: 'agent-relay',
      project: 'agent-relay',
      current: {
        stage: 2,
        title: '영수증 화면 쉽게',
        worker: 'codex',
        taskId: 'T-77',
        startedAt: new Date(NOW - 12 * 60000).toISOString(),
      },
      workerChain: ['codex'],
      holds: [
        {
          taskId: 'hold-auto',
          reason: 'QA FAILED',
          waitMin: 8,
          heldSeen: NOW - 60_000,
          explain: { sentence: '곧 알아서 진행해요' },
        },
        {
          taskId: 'hold-need',
          title: '범위 고르기',
          reason: 'SCOPE missing',
          explain: { sentence: '범위를 골라 주세요' },
        },
        {
          taskId: 'hold-skip',
          reason: 'skip me',
          choice: 'skip',
          explain: { sentence: '안 보임' },
        },
        {
          taskId: 'hold-chosen',
          title: '이미 고른 일',
          reason: 'done',
          choice: '다시 시도',
          explain: { sentence: '이미 골랐어요' },
        },
      ],
    },
    {
      id: 'actl',
      project: 'actl',
      workerChain: ['claude'],
    },
    {
      id: 'juplan',
      project: 'juplan',
      humanGate: { gateId: 'G-1', ask: '이대로 반영할까요?' },
    },
    {
      id: 'juceipt',
      project: 'juceipt',
      holds: [{ taskId: 'h3', reason: 'x', explain: { sentence: '세 번째 고르기' } }],
    },
    {
      id: 'jutell',
      project: 'jutell',
      holds: [{
        taskId: 'h4',
        reason: 'y',
        waitMin: 5,
        heldSeen: NOW,
        explain: { sentence: '제가 볼 일', recommended: '내가 직접 볼게요' },
      }],
    },
  ],
};

function surface(items) {
  return items.map((item) => `${item.projectName} ${item.title} ${item.sentence}`).join('\n');
}

test('status sentence is teal when nothing needs the Founder', () => {
  const clear = controlRoomStatusSentence({
    lanes: [{ project: 'actl', current: { stage: 2, title: '명령 결과를 한 줄로', worker: 'codex' } }],
  });
  assert.equal(clear.tone, 'teal');
  assert.equal(clear.text, '지금 1개 프로젝트가 일하는 중 · 대표님이 하실 일 없어요');
  assert.equal(clear.actionLabel, '');
  assert.equal(clear.chooseCount, 0);

  const empty = controlRoomStatusSentence({ lanes: [] });
  assert.equal(empty.text, '지금 0개 프로젝트가 일하는 중 · 대표님이 하실 일 없어요');
  assert.equal(empty.workingProjects, 0);
  assert.deepEqual(controlRoomSimpleRows(null), []);
  assert.deepEqual(controlRoomFounderHolds(null), []);
});

test('rows are one line each, and only founder holds are counted', () => {
  const status = controlRoomStatusSentence(BOARD);
  assert.equal(status.tone, 'amber');
  assert.equal(status.text, '대표님이 고를 것 4개');
  assert.equal(status.actionLabel, '고르기');
  assert.equal(status.workingProjects, 1);
  assert.equal(status.chooseCount, 4);

  const rows = controlRoomSimpleRows(BOARD, NOW);
  assert.deepEqual(rows.map((row) => [row.name, row.state, row.tone]), [
    ['agent-relay', '확인 필요', 'amber'],
    ['actl', '쉬는 중', 'muted'],
    ['juplan', '확인 필요', 'amber'],
    ['juceipt', '확인 필요', 'amber'],
    ['jutell', '확인 필요', 'amber'],
  ]);
  assert.equal(rows[0].doing, "Codex가 '영수증 화면 쉽게' 만드는 중 · 12분째");
  assert.equal(rows[1].doing, '지금 하는 일이 없어요');
  assert.doesNotMatch(rows.map((row) => `${row.name} ${row.doing} ${row.state}`).join('\n'), /T-77|HOLD|QUEUED|SCOPE|2026-/);

  const holds = controlRoomFounderHolds(BOARD);
  assert.deepEqual(holds.map((item) => item.title), [
    '범위 고르기',
    '결정이 필요해요',
    '세 번째 고르기',
    '제가 볼 일',
  ]);
  assert.equal(holds.length, 4);
  assert.equal(surface(holds).includes('곧 알아서 진행해요'), false);
  assert.equal(surface(holds).includes('안 보임'), false);
  assert.equal(surface(holds).includes('이미 골랐어요'), false);
  assert.match(holds[1].sentence, /이대로 반영할까요/);
  assert.match(holds[0].raw, /hold-need/);
  assert.doesNotMatch(surface(holds), /hold-need|G-1|SCOPE|QA FAILED|2026-/);

  const preview = controlRoomFounderHoldPreview(holds);
  assert.equal(CONTROL_ROOM_HOLD_PREVIEW, 3);
  assert.equal(preview.shown.length, 3);
  assert.equal(preview.hidden, 1);
  assert.equal(controlRoomFounderHoldPreview(holds, true).hidden, 0);
  assert.equal(controlRoomFounderHoldPreview(holds.slice(0, 2)).hidden, 0);
});
