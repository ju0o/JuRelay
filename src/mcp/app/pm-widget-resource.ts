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
  .card { border:1px solid var(--border); border-radius:10px; padding:14px; }
  .title { font-size:15px; font-weight:700; margin:0 0 4px; display:flex; align-items:center; gap:8px; }
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
  .counts { display:flex; gap:8px; margin:10px 0 4px; }
  .count { flex:1; border:1px solid var(--border); border-radius:8px; padding:8px 10px; text-align:center; }
  .count b { display:block; font-size:20px; }
  .count span { font-size:11px; color: var(--muted); }
  .steps { display:flex; align-items:center; gap:6px; margin:10px 0 4px; font-size:11px; color: var(--muted); }
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
  .dcard .task { color: var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pill { margin-left:auto; font-size:11px; border:1px solid var(--border); border-radius:20px; padding:1px 8px; flex:none; }
  .pill.wait { color: var(--wait); border-color: var(--wait); }
  .pill.doing { color: var(--mut); border-color: var(--mut); }
  .pill.done { color: var(--ok); border-color: var(--ok); }
  .dcard summary { cursor:pointer; }
  .dcard .meta { color: var(--muted); font-size:11px; margin-top:4px; }
  .agents { display:flex; flex-direction:column; gap:8px; margin-top:8px; }
  .agent { display:flex; align-items:center; gap:10px; border:1px solid var(--border);
           border-radius:8px; padding:6px 10px; font-size:12px; }
  .agent svg { flex:none; }
  .agent .who { overflow:hidden; }
  .agent .who b { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .agent .who span { color: var(--muted); font-size:11px; display:block; overflow:hidden;
                     text-overflow:ellipsis; white-space:nowrap; }
  .agent .st { margin-left:auto; flex:none; }
  .remain { margin-top:8px; font-size:12px; color: var(--muted); }
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
  .tabs { display:flex; gap:6px; margin:10px 0 4px; }
  .tabs button { flex:1; border:1px solid var(--border); background:transparent; color:var(--muted);
                 border-radius:8px; padding:6px 4px; font-size:12px; cursor:pointer; }
  .tabs button.on { color:var(--text); border-color:var(--text); font-weight:700; }
  .tabpane { display:none; }
  .tabpane.on { display:block; }
  .crew-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:8px; margin-top:8px; }
  .agents { display:grid; grid-template-columns:repeat(2,111px); gap:8px; justify-content:center; margin:8px 0 2px; }
  .crew-card { border:1px solid var(--border); border-radius:8px; padding:6px; text-align:center; }
  .crew-card .stage { height:150px; display:flex; align-items:flex-end; justify-content:center; overflow:hidden; }
  .crew-card .nm { font-size:12px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .crew-card .md { font-size:10px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .crew-card .rl { font-size:11px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ladder-wrap { display:flex; gap:10px; margin-top:8px; }
  .ladder-stage { position:relative; width:150px; flex:none; }
  .climber { position:absolute; left:50%; transform:translateX(-50%); transition:bottom 1.1s ease; }
  .tasklist { flex:1; font-size:12px; min-width:0; }
  .tasklist .trow { padding:4px 6px; border-radius:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tasklist .trow.done { color:var(--muted); text-decoration:line-through; }
  .tasklist .trow.cur { font-weight:700; border:1px solid var(--border); }
  .goalbadge { display:inline-block; font-size:11px; border:1px solid var(--border);
               border-radius:12px; padding:1px 8px; margin:6px 4px 0 0; }
  .wbs-wrap { margin-top:8px; }
  .track { position:relative; height:225px; border-bottom:2px solid var(--border); margin-top:24px; }
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
      <span class="sub" id="buildTag">__WIDGET_BUILD__</span>
      <span class="lang"><button id="langKo" class="on">한국어</button><button id="langEn">EN</button></span>
    </div>
    <div class="statusline"><span class="dot waiting" id="dot"></span><span class="state" id="status">연결 중…</span></div>
    <div class="sub" id="sub"></div>
    <div class="counts">
      <div class="count"><b id="cWait">0</b><span data-i="wait">대기 중</span></div>
      <div class="count"><b id="cDoing">0</b><span data-i="doing">검토 중</span></div>
      <div class="count"><b id="cDone">0</b><span data-i="done">완료</span></div>
    </div>
    <div class="steps" id="steps">
      <span class="step off" data-s="wait"><i></i><span data-i="sWait">대기</span></span><span class="step-sep"></span>
      <span class="step off" data-s="doing"><i></i><span data-i="sDoing">검토 요청</span></span><span class="step-sep"></span>
      <span class="step off" data-s="done"><i></i><span data-i="sDone">판정 완료</span></span>
    </div>
    <div class="tabs" id="tabs">
      <button data-tab="crew" class="on">Builder</button>
      <button data-tab="ladder"><span data-i="tabLadder">사다리</span></button>
      <button data-tab="wbs">WBS</button>
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
    <details>
      <summary>debug log</summary>
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
      var agentsEl = document.getElementById('agents');
      var remainEl = document.getElementById('remain');
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
        cWaitEl.textContent = String(list.length - doing);
        cDoingEl.textContent = String(doing);
        cDoneEl.textContent = String(doneCount);
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
              modelUnknown: '모델 정보 없음',
              remaining: '남은 일', goals: '목표', noAgents: '일하는 AI 없음' },
        en: { connecting: 'Connecting…', connected: 'Connected', waiting: 'Waiting for Agent result…',
              reviewReady: 'PM review ready', waking: 'Waking GPT…', wakeSent: 'Wake sent — GPT notified',
              wakeFail: 'Wake failed', initFail: 'Initialization failed', wait: 'Waiting', doing: 'Reviewing',
              done: 'Done', sWait: 'Wait', sDoing: 'Review', sDone: 'Judged',
              working: 'working', resting: 'resting', qaDoing: 'inspecting',
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
      var SHEET_W = { crew: 98, crewH: 150, climb: 140, climbH: 214 };
      function applySheet(el, state, w, h) {
        var n = FRAMES[state] || 4;
        var dur = DURS[state] || 1;
        el.style.backgroundImage = 'url(' + ASSET_BASE + '/' + state + '-sheet.png)';
        el.style.backgroundRepeat = 'no-repeat';
        el.style.backgroundSize = (n * w) + 'px ' + h + 'px';
        el.style.setProperty('--sheetW', String(-(n * w)) + 'px');
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        el.style.animation = 'play ' + dur + 's steps(' + n + ') infinite';
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
      // ---- tabs ----
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
        runner.style.top = '75px';
        runner.style.left = 'calc(' + Math.round(frac * 100) + '% - 49px)';
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
      }
      function renderAgents(dash) {
        var agents = (dash && dash.agents) || [];
        if (!agents.length) { agentsEl.innerHTML = '<div class="sub">' + esc(t('noAgents')) + '</div>'; return; }
        var html = '';
        for (var i = 0; i < agents.length; i++) {
          var a = agents[i] || {};
          var sheet = agentSheet(a);
          var line = esc(a.displayName || a.workerId || '?');
          line += ' · ' + esc(a.model || t('modelUnknown'));
          line += ' — ' + esc(agentStateLabel(a));
          if (a.taskTitle) line += ' · ' + esc(a.taskTitle);
          html += '<div class="crew-card"><div class="stage"><div class="crew-sp" data-sheet="' + sheet + '"></div></div>'
            + '<div class="nm" title="' + esc((a.displayName || '') + ' ' + (a.workerId || '')) + '">' + esc(a.displayName || a.workerId || '?') + '</div>'
            + '<div class="md">' + esc(a.model || t('modelUnknown')) + '</div>'
            + '<div class="rl">' + esc(agentStateLabel(a)) + '</div></div>';
        }
        agentsEl.innerHTML = html;
        var stages = agentsEl.querySelectorAll('.crew-sp');
        for (var s = 0; s < stages.length; s++) {
          var sh = stages[s].getAttribute('data-sheet');
          if (sh === 'dig') applySheet(stages[s], 'dig', SHEET_W.crew, SHEET_W.crewH);
          else if (sh === 'qa') applySheet(stages[s], 'qa', SHEET_W.crew, SHEET_W.crewH);
          else applySheet(stages[s], 'idle', SHEET_W.crew, SHEET_W.crewH);
        }
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
            renderAgents(dash);
            try {
              var tl = await callTool('relay_pm_list_tasks', {});
              var taskList = (tl && tl.tasks) || [];
              var goals = (dash && dash.goals) || [];
              renderLadder(taskList, goals);
              renderWbs(taskList, goals);
            } catch (e3) { /* task views best-effort */ }
          } catch (e2) { /* dashboard best-effort; deliveries already shown */ }
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

      init();
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