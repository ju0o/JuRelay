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
                 border-radius:8px; padding:6px 4px; font-size:12px; cursor:pointer; white-space:nowrap; }
  .tabs button.on { color:var(--text); border-color:var(--text); font-weight:700; }
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
    <div class="env" id="env">
      <div class="env-title">지금 이 환경</div>
      <div class="env-row">
        <div class="env-nums">
          <div class="eseg blue" id="sgAgents"><b id="stAgents">0</b><span>에이전트</span></div>
          <div class="eseg amber" id="sgReview"><b id="stReview">0</b><span>검토중</span></div>
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
      <button data-tab="crew" class="on">Builder<span class="bdg" id="bCrew">0</span></button>
      <button data-tab="ladder"><span data-i="tabLadder">사다리</span><span class="bdg" id="bLadder">0</span></button>
      <button data-tab="wbs">WBS<span class="bdg" id="bWbs">0</span></button>
    </div>
    <div class="tabpane on" id="pane-crew">
      <div class="lanes" id="lanes">
        <div class="lane lane-a">
          <div class="lane-head"><span class="lane-title">검토 중</span><span class="lane-desc">사람이 봐야 함</span><span class="lane-n" id="laneNa">0</span></div>
          <div class="bar"><i id="barA" style="width:100%"></i></div>
          <div class="chips" id="chipsA"></div>
        </div>
        <div class="lane lane-b">
          <div class="lane-head"><span class="lane-title">작업 중</span><span class="lane-desc">지금 코드를 쓰는 중</span><span class="lane-n" id="laneNb">0</span></div>
          <div class="bar"><i id="barB" style="width:0%"></i></div>
          <div class="chips" id="chipsB"></div>
        </div>
        <div class="lane lane-c">
          <div class="lane-head"><span class="lane-title">휴식</span><span class="lane-desc">토큰 대기</span><span class="lane-n" id="laneNc">0</span></div>
          <div class="chips" id="chipsC"></div>
        </div>
      </div>
    </div>
    <div class="tabpane" id="pane-ladder">
      <div id="goalBadges"></div>
      <div class="ladder-wrap">
        <div class="ladder-stage" id="ladderStage"><div class="climber" id="climber"></div></div>
        <div class="tasklist" id="taskList"></div>
      </div>
    </div>
    <div class="tabpane" id="pane-wbs">
      <div class="wbs-wrap"><div class="track" id="track"><div class="track-fill" id="trackFill"></div><div class="runner" id="runner"></div><div class="wgoal" id="wbsGoal"></div></div></div>
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
        showFallback('위젯 로드 실패', String(msg).slice(0, 300));
      });
      window.addEventListener('unhandledrejection', function (ev) {
        var r = ev && ev.reason;
        var msg = (r && r.message) || String(r || 'promise rejected');
        showFallback('위젯 로드 실패', String(msg).slice(0, 300));
      });
      var dotEl = document.getElementById('dot');
      var statusEl = document.getElementById('status');
      var subEl = document.getElementById('sub');
      var logEl = document.getElementById('log');
      var cardsEl = document.getElementById('cards');
      var stepsEl = document.getElementById('steps');
      var doneCount = 0;
      var lastDeliveries = [];
      var lastDash = null;
      var spriteNote = '';
      var stAgentsEl = document.getElementById('stAgents');
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
      var POLL_MS = 1500;

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
        setNum(stReviewEl, doing);
        setNum(stDoneEl, doneCount);
        setSeg('sgReview', doing, 'eseg amber');
        setSeg('sgDone', doneCount, 'eseg green');
        if (headDoneEl) headDoneEl.textContent = String(doneCount);
        if (headTotalEl) headTotalEl.textContent = String(list.length);
        // "무엇을 하고 있나": arrivals first, then review, else waiting.
        try {
          if (stNoteEl) {
            stNoteEl.textContent = nWait > 0
              ? t('envArrived').replace('{n}', String(nWait))
              : (doing > 0 ? t('envReview') : t('envWait'));
          }
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
              working: '일하는 중', resting: '쉬는 중', qaDoing: '검사하는 중',
              spriteFail: '이미지 실패', spriteLoadFail: '스프라이트 로드 실패', spritesOk: '스프라이트', spritesFail: '스프라이트 실패',
              modelUnknown: '모델 정보 없음',
              remaining: '남은 일', goals: '목표', noAgents: '일하는 AI 없음',
              envWait: '대기 중', envReview: 'PM 검토 대기', envArrived: '최종 delivery {n}건 도착' },
        en: { connecting: 'Connecting…', connected: 'Connected', waiting: 'Waiting for Agent result…',
              reviewReady: 'PM review ready', waking: 'Waking GPT…', wakeSent: 'Wake sent — GPT notified',
              wakeFail: 'Wake failed', initFail: 'Initialization failed', wait: 'Waiting', doing: 'Reviewing',
              done: 'Done', sWait: 'Wait', sDoing: 'Review', sDone: 'Judged',
              working: 'working', resting: 'resting', qaDoing: 'inspecting',
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
      function agentSheet(a) {
        if (/qa/i.test(a.workerId || '')) return 'qa';
        if (a.state === 'working') return 'dig';
        return 'idle';
      }
      function agentStateLabel(a) {
        if (/qa/i.test(a.workerId || '')) return t('qaDoing');
        return a.state === 'working' ? t('working') : t('resting');
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
              var panes = ['crew', 'ladder', 'wbs'];
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
      function renderLadder(taskList, goals) {
        var tasks = (taskList || []).slice(0, 20);
        var stage = document.getElementById('ladderStage');
        var list = document.getElementById('taskList');
        var badges = document.getElementById('goalBadges');
        var RH = 78;
        stage.style.height = (tasks.length * RH + 48) + 'px';
        var cur = -1;
        for (var i = 0; i < tasks.length; i++) {
          if (!isDoneTask(tasks[i])) { cur = i; break; }
        }
        if (cur < 0 && tasks.length) cur = tasks.length - 1;
        var climber = document.getElementById('climber');
        if (!applySheet(climber, 'climb', SHEET_W.climb, SHEET_W.climbH)) {
          markSheetMissing(climber, SHEET_W.climb, SHEET_W.climbH, 'climb');
        }
        climber.style.bottom = (16 + Math.max(cur, 0) * RH - 8) + 'px';
        var html = '';
        for (var j = 0; j < tasks.length; j++) {
          var cls = isDoneTask(tasks[j]) ? 'done' : (j === cur ? 'cur' : 'todo');
          html += '<div class="trow ' + cls + '">' + taskTitleOf(tasks[j], j) + '</div>';
        }
        list.innerHTML = html;
        var openTasks = 0;
        for (var q = 0; q < tasks.length; q++) {
          if (!isDoneTask(tasks[q])) openTasks++;
        }
        setBadge('bLadder', openTasks);
        var g = '';
        for (var k = 0; k < (goals || []).length; k++) {
          g += '<span class="goalbadge">' + esc(goals[k].title || goals[k].goalId) + '</span>';
        }
        badges.innerHTML = g;
      }
      function renderWbs(taskList, goals) {
        var tasks = (taskList || []).slice(0, 20);
        var track = document.getElementById('track');
        var fill = document.getElementById('trackFill');
        var runner = document.getElementById('runner');
        var wgoal = document.getElementById('wbsGoal');
        var cur = -1;
        for (var i = 0; i < tasks.length; i++) {
          if (!isDoneTask(tasks[i])) { cur = i; break; }
        }
        if (cur < 0 && tasks.length) cur = tasks.length - 1;
        var frac = tasks.length > 1 ? Math.max(cur, 0) / (tasks.length - 1) : 1;
        fill.style.width = Math.round(frac * 100) + '%';
        if (!applySheet(runner, 'run', RUN_W, RUN_H)) {
          markSheetMissing(runner, RUN_W, RUN_H, 'run');
        }
        runner.style.top = '60px';
        runner.style.left = 'calc(' + Math.round(frac * 100) + '% - 12px)';
        var nodes = '';
        for (var j = 0; j < tasks.length; j++) {
          var done = isDoneTask(tasks[j]);
          nodes += '<span class="wnode' + (done ? ' hit' : '') + '" title="' + taskTitleOf(tasks[j], j)
            + '" style="left:' + Math.round(tasks.length > 1 ? j / (tasks.length - 1) * 100 : 0) + '%"></span>';
        }
        track.querySelectorAll('.wnode').forEach(function (el) { el.remove(); });
        var tmp = document.createElement('div');
        tmp.innerHTML = nodes;
        while (tmp.firstChild) track.appendChild(tmp.firstChild);
        wgoal.textContent = (goals && goals[0] && (goals[0].title || goals[0].goalId)) || '';
        var openGoals = 0;
        for (var gq = 0; gq < (goals || []).length; gq++) {
          var gg = goals[gq];
          if (gg && gg.status !== 'COMPLETED' && gg.status !== 'DONE') openGoals++;
        }
        setBadge('bWbs', openGoals);
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
      function setNum(el, n) {
        try { if (el) el.textContent = String(n); } catch (e) {}
      }
      function setSeg(id, n, base) {
        try {
          var el = document.getElementById(id);
          if (el) el.className = (base || 'seg') + (n ? '' : ' dim');
        } catch (e) {}
      }
      function laneOfAgent(a) {
        if (/qa/i.test((a && a.workerId) || '')) return 'A';
        return (a && a.state) === 'working' ? 'B' : 'C';
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
        var agents = (dash && dash.agents) || [];
        setBadge('bCrew', agents.length);
        setNum(stAgentsEl, agents.length);
        setSeg('sgAgents', agents.length, 'eseg blue');
        var buckets = { A: [], B: [], C: [] };
        for (var i = 0; i < agents.length; i++) {
          var a = agents[i] || {};
          try {
            buckets[laneOfAgent(a)].push(chipHtml(a));
          } catch (e) { /* one bad agent never kills the lane */ }
        }
        var lanes = ['A', 'B', 'C'];
        var boxes = ['chipsA', 'chipsB', 'chipsC'];
        var counts = ['laneNa', 'laneNb', 'laneNc'];
        for (var l = 0; l < lanes.length; l++) {
          try {
            var box = document.getElementById(boxes[l]);
            if (box) box.innerHTML = buckets[lanes[l]].join('');
          } catch (e) {}
          setLaneCount(counts[l], buckets[lanes[l]].length);
        }
        paintLaneAvatars(document);
        var goals = (dash && dash.goals) || [];
        var gTotal = goals.length;
        var gOpen = 0;
        for (var j = 0; j < goals.length; j++) {
          if (goals[j] && goals[j].status !== 'COMPLETED' && goals[j].status !== 'DONE') gOpen++;
        }
        setNum(stGoalsEl, gTotal);
        setSeg('sgGoals', gTotal, 'eseg muted');
        setBadge('bWbs', gOpen);
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
          ['laneNa', 'laneNb', 'laneNc'].forEach(function (id) {
            try {
              var n = parseInt((document.getElementById(id) || {}).textContent || '0', 10);
              if (!isNaN(n)) laneSum += n;
            } catch (e) {}
          });
          var stripN = 0;
          try { stripN = parseInt((document.getElementById('stAgents') || {}).textContent || '0', 10); } catch (e) {}
          if (isNaN(stripN)) stripN = 0;
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
          var lines = [
            'buildTag: ' + build.trim(),
            'avatar loaded: ' + (av.length ? av.join(' ') : 'none yet'),
            'lane count: ' + lanes,
            'env strip exists: ' + envOk,
            'count consistency: strip ' + stripN + ' vs lanes ' + laneSum + ' -> ' + (stripN === laneSum ? 'OK' : 'MISMATCH'),
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
              try { renderLadder(taskList, goals); } catch (eL) { logLine('render ladder error: ' + eL.message); }
              try { renderWbs(taskList, goals); } catch (eW) { logLine('render wbs error: ' + eW.message); }
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
          var res = await sendRequest('ui/initialize', {
            protocolVersion: '2026-01-26',
            appInfo: { name: 'agent-relay-pm', version: '1.0.0' },
            appCapabilities: {}
          }, 15000);
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
          setInterval(poll, POLL_MS);
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

const WIDGET_HASH = createHash('sha256').update(WIDGET_HTML, 'utf8').digest('hex').slice(0, 8);
const BUILD_DATE = new Date().toISOString().slice(0, 16).replace('T', ' ');
export const PM_WIDGET_RESOURCE_URI = `ui://agent-relay/pm-widget-${WIDGET_HASH}`;
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