/* Lovable 관제실 카드 — 프로젝트 카드와 멈춘 작업 카드.
   문장·단계는 보드 값에서 만들고, 샘플 숫자는 넣지 않는다. */
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
  const dir = await mkdtemp(`${tmpdir()}/cr-cards-`);
  try {
    const file = path.join(dir, 'controlRoom.cjs');
    await writeFile(file, out.outputFiles[0].text);
    return createRequire(file)(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const {
  STEPS,
  liveStepPills,
  verifyChipTone,
  projectPauseView,
  holdStepPills,
  holdOptionsRecommendedFirst,
  holdFounderAutoLine,
  pauseFailureLines,
  LiveStatusCard,
} = await loadHelpers();

const surface = (html) => html.replace(/<details>.*?<\/details>/gs, '').replace(/<[^>]+>/g, ' ');

test('five-step pills come from how far the lane has gone', () => {
  assert.deepEqual(STEPS, ['계획', '만들기', '검사', '시험', '반영']);
  assert.deepEqual(liveStepPills(2, true).map((pill) => [pill.name, pill.state, pill.mark]), [
    ['계획', 'done', '✓'],
    ['만들기', 'done', '✓'],
    ['검사', 'now', '●'],
    ['시험', 'wait', '○'],
    ['반영', 'wait', '○'],
  ]);
  assert.deepEqual(liveStepPills(5, true).map((pill) => pill.state), ['done', 'done', 'done', 'done', 'done']);
  assert.deepEqual(liveStepPills(0, false).map((pill) => pill.mark), ['○', '○', '○', '○', '○']);
  assert.deepEqual(verifyChipTone('확인됨'), 'teal');
  assert.deepEqual(verifyChipTone('일부 확인'), 'amber');
  assert.deepEqual(verifyChipTone('확인하지 못함'), 'muted');
});

test('pause is an explicit stop, and the safe confirm comes first', () => {
  assert.deepEqual(projectPauseView({ project: 'agent-relay', current: { title: '영수증 화면 쉽게' } }), {
    paused: false,
    stateLabel: '',
    buttonLabel: '이 프로젝트 잠시 멈춤',
    safeLabel: '계속 진행',
    confirmLabel: '잠시 멈춤',
  });
  assert.equal(projectPauseView({ paused: true, current: {} }).buttonLabel, '다시 시작');
  assert.equal(projectPauseView({ paused: true }).stateLabel, '잠시 멈춤');
  assert.equal(projectPauseView({ enabled: false, current: {} }).paused, true);
  assert.equal(projectPauseView({ current: { stage: 'PAUSED' } }).paused, true);
  assert.equal(projectPauseView({ blocker: 'SCOPE', holds: [{ reason: '멈춤' }] }).paused, false);

  const actions = room.slice(room.indexOf('className="cr-pause-actions"'));
  assert.ok(actions.indexOf('계속 진행') >= 0 && actions.indexOf('계속 진행') < actions.indexOf('잠시 멈춤'));
  assert.match(room, /op: 'controlRoom:pause'/);
  assert.match(room, /op: 'controlRoom:resume'/);
  assert.match(room, /잠시 멈췄어요 ✓/);
  assert.match(room, /다시 시작했어요 ✓/);
});

test('hold pills, recommended-first options, and the local auto line', () => {
  assert.deepEqual(holdStepPills('QA').map((pill) => [pill.name, pill.mark]), [
    ['계획', '✓'],
    ['만들기', '✓'],
    ['검사', '!'],
    ['시험', '○'],
    ['반영', '○'],
  ]);
  assert.deepEqual(holdStepPills('???').map((pill) => pill.state), ['wait', 'wait', 'wait', 'wait', 'wait']);
  const ordered = holdOptionsRecommendedFirst(['다시 시도', '범위를 좁혀 진행', '건너뛰기'], 1);
  assert.deepEqual(ordered.map((row) => row.option), ['범위를 좁혀 진행', '다시 시도', '건너뛰기']);
  assert.deepEqual(ordered.map((row) => row.index), [1, 0, 2]);
  assert.equal(ordered[0].recommended, true);

  const start = new Date(2026, 0, 2, 9, 50, 0);
  assert.equal(holdFounderAutoLine(start.getTime(), 30), '안 고르면 10:20에 추천대로 진행해요');
  assert.equal(holdFounderAutoLine(null, 30), '');
  assert.equal(holdFounderAutoLine(start.getTime(), 0), '');
  assert.match(room, /holdFounderAutoLine/);
  assert.match(room, /holdAutoProceedText/);
  assert.match(room, /op: 'controlRoom:holdChoose'/);
  assert.match(room, /선택했어요: \{savedLabel\} · 곧 다시 설계해요/);
  assert.match(room, /className="btn primary cr-hold-go"/);
});

test('a failed pause is three Korean lines, and offline is not the same as on-but-failed', () => {
  const offline = pauseFailureLines('작업 PC(ASUS)에 연결할 수 없습니다.');
  assert.match(offline[0], /잠시 멈추지 못했어요/);
  assert.match(offline[1], /꺼져 있거나 네트워크가 끊긴/);
  assert.match(offline[2], /다시 시도/);
  assert.doesNotMatch(offline.join('\n'), /ASUS|연결할 수 없습니다/);

  const remote = pauseFailureLines('작업 PC는 켜져 있는데 요청을 처리하다 오류가 났어요.');
  assert.match(remote[1], /켜져 있는데/);
  assert.doesNotMatch(remote.join('\n'), /오류가 났어요/);

  const other = pauseFailureLines('ECONNRESET /tmp/secret.json');
  assert.doesNotMatch(other.join('\n'), /ECONNRESET|\/tmp|secret/);
  assert.match(other[2], /원문 보기/);
});

test('the live card renders pills, a chip, and folded original text from the lane', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const now = Date.parse('2026-09-26T12:00:00+09:00');
  const lane = {
    project: 'agent-relay',
    current: { stage: 3, taskId: 'T-77', title: '영수증 화면 쉽게', startedAt: new Date(now - 12 * 60000).toISOString() },
    workerChain: ['codex'],
    todayDone: [{ taskId: 'T-70', title: '로그인 고치기', finishedAt: new Date(now - 3 * 60000).toISOString() }],
    counts: { VERIFIED_DONE: 4 },
  };
  const html = renderToStaticMarkup(React.createElement(LiveStatusCard, { lane, now }));
  const text = surface(html);
  assert.match(html, /class="cr-pill done"/);
  assert.match(html, /class="cr-pill now"/);
  assert.match(html, /class="cr-chip amber"/);
  assert.match(text, /계획/);
  assert.match(text, /만들기/);
  assert.match(text, /검사/);
  assert.match(text, /시험/);
  assert.match(text, /반영/);
  assert.match(text, /일부 확인/);
  assert.match(text, /지금까지 끝난 작업 4개는 확인됨/);
  assert.doesNotMatch(text, /T-77|VERIFIED_DONE|HOLD|QUEUED/);
  assert.match(html, /<details><summary>원문 보기<\/summary>.*T-77/s);
  assert.equal((html.match(/<button/g) ?? []).length, 0);
  assert.match(html, /Agent Relay/);
  const pausedHtml = renderToStaticMarkup(React.createElement(LiveStatusCard, {
    lane: { project: 'actl', paused: true, workerChain: ['claude'] },
  }));
  assert.match(surface(pausedHtml), /잠시 멈춤/);
  assert.match(pausedHtml, /actl/);
  assert.match(room, />이 프로젝트 잠시 멈춤</);
  assert.match(room, />다시 시작</);
  assert.match(room, /<LiveStatusCard lane=\{lane\} \/>/);
  assert.match(room, /className="cr-project-grid"/);
  assert.doesNotMatch(room, /window\.alert|window\.confirm|window\.prompt/);
});

test('project and hold cards use the dark reference look and stack on a narrow screen', () => {
  const block = css.slice(css.indexOf('/* ── 관제실 프로젝트 카드'), css.indexOf('/* ── Inline confirm'));
  for (const token of ['#0b0d10', '#12151a', '#232830', '#7dd3c0', '#e8c170', '#8b93a1', 'Noto Sans KR', 'JetBrains Mono', '16px', '44px', '14px', '0.38s', 'fade-slide-in']) {
    assert.ok(block.includes(token), `missing ${token}`);
  }
  assert.match(block, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(block, /@media\s*\(\s*max-width:\s*1099px\s*\)/);
  assert.match(block, /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
  assert.match(block, /\.hold-card[\s\S]*#e8c170/);
  assert.match(block, /\.btn\.cr-hold-go[\s\S]*#e8c170/);
  assert.match(block, /\.hold-saved[\s\S]*#7dd3c0/);
  assert.doesNotMatch(block, /#e06c5f|color:\s*red|--danger/);
});
