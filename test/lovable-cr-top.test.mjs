/* Lovable 관제실 상단 — 첫 안내, 배너, 숫자 타일.
   Values come from a board fixture through the pure helpers. */
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
  const dir = await mkdtemp(`${tmpdir()}/cr-top-`);
  try {
    const file = path.join(dir, 'controlRoom.cjs');
    await writeFile(file, out.outputFiles[0].text);
    return createRequire(file)(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const {
  CR_TOP_GUIDE_KEY,
  crTopGuideSteps,
  crTopGuideDismissed,
  crTopRememberGuide,
  crTopBanner,
  crTopStats,
} = await loadHelpers();

const FIXTURE = {
  lanes: [
    {
      id: 'agent-relay',
      project: 'agent-relay',
      current: { title: '영수증 화면 쉽게', stage: 2, state: 'RUNNING', worker: 'codex' },
      holds: [
        { taskId: 'hold-a', reason: '문장이 어려워요', waitMin: 8, explain: { sentence: '쉬운 말로 다시 써요' } },
        { taskId: 'hold-b', reason: '잠깐 느려요', waitMin: 5, explain: { sentence: '한 명만 쉬게 해요' } },
        { taskId: 'hold-skip', reason: '건너뜀', choice: 'skip', explain: { sentence: '안 보임' } },
      ],
      todayDone: [{ taskId: 'done-1', title: '첫 안내 정리' }],
    },
    {
      id: 'actl',
      current: { title: '명령 결과를 한 줄로', stage: 'QA', state: 'QA', qa: 'claude-team' },
    },
    {
      id: 'juplan',
      state: 'QUEUED',
      counts: { QUEUED: 3 },
      tasks: [{ state: 'QUEUED', taskId: 'secret-id' }],
    },
  ],
};

test('first-run guide is three Korean steps and is remembered locally', () => {
  assert.deepEqual(crTopGuideSteps().map((step) => step.title), [
    '이건 무엇인가요',
    '필요한 설정 한 가지: 작업 PC 연결',
    '다음에 일어나는 일',
  ]);
  assert.match(crTopGuideSteps()[0].text, /계획부터 반영/);
  const store = new Map();
  const read = (key) => store.get(key) ?? null;
  assert.equal(crTopGuideDismissed(read), false);
  assert.equal(crTopGuideDismissed(null), false);
  assert.equal(crTopGuideDismissed(() => { throw new Error('blocked'); }), false);
  crTopRememberGuide((key, value) => { store.set(key, value); });
  assert.equal(store.get(CR_TOP_GUIDE_KEY), '1');
  assert.equal(crTopGuideDismissed(read), true);
  assert.doesNotThrow(() => crTopRememberGuide(null));
  assert.doesNotThrow(() => crTopRememberGuide(() => { throw new Error('full'); }));
  assert.match(room, /crTopGuideDismissed\(\(key\) => localStorage\.getItem\(key\)\)/);
  assert.match(room, /crTopRememberGuide\(\(key, value\) => localStorage\.setItem\(key, value\)\)/);
  assert.match(room, />알겠어요</);
});

test('banner and tiles come from the board fixture, not sample numbers', () => {
  const banner = crTopBanner(FIXTURE);
  assert.equal(banner.tone, 'amber');
  assert.equal(banner.title, '멈춘 작업 2건');
  assert.equal(banner.detail, '5분 안에 고르지 않으면 추천대로 진행해요');
  assert.equal(banner.actionLabel, '멈춘 작업 보기');
  assert.deepEqual(crTopStats(FIXTURE), [
    { label: '오늘 끝난 작업', value: 1, tone: 'teal' },
    { label: '지금 일하는 AI', value: 2, tone: 'muted' },
    { label: '멈춘 작업', value: 2, tone: 'amber' },
    { label: '대기', value: 3, tone: 'muted' },
  ]);
  const surface = `${banner.title} ${banner.detail} ${banner.actionLabel} ${crTopStats(FIXTURE).map((stat) => stat.label).join(' ')}`;
  assert.doesNotMatch(surface, /QUEUED|HOLD|taskId|secret-id|2026-/);

  const clear = crTopBanner({ lanes: [] });
  assert.equal(clear.tone, 'teal');
  assert.equal(clear.title, '지금 하실 일은 없어요. 알아서 진행 중이에요.');
  assert.equal(clear.detail, '');
  assert.equal(clear.actionLabel, '');
  assert.deepEqual(crTopStats({ lanes: [] }).map((stat) => stat.value), [0, 0, 0, 0]);

  const blocked = crTopBanner({ lanes: [{ id: 'x', blocker: 'SCOPE', current: {} }] });
  assert.equal(blocked.title, '멈춘 작업 1건');
  assert.equal(blocked.detail, '');
  assert.equal(blocked.actionLabel, '멈춘 작업 보기');

  const other = {
    lanes: [{ current: { title: '하나만 하는 중', state: 'RUNNING' }, counts: { QUEUED: 4 }, todayDone: [{ title: '가' }, { title: '나' }] }],
  };
  assert.equal(crTopBanner(other).tone, 'teal');
  assert.deepEqual(crTopStats(other).map((stat) => stat.value), [2, 1, 0, 4]);
  assert.doesNotMatch(room, /멈춘 작업 2건/);
  assert.doesNotMatch(room, /오늘 끝난 작업", value: "39"/);
});

test('the screen scrolls the amber button to the hold card', () => {
  assert.match(room, /crTopBanner\(board\)/);
  assert.match(room, /crTopStats\(board\)/);
  assert.match(room, /멈춘 작업으로 이동했어요 ✓/);
  assert.match(room, /getElementById\('lane-hold'\)/);
  assert.match(room, /scrollIntoView/);
  assert.match(room, /id="lane-hold"/);
  assert.doesNotMatch(room, /window\.alert|window\.confirm|window\.prompt/);
});

test('cr-top look is dark, amber for stuck, and still readable on a phone', () => {
  const block = css.slice(css.indexOf('/* ── 관제실 상단'), css.indexOf('.shared-seats {'));
  for (const token of ['#0b0d10', '#12151a', '#232830', '#7dd3c0', '#e8c170', '#8b93a1', 'Noto Sans KR', 'JetBrains Mono', '14px', '16px', '44px', '0.38s', 'fade-slide-in']) {
    assert.ok(block.includes(token), `missing ${token}`);
  }
  assert.match(block, /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
  assert.match(block, /@media\s*\(\s*max-width:\s*720px\s*\)/);
  assert.match(block, /\.cr-top-banner\.amber[\s\S]*#e8c170/);
  assert.match(block, /\.cr-top-stat\.amber \.cr-top-num[\s\S]*#e8c170/);
  assert.match(block, /\.cr-top-stat\.teal \.cr-top-num[\s\S]*#7dd3c0/);
  assert.doesNotMatch(block, /--danger|#[eE]06[cC]5[fF]|color:\s*red/);
});
