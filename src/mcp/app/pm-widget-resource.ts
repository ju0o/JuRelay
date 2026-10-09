/**
 * V1-G6-MCP — Agent Relay PM widget resource.
 *
 * Production-shaped MCP App widget (based on the live-proven spike, not a
 * wholesale copy). Responsibilities ONLY:
 *   1. initialize via the current MCP Apps protocol
 *   2. poll a lightweight pending-delivery tool (relay_pm_list_pending_deliveries)
 *   3. detect one actionable PM Delivery
 *   4. maintain local in-widget dedupe for the mounted session
 *   5. claim the durable wake (relay_pm_claim_wake) and fire ui/message with
 *      the bounded AGENT_RELAY_PM_WAKE instruction
 *   6. show simple status
 *
 * No business logic lives in the widget. No Result text is fetched or shown.
 * The HTML is embedded so the compiled dist needs no asset-copy step.
 *
 * Cache policy: MCP Apps hosts cache the rendered widget by resource URI.
 * The URI below embeds a content hash, so EVERY widget change mints a fresh
 * resource identity automatically — no manual v-bump, no stale renders.
 */
import { createHash } from 'node:crypto';

export const PM_WIDGET_RESOURCE_VERSION = '2026-09-28-auto';

export function pmWidgetHtml(assetBase = ''): string {
  return WIDGET_HTML
    .replaceAll('__WIDGET_URI__', PM_WIDGET_RESOURCE_URI)
    .replaceAll('__ASSET_BASE__', assetBase)
    .replaceAll('__WIDGET_BUILD__', `${WIDGET_HASH} ${BUILD_DATE}`);
}

const WIDGET_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="light dark" />
<title>Agent Relay PM</title>
<style>
  :root {
    --bg:#ffffff; --panel:#f5f5f5; --text:#1a1a1a; --muted:#555555; --border:#d0d0d0;
    --ok:#0a7d33; --err:#b42318; --mut:#7a5af8; --wait:#8a6d00;
    --lane-bg:#f3f5f8; --lane-border:#d0d5de; --lane-card:#ffffff; --lane-card-border:#d8dde6;
    --lane-a-bg:#fff8e8; --lane-a-border:#e0c56a; --lane-b-bg:#eef5ff; --lane-b-border:#9bb7d8;
    --lane-c-bg:#f4f2fb; --lane-c-border:#b7aed8; --pipe-bg:#f3f5f8; --pipe-border:#d0d5de;
    --live-lt:#1a1a1a; --bar-track:#dde2ea;
    --accent-panel-bg:#e8effc; --accent-panel-fg:#1a1a1a; --accent-panel-muted:#555555; --accent-panel-border:#4a7fd4;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#121212; --panel:#1e1e1e; --text:#e8e8e8; --muted:#9a9a9a; --border:#3a3a3a;
      --lane-bg:#161a21; --lane-border:#262c37; --lane-card:#12161c; --lane-card-border:#232a34;
      --lane-a-bg:#1e1a12; --lane-a-border:#5a4a1e; --lane-b-bg:#141d29; --lane-b-border:#2c4a6e;
      --lane-c-bg:#161a21; --lane-c-border:#3d3466; --pipe-bg:#161a21; --pipe-border:#262c37;
      --live-lt:#e8ecf2; --bar-track:#262c37;
      --accent-panel-bg:#121a2a; --accent-panel-fg:#e8ecf2; --accent-panel-muted:#9aa3b2; --accent-panel-border:#1b4fbf; }
  }
  body[data-theme="dark"] { --bg:#121212; --panel:#1e1e1e; --text:#e8e8e8; --muted:#9a9a9a; --border:#3a3a3a;
    --lane-bg:#161a21; --lane-border:#262c37; --lane-card:#12161c; --lane-card-border:#232a34;
    --lane-a-bg:#1e1a12; --lane-a-border:#5a4a1e; --lane-b-bg:#141d29; --lane-b-border:#2c4a6e;
    --lane-c-bg:#161a21; --lane-c-border:#3d3466; --pipe-bg:#161a21; --pipe-border:#262c37;
    --live-lt:#e8ecf2; --bar-track:#262c37;
    --accent-panel-bg:#121a2a; --accent-panel-fg:#e8ecf2; --accent-panel-muted:#9aa3b2; --accent-panel-border:#1b4fbf; }
  body[data-theme="light"] { --bg:#ffffff; --panel:#f5f5f5; --text:#1a1a1a; --muted:#555555; --border:#d0d0d0;
    --lane-bg:#f3f5f8; --lane-border:#d0d5de; --lane-card:#ffffff; --lane-card-border:#d8dde6;
    --lane-a-bg:#fff8e8; --lane-a-border:#e0c56a; --lane-b-bg:#eef5ff; --lane-b-border:#9bb7d8;
    --lane-c-bg:#f4f2fb; --lane-c-border:#b7aed8; --pipe-bg:#f3f5f8; --pipe-border:#d0d5de;
    --live-lt:#1a1a1a; --bar-track:#dde2ea;
    --accent-panel-bg:#e8effc; --accent-panel-fg:#1a1a1a; --accent-panel-muted:#555555; --accent-panel-border:#4a7fd4; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans KR", sans-serif; margin:0; padding:10px; font-size:14px;
         background: var(--bg); color: var(--text); word-break: keep-all; overflow-wrap: normal; overflow-x: hidden; }
  .card { border:1px solid var(--border); border-radius:10px; padding:8px 10px; max-width:100%; overflow-x:hidden; }
  /* A안 헤더 — 좁은 폭에서 분절·두 줄 깨짐 방지 */
  .hdr { display:flex; align-items:center; flex-wrap:wrap; gap:6px 8px; margin:0 0 2px; min-width:0; }
  .dot { width:9px; height:9px; border-radius:50%; flex:none; }
  .pulse { animation:pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.35; } }
  .dot.connected{background:var(--ok);} .dot.waiting{background:var(--wait);} .dot.ready{background:var(--ok);}
  .dot.fail{background:var(--err);} .dot.sent{background:var(--mut);}
  .app { font-size:15px; font-weight:700; white-space:nowrap; flex:none; }
  .hpill { font-size:11px; border:1px solid var(--border); border-radius:12px; padding:1px 9px; color:var(--muted); white-space:nowrap; flex:none; }
  .hfrac { margin-left:auto; font-size:12px; color:var(--muted); white-space:nowrap; flex:none; }
  .hfrac b { color:var(--text); font-size:14px; }
  .subhide { display:none; }
  .lang { display:flex; gap:4px; flex:none; }
  .lang button { font-size:11px; border:1px solid var(--border); background:transparent; color:var(--muted);
                 border-radius:12px; padding:4px 8px; min-height:32px; cursor:pointer; white-space:nowrap; flex:none; }
  .lang button.on { color:var(--text); border-color:var(--text); font-weight:700; }
  @media (max-width:380px) {
    .hdr { row-gap:4px; }
    .hfrac { margin-left:0; }
    .proj-switch { max-width:100%; }
    .proj-switch > summary { max-width:100%; overflow:hidden; text-overflow:ellipsis; }
  }
  .sub { color: var(--muted); font-size:12px; }
  /* A안 "지금 이 환경" 스트립 */
  .env { border:1px solid var(--border); border-radius:10px; padding:6px 8px; margin:4px 0 0; }
  .env-title { font-size:12px; font-weight:700; margin-bottom:4px; }
  .env-row { display:flex; align-items:center; gap:10px; }
  .env-nums { display:flex; flex:1; gap:12px; min-width:0; }
  .eseg b { display:block; font-size:18px; font-weight:650; line-height:1.1; }
  .eseg span { font-size:11px; color:var(--muted); white-space:nowrap; }
  .eseg.blue b { color:#4a9eff; } .eseg.amber b { color:#f0b429; }
  .eseg.green b { color:#2ea86a; } .eseg.muted b { color:#5c6470; }
  .eseg.dim { opacity:.38; }
  .env-note { font-size:12px; color:var(--muted); white-space:nowrap; margin-left:auto;
              border:1px solid var(--border); border-radius:8px; padding:4px 8px; }
  @media (max-width:480px) { .env-row { flex-wrap:wrap; } .env-note { margin-left:0; } }
  /* A안 레인 3개 — theme tokens (light/dark) */
  .lanes { display:flex; flex-direction:column; gap:5px; margin:2px 0 0; }
  .lane { background:var(--lane-bg); border:1px solid var(--lane-border); border-radius:10px; padding:6px 8px; }
  .lane-head { display:flex; align-items:baseline; gap:8px; }
  .lane-title { font-size:13px; font-weight:700; }
  .lane-a .lane-title { color:#c48a00; } .lane-b .lane-title { color:#2b7de0; } .lane-c .lane-title { color:#6b5bb8; }
  body[data-theme="dark"] .lane-a .lane-title { color:#f0b429; }
  body[data-theme="dark"] .lane-b .lane-title { color:#4a9eff; }
  body[data-theme="dark"] .lane-c .lane-title { color:#8b7bd8; }
  .lane-a { background:var(--lane-a-bg); border-color:var(--lane-a-border); }
  .lane-b { background:var(--lane-b-bg); border-color:var(--lane-b-border); }
  .lane-c { background:var(--lane-c-bg); border-color:var(--lane-c-border); }
  /* F1 pipeline flow */
  .pipe { display:flex; flex-wrap:wrap; align-items:stretch; gap:4px; margin:4px 0 0; }
  .pnode { flex:1; background:var(--pipe-bg); border:1px solid var(--pipe-border); border-radius:8px; padding:4px 2px; text-align:center; min-width:0; }
  .pnode b { display:block; font-size:12px; }
  .pnode span { font-size:11px; color:var(--muted); white-space:nowrap; }
  /* QA wait is secondary information: dimmer than the review count so the eye reads "4 review" first.
     It stays hidden entirely when nothing is waiting, so a healthy pipeline looks unchanged. */
  .pnode .pwait { color:var(--muted); opacity:.62; margin-left:4px; }
  .pnode .pwait:empty { display:none; }
  /* One card per real task, titled in plain Korean. The model name is tooltip-only: it is debugging
     detail, never something the Founder has to read on the surface. */
  .livecards { display:flex; flex-direction:column; gap:3px; margin-top:4px; }
  .livecard { display:flex; align-items:baseline; gap:6px; padding:4px 6px; border-radius:6px;
              background:var(--lane-card); border:1px solid var(--lane-card-border); min-width:0; }
  .livecard .lt { font-size:13px; color:var(--live-lt); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .livecard .lr { font-size:11px; color:var(--muted); opacity:.85; flex:none; }
  .livecard .lr:empty { display:none; }
  .livecard .ldead { color:#c48a00; font-size:11px; flex:none; }
  .live-empty { font-size:12px; color:var(--muted); padding:4px 2px; }
  .edge { align-self:center; color:var(--muted); font-size:12px; flex:none; }
  .ploop { flex-basis:100%; text-align:center; font-size:11px; color:var(--muted); margin-top:2px; }
  .ploop.hot { color:#c48a00; font-weight:700; }
  .lane-empty { font-size:12px; color:var(--muted); padding:4px 2px; }
  .lane-desc { font-size:11px; color:var(--muted); }
  .lane-n { margin-left:auto; font-size:14px; font-weight:700; }
  .bar { height:3px; border-radius:2px; background:var(--bar-track); margin:4px 0; overflow:hidden; }
  .bar i { display:block; height:100%; border-radius:2px; transition:width 1s ease; }
  .lane-a .bar i { background:#f0b429; } .lane-b .bar i { background:#4a9eff; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chip { display:flex; align-items:center; gap:6px; min-height:40px; border:1px solid var(--lane-border);
          border-radius:6px; padding:2px 8px 2px 2px; min-width:0; max-width:100%; background:var(--lane-card); }
  /* Sprite cell: source frame 340×520 → display 26×40 (aspect-locked, foot baseline) */
  .cav { flex:none; width:26px; height:40px; display:flex; align-items:flex-end; justify-content:center; overflow:hidden; }
  .cav-miss { width:26px; height:40px; display:flex; align-items:center; justify-content:center;
             border:1px dashed var(--wait); border-radius:4px; font-size:12px; font-weight:700;
             color:var(--text); background:var(--panel); flex:none; }
  .ctx { min-width:0; }
  .ctx b { display:block; font-size:13px; font-weight:650; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ctx i { display:block; font-style:normal; font-size:12px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .steps { display:flex; align-items:center; gap:6px; margin:6px 0 2px; font-size:11px; color: var(--muted); }
  .step { display:flex; align-items:center; gap:4px; }
  .step i { width:9px; height:9px; border-radius:50%; background: var(--border); flex:none; }
  .step.on i { background: var(--ok); }
  .step.doing i { background: var(--wait); }
  .step.off { opacity:.55; }
  .step-sep { flex:1; height:1px; background: var(--border); min-width:8px; }
  .inbox { margin-top:8px; border:1px solid var(--border); border-radius:10px; padding:8px 10px; background:var(--panel); }
  .inbox-head { margin-bottom:6px; }
  .inbox-title { font-size:14px; font-weight:700; }
  .inbox-sub { font-size:12px; color:var(--muted); margin-top:2px; }
  .inbox-count { font-size:12px; color:var(--muted); margin-top:4px; }
  .inbox-count b { color:var(--text); font-size:14px; }
  .cards { display:flex; flex-direction:column; gap:8px; margin-top:6px; }
  .dcard { border:1px solid var(--border); border-radius:8px; padding:8px 10px; font-size:12px; background:var(--bg); color:var(--text); }
  .dcard .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; }
  .dcard .id { font-weight:700; flex:none; }
  .dcard .task { color: var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; flex:1; }
  .dcard .proj { font-size:11px; border:1px solid var(--border); border-radius:10px; padding:1px 7px; color:var(--muted); flex:none; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dcard .proj.unknown { border-style:dashed; }
  .dcard .proj.legacy { color:var(--wait); border-color:var(--wait); }
  .pill { margin-left:auto; font-size:11px; border:1px solid var(--border); border-radius:20px; padding:1px 8px; flex:none; }
  .pill.wait { color: var(--wait); border-color: var(--wait); }
  .pill.doing { color: var(--mut); border-color: var(--mut); }
  .pill.done { color: var(--ok); border-color: var(--ok); }
  .dcard summary { cursor:pointer; }
  .dcard .meta { color: var(--muted); font-size:11px; margin-top:4px; word-break:break-all; }
  .remain { margin-top:6px; font-size:12px; color: var(--muted); }
  .remain b { color: var(--text); }
  .update { display:none; margin-top:8px; border:1px solid var(--wait); border-radius:8px;
            padding:8px 10px; font-size:12px; }
  .update.show { display:block; }
  .update button { margin:0 6px; border:1px solid var(--text); background:transparent;
                   color:var(--text); border-radius:12px; padding:2px 10px; cursor:pointer;
                   font-size:12px; }
  /* sprite engine (handoff spec: fixed cells, foot baseline, no scale maps) */
  @keyframes play {
    from { background-position-x: 0; }
    to   { background-position-x: var(--sheetW); }
  }
  .crew-sp, .climber, .runner { background-repeat:no-repeat; }
  @media (prefers-reduced-motion: reduce) {
    .crew-sp, .climber, .runner, .pulse { animation:none !important; }
    .climber, .runner, .track-fill, .bar i { transition:none !important; }
  }
  .tabs { display:flex; gap:4px; margin:6px 0 2px; }
  .tabs button { flex:1; border:1px solid var(--border); background:transparent; color:var(--muted);
                 border-radius:8px; padding:8px 6px; min-height:40px; font-size:13px; cursor:pointer; white-space:nowrap; flex:none; }
  .tabs button.on { color:var(--text); border-color:var(--text); font-weight:700; background:var(--panel); }
  @media (max-width:480px) { .tabs { overflow-x:auto; -webkit-overflow-scrolling:touch; } }
  /* UX-VISUAL-02: secondary strips collapsed by default */
  .more-panel { margin:4px 0 2px; border:1px solid var(--border); border-radius:10px; padding:0 8px 6px; background:var(--panel); }
  .more-panel > summary { cursor:pointer; color:var(--muted); font-size:13px; font-weight:600; user-select:none;
                          list-style:none; padding:8px 2px; min-height:40px; display:flex; align-items:center; }
  .more-panel > summary::-webkit-details-marker { display:none; }
  .more-panel[open] > summary { color:var(--text); border-bottom:1px solid var(--border); margin-bottom:4px; }
  .more-panel .pipe, .more-panel .env, .more-panel .steps { margin-left:0; margin-right:0; }
  /* v6 control tower */
  .nowcard { border:1px solid var(--border); border-radius:10px; padding:6px 8px; margin:4px 0 2px; }
  .now-top { display:flex; align-items:center; gap:8px; font-size:14px; font-weight:700; }
  .now-top .hpill { margin-left:auto; }
  .now-pm { font-size:12px; color:var(--muted); margin-top:2px; }
  .now-arr { font-size:13px; font-weight:600; margin-top:2px; }
  .tasksum { border:1px solid var(--border); border-radius:10px; padding:8px 10px; margin:6px 0; }
  .tasksum-top { display:flex; font-size:12px; } .tasksum-top b { margin-left:auto; }
  .bar3 { display:flex; height:6px; border-radius:3px; background:#262c37; margin:6px 0; overflow:hidden; }
  .bar3 i { display:block; height:100%; }
  .bar3 .bdone { background:#2ea86a; } .bar3 .breview { background:#f0b429; } .bar3 .bleft { background:#3a4250; }
  .taskcounts { display:flex; gap:12px; font-size:11px; color:var(--muted); }
  .taskcounts b { font-size:13px; }
  .tc-done b { color:#2ea86a; } .tc-review b { color:#f0b429; }
  .taskrows { display:flex; flex-direction:column; gap:6px; margin-top:6px; }
  .trow { display:flex; align-items:center; gap:8px; border:1px solid var(--border); border-radius:8px; padding:6px 8px; font-size:12px; background:transparent; color:inherit; width:100%; text-align:left; font:inherit; cursor:pointer; }
  .trow:focus-visible { outline:2px solid var(--accent, #4a9eff); outline-offset:1px; }
  .trow.sel { border-color:var(--accent, #4a9eff); box-shadow:0 0 0 1px var(--accent, #4a9eff); }
  .trow.ro { cursor:default; opacity:.92; }
  .trow .tid { font-size:10px; font-family:ui-monospace,Menlo,monospace; color:var(--muted); flex:none; }
  .trow .tti { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  @media (max-width:380px) {
    .trow .tti { white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  }
  .trow .tst { font-size:10px; padding:1px 7px; border-radius:9px; flex:none; border:1px solid var(--border); color:var(--muted); }
  .trow.st-done .tst { color:#2ea86a; border-color:#2ea86a; }
  .trow.st-review .tst { color:#f0b429; border-color:#f0b429; }
  .trow.st-working { border-left:3px solid #4a9eff; }
  .trow.st-working .tst { color:#4a9eff; border-color:#4a9eff; }
  .goalcard { background:linear-gradient(135deg,#1a1524,#141a24); border:1px solid #2e2a44; border-radius:11px; padding:12px; margin:6px 0; }
  .goalcard .gt { font-size:15px; font-weight:650; }
  .goalcard .gw { font-size:11px; color:var(--muted); margin-top:4px; }
  .goalcard .gs { font-size:11px; margin-top:6px; }
  .kpis { display:flex; background:var(--panel); border:1px solid var(--border); border-radius:9px; margin-top:6px; overflow:hidden; flex-wrap:wrap; }
  .kpi { flex:1; min-width:70px; padding:8px 10px; }
  .kpi .n { font-size:17px; font-weight:660; }
  .kpi .k { font-size:10px; color:var(--muted); }
  .wf { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:6px 0; }
  .mock { background:#0c0e12; border:1px solid var(--border); border-radius:8px; padding:8px; min-height:120px; }
  .mock .mb { background:var(--panel); border:1px solid var(--border); border-radius:5px; padding:5px 7px; margin-bottom:5px; font-size:10px; color:var(--muted); }
  .mock .row { display:flex; gap:5px; margin-bottom:5px; }
  .mock .bx { flex:1; background:var(--panel); border:1px dashed #333b49; border-radius:5px; min-height:30px; display:flex; align-items:center; justify-content:center; font-size:9px; color:var(--muted); }
  .wflist { display:flex; flex-direction:column; gap:6px; }
  .wfrow { display:flex; gap:8px; align-items:flex-start; font-size:11px; padding:6px 8px; background:var(--panel); border:1px solid var(--border); border-radius:7px; }
  .wfrow .n { width:18px; height:18px; border-radius:5px; background:#4a9eff; color:#06121f; display:flex; align-items:center; justify-content:center; font-size:9px; font-weight:700; flex:none; }
  .wfrow .tt { font-size:12px; font-weight:600; } .wfrow .ds { font-size:10px; color:var(--muted); }
  .tabs2 { display:flex; gap:3px; margin:6px 0; background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:3px; }
  .tabs2 button { flex:1; background:transparent; border:0; color:var(--muted); padding:6px; border-radius:6px; cursor:pointer; font-size:11px; }
  .tabs2 button.on { background:#1b2029; color:var(--text); }
  .dtabpane { display:none; } .dtabpane.on { display:block; }
  .dia { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:10px; overflow-x:auto; }
  .dia svg { display:block; min-width:620px; width:100%; height:auto; }
  .ent { fill:#1b2029; stroke:#39414f; stroke-width:1; }
  .ent-h { fill:#242b36; stroke:#39414f; stroke-width:1; }
  .ent-t { fill:#e8eaed; font-size:11px; font-weight:600; font-family:system-ui,sans-serif; }
  .ent-c { fill:#98a0ae; font-size:9.5px; font-family:ui-monospace,Menlo,monospace; }
  .ent-pk { fill:#f0b429; font-size:9.5px; font-family:ui-monospace,Menlo,monospace; }
  .ent-fk { fill:#4a9eff; font-size:9.5px; font-family:ui-monospace,Menlo,monospace; }
  .rel { stroke:#4a5464; stroke-width:1.2; fill:none; }
  .rel-l { fill:#98a0ae; font-size:9px; }
  .cnt { stroke:#5c6470; stroke-width:1; fill:none; stroke-dasharray:3 2; }
  .cnt-l { fill:#5c6470; font-size:8.5px; }
  .rel2 { display:flex; flex-direction:column; gap:5px; margin-top:8px; }
  .relrow { display:flex; gap:8px; align-items:center; font-size:11px; padding:5px 8px; background:var(--panel); border:1px solid var(--border); border-radius:6px; }
  .relrow .a { font-family:ui-monospace,Menlo,monospace; color:#4a9eff; flex:none; }
  .relrow .ar { color:var(--muted); flex:none; }
  .relrow .b { font-family:ui-monospace,Menlo,monospace; color:#f0b429; flex:none; }
  .relrow .d { color:var(--muted); font-size:10px; }
  .wbs { display:flex; flex-direction:column; gap:6px; margin-top:6px; }
  .wbsrow { display:flex; gap:8px; align-items:center; font-size:11px; }
  .wbsrow .ind { flex:none; color:var(--muted); font-size:10px; white-space:pre; }
  .wbsrow .bar2 { flex:1; border:1px solid var(--border); background:var(--panel); border-radius:5px; display:flex; align-items:center; padding:3px 8px; gap:6px; min-width:0; }
  .wbsrow .bar2 span { white-space:nowrap; overflow:hidden; }
  .wbsrow .sz { font-size:9px; color:var(--muted); font-family:ui-monospace,Menlo,monospace; flex:none; }
  .wbsrow .dep { font-size:9px; flex:none; }
  .dep.done { color:#2ea86a; } .dep.working { color:#4a9eff; } .dep.wait { color:var(--muted); }
  .estrows { display:flex; flex-direction:column; gap:6px; margin-top:6px; font-size:12px; }
  .estrow { border:1px solid var(--border); border-radius:8px; padding:6px 8px; }
  .estrow b { display:block; font-size:12px; } .estrow span { font-size:11px; color:var(--muted); }
  .emptybox { border:1px dashed var(--border); border-radius:8px; padding:12px; margin-top:6px; font-size:12px; color:var(--muted); text-align:center; }
  .tabs .bdg { display:inline-block; min-width:18px; font-size:10px; border:1px solid var(--border);
              border-radius:10px; padding:0 5px; margin-left:4px; color:var(--muted); font-weight:400; }
  .tabs button.on .bdg { color:var(--text); border-color:var(--text); }
  .tabpane { display:none; }
  .tabpane.on { display:block; }
  .sheet-missing { display:flex; align-items:center; justify-content:center;
                  border:1px dashed var(--wait); border-radius:6px; background:var(--panel);
                  font-size:16px; font-weight:700; color:var(--wait); }
  .ladder-wrap { display:flex; gap:10px; margin-top:6px; }
  .ladder-stage { position:relative; width:60px; flex:none; }
  .climber { position:absolute; left:50%; transform:translateX(-50%); transition:bottom 1.1s ease; }
  .tasklist { flex:1; font-size:12px; min-width:0; }
  .tasklist .trow { padding:4px 6px; border-radius:6px; overflow:hidden; white-space:nowrap; }
  .tasklist .trow.done { color:var(--muted); text-decoration:line-through; }
  .tasklist .trow.cur { font-weight:700; border:1px solid var(--border); }
  .goalbadge { display:inline-block; font-size:11px; border:1px solid var(--border);
               border-radius:12px; padding:1px 8px; margin:6px 4px 0 0; }
  .wbs-wrap { margin-top:6px; }
  .track { position:relative; height:96px; border-bottom:2px solid var(--border); margin-top:8px; }
  .track-fill { position:absolute; left:0; top:0; bottom:0;
                background:linear-gradient(90deg,#3b82f6,#22c55e); opacity:.25; transition:width 1s ease; }
  .runner { position:absolute; transition:left 1s ease; }
  .wnode { position:absolute; bottom:0; width:9px; height:9px; border-radius:50%;
           background:#3a4753; border:1px solid #6b7a89; transform:translate(-50%,50%); }
  .wnode.hit { background:#22b573; border-color:#22b573; }
  .wgoal { position:absolute; right:0; top:100%; transform:translateY(-50%); font-size:11px; font-weight:700; }
  @media (max-width:820px) { .ladder-wrap { flex-direction:column; } }
  details { margin-top:10px; }
  summary { cursor:pointer; color:var(--muted); font-size:12px; user-select:none; }
  #log { margin:6px 0 0; padding:8px; border:1px solid var(--border); border-radius:6px;
         background: var(--panel); color: var(--text); max-height:150px; overflow:auto;
         font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px;
         white-space:pre-wrap; word-break:break-word; }
  #log .t { color: var(--muted); }
  .fallback { border:1px solid #b26a00; background:#2a1f08; color:#ffd9a0;
             border-radius:8px; padding:8px 10px; margin:8px 0; font-size:12px; }
  .fallback.hide { display:none; }
  .fallback b { color:#fff; }
  .fallback .ver { color:var(--muted); font-size:11px; }
  .fallback button { margin-top:6px; }
  /* P1.8C-03 first-run bootstrap */
  .hide { display:none !important; }
  .bootstrap { margin:8px 0 0; border:1px solid var(--border); border-radius:10px;
               padding:12px; background:var(--panel); }
  .boot-lead { font-size:13px; color:var(--muted); margin:4px 0 10px; }
  .boot-title { font-size:16px; font-weight:700; margin:0; }
  .boot-steps { display:flex; gap:6px; flex-wrap:wrap; margin:0 0 10px; }
  .boot-step { font-size:11px; border:1px solid var(--border); border-radius:12px;
               padding:3px 9px; color:var(--muted); }
  .boot-step.on { color:var(--text); border-color:var(--text); font-weight:700; background:var(--bg); }
  .boot-step.done { color:var(--ok); border-color:var(--ok); }
  .boot-list { display:flex; flex-direction:column; gap:8px; margin:8px 0; max-height:280px; overflow:auto; }
  .boot-card { border:1px solid var(--border); border-radius:8px; padding:10px; text-align:left;
               background:var(--bg); cursor:pointer; width:100%; color:var(--text); font:inherit; }
  .boot-card:hover, .boot-card:focus { border-color:var(--text); outline:2px solid var(--mut); outline-offset:1px; }
  .boot-card.sel { border-color:#4a9eff; box-shadow:0 0 0 1px #4a9eff; }
  .boot-card.legacy { opacity:.85; border-style:dashed; }
  .boot-card .bn { font-size:14px; font-weight:700; display:block; }
  .boot-card .bp { font-size:11px; color:var(--muted); word-break:break-all; margin-top:2px; }
  .boot-card .bid { font-size:10px; color:var(--muted); font-family:ui-monospace,Menlo,monospace; }
  .spill { display:inline-block; font-size:10px; border:1px solid var(--border); border-radius:10px;
           padding:1px 7px; margin-top:4px; color:var(--muted); }
  .spill.ok { color:var(--ok); border-color:var(--ok); }
  .spill.warn { color:var(--wait); border-color:var(--wait); }
  .spill.legacy { color:#b42318; border-color:#b42318; }
  .boot-box { border:1px solid var(--border); border-radius:8px; padding:10px; margin:8px 0; font-size:13px; }
  .boot-box.warn { border-color:var(--wait); }
  .boot-box.err { border-color:var(--err); }
  .boot-box.ok { border-color:var(--ok); }
  .boot-box .path { font-family:ui-monospace,Menlo,monospace; font-size:12px; word-break:break-all; }
  .boot-roles { display:flex; flex-direction:column; gap:10px; margin:8px 0; }
  .boot-role { border:1px solid var(--border); border-radius:8px; padding:8px 10px; }
  .boot-role h3 { margin:0 0 6px; font-size:12px; }
  .boot-assigned { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:6px; }
  .boot-avail { display:flex; flex-wrap:wrap; gap:6px; }
  .achip { font-size:11px; border:1px solid #2ea86a; color:#2ea86a; border-radius:12px;
           padding:3px 9px; background:transparent; }
  .vchip { font-size:11px; border:1px dashed var(--border); color:var(--muted); border-radius:12px;
           padding:3px 9px; background:transparent; cursor:pointer; }
  .vchip:hover, .vchip:focus { border-color:var(--text); color:var(--text); }
  .vchip[disabled] { opacity:.45; cursor:not-allowed; }
  .boot-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
  .boot-actions button { min-height:44px; min-width:88px; border:1px solid var(--border);
                         background:var(--bg); color:var(--text); border-radius:10px;
                         padding:8px 14px; font-size:14px; cursor:pointer; }
  .boot-actions button.primary { background:#1b4fbf; border-color:#1b4fbf; color:#fff; font-weight:700; }
  .boot-actions button.primary:disabled { opacity:.45; cursor:not-allowed; }
  .boot-actions button:focus { outline:2px solid var(--mut); outline-offset:1px; }
  .boot-err { color:var(--err); font-size:12px; margin-top:6px; }
  .boot-note { font-size:11px; color:var(--muted); margin-top:6px; }
  .proj-switch { position:relative; margin-left:4px; }
  .proj-switch > summary { list-style:none; cursor:pointer; font-size:11px; border:1px solid var(--border);
                           border-radius:12px; padding:2px 9px; color:var(--muted); user-select:none; }
  .proj-switch > summary::-webkit-details-marker { display:none; }
  .proj-switch[open] > summary { color:var(--text); border-color:var(--text); }
  .proj-menu { position:absolute; right:0; top:120%; z-index:20; min-width:220px; max-width:320px;
               background:var(--bg); border:1px solid var(--border); border-radius:8px;
               padding:6px; box-shadow:0 8px 24px rgba(0,0,0,.18); }
  .proj-menu button { display:block; width:100%; text-align:left; border:0; background:transparent;
                      color:var(--text); padding:8px; border-radius:6px; cursor:pointer; font-size:12px; }
  .proj-menu button:hover, .proj-menu button:focus { background:var(--panel); }
  .proj-menu .cur { font-weight:700; }
  .main-view.hide-for-boot { display:none !important; }
  /* P1.8C-04 project dashboard — UX-VISUAL-02 compact first screen */
  .pdash { border:1px solid var(--border); border-radius:10px; padding:6px 8px; margin:2px 0;
           background:var(--panel); }
  .pdash-head .pn { font-size:16px; font-weight:700; min-width:0; overflow-wrap:normal; word-break:keep-all; }
  .pdash-head .pp { font-size:12px; color:var(--muted); margin-top:2px;
                    font-family:ui-monospace,Menlo,monospace; white-space:nowrap; overflow:hidden;
                    text-overflow:ellipsis; max-width:100%; min-width:0; cursor:help;
                    overflow-wrap:anywhere; word-break:break-all; }
  @media (max-width:380px) {
    .pdash-head .pp { white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  }
  .pdash-head .pa { font-size:13px; margin-top:4px; }
  .pdash-next { margin:4px 0; padding:6px 10px; border-radius:9px;
                border:1px solid var(--accent-panel-border);
                background:var(--accent-panel-bg); color:var(--accent-panel-fg); }
  .pdash-next .nl { font-size:12px; color:var(--accent-panel-muted); }
  .pdash-next .nt { font-size:14px; font-weight:700; margin-top:2px; color:var(--accent-panel-fg); }
  .pdash-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:6px; }
  @media (max-width:520px) { .pdash-grid { grid-template-columns:1fr; } }
  .pdash-card { border:1px solid var(--border); border-radius:8px; padding:8px; background:var(--bg); }
  .pdash-card h3 { margin:0 0 4px; font-size:12px; color:var(--muted); font-weight:600; }
  .pdash-card .tt { font-size:14px; font-weight:650; overflow:hidden; text-overflow:ellipsis; display:-webkit-box;
                    -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  .pdash-card .meta { font-size:12px; color:var(--muted); margin-top:4px; }
  .pdash-card .empty { font-size:13px; color:var(--muted); }
  .pdash-counts { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
  .pdash-counts .c { font-size:12px; border:1px solid var(--border); border-radius:12px;
                     padding:4px 9px; color:var(--muted); }
  .pdash-counts .c b { color:var(--text); }
  .pdash-counts .c.warn { border-color:var(--wait); color:var(--wait); }
  .pdash-counts .c.err { border-color:var(--err); color:var(--err); }
  .pdash-counts .c.ok { border-color:var(--ok); color:var(--ok); }
  .pdash-warn { margin-top:8px; padding:8px 10px; border-radius:8px; border:1px solid var(--wait);
                background:#2a1f08; color:#ffd9a0; font-size:12px; }
  .pdash-warn.err { border-color:var(--err); background:#2a1212; color:#ffb4b4; }
  .rtpill { display:inline-block; font-size:10px; border:1px solid var(--border); border-radius:10px;
            padding:1px 7px; margin-left:4px; color:var(--muted); }
  .rtpill.ACTIVE { color:#4a9eff; border-color:#4a9eff; }
  .rtpill.STALE { color:var(--wait); border-color:var(--wait); }
  .rtpill.ORPHAN { color:var(--err); border-color:var(--err); }
  .rtpill.IDLE { color:var(--muted); }
  .rtpill.UNKNOWN { color:var(--muted); }
  /* P1.8C-05 — Goal → Task preview → explicit Run */
  .pdash-actions { margin-top:6px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .pdash-actions button { min-height:44px; padding:8px 16px; border-radius:10px; border:1px solid var(--border);
                          background:var(--panel); color:var(--text); font-size:14px; font-weight:650; cursor:pointer; }
  .pdash-actions button.primary { background:#1b4fbf; border-color:#1b4fbf; color:#fff; }
  .pdash-actions button:disabled { opacity:.45; cursor:not-allowed; }
  .pdash-actions .hint { font-size:12px; color:var(--muted); }
  .goalflow { margin-top:10px; border:1px solid var(--border); border-radius:10px; padding:12px; background:var(--panel); }
  .goalflow h3 { margin:0 0 8px; font-size:14px; }
  .goalflow label { display:block; font-size:12px; color:var(--muted); margin:8px 0 4px; }
  .goalflow input, .goalflow textarea { width:100%; font-size:14px; padding:10px 12px; border-radius:8px;
    border:1px solid var(--border); background:var(--bg); color:var(--text); min-height:44px; }
  .goalflow textarea { min-height:72px; resize:vertical; }
  .goalflow .row { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
  .goalflow .row button { min-height:44px; padding:8px 16px; border-radius:10px; border:1px solid var(--border);
    background:var(--panel); color:var(--text); font-size:14px; font-weight:650; cursor:pointer; }
  .goalflow .row button.primary { background:#1b4fbf; border-color:#1b4fbf; color:#fff; }
  .goalflow .row button:disabled { opacity:.45; cursor:not-allowed; }
  .goalflow .err { margin-top:8px; font-size:12px; color:var(--err); }
  .goalflow .ok { margin-top:8px; font-size:12px; color:var(--ok); }
  /* UX-VISUAL-02A: theme tokens for accent panels (fixes light contrast on #121a2a) */
  .taskprev { margin-top:10px; border:1px solid var(--accent-panel-border); border-radius:10px; padding:12px;
              background:var(--accent-panel-bg); color:var(--accent-panel-fg); }
  .taskprev h3 { margin:0 0 8px; font-size:14px; color:var(--accent-panel-fg); }
  .taskprev .line { font-size:13px; margin:4px 0; color:var(--accent-panel-fg); }
  .taskprev .line b { color:var(--accent-panel-muted); font-weight:600; margin-right:6px; }
  .taskprev .line span, .taskprev .hint { color:var(--accent-panel-fg); }
  .taskprev .crit { margin:4px 0 0 16px; font-size:12px; color:var(--accent-panel-muted); }
  .taskprev select, .taskprev input[type="text"], .taskprev textarea {
    color:var(--text); background:var(--bg); border:1px solid var(--border); border-radius:8px;
    font-size:14px; padding:8px 10px; min-height:40px; max-width:100%; }
  .taskprev .row { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; align-items:center; }
  .taskprev .row button { min-height:44px; padding:8px 16px; border-radius:10px; border:1px solid var(--border);
    background:var(--panel); color:var(--text); font-size:14px; font-weight:650; cursor:pointer; }
  .taskprev .row button.primary { background:#0a7d33; border-color:#0a7d33; color:#fff; }
  .taskprev .row button:disabled { opacity:.55; cursor:not-allowed; color:var(--muted); }
  .taskprev .status { font-size:12px; color:var(--accent-panel-muted); margin-top:8px; }
  .taskprev .err { color:var(--err); }
  .taskprev label { color:var(--accent-panel-fg); }
</style>
</head>
<body>
  <div class="card">
    <div class="fallback" id="fallback"><b>위젯 로드 중…</b><br>
      <span class="ver">버전 __WIDGET_BUILD__ · 자바스크립트가 실행되면 이 박스는 사라집니다.</span><br>
      <span class="ver">이 박스가 계속 보이면 위젯 스크립트가 막힌 것입니다. 새 대화에서 열어주세요.</span>
    </div>
    <div class="hdr">
      <span class="dot waiting pulse" id="dot"></span>
      <span class="app">Agent Relay</span>
      <details class="proj-switch hide" id="projSwitch">
        <summary id="projSwitchLabel">Project ▾</summary>
        <div class="proj-menu" id="projSwitchMenu" role="menu"></div>
      </details>
      <span class="hpill" id="status">PM 대기</span>
      <span class="hfrac"><b id="headDone">0</b> / <span id="headTotal">0</span></span>
      <span class="lang"><button id="langKo" class="on">한국어</button><button id="langEn">EN</button></span>
      <span id="sub" class="subhide"></span>
    </div>
    <div id="bootstrap" class="bootstrap hide" role="dialog" aria-labelledby="bootTitle" aria-modal="true">
      <h2 class="boot-title" id="bootTitle">프로젝트 준비</h2>
      <p class="boot-lead" id="bootLead">어떤 프로젝트를 쓸지 고르고, 경로와 에이전트를 확인한 뒤 시작해요. 지금은 작업이 시작되지 않아요.</p>
      <div class="boot-steps" id="bootSteps" aria-label="준비 단계">
        <span class="boot-step on" data-bs="project">1 프로젝트</span>
        <span class="boot-step" data-bs="workspace">2 경로</span>
        <span class="boot-step" data-bs="agents">3 에이전트</span>
        <span class="boot-step" data-bs="ready">4 준비 완료</span>
      </div>
      <div id="bootPaneProject">
        <div class="boot-list" id="bootProjectList" role="listbox" aria-label="프로젝트 목록"></div>
        <p class="boot-note">실행 컴퓨터는 ASUS입니다. 선택만으로 Goal/Task/Run은 만들지 않아요. 예전(레거시) <code>ws</code>는 Agent Relay와 합치지 않아요.</p>
        <div class="boot-actions" style="margin-top:8px">
          <button type="button" id="bootNewProjectBtn">새 폴더로 프로젝트 등록…</button>
        </div>
      </div>
      <div id="bootPaneWorkspace" class="hide">
        <div class="boot-box" id="bootWorkspaceBox"></div>
        <div class="boot-box" id="bootBrowseBox" style="margin-top:8px">
          <div style="font-weight:700">ASUS 폴더 찾아보기</div>
          <div class="boot-note" id="bootBrowsePath">루트를 고르세요</div>
          <div class="row" style="flex-wrap:wrap;gap:6px;margin:6px 0" id="bootBrowseRoots"></div>
          <div class="row" style="flex-wrap:wrap;gap:6px;margin:6px 0" id="bootBrowseEntries"></div>
          <div class="row" style="gap:6px;margin:6px 0">
            <button type="button" id="bootBrowseUp" disabled>상위</button>
            <button type="button" id="bootBrowseUse" disabled>이 폴더 사용</button>
            <button type="button" id="bootBrowseChangePath" class="hide">작업 폴더 변경</button>
          </div>
          <label for="bootPathInput">경로 직접 입력 (선택)</label>
          <input id="bootPathInput" type="text" maxlength="512" placeholder="/home/skkse12/Desktop/Projects/Core/…" />
          <div class="row" style="gap:6px;margin-top:6px">
            <button type="button" id="bootPathCheck">경로 확인</button>
          </div>
          <div id="bootRegisterPanel" class="hide" style="margin-top:10px">
            <div style="font-weight:700">새 프로젝트 등록</div>
            <label for="bootRegName">프로젝트 이름</label>
            <input id="bootRegName" type="text" maxlength="120" placeholder="예: JuDemo" />
            <label for="bootRegId">projectId (비우면 폴더명)</label>
            <input id="bootRegId" type="text" maxlength="64" placeholder="예: judemo" />
            <div class="boot-note" id="bootRegPreview">미리보기 전</div>
            <div class="row" style="gap:6px;margin-top:6px">
              <button type="button" id="bootRegPreviewBtn">등록 미리보기</button>
              <button type="button" class="primary" id="bootRegConfirmBtn" disabled>등록 승인</button>
            </div>
          </div>
        </div>
      </div>
      <div id="bootPaneAgents" class="hide">
        <div class="boot-roles" id="bootRoles"></div>
        <p class="boot-note">할당됨 = 이 프로젝트에서 쓸 역할 · 사용 가능 = 후보일 뿐 아직 배정되지 않음</p>
      </div>
      <div id="bootPaneReady" class="hide">
        <div class="boot-box" id="bootReadyBox"></div>
        <ul class="boot-note" id="bootBlockers"></ul>
      </div>
      <div class="boot-err hide" id="bootErr" role="alert"></div>
      <div class="boot-actions">
        <button type="button" id="bootBack">이전</button>
        <button type="button" id="bootNext" class="primary">다음</button>
        <button type="button" id="bootStart" class="primary hide" disabled>시작</button>
      </div>
    </div>
    <div id="mainView">
    <section class="pdash" id="projectDash" aria-label="프로젝트 대시보드">
      <div class="pdash-head" id="pdHead">
        <div class="pn" id="pdName">프로젝트 불러오는 중…</div>
        <div class="pp" id="pdPath"></div>
        <div class="pa" id="pdAssign"></div>
      </div>
      <div class="pdash-next" id="pdNext" role="status">
        <div class="nl">다음</div>
        <div class="nt" id="pdNextText">확인 중…</div>
      </div>
      <div class="pdash-grid">
        <div class="pdash-card" id="pdGoalCard">
          <h3>Goal</h3>
          <div class="tt" id="pdGoalTitle"></div>
          <div class="meta" id="pdGoalMeta"></div>
          <div class="empty hide" id="pdGoalEmpty">아직 진행 중인 Goal이 없습니다.</div>
        </div>
        <div class="pdash-card" id="pdTaskCard">
          <h3>지금 Task</h3>
          <div class="tt" id="pdTaskTitle"></div>
          <div class="meta" id="pdTaskMeta"></div>
          <div class="empty hide" id="pdTaskEmpty">지금 보고 있는 Task가 없습니다.</div>
        </div>
      </div>
      <div class="pdash-counts" id="pdCounts" aria-label="상태 요약"></div>
      <div class="pdash-warn hide" id="pdWarn" role="alert"></div>
      <div class="pdash-actions" id="pdActions">
        <button type="button" class="primary" id="pdNewGoalBtn">새 Goal</button>
        <span class="hint" id="pdActionHint"></span>
      </div>
      <div class="goalflow hide" id="pdGoalFlow" aria-label="Goal 만들기">
        <h3>새 Goal</h3>
        <p class="sub">목표만 만들고 멈춥니다. 작업은 바로 시작하지 않아요.</p>
        <label for="pdGoalTitleIn">Goal 제목</label>
        <input id="pdGoalTitleIn" type="text" maxlength="120" placeholder="예: 첫 Goal→작업 흐름 확인" />
        <label for="pdGoalStmtIn">하고 싶은 일</label>
        <textarea id="pdGoalStmtIn" maxlength="800" placeholder="한두 문장으로 적어 주세요"></textarea>
        <div class="row">
          <button type="button" id="pdGoalCancel">취소</button>
          <button type="button" class="primary" id="pdGoalContinue">이어서 Task 준비</button>
        </div>
        <div class="err hide" id="pdGoalErr" role="alert"></div>
        <div class="ok hide" id="pdGoalOk"></div>
      </div>
      <div class="taskprev hide" id="pdTaskPrev" aria-label="Task 미리보기">
        <h3>시작 전 확인</h3>
        <div class="line"><b>프로젝트</b><span id="tpProject"></span></div>
        <div class="line"><b>컴퓨터</b><span id="tpComputer">ASUS</span></div>
        <div class="line"><b>작업 폴더</b><span id="tpWorkspace"></span></div>
        <div class="line"><b>Goal</b><span id="tpGoal"></span></div>
        <div class="line"><b>Task</b><span id="tpTask"></span></div>
        <div class="line"><b>범위</b><span id="tpScope"></span></div>
        <div class="line"><b>완료 기준</b></div>
        <ul class="crit" id="tpCrit"></ul>
        <div class="line"><b>프로젝트 기본 Builder</b><span id="tpBuilder"></span></div>
        <div class="line"><b>이번 Task Agent</b>
          <select id="tpAgentSel" aria-label="Agent 선택"><option value="">선택…</option></select>
        </div>
        <div class="line"><b>모델</b>
          <select id="tpModelSel" aria-label="모델 선택" disabled><option value="">Agent 먼저</option></select>
        </div>
        <div class="line"><b>실행 프로필</b><span id="tpProfile">—</span></div>
        <div class="line"><b>가능 여부</b><span id="tpAvail">—</span></div>
        <div class="hint" id="tpConstraint"></div>
        <div class="line"><b>저장된 선택</b><span id="tpSaved">없음</span></div>
        <div class="row">
          <button type="button" id="tpSaveSel" disabled>선택 저장</button>
          <button type="button" id="tpClearSel" disabled>선택 초기화</button>
        </div>
        <div class="line"><label><input type="checkbox" id="tpApproveChk" disabled> 저장된 선택으로 실행을 승인합니다 (이번 Task만)</label></div>
        <div class="row">
          <button type="button" id="tpCancelPrep">작업 준비 취소</button>
          <button type="button" id="tpCancel">닫기</button>
          <button type="button" class="primary" id="tpRun" disabled>작업 시작</button>
        </div>
        <div class="status" id="tpStatus"></div>
        <div class="err hide" id="tpErr" role="alert"></div>
      </div>
    </section>
    <details class="more-panel" id="morePanel">
      <summary>파이프라인 · 환경 · 진단</summary>
      <div class="pipe" id="pipe">
        <div class="pnode"><b>PM</b><span data-i="pmYou">이 대화</span></div>
        <span class="edge">→</span>
        <div class="pnode"><b>Agent Relay</b><span id="pipeRelay">0 delivery</span></div>
        <span class="edge">→</span>
        <div class="pnode"><b>Worker</b><span id="pipeWorker">0 active</span></div>
        <span class="edge">→</span>
        <div class="pnode"><b>QA</b><span id="pipeQa">0 review</span><span id="pipeQaWait" class="pwait"></span></div>
        <div class="ploop" id="pipeLoop">↩ 확인 후 계속</div>
      </div>
      <div class="env" id="env">
        <div class="env-title">지금 이 환경</div>
        <div class="env-row">
          <div class="env-nums">
            <div class="eseg amber" id="sgReview"><b id="stReview">0</b><span>검사 중</span></div>
            <div class="eseg blue" id="sgCoding"><b id="stCoding">0</b><span>코드 작성 중</span></div>
            <div class="eseg green" id="sgDone"><b id="stDone">0</b><span>완료</span></div>
            <div class="eseg muted" id="sgGoals"><b id="stGoals">0</b><span>목표</span></div>
          </div>
          <div class="env-note" id="stNote">대기 중</div>
        </div>
      </div>
      <div class="steps" id="steps">
        <span class="step off" data-s="wait"><i></i><span data-i="sWait">대기</span></span><span class="step-sep"></span>
        <span class="step off" data-s="doing"><i></i><span data-i="sDoing">검토 요청</span></span><span class="step-sep"></span>
        <span class="step off" data-s="done"><i></i><span data-i="sDone">판정 완료</span></span>
      </div>
    </details>
    <div class="tabs" id="tabs">
      <button data-tab="now" class="on">지금 상황</button>
      <button data-tab="task">Task<span class="bdg" id="bTask">0</span></button>
      <button data-tab="goal">Goal</button>
      <button data-tab="proto">프로토타입</button>
      <button data-tab="design">설계</button>
    </div>
    <div class="tabpane on" id="pane-now">
      <div class="nowcard" id="nowcard">
        <div class="now-top"><span class="dot waiting pulse" id="dot2"></span><b>Agent Relay</b>
          <span class="hpill">진행 <b id="taskDone">0</b>/<span id="taskTotal">0</span></span></div>
        <div class="now-pm">PM = <span data-i="pmYou">이 대화</span>에서 진행 중</div>
        <div class="now-arr" id="nowArr">대기 중</div>
      </div>
      <div class="lanes" id="lanes">
        <div class="lane lane-a">
          <div class="lane-head"><span class="lane-title">검토 중</span><span class="lane-desc">사람이 봐야 함</span><span class="lane-n" id="laneNa">0</span></div>
          <div class="bar"><i id="barA" style="width:100%"></i></div>
          <div class="chips" id="chipsA"></div>
          <div class="livecards" id="liveA"></div>
        </div>
        <div class="lane lane-b">
          <div class="lane-head"><span class="lane-title">작업 중</span><span class="lane-desc">지금 코드를 쓰는 중</span><span class="lane-n" id="laneNb">0</span></div>
          <div class="bar"><i id="barB" style="width:0%"></i></div>
          <div class="chips" id="chipsB"></div>
          <div class="livecards" id="liveB"></div>
        </div>
        <div class="lane lane-c">
          <div class="lane-head"><span class="lane-title">대기</span><span class="lane-desc">자리가 나면 자동으로 시작해요</span><span class="lane-n" id="laneNc">0</span></div>
          <div class="livecards" id="liveC"></div>
        </div>
      </div>
    </div>
    <div class="tabpane" id="pane-task">
      <div class="tasksum" id="tasksum">
        <div class="tasksum-top"><span>진행할 Task</span><b>총 <span id="taskN">0</span>개</b></div>
        <div class="bar3" id="bar3"><i class="bdone" id="barDone" style="width:0%"></i><i class="breview" id="barReview" style="width:0%"></i><i class="bleft" id="barLeft" style="width:100%"></i></div>
        <div class="taskcounts"><span class="tc-done">완료 <b id="tcDone">0</b></span><span class="tc-review">검토 <b id="tcReview">0</b></span><span class="tc-left">남음 <b id="tcLeft">0</b></span></div>
      </div>
      <div class="taskrows" id="taskRows"></div>
    </div>
    <div class="tabpane" id="pane-goal">
      <div id="goalCards"></div>
      <div class="kpis" id="goalKpis">
        <div class="kpi"><span class="n" id="kDone">0</span><span class="k">완료한 일</span></div>
        <div class="kpi"><span class="n" id="kReview">0</span><span class="k">확인 필요</span></div>
        <div class="kpi"><span class="n" id="kLeft">0</span><span class="k">남은 일</span></div>
        <div class="kpi"><span class="n" id="kBlock">0</span><span class="k">막힌 것</span></div>
      </div>
    </div>
    <div class="tabpane" id="pane-proto">
      <div class="sub">프로토타입 &amp; 와이어프레임 — 이 채팅에서 기획한 화면 구성</div>
      <div class="wf">
        <div class="mock"><div class="mb">▣ 프로젝트 대시보드</div><div class="row"><span class="bx">진행률</span><span class="bx">상태</span></div><div class="row"><span class="bx">에이전트</span><span class="bx">대기</span></div></div>
        <div class="mock"><div class="mb">▣ 작업 상세</div><div class="row"><span class="bx">헤더</span><span class="bx">실행</span></div><div class="row"><span class="bx">로그 스트림</span></div></div>
        <div class="mock"><div class="mb">▣ 설정 화면</div><div class="row"><span class="bx h32">옵션</span><span class="bx h32">저장</span></div></div>
        <div class="mock"><div class="mb">▣ 모바일</div><div class="row"><span class="bx h32">요약</span><span class="bx h32">알림</span></div></div>
      </div>
      <div class="wflist">
        <div class="wfrow"><span class="n">1</span><span><span class="tt">PM 위젯 (이 화면)</span><br><span class="ds">실시간 환경 상태</span></span></div>
        <div class="wfrow"><span class="n">2</span><span><span class="tt">Agent-Relay Electron GUI</span><br><span class="ds">데스크톱 관제</span></span></div>
        <div class="wfrow"><span class="n">3</span><span><span class="tt">JuControler 대시보드</span><br><span class="ds">상위 감시 도구</span></span></div>
      </div>
    </div>
    <div class="tabpane" id="pane-design">
      <div class="tabs2" id="dtabs">
        <button data-dtab="erd" class="on">ERD</button>
        <button data-dtab="wbs">WBS</button>
        <button data-dtab="est">예상 시간</button>
      </div>
      <div class="dtabpane on" id="dpane-erd">
        <div class="dia"><svg id="erd" viewBox="0 0 780 470" style="width:100%;height:auto" role="img" aria-label="ERD"></svg></div>
        <div class="rel2" id="relList"></div>
      </div>
      <div class="dtabpane" id="dpane-wbs">
        <div class="wbs" id="wbsTree"></div>
      </div>
      <div class="dtabpane" id="dpane-est">
        <div class="estrows" id="estRows"></div>
      </div>
    </div>
    <div class="update" id="update"></div>
    <section class="inbox" id="inbox" aria-label="전체 프로젝트 PM 수신함">
      <div class="inbox-head">
        <div class="inbox-title">전체 프로젝트 · PM 수신함</div>
        <div class="inbox-sub">선택한 프로젝트 목록과 별개입니다. 아래는 공유 수신함 대기 건입니다.</div>
        <div class="inbox-count"><b id="inboxN">0</b>건 대기</div>
      </div>
      <div class="cards" id="cards"></div>
    </section>
    </div><!-- #mainView -->
    <details class="dbg">
      <summary>debug · <span class="sub" id="buildTag">__WIDGET_BUILD__</span></summary>
      <div class="sub" id="selfcheck">selfcheck 대기 중…</div>
      <div class="sub" id="diag">dashboard 상태 확인 중…</div>
      <div id="log"></div>
    </details>
  </div>
  <script>
    (function () {
      'use strict';
      // Error boundary first: any uncaught failure must leave a visible
      // fallback (version + error + retry), never a white screen.
      var fallbackEl = document.getElementById('fallback');
      function showFallback(title, detail) {
        try {
          if (!fallbackEl) return;
          fallbackEl.className = 'fallback';
          fallbackEl.innerHTML = '';
          var b = document.createElement('b');
          b.textContent = title || '위젯 로드 실패';
          var br1 = document.createElement('br');
          var ver = document.createElement('span');
          ver.className = 'ver';
          ver.textContent = '버전 __WIDGET_BUILD__';
          var br2 = document.createElement('br');
          var msg = document.createElement('span');
          msg.textContent = detail || '새 대화에서 열어주세요.';
          var br3 = document.createElement('br');
          var btn = document.createElement('button');
          btn.textContent = '다시 시도';
          btn.onclick = function () { hideFallback(); init(); };
          fallbackEl.appendChild(b);
          fallbackEl.appendChild(br1);
          fallbackEl.appendChild(ver);
          fallbackEl.appendChild(br2);
          fallbackEl.appendChild(msg);
          fallbackEl.appendChild(br3);
          fallbackEl.appendChild(btn);
        } catch (e) { /* fallback must never throw */ }
      }
      function hideFallback() {
        try { if (fallbackEl) fallbackEl.className = 'fallback hide'; } catch (e) {}
      }
      window.addEventListener('error', function (ev) {
        var msg = (ev && ev.message) || (ev && ev.error && ev.error.message) || 'script error';
        var where = '@' + ((ev && ev.lineno) || '?') + ':' + ((ev && ev.colno) || '?');
        try {
          var dg = document.getElementById('diag');
          if (dg) dg.textContent = 'JS 오류: ' + String(msg).slice(0, 200) + ' ' + where;
        } catch (e) {}
        showFallback('위젯 로드 실패', (String(msg).slice(0, 300)) + ' ' + where);
      });
      window.addEventListener('unhandledrejection', function (ev) {
        var r = ev && ev.reason;
        var msg = (r && r.message) || String(r || 'promise rejected');
        try {
          var dg = document.getElementById('diag');
          if (dg) dg.textContent = 'Promise 거부: ' + String(msg).slice(0, 200);
        } catch (e) {}
        showFallback('위젯 로드 실패', String(msg).slice(0, 300));
      });
      // init stage markers: boot -> init-start -> initialized -> first poll.
      // renderSelfcheck replays the trail, so a stuck init names its last step.
      var initTrail = [];
      function setInitMark(step) {
        try {
          initTrail.push(step);
          if (initTrail.length > 8) initTrail.shift();
          var sc = document.getElementById('selfcheck');
          if (sc && !window.__pollRan) sc.textContent = 'init:' + initTrail.join('>');
        } catch (e) {}
      }
      setInitMark('boot');
      var dotEl = document.getElementById('dot');
      var statusEl = document.getElementById('status');
      var subEl = document.getElementById('sub');
      var logEl = document.getElementById('log');
      var cardsEl = document.getElementById('cards');
      var stepsEl = document.getElementById('steps');
      var doneCount = 0;
      var lastDeliveries = [];
      var lastDash = null;
      var lastAgentTotal = 0;
      var spriteNote = '';
      var stCodingEl = document.getElementById('stCoding');
      var stReviewEl = document.getElementById('stReview');
      var stDoneEl = document.getElementById('stDone');
      var stGoalsEl = document.getElementById('stGoals');
      var stNoteEl = document.getElementById('stNote');
      var headDoneEl = document.getElementById('headDone');
      var headTotalEl = document.getElementById('headTotal');
      var diagEl = document.getElementById('diag');
      function setDiag(text) {
        try { if (diagEl) diagEl.textContent = text; } catch (e) {}
      }
      function diagTime() {
        try { return new Date().toISOString().slice(11, 19); }
        catch (e) { return ''; }
      }
      var updateEl = document.getElementById('update');
      var OWN_URI = '__WIDGET_URI__';
      var updateNoticed = false;
      // Self-update: if the server serves a newer bundle than this render,
      // switch to it automatically. A user-gesture button is offered too,
      // since sandboxes sometimes ignore scripted navigation.
      var updateBtnHandler = null;
      var lastDeliveryFp = '';
      function deliveryFp(deliveries) {
        return (deliveries || []).map(function (d) {
          return (d && d.deliveryId || '') + ':' + (d && d.status || '');
        }).join('|');
      }
      async function checkVersion() {
        if (updateNoticed) return;
        try {
          var v = await callTool('relay_pm_get_widget_version', {});
          if (v && v.uri && v.uri !== OWN_URI) {
            updateNoticed = true;
            var msg = lang === 'en'
              ? 'A newer widget is available.'
              : '새 위젯이 있어요.';
            var hint = lang === 'en'
              ? 'If this stays, open the widget in a new chat.'
              : '계속 보이면 새 대화에서 열어주세요.';
            updateEl.innerHTML = '';
            var s1 = document.createElement('span');
            s1.textContent = msg + ' ';
            var btn = document.createElement('button');
            btn.textContent = lang === 'en' ? 'Refresh now' : '지금 새로고침';
            btn.onclick = function () { try { window.location.reload(); } catch (e) { /* banner stays */ } };
            var s2 = document.createElement('span');
            s2.textContent = ' ' + hint;
            updateEl.appendChild(s1);
            updateEl.appendChild(btn);
            updateEl.appendChild(s2);
            updateEl.className = 'update show';
            logLine('newer widget bundle: ' + v.uri);
            // NOTE: never auto-reload here. Scripted navigation inside the
            // host sandbox can land on a blank view; the user-gesture
            // button above is the only refresh path.
          }
        } catch (e) { /* version check is best-effort */ }
      }
      var langKoBtn = document.getElementById('langKo');
      var langEnBtn = document.getElementById('langEn');
      var lang = 'ko';
      var sessionHandled = {};
      var claiming = false;
      // 10s instead of 1.5s. The widget sits open in a background chat for hours, and 1.5s is ~58k
      // round trips a day per open widget for a status board that changes on the order of minutes.
      // A hidden tab polls not at all, and catches up with one immediate poll when it comes back.
      var POLL_MS = 10000;

      function setStatus(kind, text, sub) {
        dotEl.className = 'dot ' + kind;
        statusEl.textContent = text;
        subEl.textContent = sub || '';
      }
      function esc(text) {
        return String(text == null ? '' : text).replace(/[&<>"]/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
      }
      function shortId(id) {
        var s = String(id || '');
        var dash = s.lastIndexOf('-');
        return dash >= 0 ? s.slice(dash + 1, dash + 7) : s.slice(0, 8);
      }
      // Visual board only: counts, stepper, per-delivery cards.
      // Shared inbox across projects — show taskProjectId; never invent jucontroller ownership.
      function deliveryProjectLabel(d) {
        var id = (d && (d.taskProjectId || d.projectId)) ? String(d.taskProjectId || d.projectId) : '';
        var name = (d && (d.taskProjectName || d.projectName)) ? String(d.taskProjectName || d.projectName) : '';
        if (id) {
          return {
            text: name && name !== id ? (name + ' · ' + id) : id,
            cls: id === 'ws' ? 'proj legacy' : 'proj',
            tip: name ? (name + ' (' + id + ')') : id,
          };
        }
        // Storage scope alone is not logical product identity.
        return { text: '소속 미확인', cls: 'proj unknown', tip: 'Task.projectId 없음' };
      }
      function renderBoard(deliveries) {
        var list = Array.isArray(deliveries) ? deliveries : [];
        var doing = 0;
        var html = '';
        for (var i = 0; i < list.length; i++) {
          var d = list[i] || {};
          if (!d.deliveryId) continue;
          var claimed = !!sessionHandled[d.deliveryId];
          if (claimed) doing++;
          var pill = claimed ? 'doing' : 'wait';
          var label = claimed ? '검토 중' : '대기 중';
          var proj = deliveryProjectLabel(d);
          html += '<details class="dcard"><summary><span class="row">'
            + '<span class="id">…' + esc(shortId(d.deliveryId)) + '</span>'
            + '<span class="task" title="' + esc(d.taskId || d.kind || 'delivery') + '">' + esc(d.taskId || d.kind || 'delivery') + '</span>'
            + '<span class="' + proj.cls + '" title="' + esc(proj.tip) + '">' + esc(proj.text) + '</span>'
            + '<span class="pill ' + pill + '">' + label + '</span>'
            + '</span></summary>'
            + '<div class="meta">delivery ' + esc(d.deliveryId)
            + '<br>프로젝트 ' + esc(proj.text)
            + (d.createdAt ? '<br>생성 ' + esc(d.createdAt) : '') + '</div></details>';
        }
        cardsEl.innerHTML = html;
        try {
          var inboxN = document.getElementById('inboxN');
          if (inboxN) inboxN.textContent = String(list.length);
        } catch (eInbox) {}
        var nWait = list.length - doing;
        pipeNWait = nWait;
        pipeDoing = doing;
        updatePipe();
        setNum(stReviewEl, doing);
        setNum(stDoneEl, doneCount);
        setSeg('sgReview', doing, 'eseg amber');
        setSeg('sgDone', doneCount, 'eseg green');
        setNum(headDoneEl, doneCount);
        if (headTotalEl) {
          headTotalEl.textContent = String(list.length);
          try { headTotalEl.setAttribute('title', '전체 프로젝트 · PM 수신함 ' + list.length + '건'); } catch (eH) {}
        }
        // "무엇을 하고 있나": arrivals first, then review, else waiting.
        try {
          var noteText = nWait > 0
            ? t('envArrived').replace('{n}', String(nWait))
            : (doing > 0 ? t('envReview') : t('envWait'));
          if (stNoteEl) stNoteEl.textContent = noteText;
          var nowArr = document.getElementById('nowArr');
          if (nowArr) nowArr.textContent = noteText;
        } catch (e) {}
        var steps = stepsEl.querySelectorAll('.step');
        setStep(steps[0], list.length > 0 ? 'on' : 'off');
        setStep(steps[1], doing > 0 ? 'doing' : (list.length > 0 ? 'off' : 'off'));
        setStep(steps[2], doneCount > 0 ? 'on' : 'off');
      }
      function setStep(el, cls) { if (el) el.className = 'step ' + cls; }
      function logLine(text) {
        var d = document.createElement('div');
        var t = document.createElement('span');
        t.className = 't';
        t.textContent = '[' + new Date().toISOString().slice(11, 19) + '] ';
        d.appendChild(t);
        d.appendChild(document.createTextNode(text));
        logEl.appendChild(d);
        logEl.scrollTop = logEl.scrollHeight;
      }

      // ---- i18n (KO default; EN toggle). Widget strings only, never prompts. ----
      var I18N = {
        ko: { connecting: '연결 중…', connected: '연결됨', waiting: '결과 기다리는 중…',
              reviewReady: 'PM 검토 준비됨', waking: 'GPT 깨우는 중…', wakeSent: '전송됨 — GPT에 알림',
              wakeFail: '전송 실패', initFail: '시작 실패', wait: '대기 중', doing: '검토 중',
              done: '완료', blocked: '막힘', sWait: '대기', sDoing: '검토 요청', sDone: '판정 완료',
              working: '코드 작성 중', qaDoing: '검사하는 중',
              noWorking: '지금 코드를 작성하는 에이전트 없음',
              autoResume: '검사가 끝나면 자동으로 코딩이 다시 시작됩니다',
              liveNoQa: '지금 검사 중인 작업 없어요',
              liveNoBuild: '지금 코드를 작성하는 작업 없어요',
              liveWaiting: '자리가 나면 자동으로 시작해요. 지금은 기다리는 중이에요',
              liveNoWait: '기다리는 작업 없어요',
              liveStuck: '멈춤',
              liveTooltip: '작업',
              liveTaskWord: '작업',
              pmYou: '이 대화',
              spriteFail: '이미지 실패', spriteLoadFail: '스프라이트 로드 실패', spritesOk: '스프라이트', spritesFail: '스프라이트 실패',
              modelUnknown: '모델 정보 없음',
              remaining: '남은 일', goals: '목표', noAgents: '일하는 AI 없음',
              envWait: '대기 중', envReview: 'PM 검토 대기', envArrived: '최종 delivery {n}건 도착' },
        en: { connecting: 'Connecting…', connected: 'Connected', waiting: 'Waiting for Agent result…',
              reviewReady: 'PM review ready', waking: 'Waking GPT…', wakeSent: 'Wake sent — GPT notified',
              wakeFail: 'Wake failed', initFail: 'Initialization failed', wait: 'Waiting', doing: 'Reviewing',
              done: 'Done', blocked: 'Blocked', sWait: 'Wait', sDoing: 'Review', sDone: 'Judged',
              working: 'working', qaDoing: 'inspecting',
              noWorking: 'No agent is writing code right now',
              autoResume: 'Coding resumes automatically after review',
              liveNoQa: 'Nothing is being checked right now',
              liveNoBuild: 'Nothing is being written right now',
              liveWaiting: 'Starts automatically when a slot frees. Waiting for now',
              liveNoWait: 'Nothing is waiting',
              liveStuck: 'stuck',
              liveTooltip: 'Task',
              liveTaskWord: 'Task',
              pmYou: 'This chat',
              spriteFail: 'sprite failed', spriteLoadFail: 'sprite load failed', spritesOk: 'sprites', spritesFail: 'sprites failed',
              modelUnknown: 'model unknown',
              remaining: 'Remaining', goals: 'Goals', noAgents: 'No active AI',
              envWait: 'Waiting', envReview: 'PM review pending', envArrived: 'Final delivery: {n} arrived' },
      };
      function t(key) { return (I18N[lang] && I18N[lang][key]) || I18N.ko[key] || key; }
      function applyLang() {
        var spans = document.querySelectorAll('[data-i]');
        for (var i = 0; i < spans.length; i++) {
          var k = spans[i].getAttribute('data-i');
          if (I18N[lang][k]) spans[i].textContent = I18N[lang][k];
        }
        langKoBtn.className = lang === 'ko' ? 'on' : '';
        langEnBtn.className = lang === 'en' ? 'on' : '';
        renderBoard(lastDeliveries);
      }
      langKoBtn.onclick = function () { lang = 'ko'; applyLang(); };
      langEnBtn.onclick = function () { lang = 'en'; applyLang(); };
      // ---- sprite engine (handoff spec: provided PNGs only, no redraws) ----
      var ASSET_BASE = '__ASSET_BASE__';
      var FRAMES = { run: 6, dig: 4, climb: 4, qa: 4, done: 4, blocked: 4, sleep: 4, idle: 4 };
      var DURS = { run: 0.52, dig: 0.62, climb: 0.66, qa: 1.15, done: 0.9, blocked: 0.85, sleep: 2.4, idle: 2.6 };
            var SEP_RE = new RegExp('[ \\t\\n\\r_-]+');
      // Display sizes locked to source frame aspect 340×520 (no stretch).
      // Unused sheets (run/climb/sleep) stay preloaded for CSP/selfcheck but are not
      // painted unless agent state explicitly maps to them — never invent work/done motion.
      var SHEET_W = { crew: 26, crewH: 40, climb: 48, climbH: 74 };
      var RUN_W = 26, RUN_H = 40;
      // --sheetW = -(N * displayW): sheet math from DISPLAY size only, never source pixels.
      function sheetGeom(state, w, h) {
        var n = FRAMES[state] || 4;
        return { frames: n, bgW: n * w, offW: -(n * w) };
      }
      // Sprite preload: a sheet that fails (CSP/offline/404) must NEVER
      // leave an empty black stage. Status per sheet; cards render a
      // visible missing-sprite box instead. No silent-fail empty cards.
      var SHEETS = ['run', 'dig', 'climb', 'qa', 'done', 'blocked', 'sleep', 'idle'];
      var sheetStatus = {};
      var sheetFailed = [];
      var sheetDims = {};
      function sheetUrl(state) { return ASSET_BASE + '/' + state + '-sheet.png'; }
      function preloadSheets(done) {
        var pending = SHEETS.length;
        SHEETS.forEach(function (s) {
          var settled = false;
          function mark(ok) {
            if (settled) return;
            settled = true;
            sheetStatus[s] = ok ? 'ok' : 'fail';
            if (!ok) sheetFailed.push(s);
            if (--pending === 0 && typeof done === 'function') done(sheetFailed.slice());
          }
          try {
            var img = new Image();
            var timer = setTimeout(function () { mark(false); }, 8000);
            img.onload = function () {
              clearTimeout(timer);
              try { sheetDims[s] = { w: img.naturalWidth, h: img.naturalHeight }; } catch (e) {}
              mark(true);
            };
            img.onerror = function () { clearTimeout(timer); mark(false); };
            img.src = sheetUrl(s);
          } catch (e) { mark(false); }
        });
      }
      function applySheet(el, state, w, h) {
        if (sheetStatus[state] === 'fail') return false;
        var n = FRAMES[state] || 4;
        var dur = DURS[state] || 1;
        el.style.backgroundImage = 'url(' + sheetUrl(state) + ')';
        el.style.backgroundRepeat = 'no-repeat';
        el.style.backgroundSize = (n * w) + 'px ' + h + 'px';
        el.style.setProperty('--sheetW', String(-(n * w)) + 'px');
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        el.style.animation = 'play ' + dur + 's steps(' + n + ') infinite';
        return true;
      }
      function agentRole(a) {
        return /qa/i.test(a.workerId || '') || /qa/i.test((a && a.role) || '') ? 'qa' : 'worker';
      }
      function isActive(a) {
        var st = String((a && a.state) || '').toLowerCase();
        // Surface blocked/done when the payload says so; keep idle/sleep out of the
        // default chip list so the first screen stays compact.
        if (st === 'blocked' || st === 'error' || st === 'failed') return true;
        if (st === 'done' || st === 'completed' || st === 'accepted') return true;
        return a.state === 'working' || agentRole(a) === 'qa';
      }
      function activeAgents(list) {
        return (list || []).filter(isActive);
      }
      // Map only when state evidence exists. dig/qa remain the known working animations.
      // run/climb unused: ladder/track UI is not mounted on the v6 control tower.
      // sleep unused unless agent.state is explicitly idle/sleep.
      function agentSheet(a) {
        var st = String((a && a.state) || '').toLowerCase();
        if (st === 'blocked' || st === 'error' || st === 'failed') return 'blocked';
        if (st === 'done' || st === 'completed' || st === 'accepted') return 'done';
        if (st === 'sleep' || st === 'idle') return st === 'sleep' ? 'sleep' : 'idle';
        if (agentRole(a) === 'qa') return 'qa';
        if (st === 'working' || st === 'running' || st === 'active') return 'dig';
        // No usable state → idle (never invent dig/done motion).
        return 'idle';
      }
      function agentStateLabel(a) {
        var st = String((a && a.state) || '').toLowerCase();
        if (st === 'blocked' || st === 'error' || st === 'failed') return t('blocked') || '막힘';
        if (st === 'done' || st === 'completed' || st === 'accepted') return t('done');
        if (st === 'sleep') return t('wait');
        if (st === 'idle') return t('wait');
        if (agentRole(a) === 'qa') return t('qaDoing');
        if (st === 'working' || st === 'running' || st === 'active') return t('working');
        return t('wait');
      }
      // ---- tabs (guarded: a tab failure must never kill init) ----
      try {
        (function () {
          var tabs = document.getElementById('tabs');
          if (!tabs) return;
        var btns = tabs.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          btns[i].onclick = (function (btn) {
            return function () {
              for (var j = 0; j < btns.length; j++) btns[j].className = '';
              btn.className = 'on';
              var panes = ['now', 'task', 'goal', 'proto', 'design'];
              for (var k = 0; k < panes.length; k++) {
                document.getElementById('pane-' + panes[k]).className =
                  'tabpane' + (btn.getAttribute('data-tab') === panes[k] ? ' on' : '');
              }
            };
            })(btns[i]);
          }
        })();
      } catch (eTab) { /* tabs are progressive enhancement; core still renders */ }
      // applySheet returns false when the sheet failed to preload: mark the
      // slot visibly instead of leaving an empty box.
      function markSheetMissing(el, w, h, state) {
        try {
          el.style.width = w + 'px';
          el.style.height = h + 'px';
          el.className = (el.className || '') + ' sheet-missing';
          el.textContent = '!';
          el.title = t('spriteFail') + ': ' + state;
        } catch (e) {}
      }
      function isDoneTask(task) {
        return task && (task.pmState === 'ACCEPTED' || task.executionState === 'COMPLETED');
      }
      function taskTitleOf(task, i) {
        var label = (task && (task.title || task.taskId)) || ('Task ' + (i + 1));
        return esc(label);
      }
      function taskStatus(task) {
        if (isDoneTask(task)) return 'done';
        var pm = task && task.pmState;
        if (pm === 'VERIFYING' || pm === 'CHANGES_REQUESTED' || pm === 'CHANGES') return 'review';
        if (task && task.executionState === 'RUNNING') return 'working';
        return 'planned';
      }
      function taskStatusLabel(st) {
        if (st === 'done') return t('done');
        if (st === 'review') return t('doing');
        if (st === 'working') return t('working');
        return t('wait');
      }
      var selectedTaskId = null;
      var lastTaskListCache = [];

      function isRunnableReadyTask(task) {
        if (!task || !task.taskId) return false;
        if (task.executionState !== 'READY') return false;
        var pm = task.pmState;
        if (pm && pm !== 'PENDING' && pm !== 'READY') return false;
        var runs = task.linkedRuns || [];
        return !runs.length;
      }

      function renderTaskTab(taskList) {
        var tasks = (taskList || []).slice(0, 30);
        lastTaskListCache = tasks;
        var rows = document.getElementById('taskRows');
        var done = 0, review = 0;
        var cur = -1;
        for (var i = 0; i < tasks.length; i++) {
          var st = taskStatus(tasks[i]);
          if (st === 'done') done++;
          else if (st === 'review') review++;
          if (cur < 0 && st !== 'done') cur = i;
        }
        var left = tasks.length - done - review;
        setNum(document.getElementById('taskN'), tasks.length);
        setNum(document.getElementById('tcDone'), done);
        setNum(document.getElementById('tcReview'), review);
        setNum(document.getElementById('tcLeft'), left);
        setBadge('bTask', tasks.length);
        try {
          var tot = tasks.length || 1;
          document.getElementById('barDone').style.width = Math.round((done / tot) * 100) + '%';
          document.getElementById('barReview').style.width = Math.round((review / tot) * 100) + '%';
          document.getElementById('barLeft').style.width = Math.round((left / tot) * 100) + '%';
        } catch (e) {}
        try {
          var tn = document.getElementById('taskDone');
          var tt = document.getElementById('taskTotal');
          if (tn) tn.textContent = String(done);
          if (tt) tt.textContent = String(tasks.length);
        } catch (e) {}
        var html = '';
        for (var j = 0; j < tasks.length; j++) {
          var task = tasks[j] || {};
          var s2 = taskStatus(task);
          var tid = String(task.taskId || ('T' + j));
          var runnable = isRunnableReadyTask(task);
          var selected = selectedTaskId === tid || (!selectedTaskId && j === cur);
          var title = taskTitleOf(task, j);
          html += '<button type="button" class="trow st-' + s2
            + (selected ? ' cur sel' : '')
            + (runnable ? '' : ' ro')
            + '" data-task-id="' + esc(tid) + '"'
            + ' data-runnable="' + (runnable ? '1' : '0') + '"'
            + ' aria-selected="' + (selected ? 'true' : 'false') + '"'
            + ' title="' + esc(title) + '">'
            + '<span class="tid">' + esc(tid) + '</span>'
            + '<span class="tti">' + esc(title) + '</span>'
            + '<span class="tst">' + esc(taskStatusLabel(s2)) + '</span></button>';
        }
        try { if (rows) rows.innerHTML = html; } catch (e) {}
        return { done: done, review: review, left: left, total: tasks.length };
      }
      function renderGoalTab(goals, taskCounts) {
        var box = document.getElementById('goalCards');
        var list = (goals || []).slice(0, 5);
        var html = '';
        for (var i = 0; i < list.length; i++) {
          var g = list[i] || {};
          html += '<div class="goalcard"><div class="gt">' + esc(g.title || g.goalId || 'Goal') + '</div>'
            + '<div class="gs">' + esc(g.status || '') + '</div></div>';
        }
        if (!html) {
          html = '<div class="emptybox">아직 계획 데이터가 없습니다</div>';
        }
        try { if (box) box.innerHTML = html; } catch (e) {}
        var tc = taskCounts || { done: 0, review: 0, left: 0 };
        setNum(document.getElementById('kDone'), tc.done);
        setNum(document.getElementById('kReview'), tc.review);
        setNum(document.getElementById('kLeft'), tc.left);
        setNum(document.getElementById('kBlock'), 0);
      }
      function erdSvg() {
        function ent(x, y, w, h, title, rows) {
          var s = '<g><rect class="ent" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"/>'
            + '<path class="ent-h" d="M' + x + ',' + (y + 6) + ' a6,6 0 0 1 6,-6 h' + (w - 12)
            + ' a6,6 0 0 1 6,6 v14 h-' + w + ' z"/>'
            + '<text class="ent-t" x="' + (x + 12) + '" y="' + (y + 17) + '">' + title + '</text>';
          for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var cls = r[0] === 'pk' ? 'ent-pk' : (r[0] === 'fk' ? 'ent-fk' : 'ent-c');
            var mark = r[0] === 'pk' ? '● ' : (r[0] === 'fk' ? '○ ' : '  ');
            s += '<text class="' + cls + '" x="' + (x + 12) + '" y="' + (y + 38 + i * 16) + '">' + mark + r[1] + '</text>';
          }
          return s + '</g>';
        }
        var g = '';
        g += ent(20, 20, 150, 112, 'goals', [['pk', 'id'], ['c', 'title'], ['c', 'why'], ['c', 'status'], ['c', 'created_at']]);
        g += ent(240, 20, 165, 128, 'tasks', [['pk', 'id'], ['fk', 'goal_id'], ['c', 'title'], ['c', 'status'], ['c', 'size'], ['c', 'seq']]);
        g += ent(480, 20, 150, 128, 'agents', [['pk', 'id'], ['c', 'name'], ['c', 'role'], ['c', 'state'], ['c', 'runtime'], ['c', 'sheet']]);
        g += ent(470, 215, 160, 96, 'task_runs', [['pk', 'id'], ['fk', 'task_id'], ['fk', 'agent_id'], ['c', 'started_at']]);
        g += ent(240, 200, 165, 112, 'deliveries', [['pk', 'id'], ['fk', 'task_id'], ['c', 'run_no'], ['c', 'verdict'], ['c', 'created_at']]);
        g += ent(20, 200, 150, 112, 'messages', [['pk', 'id'], ['fk', 'delivery_id'], ['c', 'role'], ['c', 'body'], ['c', 'at']]);
        g += ent(20, 360, 150, 96, 'test_runs', [['pk', 'id'], ['fk', 'delivery_id'], ['c', 'result'], ['c', 'at']]);
        g += ent(240, 360, 165, 96, 'wbs_nodes', [['pk', 'id'], ['fk', 'goal_id'], ['fk', 'parent_id'], ['c', 'title']]);
        g += ent(480, 360, 150, 96, 'designs', [['pk', 'id'], ['fk', 'goal_id'], ['c', 'kind'], ['c', 'payload']]);
        g += '<line class="rel" x1="170" y1="60" x2="240" y2="60"/>';
        g += '<text class="rel-l" x="205" y="52" text-anchor="middle">1:N</text>';
        g += '<line class="rel" x1="405" y1="80" x2="480" y2="80"/>';
        g += '<text class="rel-l" x="442" y="72" text-anchor="middle">N:M</text>';
        g += '<line class="rel" x1="300" y1="148" x2="300" y2="200"/>';
        g += '<text class="rel-l" x="292" y="178" text-anchor="end">1:N</text>';
        g += '<line class="rel" x1="405" y1="240" x2="470" y2="250"/>';
        g += '<text class="rel-l" x="440" y="236" text-anchor="middle">1:N</text>';
        g += '<line class="rel" x1="240" y1="245" x2="170" y2="245"/>';
        g += '<text class="rel-l" x="205" y="237" text-anchor="middle">1:N</text>';
        g += '<line class="rel" x1="105" y1="312" x2="105" y2="360"/>';
        g += '<text class="rel-l" x="97" y="340" text-anchor="end">1:N</text>';
        g += '<line class="cnt" x1="95" y1="148" x2="95" y2="200"/>';
        g += '<text class="cnt-l" x="102" y="178">0..N</text>';
        return g;
      }
      var RELS = [
        ['goals', '1:N', 'tasks', '목표를 작업으로 분해'],
        ['tasks', 'N:M', 'agents', 'task_runs 중간 테이블 경유'],
        ['tasks', '1:N', 'deliveries', '시도마다 기록'],
        ['deliveries', '1:N', 'messages', 'PM ↔ Worker 대화'],
        ['deliveries', '1:N', 'test_runs', '테스터 검증'],
        ['goals', '1:N', 'wbs_nodes', 'self FK 계층'],
        ['goals', '1:N', 'designs', 'ERD/와이어프레임/프로토타입'],
      ];
      function renderDesignStatic() {
        try {
          var svg = document.getElementById('erd');
          if (svg && !svg.getAttribute('data-drawn')) {
            svg.innerHTML = erdSvg();
            svg.setAttribute('data-drawn', '1');
          }
          var rl = document.getElementById('relList');
          if (rl && !rl.getAttribute('data-drawn')) {
            var html = '';
            for (var i = 0; i < RELS.length; i++) {
              html += '<div class="relrow"><span class="a">' + esc(RELS[i][0]) + '</span>'
                + '<span class="ar">' + esc(RELS[i][1]) + '</span>'
                + '<span class="b">' + esc(RELS[i][2]) + '</span>'
                + '<span class="d">' + esc(RELS[i][3]) + '</span></div>';
            }
            rl.innerHTML = html;
            rl.setAttribute('data-drawn', '1');
          }
        } catch (e) { /* static art best-effort */ }
      }
      function renderWbsNodes(nodes) {
        var box = document.getElementById('wbsTree');
        var list = nodes || [];
        var html = '';
        if (!list.length) {
          html = '<div class="emptybox">아직 계획 데이터가 없습니다<br>Goal을 먼저 만드세요</div>';
        } else {
          var byParent = {};
          for (var i = 0; i < list.length; i++) {
            var n = list[i] || {};
            var p = n.parent_id || '';
            if (!byParent[p]) byParent[p] = [];
            byParent[p].push(n);
          }
          var walk = function (pid, depth) {
            var out = '';
            var kids = byParent[pid] || [];
            for (var k = 0; k < kids.length; k++) {
              var nd = kids[k];
              var st = nd.status === 'done' ? 'done' : (nd.status === 'in-progress' || nd.status === 'working' ? 'working' : 'wait');
              var dep = st === 'done' ? '✓ 완료' : (st === 'working' ? '→ 작업 중' : '· 대기');
              var ind = depth === 0 ? '▓' : (k === kids.length - 1 ? '└' : '├');
              out += '<div class="wbsrow"><span class="ind">' + ind + '</span>'
                + '<span class="bar2"><span>' + esc(nd.title || nd.id || '') + '</span></span>'
                + '<span class="sz">' + esc(nd.size || '') + '</span>'
                + '<span class="dep ' + st + '">' + dep + '</span></div>';
              out += walk(nd.id, depth + 1);
            }
            return out;
          };
          html = walk('', 0);
        }
        try { if (box) box.innerHTML = html; } catch (e) {}
      }
      function renderEst(taskCounts) {
        var box = document.getElementById('estRows');
        var tc = taskCounts || { done: 0, review: 0, left: 0 };
        var html = '<div class="estrow"><b>✓ 완료된 일 ' + tc.done + '건</b></div>'
          + '<div class="estrow"><b>! 확인 대기 ' + tc.review + '건</b><span>답장 오면 자동 진행</span></div>'
          + '<div class="estrow"><b>→ 진행 예정 ' + tc.left + '건</b></div>';
        try { if (box) box.innerHTML = html; } catch (e) {}
      }
      function initDesignTabs() {
        try {
          var dt = document.getElementById('dtabs');
          if (!dt || dt.getAttribute('data-wired')) return;
          dt.setAttribute('data-wired', '1');
          var btns = dt.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) {
            btns[i].onclick = (function (btn) {
              return function () {
                for (var j = 0; j < btns.length; j++) btns[j].className = '';
                btn.className = 'on';
                var panes = ['erd', 'wbs', 'est'];
                for (var k = 0; k < panes.length; k++) {
                  var p = document.getElementById('dpane-' + panes[k]);
                  if (p) p.className = 'dtabpane' + (btn.getAttribute('data-dtab') === panes[k] ? ' on' : '');
                }
              };
            })(btns[i]);
          }
        } catch (e) { /* subtabs best-effort */ }
      }
      // R1-R5: name normalization (mapping at the data level, never CSS cut).
      // "Builder via live checkout" -> {name:"Live", role:"Builder"}.
      var AGENT_WORDS = /claude|codex|probe|builder|opencode|cline|cursor|grok/i;
      var NAME_MAP = [
        [/claude-code/i, 'Claude'],
        [/codex/i, 'Codex'],
        [/probe/i, 'Probe'],
        [/builder/i, 'Builder'],
      ];
      var ROLE_MAP = [
        [/claude-code/i, 'Code'],
        [/codex/i, 'Code'],
        [/probe/i, 'QA'],
        [/(^|[^a-z])qa([^a-z]|$)/i, 'QA'],
        [/builder/i, 'Build'],
        [/worker/i, 'Worker'],
        [/agent/i, 'Agent'],
      ];
      var KO_WORD = {
        quality: '품질', assurance: '검증', verification: '검증', validation: '검증',
        test: '테스트', review: '검토', scout: '정찰', probe: '탐색',
        semantic: '', smart: '', advanced: '', super: '', ultimate: '',
      };
      function mapFirst(list, text) {
        for (var i = 0; i < list.length; i++) {
          if (list[i][0].test(text)) return list[i][1];
        }
        return null;
      }
      function firstWord(text) {
        var tok = String(text || '').trim().split(SEP_RE)[0] || '';
        tok = tok.split(/(?=[A-Z])/)[0] || tok;
        return tok ? tok.slice(0, 1).toUpperCase() + tok.slice(1) : '';
      }
      function capName(name) {
        var s = String(name || '');
        var chars = Array.from(s);
        if (/[가-힣]/.test(s)) {
          return chars.length <= 10 ? s : chars.slice(0, 10).join('');
        }
        var words = s.toLowerCase().split(SEP_RE).filter(Boolean);
        if (words.length > 1) {
          // Long phrases map to key nouns ("Semantic Quality Assurance" -> "품질 검증").
          var mapped = [];
          for (var i = 0; i < words.length; i++) {
            if (words[i] in KO_WORD) { if (KO_WORD[words[i]]) mapped.push(KO_WORD[words[i]]); }
            else mapped.push(words[i]);
          }
          var ko = mapped.join(' ').trim();
          if (/[가-힣]/.test(ko)) {
            var kos = Array.from(ko);
            return kos.length <= 10 ? ko : kos.slice(0, 10).join('');
          }
          if (chars.length > 16) {
            var fw = firstWord(s);
            if (fw && fw.length <= 16) return fw;
          } else {
            return s;
          }
        }
        if (chars.length <= 16) return s;
        var fw2 = firstWord(s);
        return (fw2 && fw2.length <= 16) ? fw2 : chars.slice(0, 16).join('');
      }
      var PAREN_KO = { 'config default model': '기본 모델' };
      function stripVersions(s) {
        return String(s || '').replace(/[0-9]+(.[0-9]+)+/g, '').replace(/ +/g, ' ').trim();
      }
      function coreShort(s) {
        var c = stripVersions(String(s || ''));
        c = c.replace(/ CLI$/i, '').trim();
        return c.replace(/ +/g, ' ').trim();
      }
      function tokensOf(s) {
        return String(s || '').trim().split(SEP_RE).filter(Boolean);
      }
      var FILLERS = ['only', 'just'];
      function parenRole(p) {
        var first = String(p || '').split(',')[0].trim();
        var lk = first.toLowerCase();
        if (lk in PAREN_KO) return PAREN_KO[lk];
        var toks = first.trim().split(/ +/).filter(Boolean);
        var kept = toks.filter(function (x) { return x.indexOf('-') < 0; });
        if (kept.length) toks = kept;
        while (toks.length > 1 && FILLERS.indexOf(toks[toks.length - 1].toLowerCase()) >= 0) toks.pop();
        var joined = toks.join(' ');
        return capName(joined || first);
      }
      function normalizeAgent(a) {
        var wid = String((a && a.workerId) || '');
        var raw = String((a && (a.displayName || a.workerId)) || '');
        // Version-stamped ids ("V0.2-B Codex 0.153.4 Managed"): last token = name, first = role.
        if (!/ via /i.test(raw)) {
          var rawToks = String(raw || '').trim().split(/ +/).filter(Boolean);
          if (rawToks.length >= 3 && /[0-9]+[.][0-9]+/.test(raw)) {
            return {
              name: capName(rawToks[rawToks.length - 1]),
              role: capName(rawToks[0]),
              full: raw,
            };
          }
        }
        var via = raw.match(/^(.*?) via (.+)$/i);
        if (via) {
          var prefix = via[1].trim();
          var rest = via[2].trim();
          var pm = rest.match(/^(.*?)([(][^()]*[)]) *$/);
          var core = pm ? pm[1].trim() : rest;
          var paren = pm ? pm[2].split(',')[0].replace(/^[ (]+|[ )]+$/g, '').trim() : null;
          var isQa = /qa/i.test(prefix);
          var role;
          if (paren && !isQa) {
            role = parenRole(paren);
          } else {
            role = mapFirst(NAME_MAP, isQa ? core : prefix)
              || mapFirst(ROLE_MAP, core)
              || mapFirst(ROLE_MAP, wid)
              || (/qa/i.test(wid) ? 'QA' : 'Build');
          }
          var name;
          if (isQa) {
            name = 'QA';
          } else {
            var cs = coreShort(core);
            var cst = tokensOf(cs);
            if (!paren && cst.length >= 3) {
              name = cst[0] + ' ' + cst[cst.length - 1];
              role = cst[cst.length - 2].toLowerCase();
            } else {
              var hit = mapFirst(NAME_MAP, cs);
              if (hit) name = hit;
              else if (AGENT_WORDS.test(cs)) name = cs;
              else if (cst.length > 1) name = firstWord(cs) || cs;
              else name = cs;
            }
          }
          if (!name) name = 'Agent';
          return { name: capName(name), role: capName(role || 'Build'), full: raw };
        }
        var name2 = coreShort(raw.replace(/^(builder|worker|agent) +/i, ''));
        var hit2 = mapFirst(NAME_MAP, name2) || mapFirst(NAME_MAP, wid);
        if (hit2) name2 = hit2;
        var role2 = mapFirst(ROLE_MAP, name2) || mapFirst(ROLE_MAP, wid);
        if (!name2) name2 = 'Agent';
        name2 = capName(name2);
        if (!role2) role2 = /(^|[^a-z])qa([^a-z]|$)/i.test(wid) ? 'QA' : 'Build';
        return { name: name2, role: role2, full: raw };
      }
      // Task titles: data-level single line (cap 30, full kept in title attr).
      function shortTaskTitle(task) {
        var full = String((task && (task.title || task.taskId)) || '');
        var chars = Array.from(full);
        return { text: chars.length > 30 ? chars.slice(0, 30).join('') : full, full: full };
      }
      function agentPillClass(a) {
        if (/qa/i.test(a.workerId || '')) return 'st-qa';
        return a.state === 'working' ? 'st-work' : 'st-idle';
      }
      function setBadge(id, n) {
        try {
          var el = document.getElementById(id);
          if (el) el.textContent = String(n);
        } catch (e) {}
      }
      // A count is either measured or not. Measured means 0 or more and is shown in full colour, because
      // "0" is a real answer. Unmeasured (null/undefined/NaN) shows "—" and is dimmed, so a board that
      // has not counted yet never looks like a board reporting zero. Raw values must never reach the
      // screen: String(n) used to print the words "null" and "undefined" there.
      function hasCount(n) { return typeof n === 'number' && isFinite(n); }
      function setNum(el, n) {
        try { if (el) el.textContent = hasCount(n) ? String(n) : '—'; } catch (e) {}
      }
      function setSeg(id, n, base) {
        try {
          var el = document.getElementById(id);
          if (el) el.className = (base || 'seg') + (hasCount(n) ? '' : ' dim');
        } catch (e) {}
      }
      function laneOfAgent(a) {
        if (/qa/i.test((a && a.workerId) || '')) return 'A';
        return (a && a.state) === 'working' ? 'B' : null;
      }
      function setPipeText(id, text) {
        try {
          var el = document.getElementById(id);
          if (el) el.textContent = text;
        } catch (e) {}
      }
      // Shared pipe state: renderBoard owns deliveries, renderAgents owns workers.
      var pipeNWait = 0;
      var pipeDoing = 0;
      var pipeWorking = 0;
      // QA slot pressure from the portfolio runner (dash.portfolio), or null when the runner has not
      // written its live mirror yet. It explains WHY a queue exists — it never changes the review count,
      // and it never feeds the "검토 중" lane, which belongs to the Founder alone.
      var pipeQaWait = null;
      var pipeLive = { builders: [], qa: [] };
      /**
       * A task id like JUAI-CHECK-RULE-FIRST-POST is unreadable to a non-developer, and a hardcoded
       * dictionary would be wrong the moment a new task is written. So the rule is structural instead:
       * a human-written title is already Korean prose and is used verbatim; only an id-shaped title is
       * translated, by splitting it into words and keeping the product names readable. An empty result
       * falls back to the raw id rather than showing a blank card.
       */
      var TITLE_WORDS = {
        JUAI: 'AI 앱', JUCEIPT: '영수증', JUCEIPTPLAN: '영수증 계획', JUCONTROLER: '컨트롤러',
        JCAPP: '앱', JUTELL: '알려줄', JUCENTER: '센터', JURADAR: '레이더', JUPLAN: '계획',
        AI: 'AI', QA: '검사', CLI: '명령줄', API: 'API', UI: '화면', UX: '사용자 화면',
        CHECK: '확인', NOTES: '메모', VALID: '검증', JOIN: '결합', RULE: '규칙', FIRST: '처음',
        POST: '게시', STATUS: '상태', RUN: '실행', ORDER: '순서', PLAT: '화면', SCREEN: '화면',
        HEADER: '머리말', DATE: '날짜', SYNC: '맞춤', DAILY: '매일', REVIEW: '검토', NO: '',
        OPEN: '열기', INDEX: '목록', DECISION: '결정', ROW: '행', VALUE: '값', M2: 'M2',
        BOOT: '부팅', RECOVERY: '복구', ANSWER: '답', STORE: '저장', EVIDENCE: '근거',
        INFLIGHT: '전송 중', PRECHECK: '사전 확인', SENT: '전송', README: '안내', VIDEO: '영상',
        MEDIA: '미디어', RESULT: '결과', FOLD: '접기', KO: '한국어', PLAIN: '일반', WORDS: '문장',
        CONTRACT: '계약', FIELDS: '필드', SCHEMA: '구조', SYNC2: '맞춤', REPEAT: '반복',
        PHRASE: '문구', PARITY: '일치', SCENARIO: '시나리오', IMPORTANT: '중요', UNVERIFIED: '미검증',
        DISCOVER: '찾기', OUTLINE: '개요', GUIDE: '안내', TABLE: '표', SUMMARY: '요약',
        NESTED: '중첩', SAFE: '안전', MOVE: '이동', EXPORT: '내보내기', DOC: '문서',
        TASK: '작업', UPDATE: '개선', FIX: '수정', ADD: '추가', REMOVE: '삭제', SET: '설정',
        GET: '가져오기', LIST: '목록', CREATE: '만들기', DELETE: '삭제', MERGE: '합치기',
      };
      function humanTitle(title, taskId) {
        var raw = typeof title === 'string' ? title.trim() : '';
        if (!raw) return taskId || '';
        // Real prose (contains a space) is already meant for a human — never reformat it.
        if (/\s/.test(raw)) return raw;
        // TASK-NNNN is a plain counter, not a subject: "작업 0044" reads as a number, not two words.
        var counter = /^TASK-(\d+)$/i.exec(raw);
        if (counter) return t('liveTaskWord') + ' ' + counter[1];
        // An id-shaped title: JUAI-CHECK-RULE-FIRST-POST → AI 앱 · 확인 · 규칙 · 처음 · 게시
        var words = raw.split(/[-_]+/).filter(Boolean).map(function (w) {
          var k = w.toUpperCase();
          if (Object.prototype.hasOwnProperty.call(TITLE_WORDS, k)) return TITLE_WORDS[k];
          return w.charAt(0).toLowerCase() + w.slice(1).toLowerCase();
        }).filter(Boolean);
        var out = words.join(' · ');
        return out || raw;
      }
      /**
       * Draw what the portfolio is doing, as one card per task.
       *
       * Lane A is the Founder's own column and keeps its ws meaning untouched. The live QA list is
       * appended below it rather than replacing it, because "PM 확인 필요" is a decision the Founder makes
       * and "a QA worker is running" is not. Lane C is a machine queue: a count only, no cards, and never
       * folded into lane A.
       *
       * An entry whose title is missing falls back to the taskId, so a card is never blank. A dead pid is
       * shown in amber: stuck is not the same as finished, and it must not read as either.
       */
      // P3: shorten at the data level, never with CSS ellipsis. The full title is in the tooltip.
      var LIVE_TITLE_MAX = 48;
      function liveCardHtml(e) {
        var label = humanTitle(e && e.title, e && e.taskId);
        if (!label) return '';
        if (label.length > LIVE_TITLE_MAX) label = label.slice(0, LIVE_TITLE_MAX - 1) + '…';
        var runtime = (e && e.runtime) ? esc(e.runtime) : '';
        var tip = t('liveTooltip') + ': ' + esc((e && e.taskId) || '') + (runtime ? ' · ' + runtime : '')
          + (e && e.model ? ' · ' + esc(e.model) : '');
        return '<div class="livecard" title="' + tip + '">'
          + '<span class="lt">' + esc(label) + '</span>'
          + (e && e.alive === false ? '<span class="ldead">' + esc(t('liveStuck')) + '</span>' : '')
          + '<span class="lr">' + runtime + '</span>'
          + '</div>';
      }
      function renderLiveLanes() {
        var qa = pipeLive.qa || [];
        var builders = pipeLive.builders || [];
        var boxA = document.getElementById('liveA');
        if (boxA) {
          boxA.innerHTML = qa.length
            ? qa.map(liveCardHtml).join('')
            : '<div class="live-empty">' + esc(t('liveNoQa')) + '</div>';
        }
        var boxB = document.getElementById('liveB');
        if (boxB) {
          boxB.innerHTML = builders.length
            ? builders.map(liveCardHtml).join('')
            : '<div class="live-empty">' + esc(t('liveNoBuild')) + '</div>';
        }
        // Lane C is a count only: a waiting task needs nothing from the Founder, only time.
        var waiting = typeof pipeQaWait === 'number' ? pipeQaWait : 0;
        setLaneCount('laneNc', waiting);
        var boxC = document.getElementById('liveC');
        if (boxC) {
          boxC.innerHTML = waiting
            ? '<div class="live-empty">' + esc(t('liveWaiting')) + '</div>'
            : '<div class="live-empty">' + esc(t('liveNoWait')) + '</div>';
        }
      }
      function applyQaCapacity(cap) {
        try {
          pipeQaWait = cap && typeof cap.qaWaiting === 'number' && cap.qaWaiting > 0 ? cap.qaWaiting : 0;
          var el = document.getElementById('pipeQaWait');
          if (el) el.textContent = pipeQaWait ? '· ' + pipeQaWait + ' 대기' : '';
          updatePipe();
        } catch (e) {}
      }
      function updatePipe() {
        try {
          setPipeText('pipeRelay', pipeNWait + ' delivery');
          setPipeText('pipeWorker', pipeWorking + ' active');
          setPipeText('pipeQa', pipeDoing + ' review');
          var loop = document.getElementById('pipeLoop');
          if (loop) loop.className = 'ploop' + (pipeDoing > 0 ? ' hot' : '');
        } catch (e) {}
      }
      function chipHtml(a) {
        var norm = normalizeAgent(a);
        var sheet = agentSheet(a);
        var stateLabel = agentStateLabel(a);
        var avatar;
        if (sheetStatus[sheet] === 'fail') {
          var initial = esc(Array.from(norm.name).slice(0, 1).join('') || '?');
          avatar = '<span class="cav-miss" title="' + esc(t('spriteLoadFail') + ': ' + sheet) + '">' + initial + '</span>';
        } else {
          avatar = '<span class="cav"><span class="crew-sp" data-sheet="' + sheet + '"></span></span>';
        }
        var taskTip = (a.taskTitle || a.taskId) ? ' | ' + (a.taskTitle || a.taskId) : '';
        // Color + text: name / role / state stay distinct even if sprite fails.
        return '<span class="chip" title="' + esc(norm.full + ' · ' + stateLabel + taskTip) + '">' + avatar
          + '<span class="ctx"><b>' + esc(norm.name) + '</b><i>' + esc(norm.role) + ' · ' + esc(stateLabel) + '</i></span></span>';
      }
      function paintLaneAvatars(root) {
        try {
          var stages = (root || document).querySelectorAll('.crew-sp');
          for (var s = 0; s < stages.length; s++) {
            var sh = stages[s].getAttribute('data-sheet') || 'idle';
            if (SHEETS.indexOf(sh) < 0) sh = 'idle';
            if (!applySheet(stages[s], sh, SHEET_W.crew, SHEET_W.crewH)) {
              markSheetMissing(stages[s], SHEET_W.crew, SHEET_W.crewH, sh);
            }
          }
        } catch (e) { /* avatars best-effort; chips stay readable */ }
      }
      function setLaneCount(id, n) {
        try {
          var el = document.getElementById(id);
          if (el) el.textContent = String(n);
        } catch (e) {}
      }
      function renderAgents(dash) {
        var agents = activeAgents((dash && dash.agents) || []);
        // The portfolio is its own rail (Founder 2026-09-29). The ws agent list cannot describe it, so
        // the live mirror is the only source for what the portfolio is doing right now. When it is
        // missing — an older runner build — every list below falls back to empty rather than guessing.
        var pf = (dash && dash.portfolio) || null;
        applyQaCapacity(pf);
        pipeLive = { builders: (pf && pf.builders) || [], qa: (pf && pf.qa) || [] };
        try { renderLiveLanes(); } catch (eLive) { logLine('render live lanes error: ' + eLive.message); }
        try { lastAgentTotal = agents.length; } catch (e) {}
        var working = 0;
        for (var w = 0; w < agents.length; w++) {
          if (agents[w] && agents[w].state === 'working') working++;
        }
        pipeWorking = working;
        setNum(stCodingEl, working);
        setSeg('sgCoding', working, 'eseg blue');
        var buckets = { A: [], B: [] };
        for (var i = 0; i < agents.length; i++) {
          var a = agents[i] || {};
          try {
            var lane = laneOfAgent(a);
            if (lane) buckets[lane].push(chipHtml(a));
          } catch (e) { /* one bad agent never kills the lane */ }
        }
        var lanes = ['A', 'B'];
        var boxes = ['chipsA', 'chipsB'];
        var counts = ['laneNa', 'laneNb'];
        for (var l = 0; l < lanes.length; l++) {
          try {
            var box = document.getElementById(boxes[l]);
            if (box) {
              box.innerHTML = buckets[lanes[l]].join('')
                || (lanes[l] === 'B'
                  ? '<div class="lane-empty">' + esc(t('noWorking')) + '<br>' + esc(t('autoResume')) + '</div>'
                  : '');
            }
          } catch (e) {}
          setLaneCount(counts[l], buckets[lanes[l]].length);
        }
        paintLaneAvatars(document);
        updatePipe();
        var goals = (dash && dash.goals) || [];
        var gTotal = goals.length;
        var gOpen = 0;
        for (var j = 0; j < goals.length; j++) {
          if (goals[j] && goals[j].status !== 'COMPLETED' && goals[j].status !== 'DONE') gOpen++;
        }
        setNum(stGoalsEl, gTotal);
        setSeg('sgGoals', gTotal, 'eseg muted');
      }
      // Proven spike bridge (behavioral authority): register the response
      // listener synchronously, then postMessage, then return the promise.
      var nextId = 1;
      function sendRequest(method, params, timeoutMs) {
        var id = nextId++;
        var p = new Promise(function (resolve, reject) {
          var done = false;
          var to = setTimeout(function () {
            if (!done) { done = true; cleanup(); reject(new Error('timeout waiting for ' + method)); }
          }, timeoutMs || 15000);
          function listener(ev) {
            var d = ev.data;
            if (!d || d.id !== id) return;
            cleanup();
            // Presence check, not truthiness: an empty-object result is valid.
            if (Object.prototype.hasOwnProperty.call(d, 'result')) resolve(d.result);
            else if (d.error) reject(new Error((d.error.message) || ('error ' + method)));
            else reject(new Error('invalid response for ' + method));
          }
          function cleanup() { clearTimeout(to); window.removeEventListener('message', listener); }
          window.addEventListener('message', listener);
        });
        window.parent.postMessage({ jsonrpc: '2.0', id: id, method: method, params: params }, '*');
        return p;
      }
      function sendNotification(method, params) {
        window.parent.postMessage({ jsonrpc: '2.0', method: method, params: params }, '*');
      }

      function applyTheme(theme) {
        if (theme === 'dark' || theme === 'light') document.body.setAttribute('data-theme', theme);
      }

      // tools/call proxied by the host. Structured result preferred.
      async function callTool(name, args) {
        var r = await sendRequest('tools/call', { name: name, arguments: args || {} }, 15000);
        if (r && r.isError) {
          var txt = (r.content && r.content[0] && r.content[0].text) || '';
          throw new Error('tool ' + name + ' error: ' + txt);
        }
        if (r && r.structuredContent !== undefined && r.structuredContent !== null) return r.structuredContent;
        if (r && r.content && r.content[0] && typeof r.content[0].text === 'string') {
          try { return JSON.parse(r.content[0].text); } catch (e) { return r.content[0].text; }
        }
        return r || {};
      }

      function renderSelfcheck() {
        try {
          var el = document.getElementById('selfcheck');
          if (!el) return;
          var build = '';
          try { build = (document.getElementById('buildTag') || {}).textContent || ''; } catch (e) {}
          var lanes = document.querySelectorAll('.lane').length;
          var envOk = !!document.getElementById('env');
          var laneSum = 0;
          ['laneNa', 'laneNb'].forEach(function (id) {
            try {
              var n = parseInt((document.getElementById(id) || {}).textContent || '0', 10);
              if (!isNaN(n)) laneSum += n;
            } catch (e) {}
          });
          var badgeN = 0;
          try { badgeN = (typeof lastAgentTotal === 'number') ? lastAgentTotal : 0; } catch (e) {}
          var sheetW = '';
          try {
            var sp = document.querySelector('.crew-sp');
            if (sp) sheetW = String(getComputedStyle(sp).backgroundSize || '').split(' ')[0] || '';
          } catch (e) {}
          var av = [];
          for (var i = 0; i < SHEETS.length && av.length < 3; i++) {
            if (sheetDims[SHEETS[i]]) av.push(SHEETS[i] + '=' + sheetDims[SHEETS[i]].w);
          }
          var ext = sheetFailed.length ? ('FAIL:' + sheetFailed.join(',')) : 'jsDelivr 8/8';
          var bytes = 0;
          try { bytes = document.documentElement.outerHTML.length; } catch (e) {}
          try { window.__pollRan = true; } catch (e) {}
          var trail = '';
          try { trail = initTrail.join('>'); } catch (e) {}
          var lines = [
            'buildTag: ' + build.trim(),
            'init: ' + (trail || '?'),
            'avatar loaded: ' + (av.length ? av.join(' ') : 'none yet'),
            'lane count: ' + lanes,
            'env strip exists: ' + envOk,
            'count consistency: badge ' + badgeN + ' vs lanes ' + laneSum + ' -> ' + (badgeN === laneSum ? 'OK' : 'MISMATCH'),
            'sheetW sanity: ' + (sheetW || '?') + (sheetW === '80px' ? ' OK' : ' (want 80px)'),
            'external image load: ' + ext,
            'bundle size: ' + bytes + ' chars'
          ];
          el.textContent = lines.join(' | ');
        } catch (e) { /* selfcheck never breaks render */ }
      }
      var lastProjectDash = null;
      function setElText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text == null ? '' : String(text);
      }
      function setElHide(id, hide) {
        var el = document.getElementById(id);
        if (!el) return;
        if (hide) el.classList.add('hide');
        else el.classList.remove('hide');
      }
      function renderProjectDash(view) {
        lastProjectDash = view || null;
        if (!view) return;
        var p = view.project;
        setElText('pdName', p ? (p.projectName || p.projectId) : '프로젝트 없음');
        var pathFull = (p && p.workspacePath)
          ? p.workspacePath
          : (p && p.profileState === 'UNCONFIGURED' ? 'Workspace not configured' : '');
        setElText('pdPath', pathFull);
        try {
          var pathEl = document.getElementById('pdPath');
          if (pathEl) pathEl.setAttribute('title', pathFull || '');
        } catch (ePath) {}
        var assign = view.assignment;
        var assignLine = '';
        if (assign) {
          assignLine = 'PM ' + (assign.pm || '(없음)')
            + ' · Builder ' + ((assign.builders && assign.builders.length) ? assign.builders.join(', ') : '(없음)')
            + ' · QA ' + ((assign.qa && assign.qa.length) ? assign.qa.join(', ') : '(없음)');
        }
        setElText('pdAssign', assignLine);
        setElText('pdNextText', view.nextActionText || '진행 중인 작업 없음');

        if (view.goal) {
          setElHide('pdGoalEmpty', true);
          setElHide('pdGoalTitle', false);
          setElHide('pdGoalMeta', false);
          setElText('pdGoalTitle', view.goal.title || view.goal.goalId);
          setElText('pdGoalMeta', (view.goal.status || '') + (view.goal.goalId ? ' · ' + view.goal.goalId : ''));
        } else {
          setElText('pdGoalTitle', '');
          setElText('pdGoalMeta', '');
          setElHide('pdGoalEmpty', false);
          var ge = document.getElementById('pdGoalEmpty');
          if (ge) ge.textContent = (view.empty && view.empty.goalText) || '아직 진행 중인 Goal이 없습니다.';
        }

        if (view.task) {
          setElHide('pdTaskEmpty', true);
          setElHide('pdTaskTitle', false);
          setElHide('pdTaskMeta', false);
          setElText('pdTaskTitle', view.task.title || view.task.taskId);
          var meta = [];
          meta.push('상태 ' + (view.task.executionState || '?'));
          meta.push('실행 ' + (view.task.runtimeState || '?'));
          if (view.task.agent) meta.push('워커 ' + view.task.agent);
          if (view.task.model) meta.push('모델 ' + view.task.model);
          if (view.task.lastActivityAt) {
            try {
              var d = new Date(view.task.lastActivityAt);
              meta.push(isNaN(d.getTime()) ? view.task.lastActivityAt : d.toLocaleString());
            } catch (eT) { meta.push(view.task.lastActivityAt); }
          }
          setElText('pdTaskMeta', meta.join(' · '));
          var titleEl = document.getElementById('pdTaskTitle');
          if (titleEl) {
            var pill = document.createElement('span');
            pill.className = 'rtpill ' + (view.task.runtimeState || '');
            pill.textContent = view.task.runtimeState || '';
            // Replace previous pill if any by resetting text then appending.
            titleEl.textContent = (view.task.title || view.task.taskId) + ' ';
            titleEl.appendChild(pill);
          }
        } else {
          setElText('pdTaskTitle', '');
          setElText('pdTaskMeta', '');
          setElHide('pdTaskEmpty', false);
          var te = document.getElementById('pdTaskEmpty');
          if (te) te.textContent = (view.empty && view.empty.taskText) || '지금 보고 있는 Task가 없습니다.';
        }

        var countsEl = document.getElementById('pdCounts');
        if (countsEl) {
          countsEl.innerHTML = '';
          var c = view.counts || {};
          function addCount(label, n, cls) {
            var span = document.createElement('span');
            span.className = 'c' + (cls ? ' ' + cls : '');
            span.innerHTML = label + ' <b>' + (n == null ? 0 : n) + '</b>';
            countsEl.appendChild(span);
          }
          addCount('실제 작업 중', c.actualActiveRuns, c.actualActiveRuns ? 'ok' : '');
          addCount('검토 필요', c.verificationPending, c.verificationPending ? 'warn' : '');
          addCount('대기', c.readyTasks, '');
          addCount('ORPHAN', c.orphanRuns, c.orphanRuns ? 'err' : '');
          addCount('저장 RUNNING', c.persistedRunning, '');
        }

        var warnEl = document.getElementById('pdWarn');
        if (warnEl) {
          var warnings = view.warnings || [];
          if (!warnings.length) {
            warnEl.className = 'pdash-warn hide';
            warnEl.textContent = '';
          } else {
            var severe = warnings.some(function (w) {
              return w && (w.code === 'WORKSPACE_CONFLICT' || w.code === 'LEGACY');
            });
            warnEl.className = 'pdash-warn' + (severe ? ' err' : '');
            warnEl.textContent = warnings.map(function (w) { return w.message || w.code; }).join(' · ');
          }
        }
        updateGoalRunAffordance(view);
      }

      var pendingPreview = null;
      var runInFlight = false;

      function setGoalFlowVisible(show) {
        setElHide('pdGoalFlow', !show);
        if (show) {
          setElHide('pdTaskPrev', true);
          var err = document.getElementById('pdGoalErr');
          var ok = document.getElementById('pdGoalOk');
          if (err) { err.classList.add('hide'); err.textContent = ''; }
          if (ok) { ok.classList.add('hide'); ok.textContent = ''; }
        }
      }

      function setTaskPrevVisible(show) {
        setElHide('pdTaskPrev', !show);
      }

      function updateGoalRunAffordance(view) {
        var p = view && view.project;
        var legacyBlocked = !!(p && (p.legacy || p.profileState === 'LEGACY' || p.profileState === 'UNCONFIGURED' || p.workspaceConflict));
        var canCreate = !!(p && !legacyBlocked);
        var newBtn = document.getElementById('pdNewGoalBtn');
        var hint = document.getElementById('pdActionHint');
        if (newBtn) {
          newBtn.disabled = !canCreate || runInFlight;
          newBtn.classList.toggle('hide', !!(pendingPreview && pendingPreview.taskId));
        }
        if (hint) {
          if (legacyBlocked) hint.textContent = '이 프로젝트에서는 작업을 시작할 수 없어요.';
          else if (!view.goal) hint.textContent = 'Goal을 만들면 여기서 작업을 준비할 수 있어요.';
          else if (view.task && view.task.executionState === 'READY') hint.textContent = '준비된 Task가 있어요. 아래에서 확인하고 시작하세요.';
          else hint.textContent = '';
        }
        // READY Task → show preview so user can pick Agent/model (elig.ok may be false until selection).
        var elig = view && view.runEligibility;
        if (view && view.task && view.task.executionState === 'READY' && !pendingPreview) {
          pendingPreview = {
            goalId: view.goal && view.goal.goalId,
            goalTitle: view.goal && view.goal.title,
            taskId: view.task.taskId,
            taskTitle: view.task.title,
            scope: (p && p.workspacePath) || '',
            criteria: [],
            builder: (elig && elig.desiredBuilder) || ((view.assignment && view.assignment.builders) || [])[0] || '',
            projectWorkerHint: (elig && (elig.projectDesiredBuilder || elig.desiredBuilder)) || '',
            workerId: (elig && elig.workerId) || '',
            workspaceRoot: (elig && elig.workspaceRoot) || (p && p.workspacePath) || '',
            projectId: p && p.projectId
          };
        }
        if (pendingPreview && pendingPreview.taskId) {
          renderTaskPreview(pendingPreview, elig || (view && view.runEligibility));
          setTaskPrevVisible(true);
        }
      }

      var tpAgentsCache = [];
      var tpModelsCache = [];
      var tpSelectionBusy = false;

      function fillSelect(sel, items, valueKey, labelFn, placeholder) {
        if (!sel) return;
        var prev = sel.value;
        sel.innerHTML = '';
        var opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = placeholder || '선택…';
        sel.appendChild(opt0);
        for (var i = 0; i < (items || []).length; i++) {
          var it = items[i];
          var opt = document.createElement('option');
          opt.value = String(it[valueKey] || '');
          opt.textContent = labelFn(it);
          if (it.available === false) opt.disabled = true;
          sel.appendChild(opt);
        }
        if (prev) {
          try { sel.value = prev; } catch (ePrev) {}
        }
      }

      async function loadTpAgents(preview) {
        var sel = document.getElementById('tpAgentSel');
        try {
          var res = await callTool('relay_pm_list_executable_agents', {});
          tpAgentsCache = (res && (res.agents || res.items)) || [];
          if (!Array.isArray(tpAgentsCache)) tpAgentsCache = [];
          fillSelect(sel, tpAgentsCache.filter(function (a) { return a && a.workerId; }), 'workerId', function (a) {
            var mark = a.available === false ? ' (불가)' : '';
            return (a.displayName || a.workerId) + mark;
          }, 'Agent 선택…');
          if (preview && preview.workerId && sel) sel.value = preview.workerId;
        } catch (eAgents) {
          tpAgentsCache = [];
          fillSelect(sel, [], 'workerId', function () { return ''; }, 'Agent 목록 실패');
        }
      }

      async function loadTpModels(workerId, restoreModelId) {
        var sel = document.getElementById('tpModelSel');
        var noteEl = document.getElementById('tpConstraint');
        if (!workerId) {
          fillSelect(sel, [], 'modelId', function () { return ''; }, 'Agent 먼저');
          if (sel) { sel.disabled = true; sel.value = ''; }
          setElText('tpProfile', '—');
          setElText('tpAvail', '—');
          if (noteEl) noteEl.textContent = '';
          tpModelsCache = [];
          return;
        }
        try {
          var res = await callTool('relay_pm_list_agent_models', { workerId: workerId });
          var catalog = res && (res.catalog || res);
          tpModelsCache = (catalog && catalog.models) || [];
          // R01-HOST-FIX C: never auto-select catalog.defaultModelId.
          // Keep placeholder empty unless restoring a previously saved valid modelId.
          fillSelect(sel, tpModelsCache, 'modelId', function (m) {
            return (m.displayName ? (m.displayName + ' · ') : '') + m.modelId;
          }, '모델 선택…');
          if (sel) {
            sel.disabled = false;
            sel.value = '';
            var restore = restoreModelId || (pendingPreview && pendingPreview.modelId) || '';
            if (restore) {
              var allowed = false;
              for (var mi = 0; mi < tpModelsCache.length; mi++) {
                if (tpModelsCache[mi].modelId === restore) { allowed = true; break; }
              }
              if (allowed) sel.value = restore;
            }
          }
          var agent = null;
          for (var i = 0; i < tpAgentsCache.length; i++) {
            if (tpAgentsCache[i].workerId === workerId) { agent = tpAgentsCache[i]; break; }
          }
          setElText('tpProfile', (agent && agent.executionProfile) || (catalog && catalog.runtime) || '—');
          setElText('tpAvail', (agent && agent.available === false)
            ? ('불가' + (agent.blockedReason ? (': ' + agent.blockedReason) : ''))
            : ((catalog && catalog.authOk === false) ? '로그인/인증 필요' : '사용 가능'));
          var notes = [];
          if (catalog && catalog.constraintNote) notes.push(catalog.constraintNote);
          if (agent && agent.blockedReason) notes.push(agent.blockedReason);
          if (catalog && catalog.defaultModelId) notes.push('참고 기본값(자동 선택 안 함): ' + catalog.defaultModelId);
          if (noteEl) noteEl.textContent = notes.join(' · ');
        } catch (eModels) {
          tpModelsCache = [];
          fillSelect(sel, [], 'modelId', function () { return ''; }, '모델 목록 실패');
          if (sel) { sel.disabled = true; sel.value = ''; }
          if (noteEl) noteEl.textContent = String((eModels && eModels.message) || eModels).slice(0, 200);
        }
      }

      function draftSelection(preview) {
        var agentSel = document.getElementById('tpAgentSel');
        var modelSel = document.getElementById('tpModelSel');
        return {
          workerId: (agentSel && agentSel.value) || '',
          modelId: (modelSel && modelSel.value) || ''
        };
      }

      function selectionMatchesSaved(preview) {
        if (!preview) return false;
        var d = draftSelection(preview);
        return !!(preview.savedWorkerId && preview.savedModelId
          && d.workerId === preview.savedWorkerId
          && d.modelId === preview.savedModelId
          && !preview.draftDirty);
      }

      function updateSavedLabel(preview) {
        var el = document.getElementById('tpSaved');
        if (!el) return;
        if (preview && preview.savedWorkerId && preview.savedModelId) {
          el.textContent = preview.savedWorkerId + ' / ' + preview.savedModelId
            + (preview.selectionApproved ? ' · 승인됨' : ' · 미승인');
        } else {
          el.textContent = '없음';
        }
      }

      function updateDraftControls(preview) {
        var saveBtn = document.getElementById('tpSaveSel');
        var clearBtn = document.getElementById('tpClearSel');
        var chk = document.getElementById('tpApproveChk');
        var d = draftSelection(preview);
        var canSave = !!(preview && preview.taskId && d.workerId && d.modelId && !tpSelectionBusy && !runInFlight);
        var dirtyOrNew = !!(preview && (preview.draftDirty
          || !preview.savedWorkerId
          || !preview.savedModelId
          || d.workerId !== preview.savedWorkerId
          || d.modelId !== preview.savedModelId));
        if (saveBtn) saveBtn.disabled = !canSave || !dirtyOrNew;
        if (clearBtn) {
          clearBtn.disabled = !(preview && preview.savedWorkerId && preview.savedModelId
            && !preview.selectionApproved && !tpSelectionBusy && !runInFlight);
        }
        var savedMatch = selectionMatchesSaved(preview);
        if (chk) {
          chk.disabled = !(savedMatch && !tpSelectionBusy && !runInFlight);
          if (!savedMatch) chk.checked = false;
        }
        updateSavedLabel(preview);
      }

      async function persistTpSelection(preview) {
        if (!preview || !preview.taskId || !preview.projectId) return null;
        var d = draftSelection(preview);
        if (!d.workerId || !d.modelId) return null;
        var cfg = await callTool('relay_pm_set_task_execution_config', {
          projectId: preview.projectId,
          taskId: preview.taskId,
          workerId: d.workerId,
          modelId: d.modelId
        });
        preview.workerId = d.workerId;
        preview.modelId = d.modelId;
        preview.savedWorkerId = d.workerId;
        preview.savedModelId = d.modelId;
        preview.draftDirty = false;
        preview.selectionApproved = false;
        var chk = document.getElementById('tpApproveChk');
        if (chk) { chk.disabled = false; chk.checked = false; }
        updateDraftControls(preview);
        return cfg;
      }

      async function clearTpSelection(preview) {
        if (!preview || !preview.taskId || !preview.projectId) return null;
        var res = await callTool('relay_pm_clear_task_execution_config', {
          taskId: preview.taskId,
          projectId: preview.projectId
        });
        preview.savedWorkerId = '';
        preview.savedModelId = '';
        preview.selectionApproved = false;
        preview.draftDirty = true;
        var chk = document.getElementById('tpApproveChk');
        if (chk) { chk.checked = false; chk.disabled = true; }
        updateDraftControls(preview);
        return res;
      }

      function updateTpRunEnabled(preview, elig) {
        var runBtn = document.getElementById('tpRun');
        var status = document.getElementById('tpStatus');
        var chk = document.getElementById('tpApproveChk');
        var d = draftSelection(preview);
        var selected = !!(d.workerId && d.modelId);
        var savedMatch = selectionMatchesSaved(preview);
        var approved = !!(chk && chk.checked && preview && preview.selectionApproved && savedMatch);
        var ok = !!(preview && preview.taskId && preview.workspaceRoot && selected && savedMatch && approved && elig && elig.ok && elig.workerId);
        updateDraftControls(preview);
        if (runBtn) {
          runBtn.disabled = !ok || runInFlight || tpSelectionBusy;
          runBtn.textContent = (savedMatch && d.workerId)
            ? ('작업 시작 · ' + d.workerId + (d.modelId ? (' / ' + d.modelId) : ''))
            : '작업 시작';
        }
        if (status) {
          if (ok) status.textContent = '승인된 저장 선택으로 Worker가 한 번만 실행됩니다. 프로젝트 기본 Assignment는 바꾸지 않습니다.';
          else if (!selected) status.textContent = 'Agent와 모델을 고른 뒤 「선택 저장」을 누르세요.';
          else if (!savedMatch) status.textContent = '선택이 저장되지 않았어요. 「선택 저장」 후에만 승인할 수 있어요.';
          else if (!approved) status.textContent = '저장된 선택을 확인한 뒤 실행 승인 체크를 켜세요. 승인만으로 Worker는 시작되지 않아요.';
          else if (elig && elig.blockers && elig.blockers.length) status.textContent = '시작 불가: ' + elig.blockers.join(', ');
          else status.textContent = '시작 조건을 확인하는 중…';
        }
      }

      function renderTaskPreview(preview, elig) {
        setElText('tpProject', (preview.projectName || preview.projectId || '') + (preview.projectId ? (' · ' + preview.projectId) : ''));
        setElText('tpComputer', 'ASUS');
        setElText('tpWorkspace', preview.workspaceRoot || '');
        setElText('tpGoal', preview.goalTitle || preview.goalId || '');
        setElText('tpTask', preview.taskTitle || preview.taskId || '');
        setElText('tpScope', preview.scope || '');
        setElText('tpBuilder', (preview.builder || '') + (preview.projectWorkerHint ? (' → ' + preview.projectWorkerHint) : ''));
        var ul = document.getElementById('tpCrit');
        if (ul) {
          ul.innerHTML = '';
          var crit = preview.criteria || [];
          if (!crit.length) {
            var li0 = document.createElement('li');
            li0.textContent = '(없음)';
            ul.appendChild(li0);
          } else {
            for (var i = 0; i < crit.length; i++) {
              var li = document.createElement('li');
              li.textContent = String(crit[i]);
              ul.appendChild(li);
            }
          }
        }
        updateTpRunEnabled(preview, elig);
        if (!preview._agentsLoaded) {
          preview._agentsLoaded = true;
          loadTpAgents(preview).then(function () {
            var agentSel = document.getElementById('tpAgentSel');
            return loadTpModels(agentSel && agentSel.value, preview.modelId || '');
          }).then(function () {
            updateTpRunEnabled(preview, elig);
          }).catch(function () {});
        }
      }

      async function openExistingTask(taskId) {
        var errEl = document.getElementById('tpErr');
        var status = document.getElementById('tpStatus');
        if (errEl) { errEl.classList.add('hide'); errEl.textContent = ''; }
        var projectId = lastProjectDash && lastProjectDash.project && lastProjectDash.project.projectId;
        if (!projectId) {
          if (errEl) { errEl.classList.remove('hide'); errEl.textContent = '프로젝트가 선택되지 않았어요.'; }
          return;
        }
        if (!taskId) return;
        selectedTaskId = taskId;
        try {
          var task = await callTool('relay_pm_get_task', { taskId: taskId });
          if (!task || !task.taskId) throw new Error('Task를 찾지 못했어요.');
          if (task.projectId && task.projectId !== projectId) {
            throw new Error('이 Task는 다른 프로젝트(' + task.projectId + ')에 속해요.');
          }
          if (!task.projectId) {
            throw new Error('Task에 projectId가 없어요. 프로젝트 귀속을 먼저 고쳐 주세요.');
          }
          var goal = null;
          if (task.goalId) {
            try { goal = await callTool('relay_pm_get_goal', { goalId: task.goalId }); } catch (eG) { goal = null; }
          }
          if (goal && goal.projectId && goal.projectId !== projectId) {
            throw new Error('Goal 프로젝트와 선택 프로젝트가 달라요.');
          }
          var runnable = isRunnableReadyTask(task);
          var cfgRes = null;
          try {
            cfgRes = await callTool('relay_pm_get_task_execution_config', {
              taskId: task.taskId,
              projectId: projectId
            });
          } catch (eCfg) { cfgRes = null; }
          var cfg = cfgRes && cfgRes.config;
          if (!runnable) {
            pendingPreview = null;
            setTaskPrevVisible(false);
            if (status) {
              status.textContent = '읽기 전용 · '
                + task.taskId
                + ' · '
                + (task.executionState || '')
                + (task.pmState ? ('/' + task.pmState) : '')
                + ' · Run '
                + ((task.linkedRuns || []).length);
            }
            renderTaskTab(lastTaskListCache);
            return;
          }
          var elig = await callTool('relay_pm_resolve_run', {
            taskId: task.taskId,
            projectId: projectId
          });
          var workspace = (lastProjectDash.project && lastProjectDash.project.workspacePath) || '';
          pendingPreview = {
            goalId: task.goalId || (goal && goal.goalId) || '',
            goalTitle: (goal && goal.title) || task.goal || '',
            taskId: task.taskId,
            taskTitle: task.title || task.taskId,
            scope: task.scope || workspace || '',
            criteria: task.completionCriteria || [],
            builder: (elig && elig.desiredBuilder) || '',
            projectWorkerHint: (elig && (elig.projectDesiredBuilder || elig.desiredBuilder)) || '',
            workerId: (cfg && cfg.workerId) || '',
            modelId: (cfg && cfg.modelId) || '',
            savedWorkerId: (cfg && cfg.workerId) || '',
            savedModelId: (cfg && cfg.modelId) || '',
            draftDirty: false,
            selectionApproved: !!(cfg && cfg.ownerApproval && cfg.ownerApproval.approved),
            workspaceRoot: (elig && elig.workspaceRoot) || workspace || '',
            projectId: projectId,
            projectName: (lastProjectDash.project && lastProjectDash.project.projectName) || projectId,
            _agentsLoaded: false
          };
          setGoalFlowVisible(false);
          renderTaskPreview(pendingPreview, elig);
          setTaskPrevVisible(true);
          if (status) {
            status.textContent = cfg && cfg.modelId
              ? '디스크에 저장된 선택이 있어요. 바꾸려면 다시 고른 뒤 「선택 저장」하세요.'
              : '기존 READY Task예요. Agent와 모델을 고른 뒤 「선택 저장」하세요.';
          }
          renderTaskTab(lastTaskListCache);
        } catch (eOpen) {
          if (errEl) {
            errEl.classList.remove('hide');
            errEl.textContent = String((eOpen && eOpen.message) || eOpen).slice(0, 240);
          }
        }
      }

      async function prepareGoalAndTask() {
        var titleEl = document.getElementById('pdGoalTitleIn');
        var stmtEl = document.getElementById('pdGoalStmtIn');
        var errEl = document.getElementById('pdGoalErr');
        var okEl = document.getElementById('pdGoalOk');
        var contBtn = document.getElementById('pdGoalContinue');
        var title = (titleEl && titleEl.value || '').trim();
        var statement = (stmtEl && stmtEl.value || '').trim();
        if (errEl) { errEl.classList.add('hide'); errEl.textContent = ''; }
        if (okEl) { okEl.classList.add('hide'); okEl.textContent = ''; }
        if (!title || !statement) {
          if (errEl) { errEl.classList.remove('hide'); errEl.textContent = '제목과 하고 싶은 일을 적어 주세요.'; }
          return;
        }
        var projectId = lastProjectDash && lastProjectDash.project && lastProjectDash.project.projectId;
        var workspace = lastProjectDash && lastProjectDash.project && lastProjectDash.project.workspacePath;
        if (!projectId) {
          if (errEl) { errEl.classList.remove('hide'); errEl.textContent = '프로젝트가 없어요. 먼저 프로젝트를 준비해 주세요.'; }
          return;
        }
        if (contBtn) contBtn.disabled = true;
        try {
          // 1) create Goal only (PLANNING, no Task/Run)
          var gRes = await callTool('relay_pm_create_goal', {
            projectId: projectId,
            title: title,
            statement: statement
          });
          var goal = gRes && gRes.goal;
          if (!goal || !goal.goalId) throw new Error('Goal 만들기에 실패했어요.');
          if (gRes.sideEffects && (gRes.sideEffects.tasksCreated || gRes.sideEffects.runsCreated || gRes.sideEffects.workersSpawned)) {
            throw new Error('Goal만 만들어야 하는데 다른 작업이 함께 생겼어요.');
          }
          // 2) bounded Task contract under that Goal
          var criteria = [
            '목표에 맞는 결과를 보고한다',
            '요청 범위를 벗어나지 않는다'
          ];
          var tRes = await callTool('relay_pm_create_task', {
            projectId: projectId,
            goalId: goal.goalId,
            title: title.slice(0, 80),
            goal: statement,
            reason: '사용자가 Goal에서 준비한 작업',
            scope: workspace || projectId,
            completionCriteria: criteria
          });
          var task = tRes && tRes.task;
          if (!task || !task.taskId) throw new Error('Task 만들기에 실패했어요.');
          if (task.executionState !== 'READY') throw new Error('Task가 READY가 아니에요: ' + task.executionState);
          if (task.goalId !== goal.goalId) throw new Error('Task가 방금 만든 Goal에 연결되지 않았어요.');
          // 3) activate Goal PLANNING → ACTIVE (canonical)
          try {
            await callTool('relay_pm_activate_goal', {
              goalId: goal.goalId,
              expectedGoalStatus: 'PLANNING',
              reason: 'c05:activate-before-explicit-run'
            });
          } catch (eAct) {
            // Already ACTIVE is fine; other errors surface.
            var am = String((eAct && eAct.message) || eAct);
            if (am.indexOf('CONFLICT') < 0 && am.indexOf('ACTIVE') < 0) throw eAct;
          }
          // 4) resolve eligibility (no dispatch yet)
          var elig = await callTool('relay_pm_resolve_run', {
            taskId: task.taskId,
            projectId: projectId
          });
          // Fresh Task: no saved execution-config yet. Keep draft empty until
          // the user picks Agent/Model and presses 「선택 저장」.
          pendingPreview = {
            goalId: goal.goalId,
            goalTitle: goal.title || title,
            taskId: task.taskId,
            taskTitle: task.title || title,
            scope: task.scope || workspace || '',
            criteria: task.completionCriteria || criteria,
            builder: (elig && elig.desiredBuilder) || '',
            projectWorkerHint: (elig && (elig.projectDesiredBuilder || elig.desiredBuilder)) || '',
            workerId: '',
            modelId: '',
            savedWorkerId: '',
            savedModelId: '',
            draftDirty: true,
            selectionApproved: false,
            workspaceRoot: (elig && elig.workspaceRoot) || workspace || '',
            projectId: projectId,
            projectName: (lastProjectDash && lastProjectDash.project && lastProjectDash.project.projectName) || projectId,
            _agentsLoaded: false
          };
          if (okEl) {
            okEl.classList.remove('hide');
            okEl.textContent = 'Goal과 Task를 준비했어요. 아직 Worker는 시작하지 않았어요.';
          }
          setGoalFlowVisible(false);
          renderTaskPreview(pendingPreview, elig);
          setTaskPrevVisible(true);
          try {
            var refreshed = await callTool('relay_pm_get_project', { projectId: projectId });
            renderProjectDash(refreshed);
          } catch (eRef) { /* preview already shown */ }
        } catch (ePrep) {
          if (errEl) {
            errEl.classList.remove('hide');
            errEl.textContent = String((ePrep && ePrep.message) || ePrep).slice(0, 240);
          }
        } finally {
          if (contBtn) contBtn.disabled = false;
        }
      }

      async function explicitOwnerRun() {
        if (runInFlight || tpSelectionBusy) return;
        if (!pendingPreview || !pendingPreview.taskId) return;
        var errEl = document.getElementById('tpErr');
        var status = document.getElementById('tpStatus');
        var runBtn = document.getElementById('tpRun');
        var chk = document.getElementById('tpApproveChk');
        if (errEl) { errEl.classList.add('hide'); errEl.textContent = ''; }
        if (!selectionMatchesSaved(pendingPreview)) {
          if (errEl) { errEl.classList.remove('hide'); errEl.textContent = '먼저 「선택 저장」으로 선택을 저장해 주세요.'; }
          return;
        }
        if (!(chk && chk.checked && pendingPreview.selectionApproved)) {
          if (errEl) { errEl.classList.remove('hide'); errEl.textContent = '저장된 선택에 대한 실행 승인이 필요해요.'; }
          return;
        }
        runInFlight = true;
        tpSelectionBusy = true;
        if (runBtn) runBtn.disabled = true;
        try {
          // Dispatch only — save/approve already happened as separate owner steps.
          var resolved = await callTool('relay_pm_resolve_run', {
            taskId: pendingPreview.taskId,
            projectId: pendingPreview.projectId
          });
          if (!resolved || !resolved.ok) {
            throw new Error('시작 불가: ' + ((resolved && resolved.blockers) || []).join(', '));
          }
          if (status) status.textContent = '작업을 시작하는 중…';
          var disp = await callTool('relay_pm_dispatch_owner_approved', {
            taskId: resolved.taskId,
            workerId: resolved.workerId,
            workspaceRoot: resolved.workspaceRoot,
            expectedExecutionState: 'READY'
          });
          if (status) {
            status.textContent = '시작했어요'
              + (disp && disp.runId ? (' · 실행 ' + disp.runId) : '')
              + (resolved.workerId ? (' · ' + resolved.workerId) : '')
              + (resolved.modelId ? (' · ' + resolved.modelId) : '');
          }
          var projectIdAfter = pendingPreview.projectId;
          pendingPreview = null;
          try {
            var refreshed = await callTool('relay_pm_get_project', projectIdAfter ? { projectId: projectIdAfter } : {});
            renderProjectDash(refreshed);
            setTaskPrevVisible(false);
          } catch (eRef2) { /* keep status line */ }
        } catch (eRun) {
          if (errEl) {
            errEl.classList.remove('hide');
            errEl.textContent = String((eRun && eRun.message) || eRun).slice(0, 240);
          }
          if (status) status.textContent = '시작에 실패했어요. 다시 시도할 수 있어요.';
          try {
            var again = await callTool('relay_pm_resolve_run', {
              taskId: pendingPreview && pendingPreview.taskId,
              projectId: pendingPreview && pendingPreview.projectId
            });
            updateTpRunEnabled(pendingPreview, again);
          } catch (eAgain) {}
        } finally {
          runInFlight = false;
          tpSelectionBusy = false;
          if (runBtn) runBtn.disabled = false;
        }
      }

      async function cancelReadyPrep() {
        if (!pendingPreview || !pendingPreview.taskId) return;
        var errEl = document.getElementById('tpErr');
        var status = document.getElementById('tpStatus');
        if (errEl) { errEl.classList.add('hide'); errEl.textContent = ''; }
        try {
          var res = await callTool('relay_pm_cancel_ready_task', {
            taskId: pendingPreview.taskId,
            expectedExecutionState: 'READY',
            reason: 'widget:작업 준비 취소'
          });
          pendingPreview = null;
          setTaskPrevVisible(false);
          if (status) {
            status.textContent = res && res.goalAbandoned
              ? '준비를 취소했고 Goal도 끝냈어요.'
              : '작업 준비를 취소했어요.';
          }
          try {
            var refreshed = await callTool('relay_pm_get_project', {});
            renderProjectDash(refreshed);
          } catch (eRef) { /* ok */ }
        } catch (eCancel) {
          if (errEl) {
            errEl.classList.remove('hide');
            errEl.textContent = String((eCancel && eCancel.message) || eCancel).slice(0, 240);
          }
        }
      }

      function wireGoalRunUi() {
        var newBtn = document.getElementById('pdNewGoalBtn');
        var cancel = document.getElementById('pdGoalCancel');
        var cont = document.getElementById('pdGoalContinue');
        var tpCancel = document.getElementById('tpCancel');
        var tpCancelPrep = document.getElementById('tpCancelPrep');
        var tpRun = document.getElementById('tpRun');
        var tpSaveSel = document.getElementById('tpSaveSel');
        var tpClearSel = document.getElementById('tpClearSel');
        var tpAgentSel = document.getElementById('tpAgentSel');
        var tpModelSel = document.getElementById('tpModelSel');
        var tpApproveChk = document.getElementById('tpApproveChk');
        if (newBtn) newBtn.addEventListener('click', function () {
          setGoalFlowVisible(true);
          var t = document.getElementById('pdGoalTitleIn');
          if (t) t.focus();
        });
        if (cancel) cancel.addEventListener('click', function () { setGoalFlowVisible(false); });
        if (cont) cont.addEventListener('click', function () { prepareGoalAndTask(); });
        if (tpCancel) tpCancel.addEventListener('click', function () {
          setTaskPrevVisible(false);
          pendingPreview = null;
        });
        if (tpCancelPrep) tpCancelPrep.addEventListener('click', function () { cancelReadyPrep(); });
        if (tpRun) tpRun.addEventListener('click', function () { explicitOwnerRun(); });
        if (tpSaveSel) tpSaveSel.addEventListener('click', function () {
          if (!pendingPreview || tpSelectionBusy || runInFlight) return;
          var errEl = document.getElementById('tpErr');
          var status = document.getElementById('tpStatus');
          if (errEl) { errEl.classList.add('hide'); errEl.textContent = ''; }
          var d = draftSelection(pendingPreview);
          if (!d.workerId || !d.modelId) {
            if (errEl) { errEl.classList.remove('hide'); errEl.textContent = 'Agent와 모델을 선택한 뒤 저장하세요.'; }
            return;
          }
          tpSelectionBusy = true;
          persistTpSelection(pendingPreview).then(function (cfg) {
            return callTool('relay_pm_get_task_execution_config', {
              taskId: pendingPreview.taskId,
              projectId: pendingPreview.projectId
            }).then(function (again) {
              var saved = again && again.config;
              if (!saved || saved.workerId !== d.workerId || saved.modelId !== d.modelId) {
                throw new Error('저장 후 재조회 값이 일치하지 않아요.');
              }
              pendingPreview.savedWorkerId = saved.workerId;
              pendingPreview.savedModelId = saved.modelId;
              pendingPreview.selectionApproved = !!(saved.ownerApproval && saved.ownerApproval.approved);
              pendingPreview.draftDirty = false;
              if (status) status.textContent = '선택을 저장했어요. 아직 Worker는 시작하지 않았어요.';
              return callTool('relay_pm_resolve_run', {
                taskId: pendingPreview.taskId,
                projectId: pendingPreview.projectId
              });
            });
          }).then(function (elig) {
            updateTpRunEnabled(pendingPreview, elig);
          }).catch(function (e) {
            if (errEl) { errEl.classList.remove('hide'); errEl.textContent = String((e && e.message) || e).slice(0, 240); }
          }).finally(function () { tpSelectionBusy = false; updateDraftControls(pendingPreview); });
        });
        if (tpClearSel) tpClearSel.addEventListener('click', function () {
          if (!pendingPreview || tpSelectionBusy || runInFlight) return;
          var errEl = document.getElementById('tpErr');
          var status = document.getElementById('tpStatus');
          if (errEl) { errEl.classList.add('hide'); errEl.textContent = ''; }
          tpSelectionBusy = true;
          clearTpSelection(pendingPreview).then(function () {
            if (status) status.textContent = '저장된 선택을 초기화했어요. Worker는 실행되지 않았어요.';
            updateTpRunEnabled(pendingPreview, null);
          }).catch(function (e) {
            if (errEl) { errEl.classList.remove('hide'); errEl.textContent = String((e && e.message) || e).slice(0, 240); }
          }).finally(function () { tpSelectionBusy = false; updateDraftControls(pendingPreview); });
        });
        if (tpAgentSel) tpAgentSel.addEventListener('change', function () {
          if (!pendingPreview) return;
          // Draft only — never write execution-config on Agent browse/change.
          // Agent change invalidates prior model + approval (R01-HOST-FIX C / selection safety).
          pendingPreview.workerId = tpAgentSel.value || '';
          pendingPreview.modelId = '';
          pendingPreview.draftDirty = true;
          pendingPreview.selectionApproved = false;
          if (tpModelSel) tpModelSel.value = '';
          if (tpApproveChk) { tpApproveChk.checked = false; tpApproveChk.disabled = true; }
          tpSelectionBusy = true;
          loadTpModels(tpAgentSel.value, '').then(function () {
            updateTpRunEnabled(pendingPreview, null);
          }).catch(function (e) {
            var errEl = document.getElementById('tpErr');
            if (errEl) { errEl.classList.remove('hide'); errEl.textContent = String((e && e.message) || e).slice(0, 240); }
          }).finally(function () { tpSelectionBusy = false; });
        });
        if (tpModelSel) tpModelSel.addEventListener('change', function () {
          if (!pendingPreview) return;
          // Draft only — exploring/changing the model must not call set_task_execution_config.
          pendingPreview.modelId = tpModelSel.value || '';
          pendingPreview.draftDirty = true;
          pendingPreview.selectionApproved = false;
          if (tpApproveChk) { tpApproveChk.checked = false; }
          updateTpRunEnabled(pendingPreview, null);
        });
        if (tpApproveChk) tpApproveChk.addEventListener('change', function () {
          if (!pendingPreview) return;
          if (!tpApproveChk.checked) {
            pendingPreview.selectionApproved = false;
            updateTpRunEnabled(pendingPreview, null);
            return;
          }
          if (!selectionMatchesSaved(pendingPreview)) {
            tpApproveChk.checked = false;
            var errEarly = document.getElementById('tpErr');
            if (errEarly) { errEarly.classList.remove('hide'); errEarly.textContent = '저장된 선택과 같아야 승인할 수 있어요. 먼저 「선택 저장」하세요.'; }
            return;
          }
          tpSelectionBusy = true;
          // Approve only — do not re-persist and do not dispatch.
          callTool('relay_pm_approve_task_execution', {
            taskId: pendingPreview.taskId,
            projectId: pendingPreview.projectId
          }).then(function () {
            return callTool('relay_pm_resolve_run', {
              taskId: pendingPreview.taskId,
              projectId: pendingPreview.projectId
            });
          }).then(function (elig) {
            pendingPreview.selectionApproved = true;
            updateTpRunEnabled(pendingPreview, elig);
            var status = document.getElementById('tpStatus');
            if (status) status.textContent = '실행을 승인했어요. 「작업 시작」을 누르기 전까지 Worker는 0이에요.';
          }).catch(function (e) {
            tpApproveChk.checked = false;
            pendingPreview.selectionApproved = false;
            var errEl = document.getElementById('tpErr');
            if (errEl) { errEl.classList.remove('hide'); errEl.textContent = String((e && e.message) || e).slice(0, 240); }
            updateTpRunEnabled(pendingPreview, null);
          }).finally(function () { tpSelectionBusy = false; });
        });
      }

      wireGoalRunUi();

      function wireTaskRows() {
        var rows = document.getElementById('taskRows');
        if (!rows || rows._r01Wired) return;
        rows._r01Wired = true;
        rows.addEventListener('click', function (ev) {
          var btn = ev.target && ev.target.closest ? ev.target.closest('button.trow[data-task-id]') : null;
          if (!btn) return;
          var tid = btn.getAttribute('data-task-id');
          if (!tid) return;
          openExistingTask(tid);
        });
        rows.addEventListener('keydown', function (ev) {
          var btn = ev.target && ev.target.closest ? ev.target.closest('button.trow[data-task-id]') : null;
          if (!btn) return;
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            var tid = btn.getAttribute('data-task-id');
            if (tid) openExistingTask(tid);
          }
        });
      }
      wireTaskRows();

      async function poll() {
        try {
          var list = await callTool('relay_pm_list_pending_deliveries', {});
          var deliveries = (list && list.deliveries) || [];
          lastDeliveries = deliveries;
          renderBoard(deliveries);
          // Event-driven version check: only when the delivery set actually
          // changed (or first run). No timer polling.
          var fp = deliveryFp(deliveries);
          if (fp !== lastDeliveryFp) { lastDeliveryFp = fp; checkVersion(); }
          // P1.8C-04 — bounded selected-project dashboard (not full get_dashboard).
          try {
            var projView = await callTool('relay_pm_get_project', {});
            renderProjectDash(projView);
            setDiag('project ok · ' + diagTime() + spriteNote);
          } catch (eProj) {
            setDiag('project 실패: ' + String((eProj && eProj.message) || eProj).slice(0, 120) + spriteNote);
            logLine('get_project error: ' + ((eProj && eProj.message) || eProj));
          }
          try {
            var dash = await callTool('relay_pm_get_dashboard', {});
            lastDash = dash;
            try { renderAgents(dash); } catch (eAgents) { logLine('render agents error: ' + eAgents.message); }
            try {
              // Prefer bounded recentTasks from get_project for Task tab when available.
              var taskList = (lastProjectDash && lastProjectDash.recentTasks)
                || (lastProjectDash && lastProjectDash.tasks)
                || [];
              if (!taskList.length) {
                try {
                  var tl = await callTool('relay_pm_list_tasks', {});
                  taskList = (tl && tl.tasks) || [];
                } catch (eTl) { taskList = []; }
              }
              var goals = (lastProjectDash && lastProjectDash.goal)
                ? [lastProjectDash.goal]
                : ((dash && dash.goals) || []);
              try {
                var doneT = 0;
                for (var ti = 0; ti < taskList.length; ti++) {
                  if (isDoneTask(taskList[ti])) doneT++;
                }
                var barB = document.getElementById('barB');
                if (barB && taskList.length) {
                  barB.style.width = Math.round((doneT / taskList.length) * 100) + '%';
                }
              } catch (eBar) { /* progress best-effort */ }
              var taskCounts = null;
              try { taskCounts = renderTaskTab(taskList); } catch (eT) { logLine('render tasktab error: ' + eT.message); }
              try { renderGoalTab(goals, taskCounts); } catch (eG) { logLine('render goaltab error: ' + eG.message); }
              try {
                initDesignTabs();
                renderDesignStatic();
                var dz = await callTool('relay_pm_get_design', {});
                renderWbsNodes(dz && dz.nodes);
                renderEst(taskCounts);
              } catch (eD) { /* design best-effort */ }
            } catch (e3) { /* task views best-effort */ }
          } catch (e2) {
            setDiag('dashboard 실패: ' + String((e2 && e2.message) || e2).slice(0, 120) + spriteNote);
            /* dashboard best-effort; deliveries already shown */
          }
          if (deliveries.length === 0) {
            setStatus('waiting', t('connected'), t('waiting'));
            return;
          }
          for (var i = 0; i < deliveries.length; i++) {
            var d = deliveries[i];
            if (!d || !d.deliveryId) continue;
            if (sessionHandled[d.deliveryId]) continue;
            if (claiming) continue;
            claiming = true;
            try { await handleDelivery(d); }
            catch (e) { logLine('handle delivery error: ' + e.message); }
            finally { claiming = false; }
          }
        } catch (e) {
          setStatus('waiting', t('connected'), t('waiting'));
          logLine('poll error: ' + e.message);
        }
        renderSelfcheck();
      }

      async function handleDelivery(delivery) {
        sessionHandled[delivery.deliveryId] = true;
        setStatus('ready', t('reviewReady'), delivery.taskId ? 'TASK-' + delivery.taskId.replace(/^TASK-/, '') : delivery.deliveryId);
        logLine('delivery actionable: ' + delivery.deliveryId + ' task=' + delivery.taskId);
        // P1.8D — refuse re-wake when durable wake is already SENT, even after remount.
        try {
          var wakeSt = await callTool('relay_pm_get_wake_status', { deliveryId: delivery.deliveryId });
          if (wakeSt && wakeSt.status === 'SENT') {
            logLine('wake already SENT — skip re-wake: ' + delivery.deliveryId);
            return;
          }
        } catch (eWs) { /* claim still gates */ }
        var claim;
        try {
          claim = await callTool('relay_pm_claim_wake', { deliveryId: delivery.deliveryId });
        } catch (e) {
          logLine('claim failed: ' + e.message);
          return;
        }
        if (!claim || claim.claimable !== true) {
          logLine('not claimable: ' + (claim && claim.reason));
          return;
        }
        var instruction = claim.instruction;
        if (!instruction) { logLine('claim returned no instruction'); return; }
        setStatus('sent', t('waking'), delivery.deliveryId);
        logLine('wake claimed (attempt ' + claim.record.attemptCount + '). firing ui/message.');
        try {
          var r = await sendRequest('ui/message', {
            role: 'user',
            content: [ { type: 'text', text: instruction } ]
          }, 20000);
          logLine('ui/message accepted: ' + JSON.stringify(r));
          doneCount++;
          setStatus('sent', t('reviewReady'), t('wakeSent'));
          renderBoard(lastDeliveries);
        } catch (e) {
          logLine('ui/message error: ' + e.message);
          setStatus('fail', t('wakeFail'), delivery.deliveryId);
          try {
            var f = await callTool('relay_pm_mark_wake_failed', { deliveryId: delivery.deliveryId, reason: e.message.slice(0, 300) });
            logLine('wake marked FAILED for retry: ' + (f && f.status));
          } catch (e2) { logLine('mark failed error: ' + e2.message); }
          sessionHandled[delivery.deliveryId] = false; // allow bounded retry next poll
        }
      }

      /* —— P1.8C-03 first-run bootstrap (mirrors src/mcp/app/bootstrap-gate.ts) —— */
      var boot = {
        active: false,
        step: 'project', // project | workspace | agents | ready
        profiles: [],
        selectedId: null,
        profile: null,
        assignment: null,
        completed: false
      };
      function needsFirstRunBootstrap(selectedProjectId, selectedProfile) {
        if (!selectedProjectId || typeof selectedProjectId !== 'string' || !selectedProjectId.trim()) return true;
        if (!selectedProfile || typeof selectedProfile !== 'object') return true;
        if (selectedProfile.legacy === true || selectedProfile.profileState === 'LEGACY') return true;
        if (selectedProfile.profileState === 'UNCONFIGURED') return true;
        if (selectedProfile.workspaceConflict === true) return true;
        if (selectedProfile.workspaceConfigured !== true) return true;
        return false;
      }
      function canCompleteBootstrapAsTarget(profile) {
        if (!profile) return { ok: false, reason: 'NO_PROJECT' };
        if (profile.legacy === true || profile.profileState === 'LEGACY') {
          return { ok: false, reason: 'LEGACY_NOT_ALLOWED' };
        }
        return { ok: true, reason: null };
      }
      function workspaceDisplayForProfile(profile) {
        if (!profile) return { kind: 'NONE', workspacePath: null, label: '프로젝트를 먼저 골라 주세요.' };
        if (profile.workspaceConflict === true) {
          return { kind: 'WORKSPACE_CONFLICT', workspacePath: profile.workspacePath || null,
            label: '워크스페이스 설정이 서로 다릅니다. 계속할 수 없어요.' };
        }
        if (profile.workspaceConfigured === true && profile.workspacePath) {
          return { kind: 'PATH', workspacePath: profile.workspacePath, label: profile.workspacePath };
        }
        return { kind: 'WORKSPACE_CONFIGURATION_REQUIRED', workspacePath: null,
          label: '워크스페이스 경로 설정이 필요해요.' };
      }
      function hasBinding(v) { return v !== null && v !== undefined && typeof v === 'object'; }
      function bindingCount(list) {
        if (!Array.isArray(list)) return 0;
        var n = 0; for (var i = 0; i < list.length; i++) if (hasBinding(list[i])) n++;
        return n;
      }
      function evaluateBootstrapReady(profile, assignment) {
        var blockers = [];
        var target = canCompleteBootstrapAsTarget(profile);
        if (!target.ok && target.reason) blockers.push(target.reason);
        if (profile) {
          if (profile.workspaceConflict === true) blockers.push('WORKSPACE_CONFLICT');
          if (profile.workspaceConfigured !== true) blockers.push('WORKSPACE_CONFIGURATION_REQUIRED');
        }
        var src = (assignment && typeof assignment === 'object') ? assignment : profile;
        if (assignment && assignment.configurationRequired === true) blockers.push('CONFIGURATION_REQUIRED');
        if (!src || !hasBinding(src.pm)) blockers.push('PM_REQUIRED');
        if (!src || bindingCount(src.builders) < 1) blockers.push('BUILDER_REQUIRED');
        if (!src || bindingCount(src.qa) < 1) blockers.push('QA_REQUIRED');
        var unique = [];
        for (var i = 0; i < blockers.length; i++) {
          if (unique.indexOf(blockers[i]) < 0) unique.push(blockers[i]);
        }
        return unique.length === 0
          ? { ready: true, state: 'BOOTSTRAP_READY', blockers: [] }
          : { ready: false, state: 'BOOTSTRAP_BLOCKED', blockers: unique };
      }
      function bootstrapBlockerLabel(code) {
        var map = {
          NO_PROJECT: '프로젝트를 골라 주세요.',
          LEGACY_NOT_ALLOWED: '예전(레거시) 프로젝트는 여기서 시작할 수 없어요.',
          WORKSPACE_CONFIGURATION_REQUIRED: '워크스페이스 경로 설정이 필요해요.',
          WORKSPACE_CONFLICT: '워크스페이스 설정이 서로 달라 계속할 수 없어요.',
          PM_REQUIRED: 'PM을 정해 주세요.',
          BUILDER_REQUIRED: 'Builder를 정해 주세요.',
          QA_REQUIRED: 'QA를 정해 주세요.',
          CONFIGURATION_REQUIRED: '프로젝트 설정이 아직 없어요.'
        };
        return map[code] || '아직 준비가 끝나지 않았어요.';
      }
      function bindingDisplayName(binding) {
        if (!hasBinding(binding)) return '(없음)';
        return binding.runtime || binding.runtimeAdapterId || binding.workerId || '(이름 없음)';
      }
      function profileStatePill(state) {
        if (state === 'CONFIGURED') return { code: state, tone: 'ok', labelKo: '준비됨' };
        if (state === 'PARTIAL') return { code: state, tone: 'warn', labelKo: '일부만 설정' };
        if (state === 'UNCONFIGURED') return { code: state, tone: 'warn', labelKo: '설정 필요' };
        if (state === 'LEGACY') return { code: state, tone: 'legacy', labelKo: '예전(레거시)' };
        return { code: state || 'UNKNOWN', tone: 'muted', labelKo: state || '알 수 없음' };
      }
      function setBootErr(msg) {
        var el = document.getElementById('bootErr');
        if (!el) return;
        if (!msg) { el.className = 'boot-err hide'; el.textContent = ''; return; }
        el.className = 'boot-err'; el.textContent = msg;
      }
      function showBootstrap(show) {
        boot.active = !!show;
        var bootEl = document.getElementById('bootstrap');
        var mainEl = document.getElementById('mainView');
        var sw = document.getElementById('projSwitch');
        if (bootEl) bootEl.className = show ? 'bootstrap' : 'bootstrap hide';
        if (mainEl) {
          if (show) mainEl.classList.add('hide-for-boot');
          else mainEl.classList.remove('hide-for-boot');
        }
        if (sw) {
          if (show) sw.classList.add('hide');
          else sw.classList.remove('hide');
        }
      }
      function setBootStep(step) {
        boot.step = step;
        var panes = {
          project: document.getElementById('bootPaneProject'),
          workspace: document.getElementById('bootPaneWorkspace'),
          agents: document.getElementById('bootPaneAgents'),
          ready: document.getElementById('bootPaneReady')
        };
        Object.keys(panes).forEach(function (k) {
          if (panes[k]) panes[k].className = (k === step) ? '' : 'hide';
        });
        var steps = document.querySelectorAll('#bootSteps .boot-step');
        var order = ['project', 'workspace', 'agents', 'ready'];
        var idx = order.indexOf(step);
        for (var i = 0; i < steps.length; i++) {
          var s = steps[i];
          var key = s.getAttribute('data-bs');
          var ki = order.indexOf(key);
          s.className = 'boot-step' + (ki === idx ? ' on' : (ki < idx ? ' done' : ''));
        }
        var nextBtn = document.getElementById('bootNext');
        var startBtn = document.getElementById('bootStart');
        var backBtn = document.getElementById('bootBack');
        if (backBtn) backBtn.disabled = step === 'project';
        if (step === 'ready') {
          if (nextBtn) nextBtn.className = 'hide';
          if (startBtn) startBtn.className = 'primary';
        } else {
          if (nextBtn) nextBtn.className = 'primary';
          if (startBtn) startBtn.className = 'primary hide';
        }
        renderBootStep();
      }
      function projectRunnableLabel(p) {
        if (!p) return '불가';
        if (p.legacy || p.profileState === 'LEGACY') return '불가(레거시)';
        if (p.workspaceConflict) return '불가(경로 충돌)';
        if (!p.workspaceConfigured || !p.workspacePath) return '불가(경로 없음)';
        if (p.profileState === 'PARTIAL') return '부분 준비(역할 필요)';
        if (p.profileState === 'CONFIGURED') return '작업 가능';
        return '설정 필요';
      }
      function renderBootProjectList() {
        var list = document.getElementById('bootProjectList');
        if (!list) return;
        list.innerHTML = '';
        if (!boot.profiles.length) {
          var empty = document.createElement('div');
          empty.className = 'boot-box warn';
          empty.textContent = '보여줄 프로젝트가 없어요. 아래 「새 폴더로 프로젝트 등록」으로 추가하세요.';
          list.appendChild(empty);
          return;
        }
        boot.profiles.forEach(function (p) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'boot-card' + (p.projectId === boot.selectedId ? ' sel' : '')
            + ((p.legacy || p.profileState === 'LEGACY') ? ' legacy' : '');
          btn.setAttribute('role', 'option');
          btn.setAttribute('aria-selected', p.projectId === boot.selectedId ? 'true' : 'false');
          var pill = profileStatePill(p.profileState);
          var name = document.createElement('span'); name.className = 'bn'; name.textContent = p.projectName || p.projectId;
          var id = document.createElement('span'); id.className = 'bid'; id.textContent = p.projectId + ' · ASUS';
          var path = document.createElement('span'); path.className = 'bp';
          path.textContent = (p.workspaceConfigured && p.workspacePath)
            ? p.workspacePath
            : (p.profileState === 'UNCONFIGURED' ? '경로 미설정' : (p.workspacePath || '경로 없음'));
          var sp = document.createElement('span');
          sp.className = 'spill ' + pill.tone;
          sp.textContent = pill.code + ' · ' + pill.labelKo + ' · ' + projectRunnableLabel(p);
          btn.appendChild(name); btn.appendChild(id); btn.appendChild(path); btn.appendChild(sp);
          if (p.legacy || p.profileState === 'LEGACY') {
            var note = document.createElement('span');
            note.className = 'bp';
            note.textContent = '레거시 — 일반 시작 대상으로 쓸 수 없어요';
            btn.appendChild(note);
          }
          btn.onclick = function () {
            boot.selectedId = p.projectId;
            boot.profile = p;
            boot.assignment = null;
            setBootErr('');
            renderBootProjectList();
          };
          list.appendChild(btn);
        });
      }
      var browseState = { path: null, parentPath: null, roots: [], mode: 'register' };
      function setBrowsePathLabel(text) {
        var el = document.getElementById('bootBrowsePath');
        if (el) el.textContent = text || '';
      }
      async function loadBrowseRoots() {
        var res = await callTool('relay_pm_list_workspace_browse_roots', {});
        browseState.roots = (res && res.roots) || [];
        var box = document.getElementById('bootBrowseRoots');
        if (!box) return;
        box.innerHTML = '';
        browseState.roots.forEach(function (r) {
          var b = document.createElement('button');
          b.type = 'button';
          b.disabled = !r.exists;
          b.textContent = r.label + (r.exists ? '' : ' (없음)');
          b.onclick = function () { openBrowsePath(r.path); };
          box.appendChild(b);
        });
      }
      async function openBrowsePath(absPath) {
        setBootErr('');
        try {
          var res = await callTool('relay_pm_browse_workspace_directories', { absolutePath: absPath });
          browseState.path = res.path;
          browseState.parentPath = res.parentPath || null;
          setBrowsePathLabel(res.path);
          var up = document.getElementById('bootBrowseUp');
          if (up) up.disabled = !browseState.parentPath;
          var use = document.getElementById('bootBrowseUse');
          if (use) use.disabled = !browseState.path;
          var entries = document.getElementById('bootBrowseEntries');
          if (!entries) return;
          entries.innerHTML = '';
          (res.entries || []).forEach(function (e) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = e.name + (e.hasWorkspaceConfig ? ' · 설정있음' : '');
            b.onclick = function () { openBrowsePath(e.path); };
            entries.appendChild(b);
          });
          if (res.truncated) {
            var more = document.createElement('div');
            more.className = 'boot-note';
            more.textContent = '목록이 잘렸습니다. 하위 폴더로 이동해 주세요.';
            entries.appendChild(more);
          }
        } catch (e) {
          setBootErr('폴더 탐색 실패: ' + String((e && e.message) || e).slice(0, 200));
        }
      }
      function showRegisterPanel(show) {
        var panel = document.getElementById('bootRegisterPanel');
        if (panel) panel.className = show ? '' : 'hide';
      }
      function renderBootWorkspace() {
        var box = document.getElementById('bootWorkspaceBox');
        if (!box) return;
        var d = workspaceDisplayForProfile(boot.profile);
        box.className = 'boot-box' + (d.kind === 'PATH' ? ' ok' : (d.kind === 'WORKSPACE_CONFLICT' ? ' err' : ' warn'));
        box.innerHTML = '';
        var title = document.createElement('div');
        title.style.fontWeight = '700';
        title.textContent = d.kind === 'PATH' ? '등록된 작업 폴더 (ASUS)'
          : (d.kind === 'WORKSPACE_CONFLICT' ? '설정 충돌' : '워크스페이스 설정 필요');
        box.appendChild(title);
        var host = document.createElement('div');
        host.className = 'boot-note';
        host.textContent = '실행 컴퓨터: ASUS';
        box.appendChild(host);
        var changeBtn = document.getElementById('bootBrowseChangePath');
        if (d.kind === 'PATH') {
          var path = document.createElement('div');
          path.className = 'path';
          path.textContent = d.workspacePath;
          box.appendChild(path);
          var note = document.createElement('div');
          note.className = 'boot-note';
          note.textContent = '이 경로를 실행 기본 폴더로 씁니다. 바꾸려면 아래에서 「작업 폴더 변경」을 누르세요.';
          box.appendChild(note);
          if (changeBtn) {
            changeBtn.className = '';
            changeBtn.disabled = false;
          }
          showRegisterPanel(false);
        } else {
          var msg = document.createElement('div');
          msg.textContent = d.label;
          box.appendChild(msg);
          if (d.kind === 'WORKSPACE_CONFIGURATION_REQUIRED') {
            var code = document.createElement('div');
            code.className = 'boot-note';
            code.textContent = '아래 찾아보기로 폴더를 고른 뒤 새 프로젝트로 등록하세요. 경로는 지어내지 않아요.';
            box.appendChild(code);
            showRegisterPanel(true);
          }
          if (changeBtn) changeBtn.className = 'hide';
        }
        loadBrowseRoots().catch(function (e) {
          setBootErr('탐색 루트 실패: ' + String((e && e.message) || e).slice(0, 160));
        });
      }
      function renderBootAgents() {
        var root = document.getElementById('bootRoles');
        if (!root) return;
        root.innerHTML = '';
        var a = boot.assignment || {};
        var assignedPm = a.pm || (boot.profile && boot.profile.pm) || null;
        var assignedBuilders = (a.builders && a.builders.length)
          ? a.builders
          : ((boot.profile && boot.profile.builders) || []);
        var assignedQa = (a.qa && a.qa.length)
          ? a.qa
          : ((boot.profile && boot.profile.qa) || []);
        var available = (a.availableWorkers || (boot.profile && boot.profile.availableWorkers) || []).slice();
        function section(title, assignedList, roleKey) {
          var wrap = document.createElement('div');
          wrap.className = 'boot-role';
          var h = document.createElement('h3');
          h.textContent = title;
          wrap.appendChild(h);
          var as = document.createElement('div');
          as.className = 'boot-assigned';
          var lab = document.createElement('span');
          lab.className = 'boot-note';
          lab.textContent = '할당됨: ';
          as.appendChild(lab);
          if (!assignedList.length) {
            var none = document.createElement('span');
            none.className = 'achip';
            none.textContent = '(없음)';
            as.appendChild(none);
          } else {
            assignedList.forEach(function (b) {
              var c = document.createElement('span');
              c.className = 'achip';
              c.textContent = bindingDisplayName(b);
              as.appendChild(c);
            });
          }
          wrap.appendChild(as);
          var av = document.createElement('div');
          av.className = 'boot-avail';
          var alab = document.createElement('span');
          alab.className = 'boot-note';
          alab.textContent = '사용 가능(후보): ';
          av.appendChild(alab);
          if (!available.length) {
            var none2 = document.createElement('span');
            none2.className = 'vchip';
            none2.textContent = '(후보 없음)';
            none2.disabled = true;
            av.appendChild(none2);
          } else {
            available.forEach(function (wid) {
              var c = document.createElement('button');
              c.type = 'button';
              c.className = 'vchip';
              c.textContent = wid;
              c.title = '후보만 표시 — 누르면 이 역할에 배정 요청';
              c.onclick = function () { assignWorkerToRole(roleKey, wid); };
              av.appendChild(c);
            });
          }
          wrap.appendChild(av);
          root.appendChild(wrap);
        }
        section('PM', assignedPm ? [assignedPm] : [], 'pm');
        section('Builder', assignedBuilders, 'builder');
        section('QA', assignedQa, 'qa');
      }
      function renderBootReady() {
        var box = document.getElementById('bootReadyBox');
        var ul = document.getElementById('bootBlockers');
        var startBtn = document.getElementById('bootStart');
        if (!box) return;
        var gate = evaluateBootstrapReady(boot.profile, boot.assignment);
        box.className = 'boot-box ' + (gate.ready ? 'ok' : 'warn');
        box.innerHTML = '';
        var t1 = document.createElement('div');
        t1.style.fontWeight = '700';
        t1.textContent = gate.ready ? '준비 완료 (BOOTSTRAP_READY)' : '아직 준비가 안 됐어요';
        box.appendChild(t1);
        var t2 = document.createElement('div');
        t2.className = 'boot-note';
        t2.textContent = gate.ready
          ? '설정만 끝났어요. Goal / Task / Worker는 만들지 않아요.'
          : '아래를 해결해야 시작할 수 있어요.';
        box.appendChild(t2);
        if (boot.profile) {
          var sum = document.createElement('div');
          sum.style.marginTop = '6px';
          sum.innerHTML = '';
          var lines = [
            '프로젝트: ' + (boot.profile.projectName || boot.profile.projectId),
            '경로: ' + (boot.profile.workspacePath || '(없음)'),
            'PM: ' + bindingDisplayName((boot.assignment && boot.assignment.pm) || boot.profile.pm),
            'Builder: ' + (((boot.assignment && boot.assignment.builders) || boot.profile.builders || []).map(bindingDisplayName).join(', ') || '(없음)'),
            'QA: ' + (((boot.assignment && boot.assignment.qa) || boot.profile.qa || []).map(bindingDisplayName).join(', ') || '(없음)')
          ];
          lines.forEach(function (line) {
            var d = document.createElement('div');
            d.textContent = line;
            sum.appendChild(d);
          });
          box.appendChild(sum);
        }
        if (ul) {
          ul.innerHTML = '';
          gate.blockers.forEach(function (code) {
            var li = document.createElement('li');
            li.textContent = bootstrapBlockerLabel(code);
            ul.appendChild(li);
          });
        }
        if (startBtn) startBtn.disabled = !gate.ready;
      }
      function renderBootStep() {
        if (boot.step === 'project') renderBootProjectList();
        else if (boot.step === 'workspace') renderBootWorkspace();
        else if (boot.step === 'agents') renderBootAgents();
        else if (boot.step === 'ready') renderBootReady();
      }
      async function loadBootProfiles() {
        var listed = await callTool('relay_pm_list_project_profiles', {});
        boot.profiles = (listed && listed.profiles) || [];
        return listed;
      }
      async function loadBootAssignment(projectId) {
        if (!projectId) { boot.assignment = null; return null; }
        try {
          var res = await callTool('relay_pm_get_project_assignments', { projectId: projectId });
          boot.assignment = (res && res.assignment) || null;
          return boot.assignment;
        } catch (e) {
          boot.assignment = null;
          setBootErr('역할 정보를 읽지 못했어요: ' + String((e && e.message) || e).slice(0, 160));
          return null;
        }
      }
      function toBindingInput(b) {
        if (!hasBinding(b)) return null;
        return {
          runtime: b.runtime,
          runtimeAdapterId: b.runtimeAdapterId,
          workerId: b.workerId,
          provider: b.provider,
          model: b.model
        };
      }
      async function assignWorkerToRole(roleKey, workerId) {
        if (!boot.selectedId) return;
        setBootErr('');
        try {
          var cur = boot.assignment || await loadBootAssignment(boot.selectedId) || {
            pm: null, builders: [], qa: [], availableWorkers: []
          };
          var pm = toBindingInput(cur.pm);
          var builders = (cur.builders || []).map(toBindingInput).filter(Boolean);
          var qa = (cur.qa || []).map(toBindingInput).filter(Boolean);
          var next = { workerId: workerId, runtimeAdapterId: workerId };
          if (roleKey === 'pm') pm = next;
          else if (roleKey === 'builder') builders = [next];
          else if (roleKey === 'qa') qa = [next];
          // Keep a local draft so the UI reflects the pick even before a full C02 write.
          boot.assignment = {
            projectId: boot.selectedId,
            pm: pm,
            builders: builders,
            qa: qa,
            availableWorkers: cur.availableWorkers || [],
            configurationRequired: cur.configurationRequired,
            workspacePath: cur.workspacePath || (boot.profile && boot.profile.workspacePath) || null
          };
          renderBootAgents();
          if (!pm || !builders.length || !qa.length) {
            setBootErr('PM · Builder · QA를 모두 고르면 저장돼요. (지금은 화면에만 반영)');
            return;
          }
          var result = await callTool('relay_pm_set_project_assignments', {
            projectId: boot.selectedId,
            pm: pm,
            builders: builders,
            qa: qa
          });
          boot.assignment = (result && result.assignment) || boot.assignment;
          if (result && result.profile) boot.profile = result.profile;
          setBootErr('');
          logLine('assignment set via C02 for ' + boot.selectedId);
          renderBootAgents();
        } catch (e) {
          setBootErr('역할 저장 실패: ' + String((e && e.message) || e).slice(0, 200));
        }
      }
      async function bootGoNext() {
        setBootErr('');
        if (boot.step === 'project') {
          if (!boot.selectedId || !boot.profile) {
            setBootErr('프로젝트를 골라 주세요.');
            return;
          }
          var gate = canCompleteBootstrapAsTarget(boot.profile);
          if (!gate.ok) {
            setBootErr(bootstrapBlockerLabel(gate.reason));
            return;
          }
          await loadBootAssignment(boot.selectedId);
          setBootStep('workspace');
          return;
        }
        if (boot.step === 'workspace') {
          var wd = workspaceDisplayForProfile(boot.profile);
          if (wd.kind === 'WORKSPACE_CONFLICT') {
            setBootErr(bootstrapBlockerLabel('WORKSPACE_CONFLICT'));
            return;
          }
          if (wd.kind === 'WORKSPACE_CONFIGURATION_REQUIRED') {
            setBootErr(bootstrapBlockerLabel('WORKSPACE_CONFIGURATION_REQUIRED'));
            return;
          }
          if (!boot.assignment) await loadBootAssignment(boot.selectedId);
          setBootStep('agents');
          return;
        }
        if (boot.step === 'agents') {
          if (!boot.assignment) await loadBootAssignment(boot.selectedId);
          setBootStep('ready');
        }
      }
      function bootGoBack() {
        setBootErr('');
        if (boot.step === 'workspace') setBootStep('project');
        else if (boot.step === 'agents') setBootStep('workspace');
        else if (boot.step === 'ready') setBootStep('agents');
      }
      async function bootComplete() {
        setBootErr('');
        var gate = evaluateBootstrapReady(boot.profile, boot.assignment);
        if (!gate.ready) {
          setBootErr(gate.blockers.map(bootstrapBlockerLabel).join(' · '));
          return;
        }
        try {
          var result = await callTool('relay_pm_select_project', { projectId: boot.selectedId });
          logLine('bootstrap select_project → ' + (result && result.selectedProjectId));
          boot.completed = true;
          showBootstrap(false);
          renderProjectSwitch(boot.profiles, boot.selectedId);
          setStatus('waiting', t('connected'), (boot.profile && boot.profile.projectName) || boot.selectedId);
          // Resume normal poll/dashboard view (zero Goal/Task/Run by contract of select_project).
          poll();
        } catch (e) {
          setBootErr('프로젝트 저장 실패: ' + String((e && e.message) || e).slice(0, 200));
        }
      }
      function renderProjectSwitch(profiles, selectedId) {
        var sw = document.getElementById('projSwitch');
        var menu = document.getElementById('projSwitchMenu');
        var label = document.getElementById('projSwitchLabel');
        if (!sw || !menu || !label) return;
        var cur = (profiles || []).find(function (p) { return p.projectId === selectedId; });
        label.textContent = (cur && cur.projectName ? cur.projectName : (selectedId || 'Project')) + ' ▾';
        menu.innerHTML = '';
        (profiles || []).forEach(function (p) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = p.projectId === selectedId ? 'cur' : '';
          b.textContent = (p.projectName || p.projectId)
            + (p.profileState === 'LEGACY' || p.legacy ? ' · LEGACY' : '')
            + (p.profileState === 'UNCONFIGURED' ? ' · 설정 필요' : '');
          b.onclick = async function () {
            try { sw.open = false; } catch (e) {}
            if (p.legacy || p.profileState === 'LEGACY' || p.profileState === 'UNCONFIGURED'
                || p.profileState === 'PARTIAL'
                || p.workspaceConflict || !p.workspaceConfigured) {
              boot.selectedId = p.projectId;
              boot.profile = p;
              boot.assignment = null;
              showBootstrap(true);
              setBootStep('project');
              renderBootProjectList();
              return;
            }
            try {
              await callTool('relay_pm_select_project', { projectId: p.projectId });
              renderProjectSwitch(profiles, p.projectId);
              poll();
            } catch (e) {
              logLine('project switch failed: ' + e.message);
            }
          };
          menu.appendChild(b);
        });
        var reopen = document.createElement('button');
        reopen.type = 'button';
        reopen.textContent = '프로젝트 다시 준비…';
        reopen.onclick = function () {
          try { sw.open = false; } catch (e) {}
          showBootstrap(true);
          setBootStep('project');
          loadBootProfiles().then(function () { renderBootProjectList(); });
        };
        menu.appendChild(reopen);
        sw.classList.remove('hide');
      }
      async function maybeStartBootstrap() {
        try {
          var listed = await loadBootProfiles();
          var selectedId = listed && listed.selectedProjectId;
          var selectedProfile = null;
          if (selectedId) {
            for (var i = 0; i < boot.profiles.length; i++) {
              if (boot.profiles[i].projectId === selectedId) { selectedProfile = boot.profiles[i]; break; }
            }
          }
          if (needsFirstRunBootstrap(selectedId, selectedProfile)) {
            boot.selectedId = selectedId || null;
            boot.profile = selectedProfile;
            showBootstrap(true);
            setBootStep('project');
            renderBootProjectList();
            setStatus('waiting', '프로젝트 준비', '첫 실행');
            logLine('bootstrap shown (first-run)');
            return true;
          }
          showBootstrap(false);
          renderProjectSwitch(boot.profiles, selectedId);
          logLine('bootstrap skipped (returning user: ' + selectedId + ')');
          return false;
        } catch (e) {
          logLine('bootstrap check failed: ' + e.message);
          // Fail open to normal view; operator can still use Project ▾ later.
          showBootstrap(false);
          return false;
        }
      }
      try {
        var bootBack = document.getElementById('bootBack');
        var bootNext = document.getElementById('bootNext');
        var bootStart = document.getElementById('bootStart');
        if (bootBack) bootBack.onclick = function () { bootGoBack(); };
        if (bootNext) bootNext.onclick = function () { bootGoNext(); };
        if (bootStart) bootStart.onclick = function () { bootComplete(); };
        var bootNew = document.getElementById('bootNewProjectBtn');
        if (bootNew) bootNew.onclick = function () {
          browseState.mode = 'register';
          setBootStep('workspace');
          showRegisterPanel(true);
          loadBrowseRoots().catch(function () {});
        };
        var bootUp = document.getElementById('bootBrowseUp');
        if (bootUp) bootUp.onclick = function () {
          if (browseState.parentPath) openBrowsePath(browseState.parentPath);
        };
        var bootUse = document.getElementById('bootBrowseUse');
        if (bootUse) bootUse.onclick = function () {
          if (!browseState.path) return;
          var input = document.getElementById('bootPathInput');
          if (input) input.value = browseState.path;
          if (browseState.mode === 'change' && boot.selectedId) {
            setBootErr('');
            callTool('relay_pm_set_project_workspace_path', {
              projectId: boot.selectedId,
              workspacePath: browseState.path,
              syncRoleConfig: true
            }).then(function () {
              return loadBootProfiles();
            }).then(function () {
              for (var i = 0; i < boot.profiles.length; i++) {
                if (boot.profiles[i].projectId === boot.selectedId) {
                  boot.profile = boot.profiles[i];
                  break;
                }
              }
              setBootErr('');
              renderBootWorkspace();
            }).catch(function (e) {
              setBootErr('경로 변경 실패: ' + String((e && e.message) || e).slice(0, 220));
            });
            return;
          }
          browseState.mode = 'register';
          showRegisterPanel(true);
          var nameEl = document.getElementById('bootRegName');
          if (nameEl && !nameEl.value) {
            var parts = browseState.path.split('/');
            nameEl.value = parts[parts.length - 1] || '';
          }
        };
        var bootChange = document.getElementById('bootBrowseChangePath');
        if (bootChange) bootChange.onclick = function () {
          browseState.mode = 'change';
          showRegisterPanel(false);
          setBrowsePathLabel('변경할 폴더를 고르세요');
          loadBrowseRoots().catch(function () {});
        };
        var bootPathCheck = document.getElementById('bootPathCheck');
        if (bootPathCheck) bootPathCheck.onclick = function () {
          var input = document.getElementById('bootPathInput');
          var v = (input && input.value || '').trim();
          if (!v) { setBootErr('경로를 입력해 주세요.'); return; }
          openBrowsePath(v);
        };
        var bootRegPrev = document.getElementById('bootRegPreviewBtn');
        if (bootRegPrev) bootRegPrev.onclick = function () {
          var pathV = (document.getElementById('bootPathInput') && document.getElementById('bootPathInput').value || browseState.path || '').trim();
          var nameV = (document.getElementById('bootRegName') && document.getElementById('bootRegName').value || '').trim();
          var idV = (document.getElementById('bootRegId') && document.getElementById('bootRegId').value || '').trim();
          if (!pathV || !nameV) { setBootErr('폴더와 프로젝트 이름이 필요해요.'); return; }
          setBootErr('');
          var args = { projectName: nameV, workspacePath: pathV };
          if (idV) args.projectId = idV;
          callTool('relay_pm_preview_register_project', args).then(function (prev) {
            var el = document.getElementById('bootRegPreview');
            if (el) {
              el.textContent = '등록 예정 · ' + prev.projectId + ' · ' + prev.workspacePath
                + (prev.git && prev.git.isRepo ? (' · git ' + (prev.git.headSha || 'repo')) : ' · git 아님')
                + ' · 상태 PARTIAL · Worker 0';
            }
            var conf = document.getElementById('bootRegConfirmBtn');
            if (conf) conf.disabled = false;
            boot._regPreview = prev;
          }).catch(function (e) {
            setBootErr('미리보기 실패: ' + String((e && e.message) || e).slice(0, 220));
            var conf = document.getElementById('bootRegConfirmBtn');
            if (conf) conf.disabled = true;
          });
        };
        var bootRegConf = document.getElementById('bootRegConfirmBtn');
        if (bootRegConf) bootRegConf.onclick = function () {
          var pathV = (document.getElementById('bootPathInput') && document.getElementById('bootPathInput').value || browseState.path || '').trim();
          var nameV = (document.getElementById('bootRegName') && document.getElementById('bootRegName').value || '').trim();
          var idV = (document.getElementById('bootRegId') && document.getElementById('bootRegId').value || '').trim();
          if (!pathV || !nameV) { setBootErr('폴더와 프로젝트 이름이 필요해요.'); return; }
          var args = { projectName: nameV, workspacePath: pathV, confirm: true };
          if (idV) args.projectId = idV;
          setBootErr('');
          callTool('relay_pm_register_project', args).then(function (reg) {
            return loadBootProfiles().then(function () {
              boot.selectedId = reg.projectId;
              for (var i = 0; i < boot.profiles.length; i++) {
                if (boot.profiles[i].projectId === reg.projectId) {
                  boot.profile = boot.profiles[i];
                  break;
                }
              }
              var conf = document.getElementById('bootRegConfirmBtn');
              if (conf) conf.disabled = true;
              setBootStep('agents');
              loadBootAssignment(boot.selectedId).then(function () { renderBootAgents(); });
            });
          }).catch(function (e) {
            setBootErr('등록 실패: ' + String((e && e.message) || e).slice(0, 220));
          });
        };
      } catch (eBind) { /* bootstrap controls best-effort */ }

      async function init() {
        try {
          setInitMark('init-start');
          var res = await sendRequest('ui/initialize', {
            protocolVersion: '2026-01-26',
            appInfo: { name: 'agent-relay-pm', version: '1.0.0' },
            appCapabilities: {}
          }, 15000);
          setInitMark('initialized');
          applyTheme(res.hostContext && res.hostContext.theme);
          sendNotification('ui/notifications/initialized', {});
          logLine('initialized');
          hideFallback();
          setStatus('waiting', t('connected'), t('waiting'));
          try {
            preloadSheets(function (failed) {
              if (failed.length) {
                spriteNote = ' · ' + t('spritesFail') + ': ' + failed.join(',');
                setDiag(t('spritesFail') + ': ' + failed.join(','));
                logLine('sprite preload failed: ' + failed.join(','));
              } else {
                spriteNote = ' · ' + t('spritesOk') + ' 8/8';
                setDiag(t('spritesOk') + ' 8/8 · ' + diagTime());
                logLine(t('spritesOk') + ' 8/8');
              }
              try { if (lastDash) renderAgents(lastDash); } catch (e) { /* next poll redraws */ }
            });
          } catch (ePre) { /* sprites best-effort; missing boxes cover failures */ }
          checkVersion();
          var bootShown = false;
          try { bootShown = await maybeStartBootstrap(); } catch (eBoot) { logLine('bootstrap init: ' + eBoot.message); }
          // Pause while the tab is hidden, and catch up once on return. A background chat window should
          // cost nothing: the numbers cannot change what the Founder is looking at if nobody is looking.
          var pollTimer = setInterval(function () {
            if (document.visibilityState === 'hidden') return;
            if (boot.active) return; // zero-execution: do not poll deliveries during wizard
            poll();
          }, POLL_MS);
          try {
            document.addEventListener('visibilitychange', function () {
              if (document.visibilityState === 'visible' && !boot.active) poll();
            });
          } catch (eVis) { /* polling simply keeps its fixed interval */ }
          setInitMark('poll-start');
          if (!bootShown) poll();
        } catch (e) {
          setStatus('fail', t('initFail'), e.message);
          logLine('initialize FAILED: ' + e.message);
          showFallback('위젯 시작 실패', (e && e.message) || 'initialize 실패. 다시 시도 버튼을 눌러주세요.');
        }
      }

      window.addEventListener('message', function (ev) {
        var d = ev.data;
        if (!d) return;
        if (d.method === 'ui/resource-teardown') {
          logLine('view torn down: ' + ((d.params && d.params.reason) || ''));
          if (d.id !== undefined) window.parent.postMessage({ jsonrpc: '2.0', id: d.id, result: {} }, '*');
        }
      });

      try {
        init();
      } catch (eInit) {
        showFallback('위젯 시작 실패', String((eInit && eInit.message) || eInit).slice(0, 300));
      }
    })();
  </script>
</body>
</html>
`;

// The URI is the cache key, so its identity must be the widget's content.
//
// The pipeline is one-way, with no feedback loop:
//
//   1. WIDGET_HTML — the evaluated template, so escapes are resolved exactly as the browser will see
//      them. Hashing the raw source text instead is wrong: the template contains sequences like
//      '[ \\t\\n\\r_-]+' whose source and runtime forms differ, which made the fingerprint disagree
//      with the bytes actually served.
//   2. fingerprint = hash(WIDGET_HTML with every placeholder normalised back to its token)
//   3. URI = ui://agent-relay/pm-widget-<fingerprint>
//   4. pmWidgetHtml() substitutes the URI, asset base and build stamp into the template
//
// Step 2 is what breaks the cycle. __WIDGET_URI__ appears inside the template, so hashing the
// substituted output would feed the URI into its own input. Normalising the placeholders first means
// the fingerprint depends only on the widget's real content, never on the URI derived from it.
//
// BUILD_DATE is substituted after the fingerprint, so two processes serving the same source agree on
// one URI and a clock reading can never look like a content change.
function widgetFingerprintSource(html: string): string {
  return html
    .split('__WIDGET_URI__').join('{{WIDGET_URI}}')
    .split('__ASSET_BASE__').join('{{ASSET_BASE}}')
    .split('__WIDGET_BUILD__').join('{{WIDGET_BUILD}}');
}
const WIDGET_HASH = createHash('sha256').update(widgetFingerprintSource(WIDGET_HTML), 'utf8').digest('hex').slice(0, 8);
const BUILD_DATE = new Date().toISOString().slice(0, 16).replace('T', ' ');
export const PM_WIDGET_RESOURCE_URI = `ui://agent-relay/pm-widget-${WIDGET_HASH}`;
/** The identity the URI is derived from, exposed so callers can assert the two agree. */
export const PM_WIDGET_CONTENT_FINGERPRINT = WIDGET_HASH;
export const PM_WIDGET_RESOURCE_NAME = 'Agent Relay PM';
export const PM_WIDGET_MIME_TYPE = 'text/html;profile=mcp-app';
// Host CSP allowlist (OpenAI Apps SDK / MCP Apps): the widget loads sprite
// images from the public asset base, so its origin must be declared in
// _meta.ui.csp.resourceDomains or the sandbox blocks them.
// ChatGPT has been observed sourcing the legacy openai/widgetCSP key even
// for ui.resourceUri templates, so both keys are emitted (dual-protocol).
export function widgetResourceMeta(assetBase = ''): Record<string, unknown> {
  let origin = 'https://mcp.relay-agent.site';
  try {
    if (assetBase) origin = new URL(assetBase).origin;
  } catch (e) { /* keep default origin */ }
  return {
    ui: { prefersBorder: true, csp: { resourceDomains: [origin], connectDomains: [origin] } },
    'openai/widgetCSP': { resource_domains: [origin], connect_domains: [origin] },
  };
}
export const WIDGET_SPRITE_SHEETS = ['run', 'dig', 'climb', 'qa', 'done', 'blocked', 'sleep', 'idle'];