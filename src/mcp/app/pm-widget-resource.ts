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
  .title { font-size:15px; font-weight:700; margin:0 0 2px; display:flex; align-items:center; gap:8px; }
  #buildTag { font-size:10px; font-weight:400; }
  .lang { margin-left:auto; display:flex; gap:4px; }
  .lang button { font-size:11px; border:1px solid var(--border); background:transparent; color:var(--muted);
                 border-radius:12px; padding:1px 8px; cursor:pointer; }
  .lang button.on { color:var(--text); border-color:var(--text); font-weight:700; }
  .statusline { display:flex; align-items:center; gap:8px; margin:4px 0 10px; font-weight:600; }
  .dot { width:10px; height:10px; border-radius:50%; flex:none; }
  .dot.connected{background:var(--ok);} .dot.waiting{background:var(--wait);} .dot.ready{background:var(--ok);}
  .dot.fail{background:var(--err);} .dot.sent{background:var(--mut);}
  .state { font-size:14px; }
  .sub { color: var(--muted); font-size:12px; }
  /* H2: unified strip [wait][work][done] + Active n/m. Zero segments dim. */
  .strip { display:flex; align-items:stretch; margin:6px 0 2px; border:1px solid var(--border); border-radius:8px; overflow:hidden; }
  .seg { flex:1; padding:5px 2px; text-align:center; min-width:0; }
  .seg + .seg { border-left:1px solid var(--border); }
  .seg b { display:block; font-size:18px; }
  .seg span { font-size:10px; color: var(--muted); white-space:nowrap; }
  .seg.dim { opacity:.38; }
  .active-mini { display:flex; align-items:center; gap:3px; padding:0 10px; font-size:11px; color:var(--muted);
                border-left:1px solid var(--border); white-space:nowrap; }
  .active-mini b { color:var(--text); font-size:13px; }
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
    .crew-sp, .climber, .runner { animation:none !important; }
    .climber, .runner, .track-fill { transition:none !important; }
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
  /* P2: avatar 32x48 (<=10% of card). 3-line card: [avatar] name+pill / role / task. */
  .agents { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin:6px 0 2px; }
  @media (min-width:820px) { .agents { grid-template-columns:repeat(3,1fr); } }
  @media (min-width:1180px) { .agents { grid-template-columns:repeat(4,1fr); } }
  .crew-card { border:1px solid var(--border); border-radius:8px; padding:6px 8px; min-width:0; }
  .crew-top { display:flex; align-items:center; gap:8px; min-width:0; }
  .avatar { flex:none; width:32px; height:48px; display:flex; align-items:flex-end; justify-content:center; overflow:hidden; }
  .who { flex:1; min-width:0; }
  .crew-card .nm { font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; }
  .crew-card .pill { display:inline-block; font-size:11px; font-weight:700; border-radius:12px; padding:1px 10px; margin-top:2px; white-space:nowrap; }
  .crew-card .pill.st-work { background:#0a7d33; color:#fff; }
  .crew-card .pill.st-qa { background:#3b82f6; color:#fff; }
  .crew-card .pill.st-idle { background:transparent; border:1px solid var(--border); color:var(--muted); }
  .crew-card .role { font-size:11px; color:var(--muted); white-space:nowrap; overflow:hidden; margin-top:2px; }
  .crew-card .task1 { font-size:12px; white-space:nowrap; overflow:hidden; margin-top:2px; }
  .crew-missing { width:32px; height:48px; display:flex; align-items:center; justify-content:center;
                 border:1px dashed var(--wait); border-radius:6px; background:var(--panel);
                 font-size:16px; font-weight:700; color:var(--text); }
  .ladder-wrap { display:flex; gap:10px; margin-top:6px; }
  .ladder-stage { position:relative; width:76px; flex:none; }
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
  /* character animations (pure CSS/SVG, no assets) */
  @keyframes swing { 0%,100% { transform:rotate(-18deg); } 50% { transform:rotate(24deg); } }
  @keyframes bob { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-3px); } }
  @keyframes floatz { 0% { transform:translateY(2px); opacity:0; } 30% { opacity:1; } 100% { transform:translateY(-9px); opacity:0; } }
  @keyframes peek { 0%,100% { transform:translateX(0); } 50% { transform:translateX(3px); } }
  .pick { transform-origin: 44px 30px; animation: swing 1.1s ease-in-out infinite; }
  .bob { animation: bob 1.6s ease-in-out infinite; }
  .z1 { animation: floatz 2.4s linear infinite; }
  .z2 { animation: floatz 2.4s linear 0.8s infinite; }
  .z3 { animation: floatz 2.4s linear 1.6s infinite; }
  .magn { animation: peek 2s ease-in-out infinite; }
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
    <div class="title"><span id="appName">Agent Relay</span>
      <span class="lang"><button id="langKo" class="on">한국어</button><button id="langEn">EN</button></span>
    </div>
    <div class="statusline"><span class="dot waiting" id="dot"></span><span class="state" id="status">연결 중…</span></div>
    <div class="sub" id="sub"></div>
    <div class="strip" id="strip">
      <div class="seg" id="segWait"><b id="cWait">0</b><span data-i="wait">대기 중</span></div>
      <div class="seg" id="segDoing"><b id="cDoing">0</b><span data-i="doing">검토 중</span></div>
      <div class="seg" id="segDone"><b id="cDone">0</b><span data-i="done">완료</span></div>
      <div class="active-mini">Active <b id="activeN">0</b>/<span id="activeT">0</span></div>
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
      <div class="agents" id="agents"></div>
      <div class="remain" id="remain"></div>
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
      var cWaitEl = document.getElementById('cWait');
      var cDoingEl = document.getElementById('cDoing');
      var cDoneEl = document.getElementById('cDone');
      var stepsEl = document.getElementById('steps');
      var doneCount = 0;
      var lastDeliveries = [];
      var lastDash = null;
      var agentsEl = document.getElementById('agents');
      var remainEl = document.getElementById('remain');
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
        cWaitEl.textContent = String(nWait);
        cDoingEl.textContent = String(doing);
        cDoneEl.textContent = String(doneCount);
        setSeg('segWait', nWait);
        setSeg('segDoing', doing);
        setSeg('segDone', doneCount);
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
              spriteFail: '이미지 실패', spritesOk: '스프라이트', spritesFail: '스프라이트 실패',
              modelUnknown: '모델 정보 없음',
              remaining: '남은 일', goals: '목표', noAgents: '일하는 AI 없음' },
        en: { connecting: 'Connecting…', connected: 'Connected', waiting: 'Waiting for Agent result…',
              reviewReady: 'PM review ready', waking: 'Waking GPT…', wakeSent: 'Wake sent — GPT notified',
              wakeFail: 'Wake failed', initFail: 'Initialization failed', wait: 'Waiting', doing: 'Reviewing',
              done: 'Done', sWait: 'Wait', sDoing: 'Review', sDone: 'Judged',
              working: 'working', resting: 'resting', qaDoing: 'inspecting',
              spriteFail: 'sprite failed', spritesOk: 'sprites', spritesFail: 'sprites failed',
              modelUnknown: 'model unknown',
              remaining: 'Remaining', goals: 'Goals', noAgents: 'No active AI' },
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
var SHEET_W = { crew: 32, crewH: 48, climb: 64, climbH: 98 };
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
            img.onload = function () { clearTimeout(timer); mark(true); };
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
        applySheet(climber, 'climb', SHEET_W.climb, SHEET_W.climbH);
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
        applySheet(runner, 'run', SHEET_W.crew, SHEET_W.crewH);
        runner.style.top = '48px';
        runner.style.left = 'calc(' + Math.round(frac * 100) + '% - 16px)';
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
      function normalizeAgent(a) {
        var wid = String((a && a.workerId) || '');
        var raw = String((a && (a.displayName || a.workerId)) || '');
        var name = raw;
        var role = null;
        var via = raw.match(/^(.*?) via (.+)$/i);
        if (via) {
          role = mapFirst(NAME_MAP, via[1]) || firstWord(via[1]) || 'Builder';
          name = firstWord(via[2]) || raw;
        } else {
          name = raw.replace(/^(builder|worker|agent) +/i, '');
          var hit = mapFirst(NAME_MAP, name) || mapFirst(NAME_MAP, wid);
          if (hit) name = hit;
          role = mapFirst(ROLE_MAP, name) || mapFirst(ROLE_MAP, wid);
        }
        if (!name) name = 'Agent';
        name = capName(name);
        if (!role) role = /(^|[^a-z])qa([^a-z]|$)/i.test(wid) ? 'QA' : 'Build';
        return { name: name, role: role, full: raw };
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
      function setActive(n, total) {
        try {
          var a = document.getElementById('activeN');
          var b = document.getElementById('activeT');
          if (a) a.textContent = String(n);
          if (b) b.textContent = String(total);
        } catch (e) {}
      }
      function setSeg(id, n) {
        try {
          var el = document.getElementById(id);
          if (el) el.className = 'seg' + (n ? '' : ' dim');
        } catch (e) {}
      }
      function renderAgents(dash) {
        var agents = (dash && dash.agents) || [];
        setBadge('bCrew', agents.length);
        if (!agents.length) { agentsEl.innerHTML = '<div class="sub">' + esc(t('noAgents')) + '</div>'; setActive(0, 0); return; }
        var html = '';
        var active = 0;
        for (var i = 0; i < agents.length; i++) {
          var a = agents[i] || {};
          var norm = normalizeAgent(a);
          var sheet = agentSheet(a);
          if (a.state === 'working' || /qa/i.test(a.workerId || '')) active++;
          var stageInner;
          if (sheetStatus[sheet] === 'fail') {
            // Visible missing-sprite avatar: initial only. Never an empty slot.
            var initial = esc(Array.from(norm.name).slice(0, 1).join('') || '?');
            stageInner = '<div class="crew-missing" title="' + esc(t('spriteFail')) + '">' + initial + '</div>';
          } else {
            stageInner = '<div class="crew-sp" data-sheet="' + sheet + '"></div>';
          }
          var tt = shortTaskTitle(a.taskTitle ? { title: a.taskTitle } : (a.taskId ? { taskId: a.taskId } : null));
          var taskRow = tt.text
            ? '<div class="task1" title="' + esc(tt.full) + '">' + esc(tt.text) + '</div>'
            : '';
          html += '<div class="crew-card"><div class="crew-top"><div class="avatar">' + stageInner + '</div>'
            + '<div class="who"><span class="nm" title="' + esc(norm.full) + '">' + esc(norm.name) + '</span> '
            + '<span class="pill ' + agentPillClass(a) + '">● ' + esc(agentStateLabel(a)) + '</span></div></div>'
            + '<div class="role">' + esc(norm.role) + '</div>'
            + taskRow + '</div>';
        }
        agentsEl.innerHTML = html;
        var stages = agentsEl.querySelectorAll('.crew-sp');
        for (var s = 0; s < stages.length; s++) {
          var sh = stages[s].getAttribute('data-sheet');
          if (sh === 'dig') applySheet(stages[s], 'dig', SHEET_W.crew, SHEET_W.crewH);
          else if (sh === 'qa') applySheet(stages[s], 'qa', SHEET_W.crew, SHEET_W.crewH);
          else applySheet(stages[s], 'idle', SHEET_W.crew, SHEET_W.crewH);
        }
        setActive(active, agents.length);
        var tasks = (dash && dash.tasks) || {};
        var open = (tasks.RUNNING || 0) + (tasks.DISPATCHED || 0) + (tasks.READY || 0) + (tasks.PENDING || 0);
        var goals = (dash && dash.goals) || [];
        var gOpen = 0;
        for (var j = 0; j < goals.length; j++) {
          if (goals[j] && goals[j].status !== 'COMPLETED' && goals[j].status !== 'DONE') gOpen++;
        }
        remainEl.innerHTML = '<b>' + t('remaining') + '</b> ' + open + ' · <b>' + t('goals') + '</b> ' + gOpen;
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
            setDiag('dashboard ok · ' + diagTime());
            try { renderAgents(dash); } catch (eAgents) { logLine('render agents error: ' + eAgents.message); }
            try {
              var tl = await callTool('relay_pm_list_tasks', {});
              var taskList = (tl && tl.tasks) || [];
              var goals = (dash && dash.goals) || [];
              try { renderLadder(taskList, goals); } catch (eL) { logLine('render ladder error: ' + eL.message); }
              try { renderWbs(taskList, goals); } catch (eW) { logLine('render wbs error: ' + eW.message); }
            } catch (e3) { /* task views best-effort */ }
          } catch (e2) {
            setDiag('dashboard 실패: ' + String((e2 && e2.message) || e2).slice(0, 120));
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
                setDiag(t('spritesFail') + ': ' + failed.join(','));
                logLine('sprite preload failed: ' + failed.join(','));
              } else {
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
    ui: { prefersBorder: true, csp: { resourceDomains: [origin] } },
    'openai/widgetCSP': { resource_domains: [origin], connect_domains: [] as string[] },
  };
}
export const WIDGET_SPRITE_SHEETS = ['run', 'dig', 'climb', 'qa', 'done', 'blocked', 'sleep', 'idle'];