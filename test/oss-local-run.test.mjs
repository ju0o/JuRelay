/* Open-source local run: where the engine runs is a setting.
   Default = this computer (engine CLI runs locally, no ssh). Optional = another computer over SSH
   with a user-entered alias and data root. No alias, person, or PC path lives in code defaults;
   the Founder's own setup comes from settings.json / environment. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import {
  ControlRoomError,
  DEFAULT_ENGINE_PATH,
  configureRunLocation,
  currentRunLocation,
  engineCommand,
  execFailure,
  expandHomePath,
  runControlRoom,
  runControlRoomLaneAdd,
  runControlRoomNightReports,
  runPlanStudioRequest,
} from '../dist/server/backend/controlRoom.js';
import {
  LOCAL_LOCATION_NAME,
  LOCAL_RUN_LOCATION,
  RUN_LOCATION_ENV,
  laneErrorKind,
  laneErrorLines,
  laneRowLabel,
  newLaneProblem,
  normalizeRunLocation,
  resolveRunLocation,
  runLocationFromEnv,
  runLocationName,
  runLocationProblem,
  runLocationSavedLine,
  runLocationSentence,
} from '../dist/server/shared/projectManager.js';
import { BRIDGE_ENV, FounderBridgeTransport, FounderInboxBridge, LocalFounderBridgeTransport, createFounderBridgeTransport, founderBridgeLaunchOptions, loadFounderBridgeConfig, resolveBridgeLocation } from '../src/v2/founder-bridge/index.mjs';

const root = new URL('..', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');
const SSH = { kind: 'ssh', alias: 'work-pc', dataRoot: '/srv/agent-relay/data', engine: '', name: '' };
const fakeExec = (stdout = '{}') => {
  const calls = [];
  const exec = async (...args) => { calls.push(args); return { stdout, stderr: '' }; };
  return { calls, exec };
};

describe('run location is a setting, not a code default', { concurrency: false }, () => {
  test('code defaults carry no alias, person, or PC path', async () => {
    for (const file of ['src/backend/controlRoom.ts', 'src/shared/projectManager.ts', 'src/v2/founder-bridge/index.mjs', 'bridge/founder-bridge.mjs', 'bridge/founder-gate-ui.mjs', 'bridge/install-founder-bridge.ps1', 'src/frontend/App.tsx']) {
      const source = await read(file);
      for (const banned of ["'asus'", '"asus"', 'skkse12', '/home/skkse12', 'ASUS']) {
        assert.equal(source.includes(banned), false, `${file} contains ${banned}`);
      }
    }
    assert.deepEqual(LOCAL_RUN_LOCATION, { kind: 'local', alias: '', dataRoot: '', engine: '', name: '' });
    assert.equal(LOCAL_LOCATION_NAME, '이 컴퓨터');
  });

  test('normalize: broken or alias-less ssh falls back to this computer', () => {
    assert.deepEqual(normalizeRunLocation(null), LOCAL_RUN_LOCATION);
    assert.deepEqual(normalizeRunLocation('ssh'), LOCAL_RUN_LOCATION);
    assert.equal(normalizeRunLocation({ kind: 'ssh' }).kind, 'local');
    assert.equal(normalizeRunLocation({ kind: 'ssh', alias: 'bad alias' }).kind, 'local');
    assert.equal(normalizeRunLocation({ kind: 'ssh', alias: '-o ProxyCommand=x' }).kind, 'local');
    const ssh = normalizeRunLocation({ kind: ' SSH ', alias: ' work-pc ', dataRoot: ' /srv/data ', name: ' 작업용 PC ' });
    assert.deepEqual(ssh, { kind: 'ssh', alias: 'work-pc', dataRoot: '/srv/data', engine: '', name: '작업용 PC' });
    assert.equal(normalizeRunLocation({ kind: 'local', engine: '~/bin/night' }).engine, '~/bin/night');
  });

  test('resolve: settings win over environment, environment over the default', () => {
    assert.deepEqual(resolveRunLocation(null, {}), LOCAL_RUN_LOCATION);
    assert.deepEqual(resolveRunLocation({ dataRoot: '/x', customAgents: [] }, null), LOCAL_RUN_LOCATION);
    assert.equal(runLocationFromEnv({}), null);
    const env = { [RUN_LOCATION_ENV.alias]: 'work-pc', [RUN_LOCATION_ENV.dataRoot]: '/srv/data' };
    assert.deepEqual(runLocationFromEnv(env), { kind: 'ssh', alias: 'work-pc', dataRoot: '/srv/data', engine: '', name: '' });
    assert.equal(resolveRunLocation({}, env).kind, 'ssh');
    assert.equal(resolveRunLocation({ runLocation: { kind: 'local' } }, env).kind, 'local', 'explicit local setting beats env');
    assert.equal(runLocationFromEnv({ [RUN_LOCATION_ENV.kind]: 'local', [RUN_LOCATION_ENV.name]: '내 노트북' }).name, '내 노트북');
  });

  test('names and copy follow the location', () => {
    assert.equal(runLocationName(LOCAL_RUN_LOCATION), '이 컴퓨터');
    assert.equal(runLocationName(SSH), 'work-pc');
    assert.equal(runLocationName({ ...SSH, name: '작업용 PC' }), '작업용 PC');
    assert.equal(runLocationName(null), '이 컴퓨터');
    assert.match(runLocationSentence(LOCAL_RUN_LOCATION), /^지금은 이 컴퓨터에서 AI가 일해요/);
    assert.match(runLocationSentence(SSH), /다른 컴퓨터\(work-pc\)/);
    assert.equal(runLocationSavedLine(SSH), '저장했어요 ✓ · 이제 work-pc에서 일해요');
    assert.equal(laneRowLabel(true), '켜짐 · 이 컴퓨터 켤 때 자동으로 돌아요');
    assert.equal(laneRowLabel(true, '작업용 PC'), '켜짐 · 작업용 PC 켤 때 자동으로 돌아요');
    assert.match(newLaneProblem({ id: 'ok-id', path: 'relative', name: 'n' }), /이 컴퓨터의 전체 경로/);
    assert.match(newLaneProblem({ id: 'ok-id', path: 'relative', name: 'n' }, [], '작업용 PC'), /작업용 PC의 전체 경로/);
  });

  test('settings form validation speaks plain Korean', () => {
    assert.equal(runLocationProblem({ kind: 'local' }), null);
    assert.equal(runLocationProblem({ kind: 'ssh', alias: 'work-pc', dataRoot: '/srv/data' }), null);
    assert.match(runLocationProblem({}), /골라 주세요/);
    assert.match(runLocationProblem({ kind: 'ssh' }), /연결 이름/);
    assert.match(runLocationProblem({ kind: 'ssh', alias: 'a b' }), /영문·숫자/);
    assert.match(runLocationProblem({ kind: 'ssh', alias: 'work-pc' }), /데이터 폴더/);
    assert.match(runLocationProblem({ kind: 'ssh', alias: 'work-pc', dataRoot: 'relative' }), /전체 경로/);
    assert.match(runLocationProblem({ kind: 'local', name: 'x'.repeat(41) }), /40자/);
  });
});

describe('engine command', { concurrency: false }, () => {
  test('this computer: engine CLI runs directly, no ssh, user text passed raw', () => {
    const local = engineCommand(LOCAL_RUN_LOCATION, ['board', '--json']);
    assert.notEqual(local.file, 'ssh');
    assert.ok(local.file.endsWith('/.agents/skills/auto-night-orchestrator/scripts/night'), local.file);
    assert.equal(local.file.includes('~'), false, 'home is expanded for a local exec');
    assert.equal(expandHomePath('~/x', '/home/u'), '/home/u/x');
    assert.equal(expandHomePath('/abs', '/home/u'), '/abs');
    assert.equal(engineCommand({ ...LOCAL_RUN_LOCATION, engine: '/opt/night' }, ['board', '--json']).file, '/opt/night');
    assert.deepEqual(engineCommand({ ...LOCAL_RUN_LOCATION, engine: '/opt/night' }, ['board', '--json']).args, ['board', '--json']);
  });

  test('another computer: ssh with the user alias, user text single-quoted for the remote shell', () => {
    const ssh = engineCommand(SSH, ['board', '--json']);
    assert.equal(ssh.file, 'ssh');
    assert.deepEqual(ssh.args, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 'work-pc', DEFAULT_ENGINE_PATH, 'board', '--json']);
    assert.deepEqual(engineCommand({ ...SSH, engine: '/opt/night' }, ['status', '--json']).args.slice(4), ['work-pc', '/opt/night', 'status', '--json']);
  });

  test('every control-room call goes through the configured location', async () => {
    configureRunLocation(LOCAL_RUN_LOCATION);
    assert.deepEqual(currentRunLocation(), LOCAL_RUN_LOCATION);
    const local = fakeExec('{"lanes":[]}');
    assert.deepEqual(await runControlRoom('board', local.exec), { lanes: [] });
    assert.notEqual(local.calls[0][0], 'ssh');
    assert.deepEqual(local.calls[0][1], ['board', '--json']);
    assert.deepEqual(local.calls[0][2], { shell: false, timeout: 10_000 });

    const add = fakeExec('{"ok":true}');
    await runControlRoomLaneAdd('receipt-app', "/home/a/it's", '영수증 앱', add.exec);
    assert.deepEqual(add.calls[0][1], ['lane', 'add', 'receipt-app', "/home/a/it's", '영수증 앱', '--json'], 'no shell quoting when there is no remote shell');

    const req = fakeExec('{"ok":true}');
    await runPlanStudioRequest('agent-relay', 'hello; rm -rf /', req.exec);
    assert.deepEqual(req.calls[0][1], ['plan', 'request', 'agent-relay', 'hello; rm -rf /', '--json']);

    configureRunLocation(SSH);
    const remote = fakeExec('{"lanes":[]}');
    await runControlRoom('board', remote.exec);
    assert.equal(remote.calls[0][0], 'ssh');
    assert.deepEqual(remote.calls[0][1], ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 'work-pc', DEFAULT_ENGINE_PATH, 'board', '--json']);
    const remoteAdd = fakeExec('{"ok":true}');
    await runControlRoomLaneAdd('receipt-app', "/home/a/it's", '영수증 앱', remoteAdd.exec);
    assert.deepEqual(remoteAdd.calls[0][1].slice(6), ['lane', 'add', "'receipt-app'", "'/home/a/it'\\''s'", "'영수증 앱'", '--json']);
  });

  test('laneAdd validation names the location', async () => {
    configureRunLocation({ ...SSH, name: '작업용 PC' });
    const err = await runControlRoomLaneAdd('ok-id', 'relative', 'n', async () => ({ stdout: '{}', stderr: '' })).catch((e) => e);
    assert.ok(err instanceof ControlRoomError);
    assert.match(err.message, /작업용 PC의 전체 경로/);
    configureRunLocation(LOCAL_RUN_LOCATION);
    const local = await runControlRoomLaneAdd('ok-id', 'relative', 'n', async () => ({ stdout: '{}', stderr: '' })).catch((e) => e);
    assert.match(local.message, /이 컴퓨터의 전체 경로/);
  });
});

describe('failures are told apart per location', { concurrency: false }, () => {
  const thrown = (props) => Object.assign(new Error('x'), props);

  test('ssh: 255 / ENOENT = the other computer is off; other exit codes = it is on but failed', () => {
    const named = { ...SSH, name: '작업용 PC' };
    const off = execFailure('board', thrown({ code: 255, stderr: 'ssh: connect to host' }), named);
    assert.equal(off.code, 'EXEC_FAILED');
    assert.match(off.message, /작업 PC\(작업용 PC\)에 연결할 수 없습니다/);
    assert.equal(execFailure('board', thrown({ code: 'ENOENT' }), named).code, 'EXEC_FAILED');
    const failed = execFailure('board', thrown({ code: 1, stderr: 'boom' }), named);
    assert.equal(failed.code, 'REMOTE_FAILED');
    assert.match(failed.message, /작업용 PC\)는 켜져 있는데/);
    assert.equal(failed.detail, 'boom');
    assert.doesNotMatch(off.message + failed.message, /ASUS/);
  });

  test('this computer: missing engine, timeout, and engine failure are three different sentences', () => {
    const missing = execFailure('board', thrown({ code: 'ENOENT' }), LOCAL_RUN_LOCATION);
    assert.equal(missing.code, 'EXEC_FAILED');
    assert.match(missing.message, /이 컴퓨터에서 작업 엔진을 찾지 못했습니다/);
    assert.match(missing.message, /설정 → 실행 위치/);
    assert.doesNotMatch(missing.message, /연결할 수 없습니다/, 'nothing is offline on this computer');
    const timeout = execFailure('board', thrown({ code: null, killed: true, signal: 'SIGTERM' }), LOCAL_RUN_LOCATION);
    assert.equal(timeout.code, 'EXEC_FAILED');
    assert.match(timeout.message, /시간 안에 답하지 않았어요/);
    const failed = execFailure('board', thrown({ code: 255, stderr: 'Traceback: boom' }), LOCAL_RUN_LOCATION);
    assert.equal(failed.code, 'REMOTE_FAILED', 'exit 255 is an engine exit on this computer, not a lost connection');
    assert.match(failed.message, /이 컴퓨터에서 요청을 처리하다 오류가 났어요/);
    assert.equal(failed.detail, 'Traceback: boom');
  });

  test('night reports on this computer trust stdout from any exit code', async () => {
    configureRunLocation(LOCAL_RUN_LOCATION);
    const list = await runControlRoomNightReports(async () => {
      throw thrown({ code: 255, stdout: JSON.stringify({ kind: 'REVIEW', info: [], blockers: ['NO_LAST_NIGHT_RUN'] }) });
    });
    assert.equal(list.rows.length, 2);
    configureRunLocation(SSH);
    const err = await runControlRoomNightReports(async () => {
      throw thrown({ code: 255, stdout: '{"kind":"REVIEW","info":[],"blockers":[]}' });
    }).catch((e) => e);
    assert.equal(err.code, 'EXEC_FAILED', 'over ssh, 255 still means the other computer is off');
    configureRunLocation(LOCAL_RUN_LOCATION);
  });

  test('screen lines use the location name and never ASUS', () => {
    const [, why, next] = laneErrorLines('추가하지', '작업 PC(작업용 PC)에 연결할 수 없습니다.', '작업용 PC');
    assert.equal(why, '작업용 PC가 꺼져 있거나 네트워크가 끊긴 것 같아요.');
    assert.equal(next, '작업용 PC를 켠 뒤 다시 시도해 주세요.');
    const missing = laneErrorLines('켜지', '이 컴퓨터에서 작업 엔진을 찾지 못했습니다.');
    assert.equal(laneErrorKind('이 컴퓨터에서 작업 엔진을 찾지 못했습니다.'), 'engine-missing');
    assert.match(missing[1], /이 컴퓨터에 작업 엔진이 아직 설치되지 않았거나/);
    assert.match(missing[2], /설정 → 실행 위치/);
    const local = laneErrorLines('켜지', '이 컴퓨터에서 요청을 처리하다 오류가 났어요.');
    assert.equal(laneErrorKind('이 컴퓨터에서 요청을 처리하다 오류가 났어요.'), 'remote-failed');
    assert.equal(local[1], '이 컴퓨터에서 요청을 처리하다 오류가 났어요.');
    const remote = laneErrorLines('켜지', '작업 PC(work-pc)는 켜져 있는데 요청을 처리하다 오류가 났어요.', 'work-pc');
    assert.equal(remote[1], 'work-pc는 켜져 있는데, 요청을 처리하다 오류가 났어요.');
    for (const line of [...missing, ...local, ...remote]) assert.doesNotMatch(line, /ASUS|asus/);
  });
});

describe('founder bridge location', { concurrency: false }, () => {
  test('gate UI launch options default to this computer; config or env opts into ssh', async () => {
    const empty = founderBridgeLaunchOptions({}, {});
    assert.equal(empty.alias || '', '');
    assert.equal(empty.remoteRoot || '', '');
    assert.deepEqual(resolveBridgeLocation(empty, {}), { kind: 'local', alias: '', remoteRoot: '' });
    assert.ok(createFounderBridgeTransport(resolveBridgeLocation(empty, {})) instanceof LocalFounderBridgeTransport);
    const fromConfig = founderBridgeLaunchOptions({}, { kind: 'ssh', alias: 'work-pc', remoteRoot: '/srv/data', localInbox: '/inbox' });
    assert.deepEqual(resolveBridgeLocation(fromConfig, {}), { kind: 'ssh', alias: 'work-pc', remoteRoot: '/srv/data' });
    assert.equal(fromConfig.localInbox, '/inbox');
    const legacy = founderBridgeLaunchOptions({ REMOTE_ALIAS: 'work-pc', REMOTE_DATA_ROOT: '/srv/data' }, {});
    assert.equal(resolveBridgeLocation(legacy, {}).kind, 'ssh');
    const envWins = founderBridgeLaunchOptions({ [BRIDGE_ENV.alias]: 'env-pc', [BRIDGE_ENV.dataRoot]: '/env/data' }, { alias: 'cfg-pc', remoteRoot: '/cfg/data' });
    assert.equal(envWins.alias, 'env-pc');
    assert.equal(envWins.remoteRoot, '/env/data');
    assert.deepEqual(loadFounderBridgeConfig('/no/such/founder-bridge-config'), {});
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'agent-relay-bridge-config-'));
    try {
      await writeFile(join(dir, 'founder-bridge.config.json'), '{"kind":"ssh","alias":"work-pc","remoteRoot":"/srv/data"}');
      const loaded = founderBridgeLaunchOptions({}, loadFounderBridgeConfig(dir));
      assert.deepEqual(resolveBridgeLocation(loaded, {}), { kind: 'ssh', alias: 'work-pc', remoteRoot: '/srv/data' });
      await writeFile(join(dir, 'founder-bridge.config.json'), '{');
      assert.deepEqual(loadFounderBridgeConfig(dir), {});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    const ui = await read('bridge/founder-gate-ui.mjs');
    assert.match(ui, /founderBridgeLaunchOptions\(process\.env, loadFounderBridgeConfig\(/);
    assert.match(ui, /founder-bridge\.config\.json/);
    assert.doesNotMatch(ui, /\|\|\s*["'][^"']+["']/);
  });

  test('no alias anywhere means this computer; alias in env means ssh', () => {
    assert.deepEqual(resolveBridgeLocation({}, {}), { kind: 'local', alias: '', remoteRoot: '' });
    assert.deepEqual(resolveBridgeLocation({}, { [BRIDGE_ENV.alias]: 'work-pc', [BRIDGE_ENV.dataRoot]: '/srv/data' }), { kind: 'ssh', alias: 'work-pc', remoteRoot: '/srv/data' });
    assert.equal(resolveBridgeLocation({ kind: 'ssh' }, {}).kind, 'local', 'ssh without an alias cannot be ssh');
    assert.equal(resolveBridgeLocation({ kind: 'local', alias: 'work-pc' }, {}).kind, 'local', 'an explicit local wins over a stray alias');
    assert.ok(createFounderBridgeTransport({ alias: 'work-pc', remoteRoot: '/srv' }) instanceof FounderBridgeTransport);
    assert.ok(createFounderBridgeTransport({ remoteRoot: '/srv' }) instanceof LocalFounderBridgeTransport);
    assert.ok(new FounderInboxBridge({ localInbox: '/tmp/x', alias: 'work-pc', remoteRoot: '/srv' }).transport instanceof FounderBridgeTransport);
  });

  test('ssh transport without an alias fails closed with a clear reason', async () => {
    const transport = new FounderBridgeTransport({});
    await assert.rejects(() => transport.discover(), new RegExp(BRIDGE_ENV.alias));
    await assert.rejects(() => new FounderBridgeTransport({ alias: 'work-pc' }).pull('/a', '/b'), new RegExp(BRIDGE_ENV.dataRoot));
  });

  test('local transport moves packets and receipts by file copy', async () => {
    const { mkdtemp, mkdir, writeFile, rm, readFile: readBytes } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'agent-relay-local-bridge-'));
    try {
      const engineRoot = join(dir, 'engine');
      const inbox = join(dir, 'inbox');
      const packets = join(engineRoot, 'founder-outbox', 'Demo', 'packets');
      await mkdir(packets, { recursive: true });
      await mkdir(inbox, { recursive: true });
      const packet = '# Founder Gate\nGATE_ID: FG-local\nPROJECT: Demo\n';
      await writeFile(join(packets, 'FG-local.md'), packet);
      await writeFile(join(packets, 'notes.txt'), 'ignored');
      const transport = new LocalFounderBridgeTransport({ remoteRoot: engineRoot });
      assert.deepEqual(await transport.discover(), [join(packets, 'FG-local.md')]);
      const bridge = new FounderInboxBridge({ localInbox: inbox, remoteRoot: engineRoot, transport });
      const [result] = await bridge.syncOnce();
      assert.equal(result.state, 'DELIVERED');
      assert.equal(await readBytes(join(inbox, 'Demo', 'FG-local.md'), 'utf8'), packet);
      const receipt = JSON.parse(await readBytes(join(engineRoot, 'founder-outbox', 'Demo', 'receipts', 'FG-local.json'), 'utf8'));
      assert.equal(receipt.gateId, 'FG-local');
      assert.deepEqual(await new LocalFounderBridgeTransport({ remoteRoot: join(dir, 'missing') }).discover(), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('settings screen: 실행 위치 card', { concurrency: false }, () => {
  test('card is Korean-first, recommended choice first, result inline, developer text under 고급', async () => {
    const src = await read('src/frontend/App.tsx');
    const start = src.indexOf('function RunLocationSection');
    const end = src.indexOf('function SettingsEnvSection', start);
    assert.ok(start > 0 && end > start);
    const block = src.slice(start, end);
    assert.match(block, /aria-label="실행 위치"/);
    const choices = src.slice(src.indexOf('RUN_LOCATION_CHOICES'), start);
    assert.ok(choices.indexOf('이 컴퓨터 (추천)') < choices.indexOf('다른 컴퓨터 (SSH로 연결)'), 'recommended choice comes first');
    assert.match(block, /runLocationSentence\(location\)/, 'one sentence at the top');
    assert.match(block, /이대로 저장/);
    assert.match(block, /runLocationSavedLine\(saved\)/, 'result shown where the Founder clicked');
    assert.match(block, /저장하지 못했어요\./);
    assert.ok(block.indexOf('고급 (개발용)') < block.indexOf('rl-engine'), 'engine path only under 고급');
    assert.match(block, /원문 보기/);
    assert.doesNotMatch(block, /window\.(alert|confirm|prompt)|\b(alert|confirm|prompt)\(/);
    assert.doesNotMatch(block, /tone-amber|--danger|#e06c5f/, 'the card is never red');
    assert.doesNotMatch(block, /placeholder="\/home|placeholder="\/srv/, 'no example PC paths on the surface');
    assert.match(src, /op: 'settings:setRunLocation'/);
    const page = src.slice(src.indexOf('<div className="settings-page">'), src.indexOf('<AutoWorklog />'));
    assert.ok(page.indexOf('<RunLocationSection') < page.indexOf('<SettingsEnvSection'), 'location card sits above the env cards');
    assert.match(page, /<ProjectManager locationName=\{runLocationName\(settings\.runLocation\)\} \/>/);
  });

  test('env cards mark the current location and point elsewhere to the location card', async () => {
    const src = await read('src/frontend/App.tsx');
    assert.doesNotMatch(src, /k === 'asus'/);
    assert.doesNotMatch(src, /이 컴퓨터\(ASUS\)/);
    assert.match(src, /지금은 \{runLocationName\(location\)\}에서 일해요/);
    assert.doesNotMatch(src, /원격 실행은 보류 중이에요/);
  });
});
