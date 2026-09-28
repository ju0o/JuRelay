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
 */

export const PM_WIDGET_RESOURCE_URI = 'ui://agent-relay/pm-widget-v4';
export const PM_WIDGET_RESOURCE_NAME = 'Agent Relay PM';
export const PM_WIDGET_MIME_TYPE = 'text/html;profile=mcp-app';
export const PM_WIDGET_RESOURCE_VERSION = '2026-09-28-v4';

export function pmWidgetHtml(): string {
  return WIDGET_HTML;
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
</style>
</head>
<body>
  <div class="card">
    <div class="title"><span id="appName">Agent Relay</span>
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
    <div class="agents" id="agents"></div>
    <div class="remain" id="remain"></div>
    <div class="cards" id="cards"></div>
    <details>
      <summary>debug log</summary>
      <div id="log"></div>
    </details>
  </div>
  <script>
    (function () {
      'use strict';
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
              remaining: '남은 일', goals: '목표', noAgents: '일하는 AI 없음' },
        en: { connecting: 'Connecting…', connected: 'Connected', waiting: 'Waiting for Agent result…',
              reviewReady: 'PM review ready', waking: 'Waking GPT…', wakeSent: 'Wake sent — GPT notified',
              wakeFail: 'Wake failed', initFail: 'Initialization failed', wait: 'Waiting', doing: 'Reviewing',
              done: 'Done', sWait: 'Wait', sDoing: 'Review', sDone: 'Judged',
              working: 'working', resting: 'resting', qaDoing: 'inspecting',
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
      // ---- characters (inline SVG, CSS-animated, no assets) ----
      function charSvg(kind) {
        var head = '<circle cx="22" cy="12" r="7" fill="#7a5af8"/>';
        if (kind === 'working') {
          return '<svg width="46" height="42" viewBox="0 0 60 50">' + head
            + '<rect x="15" y="20" width="14" height="18" rx="4" fill="#7a5af8"/>'
            + '<g class="pick"><line x1="46" y1="32" x2="30" y2="14" stroke="#b26a00" stroke-width="3"/>'
            + '<line x1="30" y1="14" x2="24" y2="24" stroke="#888" stroke-width="2"/></g>'
            + '<line x1="6" y1="42" x2="56" y2="42" stroke="#888" stroke-width="2"/></svg>';
        }
        if (kind === 'qa') {
          return '<svg width="46" height="42" viewBox="0 0 60 50" class="bob">' + head
            + '<rect x="15" y="20" width="14" height="18" rx="4" fill="#0a7d33"/>'
            + '<g class="magn"><rect x="34" y="22" width="12" height="15" rx="1" fill="#fff" stroke="#555"/>'
            + '<circle cx="44" cy="18" r="6" fill="none" stroke="#555" stroke-width="2"/>'
            + '<line x1="48" y1="22" x2="53" y2="27" stroke="#555" stroke-width="2"/></g></svg>';
        }
        if (kind === 'done') {
          return '<svg width="46" height="42" viewBox="0 0 60 50">'
            + '<rect x="14" y="30" width="32" height="8" rx="1" fill="#0a7d33"/>'
            + '<rect x="17" y="21" width="32" height="8" rx="1" fill="#0a7d33" opacity="0.75"/>'
            + '<rect x="20" y="12" width="32" height="8" rx="1" fill="#0a7d33" opacity="0.5"/></svg>';
        }
        return '<svg width="46" height="42" viewBox="0 0 60 50">' + head
          + '<rect x="15" y="26" width="18" height="12" rx="4" fill="#8a6d00"/>'
          + '<text x="40" y="14" font-size="10" fill="#8a6d00" class="z1">z</text>'
          + '<text x="46" y="22" font-size="12" fill="#8a6d00" class="z2">z</text>'
          + '<text x="36" y="30" font-size="9" fill="#8a6d00" class="z3">z</text></svg>';
      }
      function agentKind(a) {
        if (/qa/i.test(a.workerId || '')) return 'qa';
        return a.state === 'working' ? 'working' : 'idle';
      }
      function agentStateLabel(a) {
        if (/qa/i.test(a.workerId || '')) return t('qaDoing');
        return a.state === 'working' ? t('working') : t('resting');
      }
      function renderAgents(dash) {
        var agents = (dash && dash.agents) || [];
        if (!agents.length) { agentsEl.innerHTML = '<div class="sub">' + esc(t('noAgents')) + '</div>'; return; }
        var html = '';
        for (var i = 0; i < agents.length; i++) {
          var a = agents[i] || {};
          var kind = agentKind(a);
          var line = esc(a.displayName || a.workerId || '?');
          if (a.model) line += ' · ' + esc(a.model);
          line += ' — ' + esc(agentStateLabel(a));
          if (a.taskTitle) line += ' · ' + esc(a.taskTitle);
          html += '<div class="agent">' + charSvg(kind)
            + '<div class="who"><b>' + line + '</b>'
            + '<span>' + esc(a.taskId || '') + '</span></div>'
            + '<span class="st">' + (kind === 'working' || kind === 'qa' ? '●' : '○') + '</span></div>';
        }
        agentsEl.innerHTML = html;
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
          try {
            var dash = await callTool('relay_pm_get_dashboard', {});
            renderAgents(dash);
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
          setStatus('waiting', t('connected'), t('waiting'));
          setInterval(poll, POLL_MS);
          poll();
        } catch (e) {
          setStatus('fail', t('initFail'), e.message);
          logLine('initialize FAILED: ' + e.message);
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