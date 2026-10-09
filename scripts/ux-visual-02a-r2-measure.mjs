#!/usr/bin/env node
/**
 * UX-VISUAL-02A-R2 local visual measure (Chrome headless).
 * Measures #tpRun vs .taskprev bounding boxes at 320/380 and path-reveal open/close.
 * ChatGPT host remains NOT_PROVEN until Aside Host QA.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repo, '.agent-relay/cert/ux-visual-02a-r2');
mkdirSync(outDir, { recursive: true });

const distMod = await import(path.join(repo, 'dist/server/mcp/app/pm-widget-resource.js'));
const fullHtml = distMod.pmWidgetHtml('https://example.invalid/w');

function chromeBin() {
  for (const c of ['google-chrome', 'chromium', 'chromium-browser']) {
    const r = spawnSync('which', [c], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  throw new Error('chrome not found');
}

function extractStyle(html) {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error('no style block');
  return m[1];
}

function fixtureHtml(width, theme, opts = {}) {
  const style = extractStyle(fullHtml);
  const longPath = '/home/skkse12/Desktop/Projects/Core/JuControler';
  const longScope = '/home/skkse12/Desktop/Projects/Core/JuControler/src/backend';
  const projectName = 'JuControler';
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=${width}, initial-scale=1" />
<style>
${style}
html, body { margin:0; padding:0; }
/* Force narrow widget panel width (Chrome headless ignores small --window-size; container queries use .card). */
#card { width:${width}px; max-width:${width}px; margin:10px; padding:8px 10px; }
#measureOut { font-family:monospace; font-size:11px; white-space:pre-wrap; margin:12px 10px; border:1px dashed #888; padding:8px; max-width:${width}px; }
</style>
</head>
<body data-theme="${theme}">
  <div class="card" id="card">
    <div class="taskprev" id="pdTaskPrev" aria-label="Task 미리보기">
      <h3>시작 전 확인</h3>
      <div class="line"><b>프로젝트</b><span id="tpProject">${projectName} · jucontroller</span></div>
      <div class="line"><b>컴퓨터</b><span id="tpComputer">ASUS</span></div>
      <div class="line"><b>작업 폴더</b>
        <details class="path-reveal" id="tpWorkspaceReveal">
          <summary>
            <span class="path-summary" id="tpWorkspace">/home/skkse12/…/JuControler</span>
            <span class="path-toggle path-toggle-open">전체 경로 보기</span>
            <span class="path-toggle path-toggle-close">경로 접기</span>
          </summary>
          <code class="path-full" id="tpWorkspaceFull">${longPath}</code>
        </details>
      </div>
      <div class="line"><b>Goal</b><span id="tpGoal">GOAL-0026</span></div>
      <div class="line"><b>Task</b><span id="tpTask">TASK-0089</span></div>
      <div class="line"><b>범위</b>
        <details class="path-reveal" id="tpScopeReveal">
          <summary>
            <span class="path-summary" id="tpScope">/home/skkse12/…/backend</span>
            <span class="path-toggle path-toggle-open">전체 경로 보기</span>
            <span class="path-toggle path-toggle-close">경로 접기</span>
          </summary>
          <code class="path-full" id="tpScopeFull">${longScope}</code>
        </details>
      </div>
      <div class="row" id="tpActionRow">
        <button type="button" id="tpCancelPrep">작업 준비 취소</button>
        <button type="button" id="tpCancel">닫기</button>
        <button type="button" class="primary" id="tpRun" ${opts.runEnabled ? '' : 'disabled'}>작업 시작</button>
      </div>
    </div>
    <div class="boot-list" id="bootProjectList" role="listbox" style="margin-top:16px">
      <div class="boot-card sel" role="option" aria-selected="true" tabindex="0">
        <span class="bn">${projectName}</span>
        <span class="bid">jucontroller · ASUS</span>
        <details class="path-reveal" id="bootPathReveal">
          <summary>
            <span class="bp">/home/skkse12/…/JuControler</span>
            <span class="path-toggle path-toggle-open">전체 경로 보기</span>
            <span class="path-toggle path-toggle-close">경로 접기</span>
          </summary>
          <code class="path-full">${longPath}</code>
        </details>
        <span class="spill ok">CONFIGURED · 준비됨 · 작업 가능</span>
      </div>
    </div>
  </div>
  <pre id="measureOut"></pre>
  <script>
    function box(el) {
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
               text: (el.innerText || el.textContent || '').trim() };
    }
    function runMeasure(tag) {
      var run = document.getElementById('tpRun');
      var panel = document.getElementById('pdTaskPrev');
      var card = document.getElementById('card');
      var bp = document.querySelector('.boot-card .bp');
      var bn = document.querySelector('.boot-card .bn');
      var ws = document.getElementById('tpWorkspace');
      var wsFull = document.getElementById('tpWorkspaceFull');
      var rb = box(run);
      var pb = box(panel);
      var cb = box(card);
      var clipped = !!(rb && pb && (rb.right > pb.right + 0.5 || rb.left < pb.left - 0.5 || rb.right > cb.right + 0.5));
      var hOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
        || document.body.scrollWidth > document.body.clientWidth + 1;
      var row = document.getElementById('tpActionRow');
      var rowCs = row ? getComputedStyle(row) : null;
      var runCs = run ? getComputedStyle(run) : null;
      var cancel = document.getElementById('tpCancelPrep');
      var cancelB = box(cancel);
      var cardW = card ? card.getBoundingClientRect().width : 0;
      return {
        tag: tag,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        cardWidth: cardW,
        mq380: window.matchMedia('(max-width:380px)').matches,
        narrowPanel: cardW > 0 && cardW <= 380,
        rowFlexDirection: rowCs && rowCs.flexDirection,
        runComputedWidth: runCs && runCs.width,
        run: rb,
        cancelPrep: cancelB,
        panel: pb,
        card: cb,
        runFullyVisible: !clipped && !!(rb && rb.w > 0 && rb.h >= 44),
        runTextComplete: !!(rb && rb.text.indexOf('작업 시작') === 0 && rb.text.indexOf('작업 시작') >= 0 && /작업 시작/.test(rb.text)),
        secondaryTextComplete: !!(cancelB && /작업 준비 취소/.test(cancelB.text)),
        runText: rb && rb.text,
        runMinHeightOk: !!(rb && rb.h >= 44),
        runNearFullWidth: !!(rb && pb && rb.w >= pb.w * 0.85),
        clippedVsPanel: clipped,
        horizontalOverflow: hOverflow,
        pathSummary: ws && ws.textContent,
        pathFull: wsFull && wsFull.textContent,
        pathRevealOpen: !!(document.getElementById('tpWorkspaceReveal') || {}).open,
        bootName: bn && bn.textContent,
        bootPathSummary: bp && bp.textContent,
        bootNameHasMidBreak: bn ? /JuCont(?!roler)/.test(bn.innerText) : null
      };
    }
    var results = {};
    results.closed = runMeasure('closed');
    document.getElementById('tpWorkspaceReveal').open = true;
    document.getElementById('tpScopeReveal').open = true;
    document.getElementById('bootPathReveal').open = true;
    results.opened = runMeasure('opened');
    document.getElementById('tpWorkspaceReveal').open = false;
    document.getElementById('tpScopeReveal').open = false;
    document.getElementById('bootPathReveal').open = false;
    results.reclosed = runMeasure('reclosed');
    document.getElementById('measureOut').textContent = JSON.stringify(results, null, 2);
    document.title = 'MEASURE_OK';
  </script>
</body>
</html>`;
}

function measureViewport(width, theme) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ux02ar2-'));
  try {
    const htmlPath = path.join(dir, `fix-${width}-${theme}.html`);
    const shotPath = path.join(outDir, `${theme}-${width}.png`);
    const fixturePath = path.join(outDir, `fixture-${width}-${theme}.html`);
    const html = fixtureHtml(width, theme);
    writeFileSync(htmlPath, html, 'utf8');
    writeFileSync(fixturePath, html, 'utf8');
    const chrome = chromeBin();
    const chromeArgs = [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${width},1400`,
    ];
    const shot = spawnSync(chrome, [
      ...chromeArgs,
      `--screenshot=${shotPath}`,
      pathToFileURL(htmlPath).href,
    ], { encoding: 'utf8', timeout: 30000 });
    if (shot.status !== 0) {
      throw new Error('screenshot failed: ' + (shot.stderr || shot.stdout || shot.status));
    }
    const dump = spawnSync(chrome, [
      ...chromeArgs,
      '--virtual-time-budget=5000',
      '--run-all-compositor-stages-before-draw',
      '--dump-dom',
      pathToFileURL(htmlPath).href,
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
    if (dump.status !== 0) {
      throw new Error('dump-dom failed: ' + (dump.stderr || dump.status));
    }
    const m = dump.stdout.match(/<pre id="measureOut">([\s\S]*?)<\/pre>/);
    if (!m) throw new Error('measureOut missing in dump for ' + width + ' ' + theme);
    const decoded = m[1]
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    const data = JSON.parse(decoded);
    return { width, theme, shotPath: path.relative(repo, shotPath), measure: data, chromeOk: true };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cases = [
  [320, 'light'], [320, 'dark'],
  [380, 'light'], [380, 'dark'],
  [720, 'light'], [720, 'dark'],
];

const all = [];
for (const [w, t] of cases) {
  const r = measureViewport(w, t);
  all.push(r);
  console.log(JSON.stringify({
    w, t,
    cardW: r.measure.closed.cardWidth,
    flexDir: r.measure.closed.rowFlexDirection,
    runW: r.measure.closed.run && r.measure.closed.run.w,
    runNearFull: r.measure.closed.runNearFullWidth,
    secOk: r.measure.closed.secondaryTextComplete,
    clipped: r.measure.closed.clippedVsPanel,
    hOverflow: r.measure.closed.horizontalOverflow,
    pathOpenFull: r.measure.opened.pathFull,
    shot: r.shotPath,
  }));
}

const summary = {
  task: 'UX-VISUAL-02A-R2',
  fingerprint: distMod.PM_WIDGET_CONTENT_FINGERPRINT,
  uri: distMod.PM_WIDGET_RESOURCE_URI,
  hostQa: 'NOT_PROVEN',
  cases: all.map((c) => ({
    width: c.width,
    theme: c.theme,
    shot: c.shotPath,
    viewport: c.measure.closed.viewport,
    cardWidth: c.measure.closed.cardWidth,
    narrowPanel: c.measure.closed.narrowPanel,
    rowFlexDirection: c.measure.closed.rowFlexDirection,
    runFullyVisible_closed: c.measure.closed.runFullyVisible,
    runMinHeightOk: c.measure.closed.runMinHeightOk,
    runNearFullWidth: c.measure.closed.runNearFullWidth,
    runTextComplete: c.measure.closed.runTextComplete,
    secondaryTextComplete: c.measure.closed.secondaryTextComplete,
    clippedVsPanel: c.measure.closed.clippedVsPanel,
    horizontalOverflow: c.measure.closed.horizontalOverflow,
    runBox: c.measure.closed.run,
    cancelPrepBox: c.measure.closed.cancelPrep,
    panelBox: c.measure.closed.panel,
    pathFullWhenOpen: c.measure.opened.pathFull,
    pathRevealToggles: c.measure.opened.pathRevealOpen === true && c.measure.reclosed.pathRevealOpen === false,
    bootName: c.measure.closed.bootName,
  })),
};
writeFileSync(path.join(outDir, 'measure.json'), JSON.stringify(summary, null, 2));
console.log('wrote', path.join(outDir, 'measure.json'));

const narrow = summary.cases.filter((c) => c.width <= 380);
const fail = narrow.filter((c) =>
  !c.runFullyVisible_closed
  || c.clippedVsPanel
  || c.horizontalOverflow
  || !c.pathRevealToggles
  || !c.narrowPanel
  || c.rowFlexDirection !== 'column'
  || !c.runNearFullWidth
  || !c.secondaryTextComplete
  || !c.runTextComplete
);
if (fail.length) {
  console.error('MEASURE_FAIL', fail.map((f) => ({
    width: f.width, theme: f.theme, cardW: f.cardWidth, flex: f.rowFlexDirection,
    runW: f.runBox && f.runBox.w, nearFull: f.runNearFullWidth, secOk: f.secondaryTextComplete,
  })));
  process.exit(1);
}
console.log('MEASURE_PASS');
