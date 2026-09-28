/**
 * Crew widget spec pins (handoff DECISIONS-LOCKED + SPEC-TECHNICAL).
 * Sprite engine, forbidden patterns, tabs, asset-base injection.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const m = await import('../dist/server/mcp/app/pm-widget-resource.js');

describe('crew widget spec', () => {
  const html = m.pmWidgetHtml('https://example.invalid/w');
  it('wires provided sprites only (no redraws)', () => {
    assert.ok(html.includes('-sheet.png'));
    for (const s of ['run:6', 'dig:4', 'climb:4', 'qa:4', 'done:4', 'blocked:4', 'sleep:4', 'idle:4']) {
      const [state, frames] = s.split(':');
      assert.match(html, new RegExp(state + ':\\s*' + frames), state);
    }
  });
  it('uses display-width sheet math, durations, reduced motion', () => {
    assert.match(html, /--sheetW.*\* displayW|n \* w/);
    assert.ok(html.includes('0.62') && html.includes('2.6'));
    assert.match(html, /prefers-reduced-motion/);
  });
  it('forbids css ladder, hue-rotate, scale maps', () => {
    assert.doesNotMatch(html, /hue-rotate/);
    assert.ok(!html.includes('ladder-rail') && !html.includes('ladder-rung'));
  });
  it('has 3 tabs + ladder geometry + wbs runner', () => {
    assert.ok(html.includes('data-tab="crew"') && html.includes('data-tab="ladder"') && html.includes('data-tab="wbs"'));
    assert.ok(html.includes('climber') && html.includes('trackFill') && html.includes('applySheet'));
  });
  it('injects asset base, keeps wake contract', () => {
    assert.ok(html.includes('https://example.invalid/w/dig-sheet.png') || html.includes('example.invalid'));
    assert.ok(html.includes('ui/initialize') && html.includes('relay_pm_claim_wake'));
    assert.ok(!html.includes('AGENT_RELAY_PM_WAKE') && !html.includes('submit_judgment'));
  });
  it('never auto-reloads; fallback is static-first with retry', () => {
    const reloads = html.match(/window\.location\.reload/g) || [];
    assert.equal(reloads.length, 1, 'exactly one reload: the user-gesture update button, no auto-reload');
    assert.ok(html.includes('btn.onclick = function () { try { window.location.reload(); }'), 'reload only on user gesture');
    assert.ok(html.includes('id="fallback"'), 'static fallback box present without JS');
    assert.ok(html.includes('위젯 로드 중'), 'fallback shows loading state pre-JS');
    assert.ok(html.includes('unhandledrejection'), 'promise failures surface to fallback');
    assert.ok(html.includes("btn.onclick = function () { hideFallback(); init(); }"), 'retry re-runs init');
  });
  it('declares host CSP allowlist for sprite origin', () => {
    const meta = m.widgetResourceMeta('https://mcp.relay-agent.site/widgets/crew');
    assert.deepEqual(meta.ui.csp.resourceDomains, ['https://mcp.relay-agent.site']);
    const fallback = m.widgetResourceMeta('');
    assert.deepEqual(fallback.ui.csp.resourceDomains, ['https://mcp.relay-agent.site']);
    assert.equal(meta.ui.prefersBorder, true);
  });
  it('always renders fallback shell + dashboard diag line', () => {
    assert.ok(html.includes('id="fallback"'), 'static fallback shell');
    assert.ok(html.includes('id="diag"'), 'dashboard status line element');
    assert.ok(html.includes('dashboard ok ·') && html.includes('dashboard 실패:'), 'diag covers ok + fail');
    assert.ok(html.includes('render agents error') && html.includes('render ladder error') && html.includes('render wbs error'), 'per-view render guards');
  });
});
