/* 관제실 소음 정리 — 쉬는 프로젝트는 한 줄, 안쪽 제목은 없고, 레일은 연결이 깨졌을 때만. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const room = fs.readFileSync(path.join(root, 'src/frontend/controlRoom.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/frontend/App.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/frontend/style.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/backend/main.ts'), 'utf8');

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
  const dir = await mkdtemp(`${tmpdir()}/trim-noise-`);
  try {
    const file = path.join(dir, 'controlRoom.cjs');
    await writeFile(file, out.outputFiles[0].text);
    return createRequire(file)(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const {
  controlRoomRowSplit,
  crTopGuideVisible,
  isCaptureOrTesterSearch,
  isRestingProjectLane,
  restingProjectsLine,
} = await loadHelpers();

test('paused lanes leave the row list and become one muted line', () => {
  const lanes = [
    { id: 'agent-relay', project: 'agent-relay', current: { title: '영수증 화면 쉽게', state: 'RUNNING' } },
    { id: 'actl', project: 'actl', paused: true, current: { title: '명령 결과' } },
    { id: 'juplan', project: 'juplan', enabled: false },
    { id: 'juceipt', project: 'juceipt', current: { paused: true, stage: 'PAUSED', title: '영수증' } },
    { id: 'jutell', project: 'jutell', holds: [{ taskId: 'h1', reason: '범위', explain: { sentence: '범위를 골라 주세요' } }] },
    { id: 'idle', project: 'idle' },
  ];
  assert.equal(isRestingProjectLane(lanes[0]), false);
  assert.equal(isRestingProjectLane(lanes[1]), true);
  assert.equal(isRestingProjectLane(lanes[2]), true);
  assert.equal(isRestingProjectLane(lanes[3]), true);
  assert.equal(isRestingProjectLane(lanes[4]), false);
  assert.equal(isRestingProjectLane(lanes[5]), false);
  assert.equal(isRestingProjectLane(null), false);

  const split = controlRoomRowSplit(lanes);
  assert.deepEqual(split.shown.map((lane) => lane.id), ['agent-relay', 'jutell', 'idle']);
  assert.equal(split.resting, 3);
  assert.equal(restingProjectsLine(split.resting), '쉬는 프로젝트 3개 · 설정에서 켜기');
  assert.equal(restingProjectsLine(0), '');
  assert.equal(restingProjectsLine(1.9), '쉬는 프로젝트 1개 · 설정에서 켜기');
  assert.equal(controlRoomRowSplit([]).resting, 0);

  const surface = room.slice(room.indexOf('<main className="control-room">'), room.indexOf('</main>'));
  assert.match(surface, /restingProjectsLine\(rowSplit\.resting\)/);
  assert.match(surface, /className="cr-resting muted"/);
  const restingCss = css.slice(css.indexOf('.cr-resting {'), css.indexOf('.app[data-theme="light"] .cr-resting'));
  assert.match(restingCss, /font-size:\s*16px/);
  assert.doesNotMatch(restingCss, /--danger|color:\s*red|#e06c5f/i);
});

test('first-run guide stays until 알겠어요 and never in capture or tester mode', () => {
  assert.equal(crTopGuideVisible(false, ''), true);
  assert.equal(crTopGuideVisible(false, '?project=actl'), true);
  assert.equal(crTopGuideVisible(true, ''), false);
  assert.equal(crTopGuideVisible(true, '?capture=1'), false);
  assert.equal(crTopGuideVisible(false, '?capture=1'), false);
  assert.equal(crTopGuideVisible(false, 'capture=true'), false);
  assert.equal(crTopGuideVisible(false, '?tester=1'), false);
  assert.equal(crTopGuideVisible(false, '?tester=yes&capture=0'), false);
  assert.equal(crTopGuideVisible(false, '?capture=0'), true);
  assert.equal(isCaptureOrTesterSearch(''), false);
  assert.match(room, /crTopGuideVisible\(crTopGuideDismissed\(\(key\) => localStorage\.getItem\(key\)\), search\)/);
  assert.match(room, />알겠어요</);
  assert.match(main, /function quietLaunchQuery\(\)/);
  assert.match(main, /capture: '1'/);
  assert.match(main, /--view=/);
  assert.match(main, /capturePath/);
});

test('inner head is gone and the rail box hides when the PC is connected', () => {
  const surface = room.slice(room.indexOf('<main className="control-room">'), room.indexOf('</main>'));
  assert.equal(surface.includes('control-room-head'), false);
  assert.equal(surface.includes('5초마다 자동으로 새로 고쳐요'), false);
  assert.equal(surface.includes('>닫기<'), false);
  assert.doesNotMatch(surface, /<h1>관제실<\/h1>/);

  const topbar = app.slice(app.indexOf('className="topbar-row"'), app.indexOf('className="shell-main"'));
  assert.match(topbar, /<h1>\{pageCopy\.title\}<\/h1>/);
  assert.match(topbar, /<ConnectionBar \/>/);
  assert.equal(topbar.includes('shell-env'), false);
  assert.equal(topbar.includes('theme-toggle'), false);
  assert.equal(topbar.includes('실행 환경'), false);

  const settingsStart = app.indexOf('className="settings-page"');
  const settings = app.slice(settingsStart, app.indexOf('동시에 일하는 AI 수', settingsStart));
  assert.match(settings, /shellEnvLine\(envLabels, envPhase\)/);
  assert.match(settings, /밝게 보기/);
  assert.match(settings, /어둡게 보기/);
  assert.match(settings, /className="btn theme-toggle"/);

  assert.match(app, /export function railConnectionVisible\(phase: ConnectionPhase\): boolean \{\s*return phase === 'offline' \|\| phase === 'error';\s*\}/);
  assert.match(app, /if \(!railConnectionVisible\(conn\.phase\)\) return null;/);
  const railFn = app.slice(app.indexOf('function RailConnection'), app.indexOf('function ConnectionBar'));
  assert.match(railFn, /railConnectionVisible\(conn\.phase\)/);
  assert.equal(railFn.includes("phase === 'ok'"), false);
});
