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
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#121212; --panel:#1e1e1e; --text:#e8e8e8; --muted:#9a9a9a; --border:#3a3a3a; }
  }
  body[data-theme="dark"] { --bg:#121212; --panel:#1e1e1e; --text:#e8e8e8; --muted:#9a9a9a; --border:#3a3a3a; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin:0; padding:14px; font-size:14px;
         background: var(--bg); color: var(--text); }
  .card { border:1px solid var(--border); border-radius:10px; padding:10px 12px; }
  /* A안 헤더 1줄 */
  .hdr { display:flex; align-items:center; gap:8px; margin:0 0 2px; }
  .dot { width:9px; height:9px; border-radius:50%; flex:none; }
  .pulse { animation:pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.35; } }
  .dot.connected{background:var(--ok);} .dot.waiting{background:var(--wait);} .dot.ready{background:var(--ok);}
  .dot.fail{background:var(--err);} .dot.sent{background:var(--mut);}
  .app { font-size:15px; font-weight:700; }
  .hpill { font-size:11px; border:1px solid var(--border); border-radius:12px; padding:1px 9px; color:var(--muted); white-space:nowrap; }
  .hfrac { margin-left:auto; font-size:12px; color:var(--muted); white-space:nowrap; }
  .hfrac b { color:var(--text); font-size:14px; }
  .subhide { display:none; }
  .lang { display:flex; gap:4px; }
  .lang button { font-size:11px; border:1px solid var(--border); background:transparent; color:var(--muted);
                 border-radius:12px; padding:1px 8px; cursor:pointer; }
  .lang button.on { color:var(--text); border-color:var(--text); font-weight:700; }
  .sub { color: var(--muted); font-size:12px; }
  /* A안 "지금 이 환경" 스트립 */
  .env { border:1px solid var(--border); border-radius:10px; padding:8px 10px; margin:6px 0 2px; }
  .env-title { font-size:12px; font-weight:700; margin-bottom:4px; }
  .env-row { display:flex; align-items:center; gap:10px; }
  .env-nums { display:flex; flex:1; gap:12px; min-width:0; }
  .eseg b { display:block; font-size:21px; font-weight:650; line-height:1.1; }
  .eseg span { font-size:10px; color:var(--muted); white-space:nowrap; }
  .eseg.blue b { color:#4a9eff; } .eseg.amber b { color:#f0b429; }
  .eseg.green b { color:#2ea86a; } .eseg.muted b { color:#5c6470; }
  .eseg.dim { opacity:.38; }
  .env-note { font-size:11px; color:var(--muted); white-space:nowrap; margin-left:auto;
              border:1px solid var(--border); border-radius:8px; padding:4px 8px; }
  @media (max-width:480px) { .env-row { flex-wrap:wrap; } .env-note { margin-left:0; } }
  /* A안 레인 3개 */
  .lanes { display:flex; flex-direction:column; gap:8px; margin:6px 0 2px; }
  .lane { background:#161a21; border:1px solid #262c37; border-radius:10px; padding:9px 11px; }
  .lane-head { display:flex; align-items:baseline; gap:8px; }
  .lane-title { font-size:12px; font-weight:700; }
  .lane-a .lane-title { color:#f0b429; } .lane-b .lane-title { color:#4a9eff; } .lane-c .lane-title { color:#8b7bd8; }
  .lane-a { background:#1e1a12; border-color:#5a4a1e; }
  .lane-b { background:#141d29; border-color:#2c4a6e; }
  .lane-c { background:#161a21; border-color:#3d3466; }
  /* F1 pipeline flow */
  .pipe { display:flex; flex-wrap:wrap; align-items:stretch; gap:4px; margin:6px 0 2px; }
  .pnode { flex:1; background:#161a21; border:1px solid #262c37; border-radius:8px; padding:4px 2px; text-align:center; min-width:0; }
  .pnode b { display:block; font-size:12px; }
  .pnode span { font-size:10px; color:var(--muted); white-space:nowrap; }
  /* QA wait is secondary information: dimmer than the review count so the eye reads "4 review" first.
     It stays hidden entirely when nothing is waiting, so a healthy pipeline looks unchanged. */
  .pnode .pwait { color:var(--muted); opacity:.62; margin-left:4px; }
  .pnode .pwait:empty { display:none; }
  /* One card per real task, titled in plain Korean. The model name is tooltip-only: it is debugging
     detail, never something the Founder has to read on the surface. */
  .livecards { display:flex; flex-direction:column; gap:3px; margin-top:4px; }
  .livecard { display:flex; align-items:baseline; gap:6px; padding:4px 6px; border-radius:6px;
              background:#12161c; border:1px solid #232a34; min-width:0; }
  .livecard .lt { font-size:11px; color:#e8ecf2; flex:1; min-width:0; }
  .livecard .lr { font-size:9px; color:var(--muted); opacity:.7; flex:none; }
  .livecard .lr:empty { display:none; }
  .livecard .ldead { color:#f0b429; font-size:9px; flex:none; }
  .live-empty { font-size:11px; color:var(--muted); padding:4px 2px; }
  .edge { align-self:center; color:var(--muted); font-size:12px; flex:none; }
  .ploop { flex-basis:100%; text-align:center; font-size:10px; color:var(--muted); margin-top:2px; }
  .ploop.hot { color:#f0b429; font-weight:700; }
  .lane-empty { font-size:11px; color:var(--muted); padding:4px 2px; }
  .lane-desc { font-size:10px; color:var(--muted); }
  .lane-n { margin-left:auto; font-size:14px; font-weight:700; }
  .bar { height:3px; border-radius:2px; background:#262c37; margin:6px 0; overflow:hidden; }
  .bar i { display:block; height:100%; border-radius:2px; transition:width 1s ease; }
  .lane-a .bar i { background:#f0b429; } .lane-b .bar i { background:#4a9eff; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chip { display:flex; align-items:center; gap:6px; min-height:34px; border:1px solid #262c37;
          border-radius:6px; padding:2px 8px 2px 2px; min-width:0; max-width:100%; }
  .cav { flex:none; width:20px; height:30px; display:flex; align-items:flex-end; justify-content:center; overflow:hidden; }
  .cav-miss { width:20px; height:30px; display:flex; align-items:center; justify-content:center;
             border:1px dashed var(--wait); border-radius:4px; font-size:11px; font-weight:700;
             color:var(--text); background:var(--panel); flex:none; }
  .ctx { min-width:0; }
  .ctx b { display:block; font-size:11px; font-weight:600; white-space:nowrap; overflow:hidden; }
  .ctx i { display:block; font-style:normal; font-size:10px; color:var(--muted); white-space:nowrap; overflow:hidden; }
  .steps { display:flex; align-items:center; gap:6px; margin:6px 0 2px; font-size:11px; color: var(--muted); }
  .step { display:flex; align-items:center; gap:4px; }
  .step i { width:9px; height:9px; border-radius:50%; background: var(--border); flex:none; }
  .step.on i { background: var(--ok); }
  .step.doing i { background: var(--wait); }
  .step.off { opacity:.55; }
  .step-sep { flex:1; height:1px; background: var(--border); min-width:8px; }
  .cards { display:flex; flex-direction:column; gap:8px; margin-top:8px; }
  .dcard { border:1px solid var(--border); border-radius:8px; padding:8px 10px; font-size:12px; }
  .dcard .row { display:flex; align-items:center; gap:8px; }
  .dcard .id { font-weight:700; }
  .dcard .task { color: var(--muted); overflow:hidden; white-space:nowrap; }
  .pill { margin-left:auto; font-size:11px; border:1px solid var(--border); border-radius:20px; padding:1px 8px; flex:none; }
  .pill.wait { color: var(--wait); border-color: var(--wait); }
  .pill.doing { color: var(--mut); border-color: var(--mut); }
  .pill.done { color: var(--ok); border-color: var(--ok); }
  .dcard summary { cursor:pointer; }
  .dcard .meta { color: var(--muted); font-size:11px; margin-top:4px; }
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
  .tabs { display:flex; gap:6px; margin:8px 0 2px; }
  .tabs button { flex:1; border:1px solid var(--border); background:transparent; color:var(--muted);
                 border-radius:8px; padding:6px 4px; font-size:12px; cursor:pointer; white-space:nowrap; flex:none; }
  .tabs button.on { color:var(--text); border-color:var(--text); font-weight:700; background:var(--panel); }
  @media (max-width:480px) { .tabs { overflow-x:auto; } }
  /* v6 control tower */
  .nowcard { border:1px solid var(--border); border-radius:10px; padding:8px 10px; margin:6px 0 2px; }
  .now-top { display:flex; align-items:center; gap:8px; font-size:14px; font-weight:700; }
  .now-top .hpill { margin-left:auto; }
  .now-pm { font-size:11px; color:var(--muted); margin-top:2px; }
  .now-arr { font-size:12px; font-weight:600; margin-top:2px; }
  .tasksum { border:1px solid var(--border); border-radius:10px; padding:8px 10px; margin:6px 0; }
  .tasksum-top { display:flex; font-size:12px; } .tasksum-top b { margin-left:auto; }
  .bar3 { display:flex; height:6px; border-radius:3px; background:#262c37; margin:6px 0; overflow:hidden; }
  .bar3 i { display:block; height:100%; }
  .bar3 .bdone { background:#2ea86a; } .bar3 .breview { background:#f0b429; } .bar3 .bleft { background:#3a4250; }
  .taskcounts { display:flex; gap:12px; font-size:11px; color:var(--muted); }
  .taskcounts b { font-size:13px; }
  .tc-done b { color:#2ea86a; } .tc-review b { color:#f0b429; }
  .taskrows { display:flex; flex-direction:column; gap:6px; margin-top:6px; }
  .trow { display:flex; align-items:center; gap:8px; border:1px solid var(--border); border-radius:8px; padding:6px 8px; font-size:12px; }
  .trow .tid { font-size:10px; font-family:ui-monospace,Menlo,monospace; color:var(--muted); flex:none; }
  .trow .tti { flex:1; min-width:0; white-space:nowrap; overflow:hidden; }
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
      <span class="hpill" id="status">PM 대기</span>
      <span class="hfrac"><b id="headDone">0</b> / <span id="headTotal">0</span></span>
      <span class="lang"><button id="langKo" class="on">한국어</button><button id="langEn">EN</button></span>
      <span id="sub" class="subhide"></span>
    </div>
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
      <div class="pipe" id="pipe">
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
    <div class="cards" id="cards"></div>
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
      // No judgment here — identity (deliveryId/taskId/kind) only.
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
          html += '<details class="dcard"><summary><span class="row">'
            + '<span class="id">…' + esc(shortId(d.deliveryId)) + '</span>'
            + '<span class="task">' + esc(d.taskId || d.kind || 'delivery') + '</span>'
            + '<span class="pill ' + pill + '">' + label + '</span>'
            + '</span></summary>'
            + '<div class="meta">delivery ' + esc(d.deliveryId)
            + (d.createdAt ? '<br>생성 ' + esc(d.createdAt) : '') + '</div></details>';
        }
        cardsEl.innerHTML = html;
        var nWait = list.length - doing;
        pipeNWait = nWait;
        pipeDoing = doing;
        updatePipe();
        setNum(stReviewEl, doing);
        setNum(stDoneEl, doneCount);
        setSeg('sgReview', doing, 'eseg amber');
        setSeg('sgDone', doneCount, 'eseg green');
        setNum(headDoneEl, doneCount);
        if (headTotalEl) headTotalEl.textContent = String(list.length);   // list.length is always a number
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
              done: '완료', sWait: '대기', sDoing: '검토 요청', sDone: '판정 완료',
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
              done: 'Done', sWait: 'Wait', sDoing: 'Review', sDone: 'Judged',
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
      var SHEET_W = { crew: 20, crewH: 30, climb: 48, climbH: 74 };
      var RUN_W = 24, RUN_H = 36;
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
        return /qa/i.test(a.workerId || '') ? 'qa' : 'worker';
      }
      function isActive(a) {
        return a.state === 'working' || agentRole(a) === 'qa';
      }
      function activeAgents(list) {
        return (list || []).filter(isActive);
      }
      function agentSheet(a) {
        return agentRole(a) === 'qa' ? 'qa' : 'dig';
      }
      function agentStateLabel(a) {
        return agentRole(a) === 'qa' ? t('qaDoing') : t('working');
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
      function renderTaskTab(taskList) {
        var tasks = (taskList || []).slice(0, 30);
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
          var s2 = taskStatus(tasks[j]);
          html += '<div class="trow st-' + s2 + (j === cur ? ' cur' : '') + '">'
            + '<span class="tid">' + esc((tasks[j] && tasks[j].taskId) || ('T' + j)) + '</span>'
            + '<span class="tti" title="' + taskTitleOf(tasks[j], j) + '">' + taskTitleOf(tasks[j], j) + '</span>'
            + '<span class="tst">' + esc(taskStatusLabel(s2)) + '</span></div>';
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
        var avatar;
        if (sheetStatus[sheet] === 'fail') {
          var initial = esc(Array.from(norm.name).slice(0, 1).join('') || '?');
          avatar = '<span class="cav-miss" title="' + esc(t('spriteLoadFail') + ': ' + sheet) + '">' + initial + '</span>';
        } else {
          avatar = '<span class="cav"><span class="crew-sp" data-sheet="' + sheet + '"></span></span>';
        }
        var taskTip = (a.taskTitle || a.taskId) ? ' | ' + (a.taskTitle || a.taskId) : '';
        return '<span class="chip" title="' + esc(norm.full + taskTip) + '">' + avatar
          + '<span class="ctx"><b>' + esc(norm.name) + '</b><i>' + esc(norm.role) + '</i></span></span>';
      }
      function paintLaneAvatars(root) {
        try {
          var stages = (root || document).querySelectorAll('.crew-sp');
          for (var s = 0; s < stages.length; s++) {
            var sh = stages[s].getAttribute('data-sheet');
            if (sh === 'dig') applySheet(stages[s], 'dig', SHEET_W.crew, SHEET_W.crewH);
            else if (sh === 'qa') applySheet(stages[s], 'qa', SHEET_W.crew, SHEET_W.crewH);
            else applySheet(stages[s], 'idle', SHEET_W.crew, SHEET_W.crewH);
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
          try {
            var dash = await callTool('relay_pm_get_dashboard', {});
            lastDash = dash;
            setDiag('dashboard ok · ' + diagTime() + spriteNote);
            try { renderAgents(dash); } catch (eAgents) { logLine('render agents error: ' + eAgents.message); }
            try {
              var tl = await callTool('relay_pm_list_tasks', {});
              var taskList = (tl && tl.tasks) || [];
              var goals = (dash && dash.goals) || [];
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
          // Pause while the tab is hidden, and catch up once on return. A background chat window should
          // cost nothing: the numbers cannot change what the Founder is looking at if nobody is looking.
          var pollTimer = setInterval(function () {
            if (document.visibilityState === 'hidden') return;
            poll();
          }, POLL_MS);
          try {
            document.addEventListener('visibilitychange', function () {
              if (document.visibilityState === 'visible') poll();
            });
          } catch (eVis) { /* polling simply keeps its fixed interval */ }
          setInitMark('poll-start');
          poll();
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