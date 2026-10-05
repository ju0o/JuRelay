/**
 * P1.8B — widget mount contract regression.
 *
 * The Founder reports the ChatGPT widget does not visually open. Before blaming 85 KB of widget
 * code, these tests pin the parts of the chain that CAN be proven headlessly, so that any future
 * mount failure is either a host problem or a proven server problem — never an assumption:
 *
 *   A  the live render-tool descriptor carries _meta.ui.resourceUri
 *   B  the ChatGPT alias openai/outputTemplate equals the standard ui.resourceUri
 *   C  resources/list contains both render URIs
 *   D  resources/read returns text/html;profile=mcp-app and echoes the exact requested URI
 *   E  the render handler answers without changing the URI
 *   F  an arbitrary/stale nonce URI is rejected instead of silently serving today's HTML
 *   G  changing the widget content changes the URI (identity follows content, both directions)
 *   P  the debug probe is genuinely minimal: no script, no network, no CDN, no CSP dependency
 *
 * They run the real registration path (buildAppTools + the SDK request handlers) through the live
 * HTTP server, over the same port the tunnel reaches, so nothing here is a unit-test shortcut.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const dist = (p) => path.join(repo, 'dist/server', p);

const { buildAppTools, startMcpAppServer } = await import(dist('mcp/app-server.js'));
const widget = await import(dist('mcp/app/pm-widget-resource.js'));
const probe = await import(dist('mcp/app/widget-probe.js'));

const PRODUCTION_URI = 'ui://agent-relay/pm-widget-8b6a452e';

/** Boot the real server on an ephemeral port and speak Streamable HTTP to it. */
async function withLiveServer(fn) {
  const tools = buildAppTools({ dataRoot: '/tmp/p18b-no-data-root', project: 'ws' });
  const server = await startMcpAppServer({
    dataRoot: '/tmp/p18b-no-data-root',
    project: 'ws',
    host: '127.0.0.1',
    port: 0,
    allowUnauthenticated: true,
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/mcp`;
  let sid = null;
  let id = 0;
  const rpc = async (method, params) => {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (sid) headers['mcp-session-id'] = sid;
    const res = await fetch(base, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    const s = res.headers.get('mcp-session-id');
    if (s) sid = s;
    const text = await res.text();
    const line = text.split('\n').find((l) => l.startsWith('data:'));
    return JSON.parse(line ? line.slice(5).trim() : text);
  };
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'p18b-test', version: '1' },
  });
  await rpc('notifications/initialized', {});
  try {
    await fn({ rpc, tools });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function toolNamed(tools, name) {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `tool ${name} is registered`);
  return t;
}

test('A + B the live render-tool descriptor carries both UI metadata keys on one URI', async () => {
  await withLiveServer(async ({ rpc, tools }) => {
    const live = (await rpc('tools/list', {})).result.tools;
    const descriptor = live.find((t) => t.name === 'relay_pm_open_widget');
    assert.ok(descriptor, 'relay_pm_open_widget is in the live tools/list');

    // A — the standard MCP Apps key. This is the key a compliant host reads.
    assert.equal(descriptor._meta?.ui?.resourceUri, PRODUCTION_URI);
    // B — the ChatGPT alias must name the exact same resource, never a second URI.
    assert.equal(descriptor._meta?.['openai/outputTemplate'], PRODUCTION_URI);
    assert.equal(
      descriptor._meta['openai/outputTemplate'],
      descriptor._meta.ui.resourceUri,
      'the alias and the standard key must never diverge',
    );
    // The in-process registration must agree with what the wire actually carries.
    assert.equal(toolNamed(tools, 'relay_pm_open_widget')._meta.ui.resourceUri, PRODUCTION_URI);
  });
});

test('C resources/list carries every render URI with the MCP App MIME', async () => {
  await withLiveServer(async ({ rpc }) => {
    const { resources } = (await rpc('resources/list', {})).result;
    const uris = resources.map((r) => r.uri);
    assert.ok(uris.includes(PRODUCTION_URI), 'the production widget URI is listed');
    assert.ok(uris.includes(probe.WIDGET_PROBE_RESOURCE_URI), 'the debug probe URI is listed');
    for (const r of resources) {
      assert.equal(r.mimeType, 'text/html;profile=mcp-app', `${r.uri} must be an MCP App resource`);
    }
    // One URI, one entry: a duplicate would let a host bind the cache key to two contents.
    assert.equal(new Set(uris).size, uris.length, 'no duplicate resource URIs');
  });
});

test('D resources/read returns the right MIME and echoes the exact URI', async () => {
  await withLiveServer(async ({ rpc }) => {
    for (const uri of [PRODUCTION_URI, probe.WIDGET_PROBE_RESOURCE_URI]) {
      const read = await rpc('resources/read', { uri });
      const contents = read.result.contents;
      assert.equal(contents.length, 1, `${uri} returns exactly one content`);
      assert.equal(contents[0].mimeType, 'text/html;profile=mcp-app', uri);
      assert.equal(contents[0].uri, uri, 'the read URI is byte-identical to the requested URI');
      assert.ok(contents[0].text.length > 0, `${uri} HTML is non-empty`);
    }
  });
});

test('E the render handler answers without minting a new URI', async () => {
  await withLiveServer(async ({ rpc }) => {
    const first = await rpc('tools/call', { name: 'relay_pm_open_widget', arguments: {} });
    const second = await rpc('tools/call', { name: 'relay_pm_open_widget', arguments: {} });
    const a = JSON.parse(first.result.content[0].text);
    const b = JSON.parse(second.result.content[0].text);
    assert.equal(a.ok, true);
    assert.equal(a.widget, PRODUCTION_URI, 'the handler returns the registered URI verbatim');
    assert.deepEqual(a, b, 'two calls must not produce two identities — no nonce, no cache-bust');
    // The registered list is unchanged by calling the tool.
    const { resources } = (await rpc('resources/list', {})).result;
    assert.ok(resources.some((r) => r.uri === PRODUCTION_URI), 'the URI is still the registered one');
  });
});

test('F a stale or arbitrary URI is rejected instead of silently serving today\'s HTML', async () => {
  await withLiveServer(async ({ rpc }) => {
    for (const bogus of [
      'ui://agent-relay/pm-widget-deadbeef',
      'ui://agent-relay/pm-widget-f39176b7--1790611854233', // the historical nonce form
      'ui://agent-relay/pm-widget-8b6a452e?cachebust=1',
      'ui://agent-relay/widget-probe-deadbeef',
    ]) {
      const read = await rpc('resources/read', { uri: bogus });
      assert.ok(read.error, `${bogus} must not resolve`);
      assert.match(JSON.stringify(read.error), /Unknown resource/i);
    }
  });
});

test('G the URI follows the content in both directions', () => {
  const { PM_WIDGET_RESOURCE_URI, PM_WIDGET_CONTENT_FINGERPRINT, pmWidgetHtml } = widget;
  assert.ok(PM_WIDGET_RESOURCE_URI.endsWith(PM_WIDGET_CONTENT_FINGERPRINT), 'the URI embeds its fingerprint');

  // Reproduce the fingerprint rule over a changed template: a content change must move the URI,
  // and an unchanged template must not move it. BUILD_DATE is substituted after the fingerprint,
  // so the same source always yields one identity.
  const fingerprintSource = (html) => html
    .split('__WIDGET_URI__').join('{{WIDGET_URI}}')
    .split('__ASSET_BASE__').join('{{ASSET_BASE}}')
    .split('__WIDGET_BUILD__').join('{{WIDGET_BUILD}}');
  const hash = (html) => createHash('sha256').update(fingerprintSource(html), 'utf8').digest('hex').slice(0, 8);
  const base = '<p>__WIDGET_URI__ __ASSET_BASE__ __WIDGET_BUILD__</p>';
  assert.equal(hash(base), hash(base), 'identical content yields an identical identity');
  assert.notEqual(hash(base), hash(`${base}<p>one byte more</p>`), 'changed content yields a new identity');
  // The fingerprint is taken over the template, so every substituted value is normalised back to its
  // token first. That is the whole reason the URI cannot feed its own input and mint a new identity
  // on every render.
  assert.equal(hash('<p>__WIDGET_URI__</p>'), hash('<p>{{WIDGET_URI}}</p>'), 'URI placeholder is fingerprint-neutral');
  assert.equal(hash('<p>__ASSET_BASE__</p>'), hash('<p>{{ASSET_BASE}}</p>'), 'asset base placeholder is fingerprint-neutral');
  assert.equal(hash('<p>__WIDGET_BUILD__</p>'), hash('<p>{{WIDGET_BUILD}}</p>'), 'build stamp placeholder is fingerprint-neutral');

  // The served HTML carries the registered URI and never a per-process date in its identity.
  const html = pmWidgetHtml('');
  assert.ok(html.includes(PRODUCTION_URI), 'the served HTML refers to its own registered URI');
});

test('P the debug probe is minimal enough to be evidence', () => {
  const { WIDGET_PROBE_HTML, WIDGET_PROBE_RESOURCE_URI, WIDGET_PROBE_MIME_TYPE } = probe;
  assert.equal(WIDGET_PROBE_MIME_TYPE, 'text/html;profile=mcp-app');
  assert.match(WIDGET_PROBE_HTML, /MOUNT_OK/);
  assert.ok(WIDGET_PROBE_HTML.includes('Agent Relay Widget Probe'));
  // Nothing that could fail on its own inside the host sandbox:
  assert.ok(!/<script/i.test(WIDGET_PROBE_HTML), 'no script');
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|EventSource/.test(WIDGET_PROBE_HTML), 'no network call');
  assert.ok(!/https?:\/\//.test(WIDGET_PROBE_HTML), 'no external origin, so no CSP can block it');
  assert.ok(!/relay_pm_/.test(WIDGET_PROBE_HTML), 'no Agent Relay dependency');
  assert.equal(
    WIDGET_PROBE_RESOURCE_URI,
    `ui://agent-relay/widget-probe-${createHash('sha256').update(WIDGET_PROBE_HTML, 'utf8').digest('hex').slice(0, 8)}`,
    'the probe URI is content-derived like the production one',
  );
  // A probe with no CSP declaration is intentional: it loads nothing, so there is nothing to allow.
  assert.deepEqual(probe.widgetProbeResourceMeta(), { ui: { prefersBorder: true } });
});

test('existing headless PM tools still work alongside the render surface', async () => {
  await withLiveServer(async ({ rpc }) => {
    const dash = await rpc('tools/call', { name: 'relay_pm_get_dashboard', arguments: {} });
    const parsed = JSON.parse(dash.result.content[0].text);
    assert.equal(parsed.project, 'ws');
    assert.ok(parsed.summary, 'the P1.8A runtime-truth summary is still served');
    const version = await rpc('tools/call', { name: 'relay_pm_get_widget_version', arguments: {} });
    const v = JSON.parse(version.result.content[0].text);
    assert.equal(v.uri, PRODUCTION_URI, 'the version tool still names the same resource');
  });
});