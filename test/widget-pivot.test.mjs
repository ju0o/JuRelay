/**
 * Widget pivot pins: info-density redesign (avatar 32x48, name mapping,
 * strip+badges, no CSS truncation). Client functions are extracted from the
 * built HTML and executed, so tests pin the shipped code (zero drift).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const m = await import('../dist/server/mcp/app/pm-widget-resource.js');
const html = m.pmWidgetHtml('https://example.invalid/w');

describe('shipped script parses (no template-escape breakage)', () => {
  it('client <script> compiles clean', () => {
    const sc = html.match(/<script>([\s\S]*)<\/script>/)[1];
    assert.doesNotThrow(() => new vm.Script(sc), 'served JS must parse');
  });
  it('every getElementById target exists in static DOM', () => {
    const used = new Set([...html.matchAll(/getElementById\('([^']+)'\)/g)].map(x => x[1]));
    const defined = new Set([...html.matchAll(/id="([^"]+)"/g)].map(x => x[1]));
    const missing = [...used].filter(id => !defined.has(id));
    assert.deepEqual(missing, [], 'dangling DOM refs (agentsEl-class bug): ' + missing.join(','));
  });
});

function extractVar(src, name) {
  if (name === 'SEP_RE' || name === 'AGENT_WORDS') {
    // Served HTML holds real control chars (valid \t\n\r escapes evaluated).
    const m = src.match(new RegExp('var ' + name + ' = [\\s\\S]*?;'));
    assert.ok(m, 'client var ' + name + ' present');
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
  extractVar(html, 'AGENT_WORDS'),
  extractVar(html, 'PAREN_KO'),
  extractVar(html, 'FILLERS'),
  extractFn(html, 'mapFirst'),
  extractFn(html, 'stripVersions'),
  extractFn(html, 'coreShort'),
  extractFn(html, 'tokensOf'),
  extractFn(html, 'parenRole'),
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
  it('SEND-2 name table: 7 examples match exactly', () => {
    const rows = [
      [{ displayName: 'Builder via Claude Code (Pro profile, relay path, acceptEdits)' }, 'Claude Code', 'Pro profile'],
      [{ displayName: 'Semantic QA via Codex CLI (read-only)' }, 'QA', 'Codex'],
      [{ displayName: 'Builder via Codex CLI (config default model)' }, 'Codex', '기본 모델'],
      [{ displayName: 'V0.2-B Codex 0.153.4 Managed' }, 'Managed', 'V0.2-B'],
      [{ displayName: 'Builder via live Agent Relay checkout' }, 'live checkout', 'relay'],
      [{ displayName: 'Builder via OpenCode (free tier only)' }, 'OpenCode', 'free tier'],
      [{ displayName: 'Builder via Cline (cline-pass OAuth)' }, 'Cline', 'OAuth'],
    ];
    for (const [a, name, role] of rows) {
      const r = client.normalizeAgent(a);
      assert.equal(r.name, name, JSON.stringify(a));
      assert.equal(r.role, role, JSON.stringify(a));
    }
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
      assert.ok(r.role.length > 0 && r.role.length <= 16, `role sane: ${r.role}`);
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
  it('dig 20x30 -> 80px bg, -80px offset, steps(4)', () => {
    const el = fakeEl();
    assert.equal(client.applySheet(el, 'dig', 20, 30), true);
    assert.equal(el.style.backgroundSize, '80px 30px');
    assert.equal(el._props['--sheetW'], '-80px');
    assert.match(el.style.animation, /steps\(4\)/);
    assert.ok(el.style.backgroundImage.includes('dig-sheet.png'));
  });
  it('run 24x36 -> 144px steps(6); climb 48x74', () => {
    const r = fakeEl();
    client.applySheet(r, 'run', 24, 36);
    assert.equal(r.style.backgroundSize, '144px 36px');
    assert.match(r.style.animation, /steps\(6\)/);
    const c = fakeEl();
    client.applySheet(c, 'climb', 48, 74);
    assert.equal(c.style.backgroundSize, '192px 74px');
    assert.equal(c._props['--sheetW'], '-192px');
  });
  it('durations preserved per state', () => {
    const e = fakeEl();
    client.applySheet(e, 'dig', 20, 30);
    assert.match(e.style.animation, /0\.62s/);
    const e2 = fakeEl();
    client.applySheet(e2, 'idle', 20, 30);
    assert.match(e2.style.animation, /2\.6s/);
  });
});

describe('layout contract (P1-P5, H1-H4)', () => {
  it('no CSS ellipsis anywhere (P3: data-level shortening only)', () => {
    assert.ok(!html.includes('text-overflow'));
  });
  it('lanes + chips + strip + badges (A-plan, no card grid)', () => {
    assert.ok(!html.includes('repeat(2,1fr)') && !html.includes('crew-grid'), 'card grid removed');
    assert.ok(html.includes('.cav') && html.includes('width:20px') && html.includes('height:30px'));
    assert.ok(html.includes('id="lanes"') && html.includes('lane-a') && html.includes('lane-b') && html.includes('lane-c'));
    assert.ok(html.includes('chipHtml') && html.includes('laneOfAgent'), 'lane/chip renderers present');
    assert.ok(html.includes('id="chipsA"') && html.includes('id="chipsB"') && html.includes('id="chipsC"'));
    for (const id of ['bCrew', 'bLadder', 'bWbs', 'stAgents', 'stReview', 'stDone', 'stGoals', 'stNote', 'headDone', 'headTotal', 'laneNa', 'laneNb', 'laneNc', 'chipsA', 'chipsB', 'chipsC', 'barA', 'barB']) {
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
    assert.ok(html.includes("runner.style.top = '60px'"));
  });
  it('chip structure (avatar+name+role, no tag) + title preservation', () => {
    assert.ok(html.includes('cav-miss') && html.includes('ctx') && html.includes('laneOfAgent'));
    assert.ok(html.includes('norm.full'), 'full name kept in title');
  });
  it('A-plan palette, lane variants, selfcheck, bundle cap', () => {
    for (const hex of ['#4a9eff', '#f0b429', '#2ea86a', '#5c6470', '#8b7bd8']) {
      assert.ok(html.includes(hex), hex);
    }
    assert.ok(html.includes('#1e1a12') && html.includes('#141d29'), 'per-lane bg variants');
    assert.ok(html.includes('height:3px'), 'progress bar 3px');
    assert.ok(html.includes('id="selfcheck"') && html.includes('renderSelfcheck'), 'selfcheck block');
    assert.ok(html.includes('80px') || html.includes('want 80px'), 'sheetW sanity target');
    assert.ok(html.length < 100 * 1024, 'bundle <100KB, got ' + html.length);
  });
  it('dual CSP meta (ui.csp + legacy openai/widgetCSP)', () => {
    const meta = m.widgetResourceMeta('https://mcp.relay-agent.site/widgets/crew');
    assert.deepEqual(meta.ui.csp.resourceDomains, ['https://mcp.relay-agent.site']);
    assert.deepEqual(meta.ui.csp.connectDomains, ['https://mcp.relay-agent.site']);
    assert.deepEqual(meta['openai/widgetCSP'].resource_domains, ['https://mcp.relay-agent.site']);
    assert.deepEqual(meta['openai/widgetCSP'].connect_domains, ['https://mcp.relay-agent.site']);
  });
  it('CDN base derives jsdelivr origin for sandbox allowlist', () => {
    const cdn = m.widgetResourceMeta('https://cdn.jsdelivr.net/gh/ju0o/Agent-Relay@widgets-crew-v1/public/widgets/crew');
    assert.deepEqual(cdn.ui.csp.resourceDomains, ['https://cdn.jsdelivr.net']);
    assert.deepEqual(cdn['openai/widgetCSP'].resource_domains, ['https://cdn.jsdelivr.net']);
  });
  it('sprite failure surfaces visibly on cards and stages', () => {
    assert.ok(html.includes('스프라이트 로드 실패'), 'named sheet error text present');
    assert.ok(html.includes('markSheetMissing'), 'stage fallback marker present');
    assert.ok(html.includes('sheet-missing'), 'missing-slot style present');
  });
});
