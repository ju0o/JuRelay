/* Lovable 설정: 실행 환경 카드 · 동시에 일하는 AI 수.
   값은 envs / board 응답에서 만들고, 샘플 숫자는 넣지 않는다. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = fs.readFileSync(path.join(root, 'src/frontend/App.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/frontend/style.css'), 'utf8');

async function loadModule(file) {
  const { build } = await import('esbuild');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { createRequire } = await import('node:module');
  const out = await build({
    entryPoints: [path.join(root, file)],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  });
  const dir = await mkdtemp(`${tmpdir()}/lovable-settings-`);
  try {
    const bundled = path.join(dir, 'mod.cjs');
    await writeFile(bundled, out.outputFiles[0].text);
    return createRequire(bundled)(bundled);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const app = await loadModule('src/frontend/App.tsx');
const labels = await loadModule('src/shared/projectLabels.ts');

test('env cards: the current location is selectable, other computers point to 실행 위치, 클라우드 곧 지원', () => {
  const rows = labels.normalizeEnvs({
    envs: [
      { id: 'asus', cpu_pct: 22.4, ram_free_gb: 9.24, ram_total_gb: 16, ais: ['codex', 'claude-team'] },
      { id: 'mainpc', cpu_pct: 40, ram_free_gb: 20, ram_total_gb: 32, ais: [] },
    ],
  });
  const ssh = { kind: 'ssh', alias: 'asus', name: '' };
  const [asus, mainpc, cloud] = app.settingsEnvCards(rows, ssh);
  assert.equal(asus.label, 'ASUS (이 컴퓨터)');
  assert.equal(asus.selectable, true);
  assert.equal(asus.tone, 'teal');
  assert.equal(asus.cpuBar, 22);
  assert.equal(asus.ramLine, '9.2/16 GB 남음');
  assert.deepEqual(asus.ais, ['Codex', 'Claude Team']);
  assert.equal(mainpc.selectable, false);
  assert.equal(mainpc.holdLabel, app.ENV_CARD_CHANGE_HINT);
  // 이 컴퓨터에서 돌리면 엔진이 첫 줄로 보내는 자기 자신이 '지금 여기서 일해요'.
  const [first, second] = app.settingsEnvCards(rows);
  assert.equal(first.selectable, true);
  assert.equal(second.selectable, false);
  // 다른 컴퓨터로 정했는데 그 별칭이 목록에 없으면 아무 행도 고르지 않는다.
  assert.ok(app.settingsEnvCards(rows, { kind: 'ssh', alias: 'elsewhere', name: '' }).every(card => !card.selectable));
  assert.equal(mainpc.ramLine, '20/32 GB 남음');
  assert.equal(cloud.label, '클라우드');
  assert.equal(cloud.selectable, false);
  assert.equal(cloud.holdLabel, '곧 지원');
  assert.equal(app.settingsEnvCards([]).length, 1, 'only the cloud placeholder when envs are empty');
});

test('env cards turn amber at CPU ≥85% or RAM <3.5 GB, and when offline — never red', () => {
  const card = (r) => app.settingsEnvCards(labels.normalizeEnvs([{ id: 'asus', ...r }]), { kind: 'ssh', alias: 'asus', name: '' })[0];
  assert.equal(card({ cpu_pct: 84, ram_free_gb: 3.5 }).tone, 'teal');
  assert.equal(card({ cpu_pct: 85, ram_free_gb: 8 }).tone, 'amber');
  assert.equal(card({ cpu_pct: 10, ram_free_gb: 3.4 }).tone, 'amber');
  assert.equal(card({ cpu_pct: 99, ram_free_gb: 0.5 }).tone, 'amber');
  const off = card({ ok: false, reason: 'ssh: connect timed out' });
  assert.equal(off.tone, 'amber');
  assert.equal(off.cpuPct, null);
  assert.equal(off.ramLine, '메모리 확인 중');
  assert.doesNotMatch(off.reason, /ssh|timed/);
  assert.equal(off.rawReason, 'ssh: connect timed out');
});

test('RAM line formats free/total', () => {
  assert.equal(app.settingsRamLine(6.25, 16), '6.3/16 GB 남음');
  assert.equal(app.settingsRamLine(4, null), '4 GB 남음');
  assert.equal(app.settingsRamLine(null, 16), '메모리 확인 중');
});

test('동시에 일하는 AI 수 comes from board.capacity, never guessed', () => {
  assert.equal(app.settingsParallelLine({ capacity: { maxBuilders: 3, busy: 1 } }), '지금 3명 · RAM이 부족하면 자동으로 줄여요');
  assert.equal(app.settingsParallelLine({ capacity: { maxBuilders: 5, busy: 0 } }), '지금 5명 · RAM이 부족하면 자동으로 줄여요');
  assert.equal(app.settingsParallelLine(null), '아직 알 수 없어요 — 관제실이 연결되면 보여요');
  assert.equal(app.settingsParallelLine({ lanes: [] }), '아직 알 수 없어요 — 관제실이 연결되면 보여요');
});

test('settings page keeps update, 저장 폴더, 프로젝트 관리 and 고급 (개발용) reachable', () => {
  const page = appSrc.slice(appSrc.indexOf('<div className="settings-page">'), appSrc.indexOf('<AutoWorklog />'));
  for (const s of ['<SettingsEnvSection', '동시에 일하는 AI 수', '<UpdateSection', '저장 폴더', '<ProjectManager ', '고급 (개발용)', '개발 도구']) {
    assert.ok(page.includes(s), `missing ${s}`);
  }
  assert.ok(page.indexOf('<SettingsEnvSection') < page.indexOf('고급 (개발용)'));
  assert.ok(page.includes('<RunLocationSection'), 'run location is a setting on the same page');
  assert.doesNotMatch(appSrc, /controlRoom:remoteRun/);
});

test('storage and settings-file paths sit only under 원문 보기', () => {
  const page = appSrc.slice(appSrc.indexOf('<div className="settings-page">'), appSrc.indexOf('<AutoWorklog />'));
  const raw = page.indexOf('<summary>원문 보기</summary>');
  assert.ok(raw > 0, 'raw fold exists');
  for (const s of ['{settings.dataRoot ||', '{settings.settingsFile}']) {
    assert.ok(page.indexOf(s) > raw, `${s} must be inside 원문 보기`);
  }
  assert.doesNotMatch(page, /title=\{settings\.dataRoot\}/);
  const splash = appSrc.slice(appSrc.indexOf('저장공간 유실 화면'), appSrc.indexOf('openProjectNames ='));
  assert.ok(splash.indexOf('{settings.dataRoot}') > splash.indexOf('원문 보기'));
});

test('update failures keep the raw error out of the toast and under 원문 보기', () => {
  const sec = appSrc.slice(appSrc.indexOf('function UpdateSection'), appSrc.indexOf('<div className="update-row">'));
  assert.doesNotMatch(sec, /notify\('err', e instanceof Error/);
  const row = appSrc.slice(appSrc.indexOf('<div className="update-row">'));
  const fold = row.indexOf('<summary>원문 보기</summary>');
  assert.ok(fold > 0 && row.indexOf('{failure}') > fold, 'raw error only inside 원문 보기');
  assert.ok(row.indexOf('업데이트를 하지 못했어요.') < fold);
  assert.doesNotMatch(css, /\.update-err\s*\{[^}]*--danger/, 'update failure is amber, not red');
});

test('settings styles use the Lovable tokens and honour reduced motion', () => {
  const block = css.slice(css.indexOf('/* ── 설정: 실행 환경'));
  for (const s of ['#12151a', '#232830', '#7dd3c0', '#e8c170', '#8b93a1', 'border-radius: 14px', 'fade-slide-in 0.38s', 'JetBrains Mono', 'min-height: 44px', 'prefers-reduced-motion']) {
    assert.ok(block.includes(s), `missing ${s}`);
  }
  assert.doesNotMatch(block, /#e06c5f|var\(--danger\)/, 'no red in settings cards');
});
