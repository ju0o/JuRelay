/**
 * P2-C — ChatGPT Connect UX
 * One entrypoint: agent-relay connect (default) / agent-relay connect chatgpt
 *
 * Never prints secrets. Never ships another host's tunnel/org/profile identity.
 * Short-lived auth / credential materialization requires explicit --ready.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'node:child_process';
import {
  loadInstallMarker,
  resolveConfigDir,
  resolveDataRoot,
  fileModeOctal,
  probeHttpMcpSync,
  tunnelClientPresent,
  type InstallMarker,
} from './local-runtime.js';

export const CHATGPT_CONNECT_SCHEMA = 'cli.chatgpt-connect.v1';
export const CONNECT_STATE_SCHEMA = 'connect.v1';

export type ConnectState =
  | 'LOCAL_NOT_READY'
  | 'LOCAL_READY'
  | 'TUNNEL_CLIENT_MISSING'
  | 'TUNNEL_SETUP_REQUIRED'
  | 'TUNNEL_AUTH_REQUIRED'
  | 'TUNNEL_READY'
  | 'AUTH_TRANSPORT_REQUIRED'
  | 'CHATGPT_APP_REQUIRED'
  | 'CHATGPT_TOOL_SCAN_REQUIRED'
  | 'CHATGPT_TOOL_REFRESH_REQUIRED'
  | 'CHATGPT_CONNECTED';

export type ChatgptCapability = 'USER_VERIFICATION_REQUIRED' | 'VERIFIED' | 'BLOCKED_BY_PLAN';

const FORBIDDEN_PROFILE_SUBSTRINGS = ['asus', 'agent-relay-asus'];
const FORBIDDEN_ID_PATTERNS = [/tunnel_6abd/i, /org-eTRXK/i, /agent-relay-asus/i];

export interface ConnectStateFile {
  schemaVersion: typeof CONNECT_STATE_SCHEMA;
  state: ConnectState;
  profileName: string;
  profileDir: string;
  localMcpUri: string;
  /** Present when user supplied their own tunnel id — never a shipped default. */
  tunnelIdConfigured: boolean;
  /** Redacted fingerprint only (prefix), never full secret. */
  tunnelIdPrefix?: string;
  auth: {
    readyConfirmedAt: string | null;
    mintAttempts: number;
    runtimeKeyRef: string;
  };
  chatgpt: {
    capability: ChatgptCapability;
    appName: string;
    toolScan: 'REQUIRED' | 'REFRESH_REQUIRED' | 'VERIFIED';
    widgetMount: 'UNVERIFIED' | 'VERIFIED';
    cancelReadyTaskVisible: boolean | null;
    verifiedAt: string | null;
  };
  updatedAt: string;
}

export interface ConnectAssessment {
  schemaVersion: typeof CHATGPT_CONNECT_SCHEMA;
  ok: boolean;
  state: ConnectState;
  local: {
    status: 'PASS' | 'FAIL';
    setupMarker: boolean;
    mcpHealthy: boolean;
    proxyHealthy: boolean;
    tokenPermsOk: boolean;
    buildExists: boolean;
    localMcpUri: string | null;
    messages: string[];
  };
  tunnel: {
    status: 'PASS' | 'WARN' | 'FAIL' | 'PENDING';
    clientPresent: boolean;
    profileName: string | null;
    profileExists: boolean;
    runtimeKeyPresent: boolean;
    messages: string[];
  };
  chatgpt: {
    status: 'PASS' | 'WARN' | 'PENDING';
    capability: ChatgptCapability;
    appName: string;
    messages: string[];
  };
  overall: 'PASS' | 'WARN' | 'FAIL' | 'HUMAN_GATE_REQUIRED';
  nextActions: string[];
  manifest: Record<string, unknown>;
  secretsHidden: true;
  warnings: string[];
  error?: string;
}

export interface ChatgptConnectOptions {
  cwd?: string;
  ready?: boolean;
  tunnelId?: string;
  profile?: string;
  statusOnly?: boolean;
  /** Test/Aside: record that ChatGPT tool scan verified expected tools. */
  markToolScanVerified?: boolean;
  /** Test/Aside: record widget mount verified in ChatGPT host. */
  markWidgetVerified?: boolean;
  /** Test/Aside: record cancel_ready_task visible after refresh. */
  markCancelReadyVisible?: boolean;
  /** Test/Aside: mark full ChatGPT connection verified. */
  markChatgptConnected?: boolean;
  /** Force CHATGPT_TOOL_REFRESH_REQUIRED diagnosis (stale catalog). */
  markToolRefreshRequired?: boolean;
  force?: boolean;
  json?: boolean;
  /** Injectables for tests */
  spawnSyncImpl?: typeof spawnSync;
  tunnelClientPresentImpl?: () => boolean;
  now?: () => string;
}

function nowIso(opts: ChatgptConnectOptions): string {
  return (opts.now ?? (() => new Date().toISOString()))();
}

function connectStatePath(configDir = resolveConfigDir()): string {
  return path.join(configDir, 'connect-state.json');
}

function defaultProfileName(marker: InstallMarker | null): string {
  const inst = (marker?.instance || 'default').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  if (!inst || inst === 'default') return 'agent-relay-local';
  return `agent-relay-${inst}`;
}

function profileDir(): string {
  const override = process.env.TUNNEL_CLIENT_PROFILE_DIR?.trim() || process.env.AGENT_RELAY_TUNNEL_PROFILE_DIR?.trim();
  if (override) return path.resolve(override);
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.join(xdg, 'tunnel-client');
  return path.join(os.homedir(), '.config', 'tunnel-client');
}

function runtimeKeyPath(configDir = resolveConfigDir()): string {
  return path.join(configDir, 'secrets', 'tunnel-runtime-key');
}

function loadConnectState(configDir = resolveConfigDir()): ConnectStateFile | null {
  const p = connectStatePath(configDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ConnectStateFile;
  } catch {
    return null;
  }
}

function saveConnectState(state: ConnectStateFile, configDir = resolveConfigDir()): void {
  fs.mkdirSync(configDir, { recursive: true });
  const p = connectStatePath(configDir);
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, p);
  try { fs.chmodSync(p, 0o600); } catch { /* ignore */ }
}

function assertSafeTunnelId(id: string): void {
  const t = id.trim();
  if (!t) throw new Error('tunnel id is empty');
  for (const re of FORBIDDEN_ID_PATTERNS) {
    if (re.test(t)) throw new Error('Refusing forbidden/current-host tunnel identity. Create your own tunnel id.');
  }
  if (!/^tunnel_[A-Za-z0-9]+$/.test(t) && !/^tunnel_/.test(t)) {
    // Allow tunnel_* forms; do not invent stricter rules than CLI.
    if (t.length < 8) throw new Error('tunnel id looks too short');
  }
}

function assertSafeProfileName(name: string): void {
  const n = name.trim().toLowerCase();
  if (!n) throw new Error('profile name is empty');
  for (const bad of FORBIDDEN_PROFILE_SUBSTRINGS) {
    if (n.includes(bad)) throw new Error(`Refusing forbidden profile name containing '${bad}'. Choose your own profile.`);
  }
}

function profileFilePath(dir: string, name: string): string {
  return path.join(dir, `${name}.yaml`);
}

function profileExists(dir: string, name: string): boolean {
  return fs.existsSync(profileFilePath(dir, name));
}

function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, '$1=***')
    .replace(/tunnel_[a-f0-9]{16,}/gi, 'tunnel_***')
    .replace(/org-[A-Za-z0-9]+/g, 'org_***');
}

function spawnTunnel(
  spawn: typeof spawnSync,
  args: string[],
  opts?: { env?: NodeJS.ProcessEnv; timeout?: number },
): { status: number | null; stdout: string; stderr: string } {
  const r = spawn('tunnel-client', args, {
    encoding: 'utf8',
    shell: false,
    timeout: opts?.timeout ?? 15_000,
    env: { ...process.env, ...(opts?.env || {}) },
  } as any);
  return {
    status: r.status,
    stdout: String(r.stdout || ''),
    stderr: String(r.stderr || ''),
  };
}

function detectTunnelAuthNeeded(spawn: typeof spawnSync, profile: string, profileDirPath: string): {
  needed: boolean;
  message: string;
} {
  const keyPath = runtimeKeyPath();
  const keyPresent = fs.existsSync(keyPath) && fs.statSync(keyPath).size > 0;
  if (!keyPresent) {
    return { needed: true, message: 'Runtime API key file missing — create yours in OpenAI Runtime API keys, then place it at the local secrets path (never print the value).' };
  }
  // Prefer tunnel-client doctor when profile exists
  if (profileExists(profileDirPath, profile)) {
    const d = spawnTunnel(spawn, ['doctor', '--profile', profile, '--explain'], {
      env: { TUNNEL_CLIENT_PROFILE_DIR: profileDirPath },
      timeout: 20_000,
    });
    const out = redactSecrets((d.stdout + '\n' + d.stderr).slice(0, 2000));
    if (d.status === 0) return { needed: false, message: 'tunnel-client doctor PASS' };
    if (/api[_-]?key|auth|unauthorized|401|credential|CONTROL_PLANE_API_KEY/i.test(out)) {
      return { needed: true, message: 'tunnel-client doctor reports auth/credential problem (details redacted)' };
    }
    // Other doctor failures still mean not ready; treat as setup/auth pending
    return { needed: true, message: 'tunnel-client doctor did not pass — check profile/auth (details redacted)' };
  }
  return { needed: true, message: 'Profile not initialized yet' };
}

function probeTunnelReady(spawn: typeof spawnSync, profile: string, profileDirPath: string, healthPort?: number): boolean {
  if (!profileExists(profileDirPath, profile)) return false;
  const doctor = spawnTunnel(spawn, ['doctor', '--profile', profile], {
    env: { TUNNEL_CLIENT_PROFILE_DIR: profileDirPath },
    timeout: 20_000,
  });
  if (doctor.status !== 0) return false;
  // Optional live health if daemon is up
  const healthArgs = ['health', '--json'];
  if (healthPort && Number.isFinite(healthPort)) healthArgs.push('--port', String(healthPort));
  const health = spawnTunnel(spawn, healthArgs, { timeout: 5000 });
  if (health.status === 0) return true;
  // Doctor pass without live daemon still counts as TUNNEL_READY config-wise;
  // ChatGPT connect requires the daemon running — reflected in nextActions.
  return true;
}

function localPreflight(marker: InstallMarker | null): ConnectAssessment['local'] {
  const messages: string[] = [];
  const configDir = resolveConfigDir();
  const buildCandidates = [
    path.resolve('dist/server/mcp/app-server-main.js'),
    marker?.repoRoot ? path.join(marker.repoRoot, 'dist/server/mcp/app-server-main.js') : '',
  ].filter(Boolean);
  const buildExists = buildCandidates.some((p) => fs.existsSync(p));
  if (!buildExists) messages.push('Build missing — run ./setup.sh or npm run build');

  // Test-only hook: isolated suites may skip live port probes.
  if (process.env.AGENT_RELAY_CONNECT_TEST_LOCAL === 'PASS' && marker) {
    const uri = marker.localMcpUri || `http://127.0.0.1:${marker.proxyPort ?? 8081}/mcp`;
    return {
      status: 'PASS',
      setupMarker: true,
      mcpHealthy: true,
      proxyHealthy: true,
      tokenPermsOk: true,
      buildExists: true,
      localMcpUri: uri,
      messages: ['Local MCP + auth proxy healthy (test harness)'],
    };
  }

  if (!marker) {
    messages.push('Install marker missing — run ./setup.sh');
    return {
      status: 'FAIL',
      setupMarker: false,
      mcpHealthy: false,
      proxyHealthy: false,
      tokenPermsOk: false,
      buildExists,
      localMcpUri: null,
      messages,
    };
  }

  const tokenFile = marker.tokenFile || path.join(configDir, 'mcp-token');
  const mode = fileModeOctal(tokenFile);
  const tokenPermsOk = fs.existsSync(tokenFile) && mode === '600';
  if (!fs.existsSync(tokenFile)) messages.push('mcp-token missing');
  else if (mode !== '600') messages.push(`mcp-token mode ${mode ?? '?'} (expected 600)`);

  const mcpPort = Number(process.env.AGENT_RELAY_MCP_PORT ?? marker.mcpPort ?? 3898);
  const proxyPort = Number(process.env.AGENT_RELAY_PROXY_PORT ?? marker.proxyPort ?? 8081);
  const mcp = probeHttpMcpSync(mcpPort);
  const proxy = probeHttpMcpSync(proxyPort);
  if (!mcp.ok) messages.push(`MCP App unhealthy on 127.0.0.1:${mcpPort}`);
  if (!proxy.ok) messages.push(`Auth proxy unhealthy on 127.0.0.1:${proxyPort}`);

  const localMcpUri = marker.localMcpUri || `http://127.0.0.1:${proxyPort}/mcp`;
  const status = marker && buildExists && tokenPermsOk && mcp.ok && proxy.ok ? 'PASS' : 'FAIL';
  if (status === 'PASS') messages.push('Local MCP + auth proxy healthy');

  return {
    status,
    setupMarker: true,
    mcpHealthy: mcp.ok,
    proxyHealthy: proxy.ok,
    tokenPermsOk,
    buildExists,
    localMcpUri,
    messages,
  };
}

function emptyState(marker: InstallMarker | null, opts: ChatgptConnectOptions): ConnectStateFile {
  const configDir = resolveConfigDir();
  const pDir = profileDir();
  const profileName = opts.profile?.trim() || defaultProfileName(marker);
  assertSafeProfileName(profileName);
  const uri = marker?.localMcpUri || `http://127.0.0.1:${marker?.proxyPort ?? 8081}/mcp`;
  return {
    schemaVersion: CONNECT_STATE_SCHEMA,
    state: 'LOCAL_NOT_READY',
    profileName,
    profileDir: pDir,
    localMcpUri: uri,
    tunnelIdConfigured: false,
    auth: {
      readyConfirmedAt: null,
      mintAttempts: 0,
      runtimeKeyRef: `file:${runtimeKeyPath(configDir)}`,
    },
    chatgpt: {
      capability: 'USER_VERIFICATION_REQUIRED',
      appName: 'Agent Relay Local',
      toolScan: 'REQUIRED',
      widgetMount: 'UNVERIFIED',
      cancelReadyTaskVisible: null,
      verifiedAt: null,
    },
    updatedAt: nowIso(opts),
  };
}

export function assessChatgptConnect(opts: ChatgptConnectOptions = {}): ConnectAssessment {
  const spawn = opts.spawnSyncImpl ?? spawnSync;
  const clientPresent = (opts.tunnelClientPresentImpl ?? tunnelClientPresent)();
  const marker = loadInstallMarker();
  const configDir = resolveConfigDir();
  const local = localPreflight(marker);
  const warnings: string[] = [];
  let stateFile = loadConnectState(configDir) ?? emptyState(marker, opts);
  // Keep profile name from opts if provided
  if (opts.profile?.trim()) {
    assertSafeProfileName(opts.profile.trim());
    stateFile.profileName = opts.profile.trim();
  }
  stateFile.profileDir = profileDir();
  if (local.localMcpUri) stateFile.localMcpUri = local.localMcpUri;

  const nextActions: string[] = [];
  let state: ConnectState = 'LOCAL_NOT_READY';

  if (local.status !== 'PASS') {
    state = 'LOCAL_NOT_READY';
    nextActions.push('Fix local runtime: ./setup.sh && ./scripts/agent-relay-svc start && ./scripts/agent-relay-svc doctor');
  } else if (!clientPresent) {
    state = 'TUNNEL_CLIENT_MISSING';
    nextActions.push('Install OpenAI tunnel-client on PATH (see: tunnel-client help quickstart)');
    nextActions.push('Then re-run: agent-relay connect');
  } else {
    const pExists = profileExists(stateFile.profileDir, stateFile.profileName);
    const auth = detectTunnelAuthNeeded(spawn, stateFile.profileName, stateFile.profileDir);

    if (!pExists || !stateFile.tunnelIdConfigured) {
      state = 'TUNNEL_SETUP_REQUIRED';
      nextActions.push('Create YOUR tunnel in https://platform.openai.com/settings/organization/tunnels');
      nextActions.push('Create YOUR Runtime API key in https://platform.openai.com/settings/organization/api-keys');
      nextActions.push(`When browser/operator is READY, run: agent-relay connect --ready --tunnel-id tunnel_YOUR_ID`);
      nextActions.push('Do not reuse another machine\'s tunnel id, org id, or profile name');
    } else if (auth.needed) {
      if (!opts.ready && !stateFile.auth.readyConfirmedAt) {
        // No browser/operator ready confirmation yet
        const tty = !!process.stdin.isTTY;
        state = tty ? 'TUNNEL_AUTH_REQUIRED' : 'AUTH_TRANSPORT_REQUIRED';
        nextActions.push('Ready the browser/operator first');
        nextActions.push(`Place your Runtime API key at ${runtimeKeyPath(configDir)} (mode 0600) — value never printed`);
        nextActions.push('Then run: agent-relay connect --ready');
      } else {
        state = 'TUNNEL_AUTH_REQUIRED';
        nextActions.push(`Ensure runtime key exists at ${runtimeKeyPath(configDir)} (0600)`);
        nextActions.push(`tunnel-client doctor --profile ${stateFile.profileName} --explain`);
      }
    } else if (probeTunnelReady(spawn, stateFile.profileName, stateFile.profileDir)) {
      // Tunnel config OK
      if (stateFile.chatgpt.toolScan === 'REFRESH_REQUIRED') {
        state = 'CHATGPT_TOOL_REFRESH_REQUIRED';
        nextActions.push('In ChatGPT: Agent Relay Local → App management → Refresh / Scan Tools');
        nextActions.push('Do not delete/reconnect as the first step');
      } else if (stateFile.chatgpt.verifiedAt && stateFile.chatgpt.toolScan === 'VERIFIED' && stateFile.chatgpt.widgetMount === 'VERIFIED') {
        state = 'CHATGPT_CONNECTED';
        nextActions.push('Connected. First harmless Task is P2-D — connect itself creates no work.');
      } else if (stateFile.chatgpt.toolScan === 'VERIFIED' && stateFile.chatgpt.widgetMount === 'UNVERIFIED') {
        state = 'CHATGPT_TOOL_SCAN_REQUIRED';
        nextActions.push('Call relay_pm_open_widget in ChatGPT and confirm the production widget mounts');
      } else if (stateFile.chatgpt.capability === 'USER_VERIFICATION_REQUIRED') {
        state = 'CHATGPT_APP_REQUIRED';
        nextActions.push('Open ChatGPT → enable Developer Mode if your plan supports it');
        nextActions.push('Create/Add custom app "Agent Relay Local" using your Secure MCP Tunnel');
        nextActions.push('Scan tools, complete authorization when prompted, create/enable the app');
        nextActions.push('CHATGPT_CAPABILITY = USER_VERIFICATION_REQUIRED until tool scan proves availability');
      } else {
        state = 'TUNNEL_READY';
        nextActions.push('Start tunnel daemon if needed: tunnel-client run --profile ' + stateFile.profileName);
        nextActions.push('Then connect Agent Relay Local in ChatGPT Developer Mode');
      }
    } else {
      state = 'TUNNEL_AUTH_REQUIRED';
      nextActions.push('tunnel-client doctor did not confirm readiness');
    }
  }

  // Apply explicit human/Aside marks without inventing ChatGPT state from local probes alone
  if (opts.markToolRefreshRequired) {
    state = 'CHATGPT_TOOL_REFRESH_REQUIRED';
    stateFile.chatgpt.toolScan = 'REFRESH_REQUIRED';
    nextActions.length = 0;
    nextActions.push('Server tools exist; ChatGPT catalog is stale → Refresh / Scan Tools');
    nextActions.push('Diagnosis: CHATGPT_TOOL_REFRESH_REQUIRED — do not treat this as a tunnel outage');
  }
  if (opts.markToolScanVerified) {
    stateFile.chatgpt.toolScan = 'VERIFIED';
    stateFile.chatgpt.capability = 'VERIFIED';
  }
  if (opts.markCancelReadyVisible) {
    stateFile.chatgpt.cancelReadyTaskVisible = true;
  }
  if (opts.markWidgetVerified) {
    stateFile.chatgpt.widgetMount = 'VERIFIED';
  }
  if (opts.markChatgptConnected) {
    stateFile.chatgpt.toolScan = 'VERIFIED';
    stateFile.chatgpt.widgetMount = 'VERIFIED';
    stateFile.chatgpt.capability = 'VERIFIED';
    stateFile.chatgpt.verifiedAt = nowIso(opts);
    state = 'CHATGPT_CONNECTED';
  }

  stateFile.state = state;
  stateFile.updatedAt = nowIso(opts);

  const tunnelStatus: ConnectAssessment['tunnel']['status'] =
    state === 'LOCAL_NOT_READY' ? 'PENDING'
      : state === 'TUNNEL_CLIENT_MISSING' ? 'FAIL'
        : state === 'TUNNEL_SETUP_REQUIRED' || state === 'TUNNEL_AUTH_REQUIRED' || state === 'AUTH_TRANSPORT_REQUIRED' ? 'PENDING'
          : (state === 'TUNNEL_READY' || state.startsWith('CHATGPT_')) ? 'PASS' : 'WARN';

  const chatgptStatus: ConnectAssessment['chatgpt']['status'] =
    state === 'CHATGPT_CONNECTED' ? 'PASS'
      : state.startsWith('CHATGPT_') ? 'WARN'
        : 'PENDING';

  const overall: ConnectAssessment['overall'] =
    local.status === 'FAIL' ? 'FAIL'
      : state === 'TUNNEL_CLIENT_MISSING' ? 'FAIL'
        : state === 'CHATGPT_CONNECTED' ? 'PASS'
          : 'HUMAN_GATE_REQUIRED';

  const manifest = {
    appName: 'Agent Relay Local',
    localRuntime: local.status === 'PASS' ? 'READY' : 'NOT_READY',
    secureTunnel: tunnelStatus === 'PASS' ? 'READY' : state,
    authentication: stateFile.tunnelIdConfigured && !detectTunnelAuthNeeded(spawn, stateFile.profileName, stateFile.profileDir).needed
      ? 'configured'
      : 'pending',
    secretValues: 'HIDDEN',
    localMcpUri: local.localMcpUri,
    profileName: stateFile.profileName,
    chatgptCapability: stateFile.chatgpt.capability,
    expectedTools: [
      'relay_pm_open_widget',
      'relay_pm_list_project_profiles',
      'relay_pm_select_project',
      'relay_pm_get_project_assignments',
      'relay_pm_set_project_assignments',
      'relay_pm_get_project',
      'relay_pm_create_goal',
      'relay_pm_create_task',
      'relay_pm_resolve_run',
      'relay_pm_dispatch_owner_approved',
      'relay_pm_cancel_ready_task',
    ],
    toolRefreshHint: 'Agent Relay Local → App management → Refresh / Scan Tools (do not delete/reconnect first)',
  };

  // Persist assessment marks when status-only is false will be done by runChatgptConnect
  return {
    schemaVersion: CHATGPT_CONNECT_SCHEMA,
    ok: local.status === 'PASS' && state !== 'TUNNEL_CLIENT_MISSING' && state !== 'LOCAL_NOT_READY',
    state,
    local,
    tunnel: {
      status: tunnelStatus,
      clientPresent,
      profileName: stateFile.profileName,
      profileExists: profileExists(stateFile.profileDir, stateFile.profileName),
      runtimeKeyPresent: fs.existsSync(runtimeKeyPath(configDir)) && fs.statSync(runtimeKeyPath(configDir)).size > 0,
      messages: [
        clientPresent ? 'tunnel-client present' : 'tunnel-client missing',
        `profile=${stateFile.profileName} exists=${profileExists(stateFile.profileDir, stateFile.profileName)}`,
      ],
    },
    chatgpt: {
      status: chatgptStatus,
      capability: stateFile.chatgpt.capability,
      appName: stateFile.chatgpt.appName,
      messages: [
        `CHATGPT_CAPABILITY = ${stateFile.chatgpt.capability}`,
        `toolScan=${stateFile.chatgpt.toolScan}`,
        `widgetMount=${stateFile.chatgpt.widgetMount}`,
      ],
    },
    overall,
    nextActions,
    manifest,
    secretsHidden: true,
    warnings,
  };
}

function ensureRuntimeKeyPlaceholder(configDir: string): { created: boolean; path: string } {
  const p = runtimeKeyPath(configDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try { fs.chmodSync(path.dirname(p), 0o700); } catch { /* ignore */ }
  if (fs.existsSync(p) && fs.statSync(p).size > 0) {
    try { fs.chmodSync(p, 0o600); } catch { /* ignore */ }
    return { created: false, path: p };
  }
  // Do not invent a key — create empty placeholder only when missing so the path is obvious.
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, '', { encoding: 'utf8', mode: 0o600 });
  }
  try { fs.chmodSync(p, 0o600); } catch { /* ignore */ }
  return { created: true, path: p };
}

function initTunnelProfile(
  spawn: typeof spawnSync,
  opts: {
    profile: string;
    profileDir: string;
    tunnelId: string;
    mcpUrl: string;
    runtimeKeyRef: string;
    force?: boolean;
  },
): { ok: boolean; message: string } {
  assertSafeTunnelId(opts.tunnelId);
  assertSafeProfileName(opts.profile);
  fs.mkdirSync(opts.profileDir, { recursive: true });
  const args = [
    'init',
    '--sample', 'sample_mcp_remote_no_auth',
    '--profile', opts.profile,
    '--profile-dir', opts.profileDir,
    '--tunnel-id', opts.tunnelId,
    '--mcp-server-url', opts.mcpUrl,
    '--control-plane-api-key-ref', opts.runtimeKeyRef,
    '--health-listen-addr', '127.0.0.1:0',
  ];
  if (opts.force) args.push('--force');
  const r = spawnTunnel(spawn, args, { timeout: 30_000 });
  if (r.status === 0) return { ok: true, message: `profile initialized: ${opts.profile}` };
  return {
    ok: false,
    message: redactSecrets(`tunnel-client init failed: ${(r.stderr || r.stdout || 'unknown').slice(0, 500)}`),
  };
}

export function runChatgptConnect(opts: ChatgptConnectOptions = {}): ConnectAssessment {
  const spawn = opts.spawnSyncImpl ?? spawnSync;
  const configDir = resolveConfigDir();
  const marker = loadInstallMarker();
  let stateFile = loadConnectState(configDir) ?? emptyState(marker, opts);

  // Apply Aside/human verification marks (connection metadata only — no Goals/Tasks)
  if (opts.markToolRefreshRequired || opts.markToolScanVerified || opts.markWidgetVerified || opts.markCancelReadyVisible || opts.markChatgptConnected) {
    if (opts.markToolRefreshRequired) stateFile.chatgpt.toolScan = 'REFRESH_REQUIRED';
    if (opts.markToolScanVerified) {
      stateFile.chatgpt.toolScan = 'VERIFIED';
      stateFile.chatgpt.capability = 'VERIFIED';
    }
    if (opts.markCancelReadyVisible) stateFile.chatgpt.cancelReadyTaskVisible = true;
    if (opts.markWidgetVerified) stateFile.chatgpt.widgetMount = 'VERIFIED';
    if (opts.markChatgptConnected) {
      stateFile.chatgpt.toolScan = 'VERIFIED';
      stateFile.chatgpt.widgetMount = 'VERIFIED';
      stateFile.chatgpt.capability = 'VERIFIED';
      stateFile.chatgpt.verifiedAt = nowIso(opts);
      stateFile.state = 'CHATGPT_CONNECTED';
    }
    stateFile.updatedAt = nowIso(opts);
    saveConnectState(stateFile, configDir);
  }

  if (opts.statusOnly) {
    const assessment = assessChatgptConnect(opts);
    return assessment;
  }

  const local = localPreflight(marker);
  if (local.status !== 'PASS') {
    const a = assessChatgptConnect(opts);
    stateFile.state = 'LOCAL_NOT_READY';
    saveConnectState(stateFile, configDir);
    return a;
  }

  const clientPresent = (opts.tunnelClientPresentImpl ?? tunnelClientPresent)();
  if (!clientPresent) {
    stateFile.state = 'TUNNEL_CLIENT_MISSING';
    saveConnectState(stateFile, configDir);
    return assessChatgptConnect(opts);
  }

  const profileName = opts.profile?.trim() || stateFile.profileName || defaultProfileName(marker);
  assertSafeProfileName(profileName);
  stateFile.profileName = profileName;
  stateFile.profileDir = profileDir();
  stateFile.localMcpUri = local.localMcpUri || stateFile.localMcpUri;

  // Auth / profile materialization only when operator is READY
  if (opts.tunnelId) {
    if (!opts.ready) {
      stateFile.state = process.stdin.isTTY ? 'TUNNEL_AUTH_REQUIRED' : 'AUTH_TRANSPORT_REQUIRED';
      stateFile.updatedAt = nowIso(opts);
      saveConnectState(stateFile, configDir);
      const a = assessChatgptConnect(opts);
      a.state = stateFile.state;
      a.error = 'Refusing to materialize tunnel profile before --ready (browser/operator must be ready first).';
      a.nextActions = [
        'Ready the browser/operator',
        `Re-run: agent-relay connect --ready --tunnel-id <YOUR_tunnel_id>`,
        'Never mint/expire/retry codes in a loop',
      ];
      a.ok = false;
      return a;
    }
    assertSafeTunnelId(opts.tunnelId);
    const key = ensureRuntimeKeyPlaceholder(configDir);
    stateFile.auth.runtimeKeyRef = `file:${key.path}`;
    stateFile.auth.readyConfirmedAt = nowIso(opts);
    stateFile.auth.mintAttempts = (stateFile.auth.mintAttempts || 0) + 1;
    // Cap mint attempts — never loop
    if (stateFile.auth.mintAttempts > 3 && !opts.force) {
      stateFile.state = 'TUNNEL_AUTH_REQUIRED';
      saveConnectState(stateFile, configDir);
      const a = assessChatgptConnect({ ...opts, ready: true });
      a.ok = false;
      a.error = 'Auth materialization attempt budget exceeded. Fix the runtime key file, then retry once with --force if needed. No automatic re-mint loop.';
      return a;
    }

    if (!fs.existsSync(key.path) || fs.statSync(key.path).size === 0) {
      stateFile.tunnelIdConfigured = true;
      stateFile.tunnelIdPrefix = opts.tunnelId.slice(0, 12);
      stateFile.state = 'TUNNEL_AUTH_REQUIRED';
      saveConnectState(stateFile, configDir);
      const a = assessChatgptConnect({ ...opts, ready: true });
      a.state = 'TUNNEL_AUTH_REQUIRED';
      a.ok = false;
      a.nextActions = [
        `Paste YOUR Runtime API key into ${key.path} (chmod 600) — do not paste into chat/logs`,
        'Immediate approval in the OpenAI/ChatGPT browser session you already have ready',
        `Then: agent-relay connect --ready --tunnel-id ${opts.tunnelId.slice(0, 12)}…`,
      ];
      // Don't echo full tunnel id repeatedly in next actions beyond prefix guidance
      a.nextActions[2] = `Then: agent-relay connect --ready --tunnel-id <same id>`;
      return a;
    }

    const init = initTunnelProfile(spawn, {
      profile: profileName,
      profileDir: stateFile.profileDir,
      tunnelId: opts.tunnelId,
      mcpUrl: stateFile.localMcpUri,
      runtimeKeyRef: stateFile.auth.runtimeKeyRef,
      force: opts.force,
    });
    if (!init.ok) {
      stateFile.state = 'TUNNEL_SETUP_REQUIRED';
      saveConnectState(stateFile, configDir);
      const a = assessChatgptConnect({ ...opts, ready: true });
      a.ok = false;
      a.error = init.message;
      return a;
    }
    stateFile.tunnelIdConfigured = true;
    stateFile.tunnelIdPrefix = opts.tunnelId.slice(0, 12);
    stateFile.state = 'TUNNEL_READY';
    saveConnectState(stateFile, configDir);
  } else if (opts.ready) {
    // Ready without new tunnel id — try to advance auth if profile exists
    stateFile.auth.readyConfirmedAt = nowIso(opts);
    ensureRuntimeKeyPlaceholder(configDir);
    saveConnectState(stateFile, configDir);
  }

  // Persist latest assessment state
  const assessment = assessChatgptConnect(opts);
  stateFile = loadConnectState(configDir) ?? stateFile;
  stateFile.state = assessment.state;
  stateFile.updatedAt = nowIso(opts);
  saveConnectState(stateFile, configDir);
  return assessment;
}

export function renderChatgptConnectHuman(a: ConnectAssessment): string {
  const lines: string[] = [];
  lines.push('Agent Relay Connect');
  lines.push('');
  lines.push(`State: ${a.state}`);
  lines.push(`Local runtime: ${a.local.status === 'PASS' ? 'PASS' : 'FAIL'}`);
  lines.push(`Secure tunnel: ${a.tunnel.status === 'PASS' ? 'PASS' : a.tunnel.status === 'FAIL' ? 'FAIL' : 'PENDING'}`);
  lines.push(`ChatGPT app: ${a.chatgpt.status === 'PASS' ? 'PASS' : 'VERIFY IN CHATGPT'}`);
  lines.push(`CHATGPT_CAPABILITY = ${a.chatgpt.capability}`);
  lines.push(`Overall: ${a.overall}`);
  lines.push('');
  lines.push('Local checks:');
  for (const m of a.local.messages) lines.push(`  - ${m}`);
  lines.push('Tunnel checks:');
  for (const m of a.tunnel.messages) lines.push(`  - ${m}`);
  lines.push('ChatGPT checks:');
  for (const m of a.chatgpt.messages) lines.push(`  - ${m}`);
  lines.push('');
  lines.push('Connection manifest:');
  lines.push(`  App name: ${a.manifest.appName}`);
  lines.push(`  Local runtime: ${a.manifest.localRuntime}`);
  lines.push(`  Secure tunnel: ${a.manifest.secureTunnel}`);
  lines.push(`  Authentication: ${a.manifest.authentication}`);
  lines.push(`  Secret values: HIDDEN`);
  if (a.manifest.localMcpUri) lines.push(`  Local MCP URI: ${a.manifest.localMcpUri}`);
  if (a.manifest.profileName) lines.push(`  Tunnel profile: ${a.manifest.profileName}`);
  lines.push('');
  lines.push('Next:');
  for (const n of a.nextActions) lines.push(`  → ${n}`);
  if (a.error) {
    lines.push('');
    lines.push(`Error: ${a.error}`);
  }
  lines.push('');
  lines.push('Docs: docs/V1-CHATGPT-CONNECT.md');
  return lines.join('\n');
}

/** Count Goals/Tasks/Runs under dataRoot for zero-work assertions (read-only). */
export function countWorkArtifacts(dataRoot = resolveDataRoot()): { goals: number; tasks: number; runs: number; workers: number } {
  const walk = (dir: string, pred: (n: string) => boolean): number => {
    if (!fs.existsSync(dir)) return 0;
    let n = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) n += walk(p, pred);
      else if (pred(e.name)) n += 1;
    }
    return n;
  };
  // Conservative: only count well-known relay artifact filenames
  const goals = walk(dataRoot, (n) => n === 'goal.json');
  const tasks = walk(dataRoot, (n) => n === 'task.json');
  const runs = walk(dataRoot, (n) => n === 'run.json');
  const workersDir = path.join(dataRoot, '_relay', 'workers');
  const workers = fs.existsSync(workersDir)
    ? fs.readdirSync(workersDir).filter((n) => n.endsWith('.json')).length
    : 0;
  return { goals, tasks, runs, workers };
}
