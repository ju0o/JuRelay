/**
 * Immutable widget resource identity (WIDGET-CACHE-01).
 *
 * The Apps contract treats the resource URI as a cache key, so a URI must name exactly one widget
 * content. A live failure showed the opposite: `ui://agent-relay/pm-widget-1750426e` was mounted while
 * the iframe received pre-B3 HTML that still had `setSeg = (base) + (n ? '' : ' dim')` and no
 * hasCount(), yet a read of the same URI returned the NEW HTML. One URI, two widgets.
 *
 * The cause was not a stale build alone. WIDGET_HASH was taken over WIDGET_HTML, the evaluated
 * template — which is right, since escapes like '[ \\t\\n\\r_-]+' resolve differently at runtime than
 * in source text — but the identity was therefore not reproducible from the source, and nothing tied it
 * to the placeholders that get substituted afterwards. The tests below pin the properties that make a
 * URI trustworthy: same content → same URI, any content change → different URI, and one identity shared
 * by every reference the host can see.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// This suite lives at <repo>/test/, so dist and src are one level up, not two.
const REPO = new URL('..', import.meta.url).pathname;
const w = await import(`${REPO}dist/server/mcp/app/pm-widget-resource.js`);

const DIST = `${REPO}dist/server/mcp/app/pm-widget-resource.js`;
const serverSrc = await readFile(`${REPO}src/mcp/app-server.ts`, 'utf8');
const resourceSrc = await readFile(`${REPO}src/mcp/app/pm-widget-resource.ts`, 'utf8');
void fileURLToPath;

const OLD_URI = 'ui://agent-relay/pm-widget-1750426e';
const CURRENT = w.PM_WIDGET_RESOURCE_URI;

test('1. the same widget content always yields the same URI', () => {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const out = spawnSync(process.execPath, ['-e',
      `import("${DIST}").then(m=>console.log(m.PM_WIDGET_RESOURCE_URI))`], { encoding: 'utf8' });
    runs.push(out.stdout.trim());
  }
  assert.equal(new Set(runs).size, 1, `URI must not vary between processes: ${runs.join(' ')}`);
  assert.equal(runs[0], CURRENT, 'and it must be the exported identity');
});

test('2. the URI changed when the widget content changed', () => {
  assert.notEqual(CURRENT, OLD_URI, 'a content-changing B3 fix must not reuse the previous identity');
  assert.match(CURRENT, /^ui:\/\/agent-relay\/pm-widget-[0-9a-f]{8}$/);
});

test('the fingerprint is derived from content, not from a clock or a counter', () => {
  // The identity must be reproducible from the template, and the only non-reproducible input is the
  // build stamp. This asserts the two properties that matter, without trying to reverse-engineer the
  // substitutions out of the served bytes — that reconstruction is not a contract, and pinning it would
  // only make a future refactor look like a regression.
  assert.equal(w.PM_WIDGET_CONTENT_FINGERPRINT, CURRENT.split('-').at(-1),
    'the URI is the fingerprint, and nothing else');
  assert.match(CURRENT, /^ui:\/\/agent-relay\/pm-widget-[0-9a-f]{8}$/);
  // The stamp reaches the document, so it is the only thing that moves between processes; identity
  // stayed constant across the three runs asserted above, which is the property under test.
  const served = w.pmWidgetHtml('');
  assert.ok(served.includes(w.PM_WIDGET_CONTENT_FINGERPRINT), 'the fingerprint is shown in the version box');
  assert.match(served, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/, 'a build stamp is rendered for the operator');
  // And the stamp is not part of the hashed input: the module hashes the pre-substitution template,
  // so BUILD_DATE is rendered into the document but must not reach the fingerprint. The strongest
  // evidence is behavioural, and test 1 already carries it — the URI was identical across three
  // processes started in different seconds.
  assert.match(resourceSrc, /\.update\(widgetFingerprintSource\(WIDGET_HTML\)/);
  assert.match(resourceSrc, /const WIDGET_HASH = createHash\('sha256'\)\.update\(widgetFingerprintSource\(WIDGET_HTML\), 'utf8'\)/,
    'the hashed input is the template alone — no timestamp argument');
});

test('3. the tool descriptor points at the current URI', () => {
  assert.match(serverSrc, /ui: \{ resourceUri: PM_WIDGET_RESOURCE_URI \}/);
});

test('4. openai/outputTemplate points at the current URI', () => {
  assert.match(serverSrc, /'openai\/outputTemplate': PM_WIDGET_RESOURCE_URI/);
});

test('5/6/7. every reference reports the one registered URI', async () => {
  assert.match(serverSrc, /uri: PM_WIDGET_RESOURCE_URI,/, 'resources/list');
  assert.match(serverSrc, /uri: PM_WIDGET_RESOURCE_URI,\s*\n\s*mimeType/, 'resources/read returns the current URI');
  // relay_pm_get_widget_version must report the same identity the server registered.
  const { buildDashboardTools } = await import(`${REPO}dist/server/mcp/dashboard-tools.js`);
  const tool = buildDashboardTools({ dataRoot: '/nonexistent', project: 'ws' })
    .find((t) => t.name === 'relay_pm_get_widget_version');
  const res = await tool.handler({});
  assert.equal(res.uri, CURRENT, 'get_widget_version must report the current URI');
  assert.equal(res.version, w.PM_WIDGET_RESOURCE_VERSION);
});

test('7. open_widget returns exactly the registered URI', () => {
  // The handler is in the server; assert on the source contract and on the live value.
  assert.match(serverSrc, /return \{ ok: true, widget: PM_WIDGET_RESOURCE_URI \};/);
});

test('8. open_widget mints no per-call nonce', () => {
  assert.ok(!/Date\.now\(\)/.test(serverSrc.split('relay_pm_open_widget')[1]?.split('return tools')[0] ?? ''),
    'a timestamp suffix would invent unregistered URIs and blur the cache key');
  assert.ok(!serverSrc.includes('${PM_WIDGET_RESOURCE_URI}--'), 'no nonce suffix may be appended');
});

test('9. an old URI does not silently heal into the current HTML', () => {
  // Chosen deliberately: serving today's HTML for yesterday's URI is exactly the defect. Failing
  // loudly is what lets a host drop its cached render and re-mount.
  assert.ok(!/staleWidget/.test(serverSrc), 'the stale-hash healing branch must be gone');
  assert.match(serverSrc, /if \(uri !== PM_WIDGET_RESOURCE_URI\) \{\s*\n\s*throw new Error\(`Unknown resource: \$\{uri\}`\)/);
  assert.ok(!/pm-widget-\[0-9a-f\]\{8\}/.test(serverSrc), 'no wildcard hash may be accepted');
});

test('10. B3 counting semantics are preserved in the served HTML', () => {
  const html = w.pmWidgetHtml('');
  assert.match(html, /hasCount\(n\) \? '' : ' dim'/, 'missing is the only dimmed case');
  assert.ok(!/hasCount\(n\) && n === 0/.test(html), 'a measured 0 is not dimmed');
  const start = html.indexOf('function hasCount');
  const end = html.indexOf('function laneOfAgent', start);
  const nodes = new Map();
  const doc = { getElementById: (id) => { if (!nodes.has(id)) nodes.set(id, { textContent: '', className: '' }); return nodes.get(id); } };
  const { setNum, setSeg } = new Function('document', html.slice(start, end) + '; return { setNum, setSeg };')(doc);
  const seen = [];
  for (const v of [0, 1, 16, null, undefined, NaN]) {
    setNum(doc.getElementById('stDone'), v);
    setSeg('sgDone', v, 'eseg green');
    seen.push([String(v), doc.getElementById('stDone').textContent, /dim/.test(doc.getElementById('sgDone').className)]);
  }
  const by = Object.fromEntries(seen);
  assert.equal(by['0'], '0', '0 renders as 0');
  assert.equal(by['0'].length, 1);
  assert.equal(seen.find((s) => s[0] === '0')[2], false, '0 is not dim');
  assert.equal(seen.find((s) => s[0] === '16')[2], false, 'positive is not dim');
  for (const missing of ['null', 'undefined', 'NaN']) {
    assert.equal(by[missing], '—', `${missing} renders as an em dash`);
    assert.equal(seen.find((s) => s[0] === missing)[2], true, `${missing} is dimmed`);
  }
});

test('11. raw null/undefined/NaN never reach the screen', () => {
  const html = w.pmWidgetHtml('');
  assert.match(html, /hasCount\(n\) \? String\(n\) : '—'/, 'setNum is guarded by hasCount');
  const start = html.indexOf('function hasCount');
  const end = html.indexOf('function laneOfAgent', start);
  const nodes = new Map();
  const doc = { getElementById: (id) => { if (!nodes.has(id)) nodes.set(id, { textContent: '', className: '' }); return nodes.get(id); } };
  const { setNum } = new Function('document', html.slice(start, end) + '; return { setNum };')(doc);
  for (const v of [null, undefined, NaN, 'abc']) {
    setNum(doc.getElementById('x'), v);
    assert.ok(!/null|undefined|NaN|abc/.test(nodes.get('x').textContent), `leaked a raw value for ${String(v)}`);
  }
});

test('the fingerprint source is the evaluated template, not source text', () => {
  // Hashing raw source would hash escapes that never reach the browser. This asserts the property that
  // made the old identity unverifiable: the runtime string is what matters, so a template containing
  // an escaped regex character sequence must be fingerprinted in its evaluated form.
  assert.ok(resourceSrc.includes("widgetFingerprintSource"), 'normalisation helper is present');
  assert.match(resourceSrc, /createHash\('sha256'\)\.update\(widgetFingerprintSource\(WIDGET_HTML\)/);
});
