/* Open-source standalone: no built-in project list, hub card only when a hub is configured. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  PLAN_GOAL_UNSET,
  PROJECT_LABELS,
  applyUserProjectConfig,
  folderDisplayName,
  hubCardVisible,
  parseUserProjectConfig,
  planLaneDisplayName,
  planVisibleGoal,
  projectDisplayName,
  projectHubConfigured,
  readUserProjectConfigText,
  userProjectConfigFromSettings,
  userProjectConfigPath,
} from '../dist/server/shared/projectLabels.js';

const root = new URL('..', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

describe('standalone project labels', { concurrency: false }, () => {
test('code defaults have no founder project list, paths, or hosts', async () => {
  const source = await read('src/shared/projectLabels.ts');
  assert.equal(Object.keys(PROJECT_LABELS).length, 1);
  assert.equal(PROJECT_LABELS.jutell.name, 'JuTell');
  for (const banned of [
    'JuPlan',
    'JuCeipt',
    'JuAi',
    'JuRadar',
    '통합 관제 화면',
    'AI 인력사무소',
    '/home/skkse12',
    'skkse12',
    "'asus'",
  ]) {
    assert.equal(source.includes(banned), false, banned);
  }
  assert.match(source, /jutell:\s*\{\s*name: 'JuTell',\s*goal: '짧고 쉬운 작업 보고서'/);
});

test('names and goals come from the user config, then the repo folder name', () => {
  const parsed = parseUserProjectConfig(JSON.stringify({
    schema: 'agent-relay.project-labels.v1',
    projects: {
      demo: { name: '데모 앱', goal: '한 줄 목표', path: '/work/ignored' },
      'folder-only': { path: '/repos/checkout/folder-only' },
      parent: { name: '부모', goal: '통합해서 보기' },
      child: { name: '자식 화면', goal: '한눈에 보기' },
    },
  }));
  assert.equal(parsed.labels.demo.name, '데모 앱');
  assert.equal(parsed.labels.demo.goal, '한 줄 목표');
  assert.notEqual(parsed.labels.parent.goal, parsed.labels.child.goal);
  assert.equal(parsed.hub, false);

  applyUserProjectConfig(parsed);
  assert.equal(projectDisplayName('demo'), '데모 앱');
  assert.equal(projectDisplayName('DEMO'), '데모 앱');
  assert.equal(planVisibleGoal('demo'), '한 줄 목표');
  assert.equal(projectDisplayName('folder-only'), 'folder-only');
  assert.equal(planLaneDisplayName('folder-only', '보드 이름'), 'folder-only');
  assert.equal(planLaneDisplayName('unknown', '보드 이름'), '보드 이름');
  assert.equal(planLaneDisplayName('unknown'), 'unknown');
  assert.equal(projectDisplayName('unknown'), 'unknown');
  assert.equal(planVisibleGoal('unknown'), PLAN_GOAL_UNSET);
  assert.equal(folderDisplayName('/repos/checkout/folder-only/'), 'folder-only');
  assert.equal(folderDisplayName('C:\\repos\\Demo'), 'Demo');
  assert.equal(projectHubConfigured(), false);
});

test('a missing or broken user config never throws and stays empty', () => {
  assert.equal(readUserProjectConfigText(() => { throw new Error('ENOENT'); }, '/missing/project-labels.json'), null);
  assert.equal(readUserProjectConfigText(() => 12, '/x'), null);
  assert.deepEqual(parseUserProjectConfig('not json'), { labels: {}, hub: false });
  assert.deepEqual(parseUserProjectConfig(null), { labels: {}, hub: false });
  assert.deepEqual(parseUserProjectConfig([]), { labels: {}, hub: false });
  assert.equal(userProjectConfigFromSettings({ dataRoot: '/tmp', customAgents: [] }), null);
  assert.deepEqual(userProjectConfigFromSettings({ projectLabels: { demo: { name: '데모', goal: '목표' } } }).demo.name, '데모');
  const applied = applyUserProjectConfig(null, '', '{');
  assert.equal(Object.keys(applied.labels).length, 1);
  assert.equal(applied.labels.jutell.name, 'JuTell');
  assert.equal(applied.hub, false);
  assert.equal(projectDisplayName('demo'), 'demo');
  assert.equal(userProjectConfigPath('/tmp/someone'), '/tmp/someone/.config/agent-relay/project-labels.json');
  assert.equal(userProjectConfigPath(''), '');
  assert.doesNotMatch(userProjectConfigPath('/tmp/someone'), /skkse12|asus/);
});

test('the hub card is visible only when a hub is configured or detected', () => {
  assert.equal(hubCardVisible(null), false);
  assert.equal(hubCardVisible({}), false);
  assert.equal(hubCardVisible({ board: null }), false);
  assert.equal(hubCardVisible({ board: { lanes: [{ project: 'demo', path: '/work/demo' }] } }), false);
  assert.equal(hubCardVisible({ board: { lanes: [{ project: 'note', title: 'JuControler is mentioned' }] } }), false);
  assert.equal(hubCardVisible({ configured: true }), true);
  assert.equal(hubCardVisible({ board: { lanes: [{ project: 'jucontroler' }] } }), true);
  assert.equal(hubCardVisible({ board: { lanes: [{ id: 'other', path: '/opt/JuControler' }] } }), true);
  assert.equal(parseUserProjectConfig({ hub: true }).hub, true);
  assert.equal(parseUserProjectConfig({ projects: { jucontroler: { name: 'JuControler', goal: '허브' } } }).hub, true);
  const broken = { board: null };
  Object.defineProperty(broken, 'configured', { get() { throw new Error('boom'); } });
  assert.equal(hubCardVisible(broken), false);
});

test('settings hides the hub card until a hub is detected, and a missing board does not throw', async () => {
  const src = await read('src/frontend/App.tsx');
  const start = src.indexOf('function HubPromoteCard');
  assert.ok(start >= 0);
  const block = src.slice(start, src.indexOf('const SCHEDULE_TIME_PATTERN', start));
  const guard = block.indexOf('if (!shown) return null');
  const lead = block.indexOf('JuControler 허브에 새 버전을 올리려면 반영하기를 눌러 주세요.');
  assert.ok(guard >= 0 && lead > guard, 'the hub sentence stays behind the detection guard');
  assert.match(block, /hubCardVisible\(\{ configured: projectHubConfigured\(\), board \}\)/);
  assert.match(block, /catch \{\s*board = null;/);
  assert.match(block, /반영하기/);
  assert.doesNotMatch(block, /window\.(alert|confirm|prompt)/);
  assert.equal(src.includes('/home/skkse12'), false);
  assert.match(src, /installUserProjectConfig\(s\)/);
  assert.match(src, /<HubPromoteCard \/>/);
});
});
