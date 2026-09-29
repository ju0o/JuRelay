/**
 * B2 — the translation-mixing report, re-verified before any change (P1, 2026-09-30).
 *
 * Dogfood reported the widget showing "Builder" as "빌derr" and "안정적이고 뜨겁다" (Korean with
 * Japanese mixed in). This file does not fix anything. It pins what the title helper actually does
 * with non-ASCII input, so the verdict rests on a reproduction rather than on the report.
 *
 * The reported strings appear nowhere in the widget source, and the widget renders raw JSON titles
 * without rewriting them. So the question is narrow: can humanTitle() itself introduce a foreign
 * script into a Korean title? If it cannot, the mixing came from outside this code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const src = fs.readFileSync(path.resolve(import.meta.dirname, '../src/mcp/app/pm-widget-resource.ts'), 'utf8');

function load() {
  const i = src.indexOf('var TITLE_WORDS');
  const j = src.indexOf('function applyQaCapacity', i);
  assert.ok(i > 0 && j > i, 'the title helper exists');
  const t = (k) => (k === 'liveTaskWord' ? '작업' : k);
  return new Function('t', `${src.slice(i, j)}; return { humanTitle };`)(t).humanTitle;
}

const JAPANESE = /[\u3040-\u30ff]/;

test('a Korean sentence is returned byte-for-byte, with no translation pass', () => {
  const humanTitle = load();
  for (const title of ['완전히 한국어 문장입니다', '처음 규칙을 바로 보여주고 기억해요', 'AI 순서 화면은 그대로 두고 검사 명령어 고치기']) {
    assert.equal(humanTitle(title, 'ID'), title, 'a written Korean title is never reformatted');
  }
});

test('a mixed Korean/English title keeps both scripts unchanged', () => {
  const humanTitle = load();
  assert.equal(humanTitle('mixed 한국어 English 문장', 'ID'), 'mixed 한국어 English 문장');
});

test('humanTitle never introduces Japanese into any input', () => {
  const humanTitle = load();
  const inputs = [
    '완전히 한국어 문장입니다',
    'mixed 한국어 English 문장',
    'ΑΝΑΓΝΩΣΤΟ',
    'İstanbul-ANADOLU',
    'JUCONTROLER-V0-STATUS-CLI-RUN',
    'JUAI-CHECK-RULE-FIRST-POST',
    'TASK-0044',
    '',
  ];
  for (const input of inputs) {
    const out = humanTitle(input, 'ID');
    assert.equal(typeof out, 'string', `a string is always returned for ${JSON.stringify(input)}`);
    assert.ok(!JAPANESE.test(out), `no Japanese for ${JSON.stringify(input)} → ${JSON.stringify(out)}`);
  }
});

test('a Japanese input is passed through untouched, not transliterated', () => {
  const humanTitle = load();
  // It contains no space, so it takes the id-translation path. The result must still be the same
  // script as the input — a translation step that could not read it must not substitute another one.
  const out = humanTitle('日本語のタイトル', 'ID');
  assert.equal(JAPANESE.test(out), true, 'the original script survives unchanged');
  assert.ok(!/번역|의역/.test(out), 'nothing was rewritten');
});

test('a missing title falls back to the taskId, so a card is never blank', () => {
  const humanTitle = load();
  for (const missing of [undefined, null, '', '   ']) {
    const out = humanTitle(missing, 'JUAI-CHECK-ANSWER-STORE');
    assert.equal(out, 'JUAI-CHECK-ANSWER-STORE', `fallback for ${JSON.stringify(missing)}`);
  }
});

test('the reported strings are not produced by this codebase', () => {
  for (const artefact of ['ビルド', '빌derr', '안정적이고 뜨겁다', '静かな']) {
    assert.ok(!src.includes(artefact), `${artefact} must not exist in the widget source`);
  }
});
