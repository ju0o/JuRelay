#!/usr/bin/env node
/**
 * UX-V3 local visual screenshots (Chrome headless).
 * Captures 320/380/540 × light/dark of the founder-first shell.
 * ChatGPT host remains NOT_PROVEN until Aside Host QA.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repo, '.agent-relay/cert/ux-v3');
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

function fixtureHtml(width, theme, panel) {
  const style = extractStyle(fullHtml);
  const longPath = '/home/skkse12/Desktop/Projects/Core/JuControler';
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=${width}, initial-scale=1" />
<style>
${style}
html, body { margin:0; padding:0; background:var(--bg); color:var(--text); }
#card { width:${width}px; max-width:${width}px; margin:10px; padding:8px 10px; }
</style>
</head>
<body data-theme="${theme}">
  <div class="card" id="card">
    <div class="hdr">
      <span class="dot waiting pulse"></span>
      <span class="app">Agent Relay</span>
      <span class="hpill">PM 대기</span>
      <span class="lang"><button class="on">한국어</button><button>EN</button></span>
    </div>
    <div id="mainView">
      <nav class="v3-nav" id="v3Nav" aria-label="주요 화면">
        <button type="button" class="${panel === 'work' ? 'on' : ''}" data-v3="work" ${panel === 'work' ? 'aria-current="page"' : ''}>작업</button>
        <button type="button" class="${panel === 'activity' ? 'on' : ''}" data-v3="activity" ${panel === 'activity' ? 'aria-current="page"' : ''}>활동</button>
        <button type="button" class="extras ${panel === 'more' ? 'on' : ''}" data-v3="more" ${panel === 'more' ? 'aria-current="page"' : ''}>더보기 ⋯</button>
      </nav>
      <section class="v3-panel ${panel === 'work' ? 'on' : ''}" id="panel-work">
        <section class="pdash" id="projectDash">
          <div class="pdash-head">
            <div class="pn">JuControler</div>
            <div class="pp" id="pdPath" title="${longPath}">ASUS · Core/JuControler</div>
          </div>
          <div class="pdash-next"><div class="nl">다음</div><div class="nt">준비된 Task 확인</div></div>
          <div class="taskprev" id="pdTaskPrev">
            <h3>시작 전 확인</h3>
            <div class="line"><b>Task</b><span>TASK-0089 · README 정리</span></div>
            <div class="select-grid">
              <div class="line"><b>Agent</b><select id="tpAgentSel"><option>선택…</option></select></div>
              <div class="line"><b>모델</b><select id="tpModelSel" disabled><option>Agent 먼저</option></select></div>
            </div>
            <div class="row">
              <button type="button" id="tpSaveSel" disabled>선택 저장</button>
              <button type="button" class="primary" id="tpRun" disabled>작업 시작</button>
            </div>
          </div>
        </section>
      </section>
      <section class="v3-panel ${panel === 'activity' ? 'on' : ''}" id="panel-activity">
        <div class="v3-activity-head">
          <div class="v3-section-title">작업 현황 <span class="meta">프로젝트별</span></div>
          <div class="v3-metric-row">
            <div class="v3-metric"><b>0</b><span>진행 중</span></div>
            <div class="v3-metric"><b>1</b><span>준비됨</span></div>
            <div class="v3-metric"><b>0</b><span>검토 필요</span></div>
          </div>
        </div>
        <div class="tabs" id="tabs">
          <button data-tab="now" class="on">지금 상황</button>
          <button data-tab="task">Task</button>
        </div>
        <div class="tabpane on" id="pane-now"><div class="nowcard">대기 중</div></div>
        <section class="inbox" id="inbox"><div class="inbox-head"><div class="inbox-title">전체 프로젝트 · PM 수신함</div></div></section>
      </section>
      <section class="v3-panel ${panel === 'more' ? 'on' : ''}" id="panel-more">
        <details class="more-panel" id="morePanel" open>
          <summary>파이프라인 · 환경 · 진단</summary>
          <div class="pipe" id="pipe"><div class="pnode"><b>PM</b><span>이 대화</span></div></div>
        </details>
      </section>
    </div>
  </div>
  <script>document.title='V3_OK';</script>
</body>
</html>`;
}

function shot(width, theme, panel) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'uxv3-'));
  try {
    const htmlPath = path.join(dir, `${panel}-${width}-${theme}.html`);
    const shotPath = path.join(outDir, `${theme}-${width}-${panel}.png`);
    const html = fixtureHtml(width, theme, panel);
    writeFileSync(htmlPath, html, 'utf8');
    writeFileSync(path.join(outDir, `fixture-${width}-${theme}-${panel}.html`), html, 'utf8');
    const chrome = chromeBin();
    const r = spawnSync(chrome, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${Math.max(width, 400)},1200`,
      `--screenshot=${shotPath}`,
      pathToFileURL(htmlPath).href,
    ], { encoding: 'utf8', timeout: 30000 });
    if (r.status !== 0) throw new Error('screenshot failed: ' + (r.stderr || r.status));
    return path.relative(repo, shotPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cases = [];
for (const width of [320, 380, 540]) {
  for (const theme of ['light', 'dark']) {
    for (const panel of ['work', 'activity', 'more']) {
      const p = shot(width, theme, panel);
      cases.push({ width, theme, panel, shot: p });
      console.log('ok', theme, width, panel, p);
    }
  }
}

const summary = {
  status: 'LOCAL_FIXTURE_ONLY',
  fingerprint: distMod.PM_WIDGET_CONTENT_FINGERPRINT,
  uri: distMod.PM_WIDGET_RESOURCE_URI,
  cases,
  note: 'Host QA required for UX_V3 complete; local screenshots do not prove ChatGPT host.',
};
writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
