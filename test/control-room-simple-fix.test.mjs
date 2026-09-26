/* 관제실 상태 한 줄: 불러오는 중에도 문장이 있고, 알아서 진행되는 보류는 고를 것에서 뺀다. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  controlRoomFounderHolds,
  controlRoomLoadingStatus,
  controlRoomStatusSentence,
} from '../dist/server/shared/controlRoomSimple.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Gates and a hold with no wait, versus holds that proceed in 5 minutes (no start clock). */
const BOARD = {
  lanes: [
    {
      id: 'agent-relay',
      project: 'agent-relay',
      current: { stage: 2, title: '영수증 화면 쉽게', worker: 'codex', taskId: 'T-1' },
      holds: [
        { taskId: 'auto-a', reason: 'QA FAILED', waitMin: 5, explain: { sentence: '5분 뒤 다시 해요' } },
        { taskId: 'auto-b', reason: 'timeout', waitMin: 5, heldSeen: Date.parse('2026-09-26T17:00:00+09:00'), explain: { sentence: '알아서 다시 해요' } },
        { taskId: 'need', title: '범위 고르기', reason: 'SCOPE', explain: { sentence: '범위를 골라 주세요' } },
        { taskId: 'look', reason: '직접', waitMin: 5, explain: { sentence: '제가 볼게요', recommended: '내가 직접 볼게요' } },
      ],
    },
    {
      id: 'juplan',
      project: 'juplan',
      humanGate: { gateId: 'G-1', ask: '이대로 반영할까요?' },
    },
    {
      id: 'actl',
      project: 'actl',
      founderGate: { id: 'FG-1', ask: '시험 PC를 켤까요?' },
    },
  ],
};

const AUTO_ONLY = {
  lanes: [{
    project: 'actl',
    current: { stage: 2, title: '명령 결과를 한 줄로', worker: 'codex' },
    holds: [{ taskId: 'auto-only', reason: 'slow', waitMin: 5, explain: { sentence: '곧 다시 해요' } }],
  }],
};

async function loadCard() {
  const { build } = await import('esbuild');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { createRequire } = await import('node:module');
  const out = await build({
    entryPoints: [path.join(root, 'src/frontend/controlRoom.tsx')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  });
  const dir = await mkdtemp(`${tmpdir()}/cr-simple-fix-`);
  try {
    const file = path.join(dir, 'controlRoom.cjs');
    await writeFile(file, out.outputFiles[0].text);
    return createRequire(file)(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function visibleText(html) {
  return html.replace(/<details>.*?<\/details>/gs, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

test('choose count is gates and holds with no auto-proceed, not 5-minute holds', () => {
  const status = controlRoomStatusSentence(BOARD);
  assert.equal(status.tone, 'amber');
  assert.equal(status.text, '대표님이 고를 것 4개');
  assert.equal(status.chooseCount, 4);
  assert.equal(status.actionLabel, '고르기');
  assert.equal(status.autoCount, 2);
  assert.equal(status.autoLine, '자동으로 다시 하는 중 2개 · 원하면 골라 주세요');

  const titles = controlRoomFounderHolds(BOARD).map((item) => item.title);
  assert.deepEqual(titles, ['범위 고르기', '제가 볼게요', '결정이 필요해요', '결정이 필요해요']);
  assert.equal(titles.includes('5분 뒤 다시 해요'), false);

  const onlyAuto = controlRoomStatusSentence(AUTO_ONLY);
  assert.equal(onlyAuto.tone, 'teal');
  assert.equal(onlyAuto.chooseCount, 0);
  assert.equal(onlyAuto.actionLabel, '');
  assert.equal(onlyAuto.text, '지금 1개 프로젝트가 일하는 중 · 대표님이 하실 일 없어요');
  assert.equal(onlyAuto.autoLine, '자동으로 다시 하는 중 1개 · 원하면 골라 주세요');
});

test('loading status is a sentence, and the card is never an empty block', async () => {
  const loading = controlRoomLoadingStatus();
  assert.equal(loading.text, '상태를 확인하고 있어요');
  assert.equal(loading.actionLabel, '');
  assert.equal(loading.autoLine, '');
  assert.notEqual(loading.text.trim(), '');

  const room = fs.readFileSync(path.join(root, 'src/frontend/controlRoom.tsx'), 'utf8');
  assert.match(room, /<SimpleStatusCard /);
  assert.doesNotMatch(room, /\{board && <SimpleStatusCard/);
  assert.doesNotMatch(room, /작업 PC에서 불러오는 중/);

  const { SimpleStatusCard } = await loadCard();
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const loadingHtml = renderToStaticMarkup(React.createElement(SimpleStatusCard, {
    board: null,
    loading: true,
    note: '',
    onChoose: () => {},
  }));
  assert.match(loadingHtml, /상태를 확인하고 있어요/);
  assert.doesNotMatch(loadingHtml, /control-empty|대표님이 고를 것/);
  assert.notEqual(visibleText(loadingHtml), '');

  const boardHtml = renderToStaticMarkup(React.createElement(SimpleStatusCard, {
    board: BOARD,
    loading: false,
    note: '',
    onChoose: () => {},
  }));
  const boardText = visibleText(boardHtml);
  assert.match(boardText, /대표님이 고를 것 4개/);
  assert.match(boardText, /자동으로 다시 하는 중 2개 · 원하면 골라 주세요/);
  assert.match(boardHtml, /cr-simple-auto muted/);
  assert.doesNotMatch(boardText, /QA FAILED|T-1|G-1|HOLD|2026-/);
  assert.notEqual(boardText, '');
});
