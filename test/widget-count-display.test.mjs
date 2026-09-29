/**
 * Count rendering: a measured 0 is data, a missing count is not (P1, 2026-09-30).
 *
 * setNum used String(n), so an unmeasured counter rendered the literal words "null" or "undefined"
 * on the status strip, and setSeg treated every falsy value alike. Both collapse the difference
 * between "we counted and there are none" and "we have not counted yet" — which is the difference
 * between a board that says zero and a board that is broken.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const src = fs.readFileSync(path.resolve(import.meta.dirname, '../src/mcp/app/pm-widget-resource.ts'), 'utf8');

/** Run the widget's real setNum/setSeg against a minimal DOM. */
function load() {
  const i = src.indexOf('function hasCount');
  const j = src.indexOf('function setPipeText', i);
  assert.ok(i > 0 && j > i, 'the count helpers exist in the bundle');
  const nodes = new Map();
  const doc = { getElementById: (id) => { if (!nodes.has(id)) nodes.set(id, { id, textContent: '', className: '' }); return nodes.get(id); } };
  const api = new Function('document', `${src.slice(i, j)}; return { setNum, setSeg, hasCount };`)(doc);
  return { ...api, nodes, doc };
}

test('a measured 0 renders as "0", not as a blank and not as a word', () => {
  const { setNum, nodes, doc } = load();
  setNum(doc.getElementById('stDone'), 0);
  assert.equal(nodes.get('stDone').textContent, '0', 'zero is a real answer');
  setNum(doc.getElementById('stReview'), 0);
  assert.equal(nodes.get('stReview').textContent, '0');
});

test('a positive count renders normally', () => {
  const { setNum, setSeg, nodes, doc } = load();
  setNum(doc.getElementById('stGoals'), 16);
  setSeg('sgGoals', 16, 'eseg muted');
  assert.equal(nodes.get('stGoals').textContent, '16');
  assert.ok(!/dim/.test(nodes.get('sgGoals').className), 'a populated segment is not dimmed');
});

test('a missing count never reaches the screen as the word null or undefined', () => {
  const { setNum, nodes, doc } = load();
  for (const missing of [null, undefined, NaN, 'abc']) {
    setNum(doc.getElementById('stDone'), missing);
    const shown = nodes.get('stDone').textContent;
    assert.ok(!/null|undefined|NaN|abc/.test(shown), `leaked a raw value: ${shown}`);
    assert.notEqual(shown, '0', 'unmeasured must be distinguishable from zero');
  }
});

test('0 and missing are treated differently by the segment too', () => {
  const { setSeg, nodes, doc } = load();
  setSeg('sgDone', 0, 'eseg green');
  const zero = nodes.get('sgDone').className;
  setSeg('sgDone', 16, 'eseg green');
  const full = nodes.get('sgDone').className;
  setSeg('sgDone', null, 'eseg green');
  const missing = nodes.get('sgDone').className;
  // PM contract: 0 and a positive count are both real, measured answers. Only an unmeasured counter is
  // dimmed. An earlier version dimmed 0, which made "nothing to report" and "nothing to show yet" the
  // same picture — the one distinction this status strip exists to make.
  assert.ok(!/dim/.test(zero), 'a measured 0 is not dimmed');
  assert.ok(!/dim/.test(full), 'a positive count is not dimmed');
  assert.ok(/dim/.test(missing), 'only an unmeasured counter is dimmed');
  assert.notEqual(zero, missing, 'unmeasured is not the same state as zero');
});

test('only an unmeasured counter is dimmed', () => {
  const { setSeg, nodes, doc } = load();
  for (const measured of [0, 1, 4, 16, 100]) {
    setSeg('sgDone', measured, 'eseg green');
    assert.ok(!/dim/.test(nodes.get('sgDone').className), `${measured} is a real value and stays normal`);
  }
  for (const missing of [null, undefined, NaN, 'abc', {}]) {
    setSeg('sgDone', missing, 'eseg green');
    assert.ok(/dim/.test(nodes.get('sgDone').className), `${String(missing)} is unmeasured and is dimmed`);
  }
});

test('every status-strip counter goes through the guarded path', () => {
  // If a caller writes String(n) into these directly, the regression is back.
  for (const id of ['stReview', 'stCoding', 'stDone', 'stGoals']) {
    assert.ok(src.includes(`setNum(st${id.slice(2)}El`), `${id} is written through setNum`);
  }
  assert.ok(!/textContent = String\((doing|working|doneCount|gTotal)\)/.test(src), 'no caller bypasses setNum');
});
