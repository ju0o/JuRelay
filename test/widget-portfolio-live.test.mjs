/**
 * The portfolio on the widget surface (3rd stage, 2026-09-29).
 *
 * The runner already publishes what it is doing (title, AI, pid, alive) and the dashboard already
 * returns it. This file guards the last hop: the widget must read the `portfolio` key (the interim
 * `qa` key is gone), must not put a machine queue into the Founder's own column, and must cost
 * nothing while nobody is looking at it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const src = fs.readFileSync(path.join(repo, 'src/mcp/app/pm-widget-resource.ts'), 'utf8');

/** Run the widget's real humanTitle() against a captured slice of the bundle. */
function humanTitleFor(title, taskId = 'FALLBACK-ID') {
  const i = src.indexOf('var TITLE_WORDS');
  const j = src.indexOf('function applyQaCapacity', i);
  assert.ok(i > 0 && j > i, 'the title helper is present in the bundle');
  const t = (k) => (k === 'liveTaskWord' ? '작업' : k);
  const { humanTitle } = new Function('t', `${src.slice(i, j)}; return { humanTitle };`)(t);
  return humanTitle(title, taskId);
}

test('T1 the widget reads qa out of dash.portfolio', () => {
  assert.match(src, /pipeLive = \{ builders: \(pf && pf\.builders\) \|\| \[\], qa: \(pf && pf\.qa\) \|\| \[\] \}/,
    'the live lists come from the portfolio mirror');
  assert.ok(!/dash && dash\.qa|\(dash && dash\.qa\)/.test(src), 'the removed `qa` key is not read anywhere');
});

test('T2 the widget reads builders out of dash.portfolio', () => {
  assert.match(src, /pf = \(dash && dash\.portfolio\) \|\| null/);
  assert.match(src, /id="liveB"/, 'a container exists for the build list');
});

test('T3 capacity is read from flat keys, as the dashboard writes them', () => {
  assert.match(src, /pipeQaWait = cap && typeof cap\.qaWaiting === 'number'/, 'qaWaiting is read flat');
  assert.ok(!/cap\.capacity\./.test(src), 'no nested capacity object is expected');
});

test('T4 a Korean title is shown verbatim', () => {
  assert.equal(humanTitleFor('처음 규칙을 바로 보여주고 기억해요', 'JUAI-CHECK-RULE-FIRST-POST'),
    '처음 규칙을 바로 보여주고 기억해요');
  assert.equal(humanTitleFor('AI 순서 화면은 그대로 두고 검사 명령어 고치기', 'JCAPP-AI-ORDER-PLAIN-R3'),
    'AI 순서 화면은 그대로 두고 검사 명령어 고치기');
});

test('T5 an id-shaped title is translated word by word', () => {
  assert.equal(humanTitleFor('JUCONTROLER-V0-STATUS-CLI-RUN', 'X'), '컨트롤러 · v0 · 상태 · 명령줄 · 실행');
  assert.equal(humanTitleFor('JUCEIPTPLAN-QA-NOTES-VALID-JOIN', 'X'), '영수증 계획 · 검사 · 메모 · 검증 · 결합');
  assert.ok(!/-/.test(humanTitleFor('JUAI-CHECK-RULE-FIRST-POST', 'X')), 'no hyphen survives');
});

test('T6 a task counter reads as a number, not two words', () => {
  assert.equal(humanTitleFor('TASK-0044', 'TASK-0044'), '작업 0044');
});

test('T6b an unknown word degrades to readable text, and a missing title to the id', () => {
  const unknown = humanTitleFor('JUAI-WIDGET-SOMETHING-UNMAPPED', 'X');
  assert.ok(unknown.length > 0 && !/-/.test(unknown), `still readable: ${unknown}`);
  assert.equal(humanTitleFor(undefined, 'JUAI-CHECK-ANSWER-STORE'), 'JUAI-CHECK-ANSWER-STORE');
  assert.equal(humanTitleFor('', 'JUCEIPT-DAILY-REVIEW-NO-OPEN'), 'JUCEIPT-DAILY-REVIEW-NO-OPEN');
  assert.equal(humanTitleFor('   ', 'X'), 'X', 'whitespace is not a title');
});

test('T7 a missing portfolio keeps the previous screen instead of blanking it', () => {
  assert.match(src, /pipeLive = \{ builders: \(pf && pf\.builders\) \|\| \[\], qa: \(pf && pf\.qa\) \|\| \[\] \}/,
    'a null portfolio yields empty lists, not a throw');
  assert.match(src, /<div class="live-empty">' \+ esc\(t\('liveNoQa'\)\)/, 'an empty QA lane explains itself');
  assert.match(src, /<div class="live-empty">' \+ esc\(t\('liveNoBuild'\)\)/, 'an empty build lane explains itself');
  // And the legacy ws agent path still runs, so an older runner does not blank the board.
  assert.match(src, /renderAgents\(dash\)[\s\S]{0,400}activeAgents\(\(dash && dash\.agents\) \|\| \[\]\)/,
    'the ws agent list is still rendered');
});

test('T8 the runtime is secondary and the model is tooltip-only', () => {
  assert.match(src, /<span class="lr">' \+ runtime \+ '<\/span>/, 'the AI name is a muted aside');
  assert.match(src, /\.livecard \.lr \{[^}]*color:var\(--muted\)/, 'and it is dimmed');
  assert.ok(/class="lr"/.test(src) && !/class="lt"[^>]*>[^<]*\$\{[^}]*model/.test(src),
    'the model never reaches the visible line');
  assert.match(src, /e\.model \? ' · ' \+ esc\(e\.model\)/, 'it goes in the tooltip instead');
});

test('T9 the pipeline capacity label is still rendered', () => {
  assert.match(src, /id="pipeQaWait"/, 'the wait badge still exists');
  assert.match(src, /setPipeText\('pipeQa', pipeDoing \+ ' review'\)/, 'the review count is unchanged');
});

test('T10 ★ the "검토 중" lane never mixes in the machine queue', () => {
  const at = src.indexOf('id="laneNa"');
  assert.ok(at > 0);
  const laneHead = src.slice(at - 400, at + 160);
  for (const forbidden of ['qaWaiting', 'pipeQaWait', 'liveWait']) {
    assert.ok(!laneHead.includes(forbidden), `laneNa must not reference ${forbidden}`);
  }
  // The wait count belongs to lane C, on its own.
  assert.match(src, /setLaneCount\('laneNc', waiting\)/, 'the wait count is lane C');
  const laneC = src.slice(src.indexOf('id="laneNc"') - 400, src.indexOf('id="laneNc"') + 200);
  assert.ok(!laneC.includes('qaWaiting'), 'lane C shows a number, not per-task detail');
});

test('T11 ★ the widget never reads the 10 MB state.json', () => {
  const code = src.split('\n').map((l) => l.replace(/^\s*(\*|\/\/).*/, '')).join('\n');
  assert.ok(!code.includes('state.json'), 'state.json must not appear in executable code');
});

test('T12 the poll interval is 10s, not 1.5s', () => {
  assert.match(src, /var POLL_MS = 10000;/, 'a status board does not need sub-2-second updates');
});

test('T13 a hidden tab stops polling', () => {
  assert.match(src, /if \(document\.visibilityState === 'hidden'\) return;/, 'the tick is skipped while hidden');
});

test('T14 returning to the tab polls once immediately', () => {
  assert.match(src, /visibilitychange[\s\S]{0,200}visibilityState === 'visible'\) poll\(\)/,
    'catching up is immediate, not up to a full interval later');
});

test('T6c a dead pid is shown as stuck rather than as finished', () => {
  assert.match(src, /e && e\.alive === false/, 'alive:false is not silently ignored');
  assert.match(src, /class="ldead"/, 'and it is visibly distinct from a running task');
});
