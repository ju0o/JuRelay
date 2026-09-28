/**
 * Widget pivot pins: info-density redesign (avatar 32x48, name mapping,
 * strip+badges, no CSS truncation). Client functions are extracted from the
 * built HTML and executed, so tests pin the shipped code (zero drift).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const m = await import('../dist/server/mcp/app/pm-widget-resource.js');
const html = m.pmWidgetHtml('https://example.invalid/w');

function extractVar(src, name) {
  if (name === 'SEP_RE') {
    // Served HTML holds real control chars (valid \t\n\r escapes evaluated).
    const m = src.match(/var SEP_RE = [\s\S]*?;/);
    assert.ok(m, 'client var SEP_RE present');
    return m[0];
  }
  const rx = new RegExp('var ' + name + ' = ');
  const i = src.search(rx);
  assert.ok(i >= 0, 'client var ' + name + ' present');
  let j = i + ('var ' + name + ' = ').length;
  const open = src[j];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === open) depth++;
    if (src[k] === close) { depth--; if (depth === 0) return src.slice(i, k + 1) + ';'; }
  }
  throw new Error('unbalanced ' + name);
}

function extractFn(src, name) {
  const rx = new RegExp('function ' + name + '\\(');
  const i = src.search(rx);
  assert.ok(i >= 0, 'client fn ' + name + ' present');
  const start = src.lastIndexOf('function', i);
  let k = src.indexOf('{', i);
  let depth = 0;
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    if (src[k] === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); }
  }
  throw new Error('unbalanced fn ' + name);
}

const clientSrc = [
  'var ASSET_BASE = \'https://example.invalid/w\';',
  'var sheetStatus = {};',
  extractVar(html, 'SEP_RE'),
  extractVar(html, 'FRAMES'),
  extractVar(html, 'DURS'),
  extractVar(html, 'SHEET_W'),
  extractVar(html, 'NAME_MAP'),
  extractVar(html, 'ROLE_MAP'),
  extractVar(html, 'KO_WORD'),
  extractFn(html, 'mapFirst'),
  extractFn(html, 'firstWord'),
  extractFn(html, 'capName'),
  extractFn(html, 'normalizeAgent'),
  extractFn(html, 'shortTaskTitle'),
  extractFn(html, 'sheetUrl'),
  extractFn(html, 'applySheet'),
].join('\n');

const client = new Function(`
${clientSrc}
return { normalizeAgent, capName, shortTaskTitle, sheetUrl, applySheet };
`)();

function fakeEl() {
  const props = {};
  return { style: { setProperty(k, v) { props[k] = v; } }, _props: props };
}

describe('name normalization (R1-R6)', () => {
  it('R1 splits role: "Builder via live checkout" -> Live/Builder', () => {
    const r = client.normalizeAgent({ displayName: 'Builder via live checkout', workerId: 'builder-x' });
    assert.equal(r.name, 'Live');
    assert.equal(r.role, 'Builder');
    assert.equal(r.full, 'Builder via live checkout');
  });
  it('R3 dictionary mapping', () => {
    assert.deepEqual(
      [client.normalizeAgent({ workerId: 'worker-claude-code' }).name,
       client.normalizeAgent({ workerId: 'worker-claude-code' }).role],
      ['Claude', 'Code']);
    assert.deepEqual(
      [client.normalizeAgent({ workerId: 'builder-codex' }).name,
       client.normalizeAgent({ workerId: 'builder-codex' }).role],
      ['Codex', 'Code']);
    assert.deepEqual(
      [client.normalizeAgent({ workerId: 'probe-1' }).name,
       client.normalizeAgent({ workerId: 'probe-1' }).role],
      ['Probe', 'QA']);
    assert.deepEqual(
      [client.normalizeAgent({ workerId: 'builder-opencode', displayName: 'OpenCode 일꾼' }).name,
       client.normalizeAgent({ workerId: 'builder-opencode', displayName: 'OpenCode 일꾼' }).role],
      ['Builder', 'Build']);
  });
  it('R2 strips Builder/Worker/Agent prefixes', () => {
    assert.equal(client.normalizeAgent({ displayName: 'Worker opencode-2' }).name, 'opencode-2');
  });
  it('R3 unknown -> Agent; R4 key noun: long phrase -> 품질 검증', () => {
    assert.equal(client.normalizeAgent({}).name, 'Agent');
    assert.equal(client.normalizeAgent({ displayName: 'Semantic Quality Assurance' }).name, '품질 검증');
  });
  it('R4/R6 caps hold across the battery', () => {
    const battery = [
      {}, { displayName: 'x' }, { displayName: 'Builder via live checkout' },
      { workerId: 'builder-codex' }, { workerId: 'qa-opencode', displayName: '검수 일꾼' },
      { displayName: 'Semantic Quality Assurance' },
      { displayName: 'AQuiteLongEnglishWorkerNameForTesting' },
      { displayName: '열글자가넘어가는아주긴한국이름테스트' },
      { displayName: 'Codex' }, { displayName: 'Claude' }, { displayName: 'Probe' },
      { displayName: 'Live' }, { displayName: null, workerId: null },
    ];
    for (const a of battery) {
      const r = client.normalizeAgent(a);
      const cps = Array.from(r.name);
      if (/[가-힣]/.test(r.name)) assert.ok(cps.length <= 10, `${r.name} <= 10ko`);
      else assert.ok(cps.length <= 16, `${r.name} <= 16en`);
      assert.ok(r.role.length > 0 && r.role.length <= 10, `role sane: ${r.role}`);
    }
  });
  it('task titles shorten at data level (30), full kept', () => {
    const long = '이것은 서른 글자를 훌쩍 넘어가는 아주 긴 작업 제목입니다 정말로';
    const r = client.shortTaskTitle({ title: long });
    assert.ok(Array.from(r.text).length <= 30);
    assert.equal(r.full, long);
    assert.ok(!r.text.includes('…'));
  });
});

describe('avatar sheet geometry (display-size math)', () => {
  it('dig 32x48 -> 128px bg, -128px offset, steps(4)', () => {
    const el = fakeEl();
    assert.equal(client.applySheet(el, 'dig', 32, 48), true);
    assert.equal(el.style.backgroundSize, '128px 48px');
    assert.equal(el._props['--sheetW'], '-128px');
    assert.match(el.style.animation, /steps\(4\)/);
    assert.ok(el.style.backgroundImage.includes('dig-sheet.png'));
  });
  it('run 32x48 -> 192px steps(6); climb 64x98 -> 256px steps(4)', () => {
    const r = fakeEl();
    client.applySheet(r, 'run', 32, 48);
    assert.equal(r.style.backgroundSize, '192px 48px');
    assert.match(r.style.animation, /steps\(6\)/);
    const c = fakeEl();
    client.applySheet(c, 'climb', 64, 98);
    assert.equal(c.style.backgroundSize, '256px 98px');
    assert.equal(c._props['--sheetW'], '-256px');
  });
  it('durations preserved per state', () => {
    const e = fakeEl();
    client.applySheet(e, 'dig', 32, 48);
    assert.match(e.style.animation, /0\.62s/);
    const e2 = fakeEl();
    client.applySheet(e2, 'idle', 32, 48);
    assert.match(e2.style.animation, /2\.6s/);
  });
});

describe('layout contract (P1-P5, H1-H4)', () => {
  it('no CSS ellipsis anywhere (P3: data-level shortening only)', () => {
    assert.ok(!html.includes('text-overflow'));
  });
  it('responsive grid 2/3/4 cols + avatar + strip + badges', () => {
    assert.ok(html.includes('grid-template-columns:repeat(2,1fr)'));
    assert.ok(html.includes('@media (min-width:820px)') && html.includes('repeat(3,1fr)'));
    assert.ok(html.includes('@media (min-width:1180px)') && html.includes('repeat(4,1fr)'));
    assert.ok(html.includes('.avatar') && html.includes('width:32px') && html.includes('height:48px'));
    for (const id of ['bCrew', 'bLadder', 'bWbs', 'activeN', 'activeT', 'segWait', 'segDoing', 'segDone']) {
      assert.ok(html.includes('id="' + id + '"'), id);
    }
  });
  it('H1: hash/diag out of default view, inside folded debug', () => {
    const det = html.indexOf('<details');
    assert.ok(det > 0);
    assert.ok(html.indexOf('id="buildTag"') > det, 'buildTag inside details');
    assert.ok(html.indexOf('id="diag"') > det, 'diag inside details');
    assert.ok(html.indexOf('id="buildTag"') > html.indexOf('class="strip"'), 'no hash in header');
  });
  it('ladder RH=78 + bottom formula; WBS track 96 + runner top 48', () => {
    assert.ok(html.includes('var RH = 78;'));
    assert.ok(html.includes('16 + Math.max(cur, 0) * RH - 8'));
    assert.ok(html.includes('height:96px'));
    assert.ok(html.includes("runner.style.top = '48px'"));
  });
  it('3-line card structure with pill + title preservation', () => {
    assert.ok(html.includes('crew-top') && html.includes('class="role"') && html.includes('class="task1"'));
    assert.ok(html.includes('● '));
  });
  it('dual CSP meta (ui.csp + legacy openai/widgetCSP)', () => {
    const meta = m.widgetResourceMeta('https://mcp.relay-agent.site/widgets/crew');
    assert.deepEqual(meta.ui.csp.resourceDomains, ['https://mcp.relay-agent.site']);
    assert.deepEqual(meta.ui.csp.connectDomains, ['https://mcp.relay-agent.site']);
    assert.deepEqual(meta['openai/widgetCSP'].resource_domains, ['https://mcp.relay-agent.site']);
    assert.deepEqual(meta['openai/widgetCSP'].connect_domains, ['https://mcp.relay-agent.site']);
  });
  it('sprite failure surfaces visibly on cards and stages', () => {
    assert.ok(html.includes('스프라이트 로드 실패'), 'named sheet error text present');
    assert.ok(html.includes('markSheetMissing'), 'stage fallback marker present');
    assert.ok(html.includes('sheet-missing'), 'missing-slot style present');
  });
});
