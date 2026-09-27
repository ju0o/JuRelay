/* Lovable 관제실 하단 — AI 배정, 토큰 감지, 오늘 끝난 일.
   칩·줄·숫자는 보드와 토큰 응답에서 만들고, 샘플 이름은 넣지 않는다. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const room = fs.readFileSync(path.join(root, 'src/frontend/controlRoom.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/frontend/style.css'), 'utf8');

async function loadHelpers() {
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
  const dir = await mkdtemp(`${tmpdir()}/cr-bottom-`);
  try {
    const file = path.join(dir, 'controlRoom.cjs');
    await writeFile(file, out.outputFiles[0].text);
    return createRequire(file)(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const {
  aiAssignChips,
  cooldownPhrase,
  relativeAgo,
  todayDoneLines,
  tokenFailureLines,
  AiAssignCard,
  TodayCard,
  TokenDetectBody,
} = await loadHelpers();

const surface = (html) => html.replace(/<details>.*?<\/details>/gs, '').replace(/<[^>]+>/g, ' ');

const NOW = Date.parse('2026-09-26T17:00:00+09:00');

const BOARD = {
  lanes: [
    {
      project: 'agent-relay',
      current: { stage: 2, title: '영수증 화면 쉽게', worker: 'codex', taskId: 'T-77' },
      workerChain: ['codex'],
      qaChain: ['claude-team'],
    },
  ],
  routing: {
    pool: {
      subscribed: ['codex', 'claude-team', 'claude-pro'],
      free: ['opencode'],
      note: 'UNMAPPED sample sentence must stay off the chips',
    },
    cooling: { opencode: new Date(NOW + 12 * 60000).toISOString() },
    unavailable: ['cline'],
  },
};

test('AI chips use friendly names and plain states from the board', () => {
  const chips = aiAssignChips(BOARD, NOW);
  assert.deepEqual(chips.map((chip) => [chip.name, chip.status, chip.tone]), [
    ['Codex', '일하는 중', 'teal'],
    ['Claude Team', '쉬는 중', 'muted'],
    ['Claude Pro', '쉬는 중', 'muted'],
    ['OpenCode', '잠시 쉬게 함 · 12분 뒤 다시', 'amber'],
    ['Cline', '준비 안 됨', 'amber'],
  ]);
  assert.equal(chips[0].detail, 'agent-relay · 영수증 화면 쉽게');
  assert.equal(chips[1].detail, '');
  assert.match(chips[3].raw, /opencode/);
  assert.doesNotMatch(chips.map((chip) => `${chip.name} ${chip.status} ${chip.detail}`).join('\n'), /UNMAPPED|T-77|HOLD|QUEUED|opencode|cline/);

  assert.deepEqual(aiAssignChips(null), []);
  assert.deepEqual(aiAssignChips({ routing: { pool: true } }), []);
  assert.deepEqual(aiAssignChips({ lanes: [], routing: { pool: { note: 'not an AI' } } }), []);
});

test('cooldown minutes come from routing, and a finished rest is not still cooling', () => {
  assert.equal(cooldownPhrase(new Date(NOW + 12 * 60000).toISOString(), NOW), '잠시 쉬게 함 · 12분 뒤 다시');
  assert.equal(cooldownPhrase(new Date(NOW + 60 * 60000).toISOString(), NOW), '잠시 쉬게 함 · 1시간 뒤 다시');
  assert.equal(cooldownPhrase(new Date(NOW + 90 * 60000).toISOString(), NOW), '잠시 쉬게 함 · 1시간 30분 뒤 다시');
  assert.equal(cooldownPhrase('soon', NOW), '잠시 쉬게 함');
  assert.equal(cooldownPhrase(new Date(NOW - 60000).toISOString(), NOW), null);

  const local = new Date(2026, 8, 26, 17, 0, 0);
  assert.equal(cooldownPhrase('17:12', local.getTime()), '잠시 쉬게 함 · 12분 뒤 다시');

  const resting = aiAssignChips({
    routing: {
      pool: { free: ['opencode'] },
      cooling: [{ runtime: 'opencode', until: new Date(NOW - 60000).toISOString() }],
    },
  }, NOW);
  assert.equal(resting[0].status, '쉬는 중');
  assert.equal(resting[0].tone, 'muted');

  const busy = aiAssignChips({
    lanes: [{ project: 'actl', current: { stage: 3, title: '검사 중', qa: 'codex' }, qaChain: ['codex'] }],
    routing: { cooling: { codex: new Date(NOW + 5 * 60000).toISOString() } },
  }, NOW);
  assert.equal(busy[0].name, 'Codex');
  assert.equal(busy[0].status, '일하는 중');
  assert.equal(busy[0].tone, 'teal');

  const paused = aiAssignChips({ routing: { pausedRuntimes: { grok: '402 balance exhausted' } } }, NOW);
  assert.equal(paused[0].name, 'Grok');
  assert.equal(paused[0].status, '준비 안 됨');
  assert.equal(paused[0].tone, 'amber');
  assert.equal(paused[0].detail, '');
  assert.doesNotMatch(paused[0].status, /402|balance/);
});

test('today rows are project, Korean title, and a relative time', () => {
  const lines = todayDoneLines({
    lanes: [{
      project: 'actl',
      todayDone: [
        { taskId: 'T-9', title: '긴 결과 줄이기', finishedAt: new Date(NOW - 6 * 60000).toISOString(), scope: 'logs' },
        { taskId: 'T-1', title: '방금 끝난 일', finishedAt: new Date(NOW - 20000).toISOString() },
        { taskId: 'T-0', title: '시각 없는 일' },
      ],
    }],
  }, NOW);
  assert.equal(lines[0].title, '방금 끝난 일');
  assert.equal(lines.find((line) => line.title === '긴 결과 줄이기').project, 'actl');
  assert.equal(lines.find((line) => line.title === '긴 결과 줄이기').ago, '6분 전');
  assert.equal(lines.find((line) => line.title === '방금 끝난 일').ago, '방금');
  assert.equal(lines.find((line) => line.title === '시각 없는 일').ago, '');
  assert.equal(relativeAgo('not-a-date', NOW), '');
  assert.doesNotMatch(lines.map((line) => line.ago).join(' '), /T\d|2026-/);
  assert.deepEqual(todayDoneLines(null, NOW), []);
});

test('a failed token load is three Korean lines, and offline is not on-but-failed', () => {
  const offline = tokenFailureLines('작업 PC(ASUS)에 연결할 수 없습니다.');
  assert.match(offline[0], /가져오지 못했어요/);
  assert.match(offline[1], /꺼져 있거나 네트워크가 끊긴/);
  assert.match(offline[2], /다시 시도/);
  assert.doesNotMatch(offline.join('\n'), /ASUS|연결할 수 없습니다/);

  const remote = tokenFailureLines('작업 PC는 켜져 있는데 요청을 처리하다 오류가 났어요.');
  assert.match(remote[1], /켜져 있는데/);
  assert.doesNotMatch(remote.join('\n'), /오류가 났어요/);

  const other = tokenFailureLines('ECONNRESET /tmp/secret.json');
  assert.doesNotMatch(other.join('\n'), /ECONNRESET|\/tmp|secret/);
  assert.match(other[2], /원문 보기/);
});

test('the bottom renders chips, amber findings, and a divided today list from values', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');

  const chipsHtml = renderToStaticMarkup(React.createElement(AiAssignCard, { board: BOARD, now: NOW }));
  const chipsText = surface(chipsHtml);
  assert.match(chipsHtml, /class="cr-ai-chip teal"/);
  assert.match(chipsHtml, /class="cr-ai-chip amber"/);
  assert.match(chipsHtml, /class="cr-ai-chip muted"/);
  assert.match(chipsText, /Codex/);
  assert.match(chipsText, /일하는 중/);
  assert.match(chipsText, /잠시 쉬게 함 · 12분 뒤 다시/);
  assert.match(chipsText, /준비 안 됨/);
  assert.doesNotMatch(chipsText, /opencode|cline|T-77|UNMAPPED|2026-/);
  assert.match(chipsHtml, /<details><summary>원문 보기<\/summary>.*opencode/s);

  const emptyHtml = renderToStaticMarkup(React.createElement(AiAssignCard, { board: null, now: NOW }));
  assert.match(surface(emptyHtml), /배정된 AI가 아직 없어요/);

  const tokenHtml = renderToStaticMarkup(React.createElement(TokenDetectBody, {
    view: {
      summary: '살펴볼 토큰 사용이 1건 있어요.',
      fresh: 26_600_000,
      cache: 1_250_000_000,
      projects: [{ id: 'agent-relay', label: 'Agent Relay', fresh: 26_600_000, cache: 10 }],
      findings: [{
        kind: 'spike',
        severity: 'warn',
        text: '토큰이 갑자기 늘었어요',
        why: '10분 만에 5배',
        action: '작업을 멈춰 보세요',
        raw: { taskId: 'T-1', runtime: 'codex' },
      }],
    },
    rawJson: '{"taskId":"T-1"}',
  }));
  const tokenText = surface(tokenHtml);
  assert.match(tokenText, /살펴볼 토큰 사용이 1건 있어요/);
  assert.match(tokenText, /2,660만/);
  assert.match(tokenText, /12억 5,000만/);
  assert.match(tokenHtml, /class="cr-token-num"/);
  assert.match(tokenHtml, /class="cr-token-finding"/);
  assert.match(tokenText, /토큰이 갑자기 늘었어요/);
  assert.match(tokenText, /왜: 10분 만에 5배/);
  assert.match(tokenText, /할 일: 작업을 멈춰 보세요/);
  assert.doesNotMatch(tokenText, /T-1|codex/);
  assert.match(tokenHtml, /<details><summary>원문 보기<\/summary>.*T-1/s);

  const todayHtml = renderToStaticMarkup(React.createElement(TodayCard, {
    board: {
      lanes: [{
        project: 'juceipt',
        todayDone: [{ taskId: 'T-3', title: '영수증 날짜 확인', finishedAt: new Date(NOW - 18 * 60000).toISOString() }],
      }],
    },
    now: NOW,
  }));
  const todayText = surface(todayHtml);
  assert.match(todayText, /juceipt/);
  assert.match(todayText, /영수증 날짜 확인/);
  assert.match(todayText, /18분 전/);
  assert.match(todayHtml, /<strong>juceipt<\/strong>/);
  assert.doesNotMatch(todayText, /T-3|2026-/);
  assert.match(todayHtml, /<details><summary>원문 보기<\/summary>.*T-3/s);
});

test('bottom sits under the holds, and the environment panel is off this screen', () => {
  const lane = room.indexOf('<LaneView');
  const bottom = room.indexOf('className="cr-bottom"');
  const block = room.slice(bottom);
  assert.ok(lane > 0 && bottom > lane, 'AI 배정 block must follow the lane, where the holds are');
  assert.ok(block.indexOf('<AiAssignCard') < block.indexOf('<TokensCard'));
  assert.ok(block.indexOf('<TokensCard') < block.indexOf('<TodayCard'));
  assert.match(room, /aria-label="AI 배정"/);
  assert.match(room, /aria-label="토큰 감지"/);
  assert.match(room, /aria-label="오늘 끝난 일"/);
  assert.match(room, /op: 'controlRoom:tokens'/);
  assert.doesNotMatch(room, /<EnvsCard[\s/>]/);
  assert.doesNotMatch(room, /2,660만|12\.5억|UNMAPPED/);
  assert.doesNotMatch(room, /window\.alert|window\.confirm|window\.prompt/);
});

test('bottom look is dark, amber for a finding or a rest, and wraps on a phone', () => {
  const block = css.slice(css.indexOf('/* ── 관제실 하단'), css.indexOf('/* ── Inline confirm'));
  for (const token of ['#0b0d10', '#12151a', '#232830', '#7dd3c0', '#e8c170', '#8b93a1', 'Noto Sans KR', 'JetBrains Mono', '16px', '44px', '14px', '0.38s', 'fade-slide-in']) {
    assert.ok(block.includes(token), `missing ${token}`);
  }
  assert.match(block, /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
  assert.match(block, /@media\s*\(\s*max-width:\s*720px\s*\)/);
  assert.match(block, /\.cr-ai-chip\.teal[\s\S]*#7dd3c0/);
  assert.match(block, /\.cr-ai-chip\.amber[\s\S]*#e8c170/);
  assert.match(block, /\.cr-token-finding[\s\S]*#e8c170/);
  assert.match(block, /\.cr-token-ok[\s\S]*#7dd3c0/);
  assert.doesNotMatch(block, /#e06c5f|color:\s*red|--danger/);
});
