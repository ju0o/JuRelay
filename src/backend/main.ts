/**
 * Agent Relay — Electron main process.
 *
 * No database, no API, no cloud. This process only:
 *   - creates the branded window (React UI from dist/client)
 *   - answers single 'relay' IPC operations that read/write result records under
 *     the user-chosen DATA_ROOT.
 */
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as relay from './fs.js';
import { ControlRoomError, runControlRoom, runControlRoomApprovalAdd, runControlRoomApprovalEdit, runControlRoomApprovalRemove, runControlRoomEnvs, runControlRoomTokens, runControlRoomAutomationOff, runControlRoomAutomationOn, runControlRoomAutomationStatus, runControlRoomHoldChoose, runControlRoomLaneAdd, runControlRoomLaneSet, runControlRoomPause, runControlRoomPromoteHub, runControlRoomScheduleCancel, runControlRoomScheduleList, runControlRoomScheduleSet, runControlRoomResume, isValidProjectId, runGateAnswer, runGatesList, runPlanStudioApprove, runPlanStudioChat, runPlanStudioGet, runPlanStudioRequest, runPlanStudioSave } from './controlRoom.js';
import { migrateSettings } from './migrate.js';
import { CaptureReport, captureLoadingError, parseCapturePath } from '../shared/capture.js';
import { projectWindowKey, projectWindowTitle } from '../shared/projectLabels.js';
import { checkForUpdates, downloadUpdate, initUpdater, installUpdate, updaterSupported } from './updater.js';
import {
  AppSettings,
  DfContext,
  DfItem,
  DfPriority,
  DfStatus,
  DfType,
  ProjectViewData,
  RelayRequest,
  RelayResponse,
  RunFolderResult,
  SettingsView,
  StartView,
  UpdateEvent,
  UpdateStatus,
  friendlyErrorMessage,
  nextUpdateStatus,
  parseStartView,
  windowTitleForVersion,
} from '../shared/types.js';

/** Mutable runtime state. */
let baseDir = '';

let startView: StartView = parseStartView(process.argv);

/** `--capture=<png>`: background screenshot mode for the automated Tester (no window shown, no focus). */
const capturePath = parseCapturePath(process.argv);

/**
 * Capture and tester launches tell the page to skip the first-run guide.
 * A normal open has no --capture and no --view, so the query stays off.
 */
function quietLaunchQuery(): { capture: string } | undefined {
  const testerView = process.argv.some((arg) => arg.startsWith('--view='));
  return capturePath || testerView ? { capture: '1' } : undefined;
}
/** Resolved when the renderer asks for its start view = the UI has mounted and applied it. */
let markRendererReady: () => void = () => undefined;
const rendererReady = new Promise<void>(resolve => { markRendererReady = resolve; });
function currentSettings(): AppSettings {
  return relay.loadSettings(baseDir);
}
function saveSettings(s: AppSettings): void {
  relay.saveSettings(baseDir, s);
}

/**
 * Choose where settings.json lives.
 *
 * v0.3 — 설치형/포터블이 뚜렷이 갈린다:
 *  - Portable exe: electron-builder portable이 설정하는 PORTABLE_EXECUTABLE_DIR
 *    (= exe 위치)에 그대로 저장 — USB 휴대 시 설정이 함께 이동.
 *  - Installed (NSIS): Program Files는 절대 쓰지 않고 Electron userData
 *    (%APPDATA%/agent-relay-log)를 사용한다.
 *  - Dev: 컴파일 출력 옆(__dirname).
 */
function resolveBaseDir(): string {
  if (!app.isPackaged) return __dirname;
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir) {
    try {
      const probe = path.join(portableDir, '.agent-relay-log-write-test');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return portableDir;
    } catch {
      // fall through to userData
    }
  }
  return app.getPath('userData');
}

/**
 * 최초 실행 시 과거 버전의 settings.json을 현재 baseDir(userData)로 조용히 복사한다.
 *
 * 커버 범위:
 *  - v0.3.0 설치형: userData가 package.json name 기준이라 동일 위치 → 이관 불필요
 *  - ~v0.2.x portable 폴백: %APPDATA%/agent-relay-log/AgentRelayLog → 후보로 복사
 *  - portable exe 옆 settings.json: 위치를 알 수 없어 자동 이관 대상 아님 (문서화됨)
 *
 * - 원본은 절대 삭제하지 않는다 (destructive migration 금지).
 * - 실패해도 앱 시작을 막지 않는다.
 */
function migrateLegacySettings(): void {
  try {
    if (baseDir !== app.getPath('userData')) return; // installed 전용
    const candidates = [
      path.join(app.getPath('userData'), 'AgentRelayLog'),
    ];
    migrateSettings(baseDir, candidates);
  } catch {
    // 마이그레이션 실패는 치명적이지 않다 — 기본값으로 시작.
  }
}

/** Dispatch a single relay operation to the filesystem layer. */
async function handleRequest(req: RelayRequest): Promise<unknown> {
  switch (req.op) {
    case 'settings:get': {
      const s = currentSettings();
      const view: SettingsView = {
        ...s,
        baseDir,
        settingsFile: relay.settingsPath(baseDir),
        defaultDataRoot: path.join(app.getPath('documents'), 'Agent Relay'),
        appVersion: app.getVersion(),
        dataRootExists: relay.dataRootExists(s.dataRoot),
      };
      return view;
    }

    case 'settings:setLastProject': {
      const s = currentSettings();
      s.lastProject = req.project || '';
      saveSettings(s);
      return true;
    }

    case 'settings:setProjectOrder': {
      if (!Array.isArray(req.order)) throw new Error('order 배열이 필요합니다.');
      const s = currentSettings();
      s.projectOrder = req.order.map((x) => String(x));
      saveSettings(s);
      return s.projectOrder;
    }

    case 'settings:setAgentOrder': {
      if (!Array.isArray(req.order)) throw new Error('order 배열이 필요합니다.');
      const s = currentSettings();
      s.agentOrder = req.order.map((x) => String(x));
      saveSettings(s);
      return s.agentOrder;
    }

    case 'settings:setWorkTabOrder': {
      if (!Array.isArray(req.order)) throw new Error('order 배열이 필요합니다.');
      const s = currentSettings();
      s.workTabOrder = req.order.map((x) => String(x));
      saveSettings(s);
      return s.workTabOrder;
    }

    case 'settings:setDataRoot': {
      if (!req.path) throw new Error('DATA_ROOT 경로가 비어 있습니다.');
      const resolved = path.resolve(req.path);
      relay.ensureDataRoot(resolved);
      const s = currentSettings();
      s.dataRoot = resolved;
      saveSettings(s);
      return s;
    }

    case 'folder:pick': {
      const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
      if (picked.canceled || picked.filePaths.length === 0) return { selected: null };
      return { selected: picked.filePaths[0] };
    }

    case 'agents:add': {
      const s = currentSettings();
      const name = (req.name || '').trim();
      if (!name) throw new Error('에이전트 이름을 입력하세요.');
      if (!s.customAgents.includes(name)) {
        s.customAgents = [...s.customAgents, name];
        saveSettings(s);
      }
      return s.customAgents;
    }

    case 'projects:list':
      return relay.listProjects(req.dataRoot);

    case 'projects:create':
      return relay.createProject(req.dataRoot, req.name);

    case 'project:view': {
      const data: ProjectViewData = {
        projects: relay.listProjects(req.dataRoot),
        history: relay.buildHistory(req.dataRoot, req.project),
      };
      return data;
    }

    case 'run:next':
      return relay.nextRunNumber(req.dataRoot, req.project, req.date, req.agent);

    case 'run:ensureFolder': {
      const folder = relay.ensureRunFolder(
        req.dataRoot,
        req.project,
        req.date,
        req.agent,
        req.run,
      );
      const out: RunFolderResult = { folder, run: req.run };
      return out;
    }

    case 'run:read':
      return relay.readRun(req.folder);

    case 'run:delete': {
      if (!req.folder) throw new Error('folder가 필요합니다.');
      relay.deleteRun(req.folder);
      return true;
    }

    case 'run:export': {
      if (!req.folder) throw new Error('folder가 필요합니다.');
      const content = relay.exportRunMarkdown(req.folder);
      const runBase = path.basename(req.folder);
      const agentBase = path.basename(path.dirname(req.folder));
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: `${agentBase}-run-${runBase}.md`,
        filters: [{ name: '문서', extensions: ['md'] }],
      });
      if (canceled || !filePath) return { saved: false };
      fs.writeFileSync(filePath, content, 'utf8');
      return { saved: true, filePath };
    }

    case 'run:tagUpdate': {
      if (!req.folder) throw new Error('folder가 필요합니다.');
      relay.writeRunMeta(req.folder, { tags: req.tags });
      return req.tags;
    }

    case 'run:move': {
      if (!req.fromFolder) throw new Error('fromFolder가 필요합니다.');
      const newFolder = relay.moveRun(req.fromFolder, req.dataRoot, req.project, req.toDate, req.toAgent);
      return { folder: newFolder };
    }

    case 'date:delete': {
      if (!req.date) throw new Error('date가 필요합니다.');
      relay.deleteDateFolder(req.dataRoot, req.project, req.date);
      return true;
    }

    case 'agent:delete': {
      if (!req.agent) throw new Error('agent가 필요합니다.');
      relay.deleteAgentFolder(req.dataRoot, req.project, req.date, req.agent);
      return true;
    }

    case 'project:delete': {
      relay.deleteProject(req.dataRoot, req.project);
      return true;
    }

    case 'prompt:save':
      return relay.writeMarkdown(req.folder, 'prompt.md', req.content, req.overwrite);

    case 'result:save':
      return relay.writeMarkdown(req.folder, 'result.md', req.content, req.overwrite);

    case 'folder:open': {
      await shell.openPath(req.folder);
      return true;
    }

    case 'file:reveal': {
      // Opens Explorer (platform file manager) with the file selected.
      if (!req.path) throw new Error('path가 필요합니다.');
      shell.showItemInFolder(req.path);
      return true;
    }

    case 'df:list':
      return relay.listFeedbacks(req.dataRoot);

    case 'df:create': {
      const item: DfItem = relay.createFeedback(
        req.dataRoot,
        {
          type: req.type,
          priority: req.priority,
          feedback: req.feedback,
          desired: req.desired,
          context: sanitizeDfContext(req.context),
        },
        app.getVersion(),
      );
      return item;
    }

    case 'df:setStatus': {
      const statuses: DfStatus[] = ['OPEN', 'FIXED', 'HOLD'];
      if (!statuses.includes(req.status)) throw new Error('알 수 없는 상태입니다.');
      return relay.setFeedbackStatus(req.dataRoot, req.id, req.status);
    }

    case 'df:read':
      return relay.readFeedbackRaw(req.dataRoot, req.id);

    case 'pdf:list':
      return relay.listProjectFeedbacks(req.dataRoot, req.project);

    case 'pdf:create': {
      const item: DfItem = relay.createProjectFeedback(
        req.dataRoot,
        req.project,
        {
          type: req.type,
          priority: req.priority,
          feedback: req.feedback,
          desired: req.desired,
          agent: typeof req.agent === 'string' && req.agent ? req.agent : undefined,
          run: typeof req.run === 'string' && req.run ? req.run : undefined,
        },
        app.getVersion(),
      );
      return item;
    }

    case 'pdf:setStatus': {
      const statuses: DfStatus[] = ['OPEN', 'FIXED', 'HOLD'];
      if (!statuses.includes(req.status)) throw new Error('알 수 없는 상태입니다.');
      return relay.setProjectFeedbackStatus(req.dataRoot, req.project, req.id, req.status);
    }

    case 'pdf:read':
      return relay.readProjectFeedbackRaw(req.dataRoot, req.project, req.id);

    case 'update:check': {
      if (!updaterSupported(app.isPackaged)) {
        throw new Error('개발 모드에서는 업데이트를 확인할 수 없습니다. (설치된 앱에서만 동작)');
      }
      manualCheck = true;
      void checkForUpdates().catch(() => undefined); // errors arrive via 'error' event
      return true;
    }

    case 'update:download':
      downloadUpdate();
      return true;

    case 'update:install':
      installUpdate();
      return true;

    case 'controlRoom:board':
      return runControlRoom('board');

    case 'controlRoom:approvals':
      return runControlRoom('approvals');

    case 'controlRoom:envs':
      return runControlRoomEnvs();

    case 'controlRoom:tokens':
      return runControlRoomTokens();

    case 'planStudio:get':
      return runPlanStudioGet(req.project);

    case 'planStudio:save':
      return runPlanStudioSave(req.project, req.draft);

    case 'planStudio:chat':
      return runPlanStudioChat(req.project, req.message);

    case 'planStudio:request':
      return runPlanStudioRequest(req.project, req.text);

    case 'planStudio:approve':
      return runPlanStudioApprove(req.project);

    case 'gates:list':
      return runGatesList();

    case 'gates:answer':
      return runGateAnswer(req.gateId, req.optionIndex);

    case 'controlRoom:laneSet':
      return runControlRoomLaneSet(req.project, req.role, req.runtimes);

    case 'controlRoom:laneAdd':
      return runControlRoomLaneAdd(req.id, req.path, req.name);

    case 'controlRoom:resume':
      return runControlRoomResume(req.project);

    case 'controlRoom:pause':
      return runControlRoomPause(req.project);

    case 'controlRoom:scheduleSet':
      return runControlRoomScheduleSet(req.time);

    case 'controlRoom:scheduleList':
      return runControlRoomScheduleList();

    case 'controlRoom:scheduleCancel':
      return runControlRoomScheduleCancel();

    case 'controlRoom:holdChoose':
      return runControlRoomHoldChoose(req.taskId, req.option);

    case 'controlRoom:approvalAdd':
      return runControlRoomApprovalAdd(req.category, req.summary);

    case 'controlRoom:approvalEdit':
      return runControlRoomApprovalEdit(req.id, req.summary);

    case 'controlRoom:approvalRemove':
      return runControlRoomApprovalRemove(req.id);

    case 'controlRoom:automationStatus':
      return runControlRoomAutomationStatus();

    case 'controlRoom:automationOn':
      return runControlRoomAutomationOn();

    case 'controlRoom:automationOff':
      return runControlRoomAutomationOff();

    case 'controlRoom:promoteHub':
      return runControlRoomPromoteHub();

    case 'app:startView':
      markRendererReady();
      return { view: startView };

    default:
      throw new Error('알 수 없는 요청입니다.');
  }
}

/** Keep only the known string fields of a feedback context. */
function sanitizeDfContext(ctx: DfContext): DfContext {
  return {
    project: typeof ctx?.project === 'string' ? ctx.project : undefined,
    date: typeof ctx?.date === 'string' ? ctx.date : undefined,
    agent: typeof ctx?.agent === 'string' ? ctx.agent : undefined,
    run: typeof ctx?.run === 'string' ? ctx.run : undefined,
  };
}

// ── In-app updater state ────────────────────────────────────────────────────
// electron-updater 이벤트 → 순수 상태 머신(nextUpdateStatus) → 렌더러 푸시.
let manualCheck = false;
const initialUpdateStatus: UpdateStatus = { phase: 'idle', version: app.getVersion() };
let updateStatusState: UpdateStatus = initialUpdateStatus;

function pushUpdateStatus(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('relay-update-status', updateStatusState);
  }
}

function handleUpdateEvent(e: UpdateEvent): void {
  // 한 사이클(확인 결과/에러)이 끝나면 manual 플래그를 되돌린다.
  // (updater는 이벤트 발생 시점에 isManual()으로 플래그를 읽어 간다)
  if (e.type === 'not-available' || e.type === 'available' || e.type === 'error') {
    manualCheck = false;
  }
  updateStatusState = nextUpdateStatus(updateStatusState, e);
  pushUpdateStatus();
}

function registerIpc(): void {
  ipcMain.handle('window:openProject', (_e, projectId: unknown): RelayResponse<{ focused: boolean }> => {
    if (!isValidProjectId(projectId)) return { ok: false, error: '프로젝트 이름을 알아볼 수 없어요.' };
    try {
      return { ok: true, value: openProjectWindow(projectId) };
    } catch (err) {
      return { ok: false, error: friendlyErrorMessage(err), detail: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('relay', async (_e, req: RelayRequest): Promise<RelayResponse<unknown>> => {
    try {
      const value = await handleRequest(req);
      return { ok: true, value };
    } catch (err) {
      const message = friendlyErrorMessage(err);
      const detail = err instanceof ControlRoomError ? err.detail : undefined;
      return detail ? { ok: false, error: message, detail } : { ok: false, error: message };
    }
  });

  // ── Native file drag-out (result.md → ChatGPT input 등) ──
  // Renderer calls window.relayApi.dragFile(path); we enter the OS drag loop
  // with the real file so dropping on another app attaches it like a normal
  // file drag from Explorer.
  ipcMain.on('relay-drag-file', (event, filePath: unknown) => {
    try {
      if (typeof filePath !== 'string' || !filePath) return;
      if (!fs.existsSync(filePath)) return;
      event.sender.startDrag({ file: filePath, icon: dragIcon() });
    } catch {
      // Drag-out is best-effort; never crash the app here.
    }
  });
}

/** 1x1 transparent PNG — fallback when the drag icon asset is missing. */
const DRAG_ICON_FALLBACK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let _dragIcon: Electron.NativeImage | null = null;
function dragIcon(): Electron.NativeImage {
  if (!_dragIcon) {
    // vite copies public/ → dist/client; main.js sits in dist/server/backend.
    const p = path.join(__dirname, '..', '..', 'client', 'drag-md.png');
    const img = nativeImage.createFromPath(p);
    _dragIcon = img.isEmpty() ? nativeImage.createFromDataURL(DRAG_ICON_FALLBACK) : img;
  }
  return _dragIcon;
}

let mainWindow: BrowserWindow | null = null;

/**
 * Vite HMR URL for development. Set by `node scripts/dev.mjs`
 * (ELECTRON_DEV_URL=http://localhost:5173). Packaged builds never use it:
 * app.isPackaged implies loadFile(dist/client/index.html) below.
 */
function devServerUrl(): string {
  if (app.isPackaged) return '';
  const raw = (process.env.ELECTRON_DEV_URL || '').trim();
  return /^https?:\/\/.+/.test(raw) ? raw : '';
}

// Every window (main + project windows) gets the same preload and security options.
const WEB_PREFERENCES = (): Electron.WebPreferences => ({
  preload: path.join(__dirname, 'preload.js'),
  // contextIsolation defaults to true in Electron 28 — keep default
});

/** '이 프로젝트만 새 창으로': 프로젝트마다 창 1개. 이미 열려 있으면 앞으로 가져온다. */
const projectWindows = new Map<string, BrowserWindow>();

function openProjectWindow(projectId: string): { focused: boolean } {
  const key = projectWindowKey(projectId);
  const existing = projectWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return { focused: true };
  }
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 700,
    minHeight: 560,
    title: projectWindowTitle(projectId),
    backgroundColor: '#17181c',
    autoHideMenuBar: true,
    webPreferences: WEB_PREFERENCES(),
  });
  projectWindows.set(key, win);
  win.on('closed', () => { if (projectWindows.get(key) === win) projectWindows.delete(key); });
  // The page <title> must not overwrite 'Agent Relay · <프로젝트 이름>'.
  win.on('page-title-updated', e => e.preventDefault());
  const clientPath = path.join(__dirname, '..', '..', 'client', 'index.html');
  const devUrl = devServerUrl();
  const query = { project: key };
  const loadFromFile = (): void => { void win.loadFile(clientPath, { query }); };
  if (devUrl) {
    win.webContents.once('did-fail-load', () => { if (!win.isDestroyed() && fs.existsSync(clientPath)) loadFromFile(); });
    void win.loadURL(`${devUrl}${devUrl.includes('?') ? '&' : '?'}project=${encodeURIComponent(key)}`);
  } else loadFromFile();
  return { focused: false };
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    ...(capturePath
      ? { show: false, paintWhenInitiallyHidden: true, skipTaskbar: true, focusable: false, useContentSize: true }
      : {}),
    title: 'Agent Relay',
    backgroundColor: '#17181c',
    autoHideMenuBar: true,
    // Hidden capture window must keep rendering, or capturePage() returns the first frame.
    webPreferences: { ...WEB_PREFERENCES(), ...(capturePath ? { backgroundThrottling: false } : {}) },
  });

  // Per-build version suffix so installers can be told apart ('Agent Relay 0.3.N').
  // The constructor keeps the plain brand title (pinned by first-run-copy test);
  // the visible title carries the package.json version via app.getVersion().
  mainWindow.setTitle(windowTitleForVersion(app.getVersion()));

  // ── F12 / Ctrl+Shift+I → DevTools (development only) ──
  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (_e, input) => {
      if (
        input.type === 'keyDown' &&
        ((input.key === 'F12') ||
          (input.control && input.shift && input.key === 'I'))
      ) {
        mainWindow?.webContents.openDevTools();
      }
    });
  }

  // ── Detect page-load failure and show a diagnostic dialog ──
  const clientPath = path.join(__dirname, '..', '..', 'client', 'index.html');
  const devUrl = devServerUrl();
  let fellBackToFile = false;

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    // Offline/dev-server-down fallback: the launcher always runs an initial
    // tsc build, and `vite build` output may exist — prefer a running app
    // over an error box when the HMR URL is unreachable.
    if (devUrl && !fellBackToFile && fs.existsSync(clientPath)) {
      fellBackToFile = true;
      const quietQuery = quietLaunchQuery();
      void mainWindow?.loadFile(clientPath, quietQuery ? { query: quietQuery } : undefined);
      return;
    }
    if (capturePath) { void finishCapture('페이지 로드 실패: ' + code + ' ' + desc); return; }
    dialog.showErrorBox(
      'Agent Relay — 페이지 로드 실패',
      `오류 코드: ${code}\n설명: ${desc}\n\n시도한 경로:\n${devUrl || clientPath}\n\n경로가 존재하는지 확인하세요.`,
    );
  });

  mainWindow.webContents.on('will-prevent-unload', (event) => {
    if (capturePath) { event.preventDefault(); return; }
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      buttons: ['취소', '닫기'],
      defaultId: 0,
      cancelId: 0,
      title: '저장되지 않은 내용',
      message: '저장되지 않은 프롬프트 또는 결과가 있습니다.',
      detail: '앱을 닫으면 저장되지 않은 내용이 사라집니다.',
    });
    if (choice === 1) event.preventDefault();
  });

  // ── Load UI ──
  // Dev (scripts/dev.mjs): load the Vite HMR server for instant feedback.
  // Everything else (npm start, packaged app, offline fallback): load the
  // static build output exactly as before.
  if (devUrl) {
    const quietQuery = quietLaunchQuery();
    const url = quietQuery ? `${devUrl}${devUrl.includes('?') ? '&' : '?'}capture=1` : devUrl;
    void mainWindow.loadURL(url);
    return;
  }

  if (!fs.existsSync(clientPath)) {
    if (capturePath) { void finishCapture('index.html 없음'); return; }
    dialog.showErrorBox(
      'Agent Relay — index.html 없음',
      `다음 경로에 index.html이 없습니다:\n${clientPath}\n\n앱을 다시 빌드하거나 재설치하세요.`,
    );
    return;
  }

  const quietQuery = quietLaunchQuery();
  void mainWindow.loadFile(clientPath, quietQuery ? { query: quietQuery } : undefined);
}

/** How long the UI may keep loading data after it mounted before we take the picture. */
const CAPTURE_SETTLE_MS = 1500;
const CAPTURE_MAX_MS = 15000;
/** Max wait for the repaint (two animation frames) before capturePage(). */
const CAPTURE_PAINT_MS = 1000;
let captureDone = false;

/** Capture (error='') or record the failure, write PNG + <png>.json, then quit 0/1. Runs once. */
async function finishCapture(error: string): Promise<void> {
  if (captureDone) return;
  captureDone = true;
  const report: CaptureReport = { view: startView, ok: false, title: '', text: '', error };
  try {
    const wc = mainWindow?.webContents;
    if (!wc || wc.isDestroyed()) throw new Error(error || '창이 없습니다.');
    if (!error) {
      report.title = wc.getTitle();
      report.text = String(await wc.executeJavaScript('document.body.innerText')).slice(0, 2000);
      // Force a fresh frame of the current DOM before taking the picture.
      wc.invalidate();
      await Promise.race([
        wc.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))'),
        new Promise(r => setTimeout(r, CAPTURE_PAINT_MS)),
      ]);
      const img = await wc.capturePage();
      fs.mkdirSync(path.dirname(capturePath), { recursive: true });
      fs.writeFileSync(capturePath, img.toPNG());
      report.error = captureLoadingError(String(await wc.executeJavaScript('document.body.innerText')));
      report.ok = !report.error;
    }
  } catch (e) {
    report.error = report.error || (e instanceof Error ? e.message : String(e));
  }
  try {
    fs.writeFileSync(capturePath + '.json', JSON.stringify(report, null, 2));
  } catch {
    report.ok = false;
  }
  app.exit(report.ok ? 0 : 1);
}

/** Wait for load + renderer mount (max CAPTURE_MAX_MS), let data settle, then capture. */
function runCapture(): void {
  const wc = mainWindow!.webContents;
  const loaded = new Promise<void>(resolve => wc.once('did-finish-load', () => resolve()));
  const timeout = new Promise<void>(resolve => setTimeout(resolve, CAPTURE_MAX_MS));
  void Promise.race([
    Promise.all([loaded, rendererReady]).then(() => new Promise<void>(r => setTimeout(r, CAPTURE_SETTLE_MS))),
    timeout,
  ]).then(() => finishCapture(''));
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.agentrelaylog.v0');
  startView = parseStartView(process.argv);
  baseDir = resolveBaseDir();
  fs.mkdirSync(baseDir, { recursive: true });
  migrateLegacySettings();
  registerIpc();
  createWindow();

  if (capturePath) {
    if (mainWindow) runCapture();
    else void finishCapture('창을 만들지 못했습니다.');
    return; // no updater, never show/focus in capture mode
  }

  // ── Updater ──
  // 시작 후 조용히 1회 확인(정책상 자동 다운로드/설치 없음). 새 버전이 있으면
  // 렌더러가 작은 알림을 띄우고, 설치는 사용자가 설정에서 진행한다.
  if (updaterSupported(app.isPackaged)) {
    initUpdater({ emit: handleUpdateEvent, isManual: () => manualCheck });
    setTimeout(() => {
      void checkForUpdates().catch(() => undefined);
    }, 4000);
  }

  app.on('window-all-closed', () => {
    app.quit();
  });
});

app.on('activate', () => {
  if (mainWindow && !capturePath) mainWindow.show();
});
