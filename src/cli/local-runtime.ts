/**
 * Local install / service runtime helpers for clean-install doctor checks.
 * Never prints secret values.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { spawnSync } from 'node:child_process';

export const INSTALL_SCHEMA_VERSION = 'install.v1';

export interface InstallMarker {
  schemaVersion: string;
  instance: string;
  repoRoot: string;
  dataRoot: string;
  configDir: string;
  mcpPort: number;
  proxyPort: number;
  runtime: 'systemd' | 'pidfile' | string;
  unitPrefix?: string;
  mcpUnit?: string;
  proxyUnit?: string;
  project?: string;
  tokenFile?: string;
  proxyEnvFile?: string;
  localMcpUri?: string;
  tunnel?: { status?: string; note?: string };
}

export function resolveConfigDir(): string {
  const override = process.env.AGENT_RELAY_CONFIG_DIR?.trim();
  if (override) return path.resolve(override);
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.join(xdg, 'agent-relay');
  return path.join(os.homedir(), '.config', 'agent-relay');
}

export function resolveDataRoot(): string {
  const override = process.env.AGENT_RELAY_DATA_ROOT?.trim();
  if (override) return path.resolve(override);
  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg) return path.join(xdg, 'agent-relay');
  return path.join(os.homedir(), '.local', 'share', 'agent-relay');
}

export function installMarkerPath(configDir = resolveConfigDir()): string {
  return path.join(configDir, 'install.json');
}

export function loadInstallMarker(configDir = resolveConfigDir()): InstallMarker | null {
  const p = installMarkerPath(configDir);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as InstallMarker;
    if (!raw || typeof raw !== 'object') return null;
    return raw;
  } catch {
    return null;
  }
}

export function fileModeOctal(filePath: string): string | null {
  try {
    const st = fs.statSync(filePath);
    return (st.mode & 0o777).toString(8).padStart(3, '0');
  } catch {
    return null;
  }
}

export function probeHttpMcpSync(port: number, host = '127.0.0.1', timeoutMs = 2000): { ok: boolean; statusCode?: number; error?: string } {
  const script = `
const http=require('http');
const port=${Number(port)};
const host=${JSON.stringify(host)};
const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'agent-relay-doctor',version:'0'}}});
const req=http.request({host,port,path:'/mcp',method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream','content-length':Buffer.byteLength(body)},timeout:${timeoutMs}},res=>{
  process.stdout.write(String(res.statusCode||0));
  process.exit(0);
});
req.on('error',e=>{process.stderr.write(e.message);process.exit(2)});
req.on('timeout',()=>{req.destroy();process.stderr.write('timeout');process.exit(3)});
req.end(body);
`;
  try {
    const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: timeoutMs + 1000 });
    if (r.status === 0) {
      const code = Number((r.stdout || '').trim());
      return { ok: Number.isFinite(code) && code > 0 && code < 500, statusCode: code };
    }
    return { ok: false, error: (r.stderr || 'probe failed').trim() || 'probe failed' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function probeHttpMcp(port: number, host = '127.0.0.1', timeoutMs = 2000): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agent-relay-doctor', version: '0' },
      },
    });
    const req = http.request(
      {
        host,
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'content-length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        const code = res.statusCode ?? 0;
        resolve({ ok: code > 0 && code < 500, statusCode: code });
      },
    );
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.end(body);
  });
}

export function pidfileAlive(runtimeDir: string, name: string): { alive: boolean; pid?: number } {
  const f = path.join(runtimeDir, `${name}.pid`);
  if (!fs.existsSync(f)) return { alive: false };
  try {
    const pid = Number(fs.readFileSync(f, 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 0) return { alive: false };
    try {
      process.kill(pid, 0);
      return { alive: true, pid };
    } catch {
      return { alive: false, pid };
    }
  } catch {
    return { alive: false };
  }
}

export function systemdUserActive(unit: string): 'active' | 'inactive' | 'unknown' {
  try {
    const r = spawnSync('systemctl', ['--user', 'is-active', `${unit}.service`], {
      encoding: 'utf8',
      timeout: 3000,
    });
    const out = (r.stdout || '').trim();
    if (out === 'active') return 'active';
    if (out === 'inactive' || out === 'failed') return 'inactive';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function tunnelClientPresent(): boolean {
  try {
    const r = spawnSync('bash', ['-lc', 'command -v tunnel-client'], { encoding: 'utf8', timeout: 2000 });
    return r.status === 0 && !!(r.stdout || '').trim();
  } catch {
    return false;
  }
}

export interface LocalRuntimeDoctorExtras {
  checks: Array<{ id: string; status: 'PASS' | 'WARN' | 'FAIL'; message: string; required: boolean }>;
}

/** Additive local-service checks for doctor. Never includes secret values. */
export function collectLocalRuntimeChecks(): LocalRuntimeDoctorExtras {
  const checks: LocalRuntimeDoctorExtras['checks'] = [];
  const configDir = resolveConfigDir();
  const marker = loadInstallMarker(configDir);

  if (!marker) {
    checks.push({
      id: 'install-marker',
      status: 'WARN',
      message: `No install.json under ${configDir} (run ./setup.sh for ChatGPT Local path)`,
      required: false,
    });
    return { checks };
  }

  checks.push({
    id: 'install-marker',
    status: 'PASS',
    message: `Install marker present (instance=${marker.instance}, runtime=${marker.runtime})`,
    required: true,
  });

  const dataRoot = marker.dataRoot || resolveDataRoot();
  if (fs.existsSync(dataRoot)) {
    checks.push({ id: 'local-data', status: 'PASS', message: `Local data directory exists: ${dataRoot}`, required: true });
  } else {
    checks.push({ id: 'local-data', status: 'FAIL', message: `Local data directory missing: ${dataRoot}`, required: true });
  }

  const tokenFile = marker.tokenFile || path.join(configDir, 'mcp-token');
  if (fs.existsSync(tokenFile)) {
    const mode = fileModeOctal(tokenFile);
    if (mode === '600') {
      checks.push({ id: 'mcp-token-perms', status: 'PASS', message: 'mcp-token present with mode 600', required: true });
    } else {
      checks.push({ id: 'mcp-token-perms', status: 'WARN', message: `mcp-token mode ${mode ?? 'unknown'} (expected 600)`, required: false });
    }
  } else {
    checks.push({ id: 'mcp-token-perms', status: 'FAIL', message: 'mcp-token missing', required: true });
  }

  const mcpPort = Number(process.env.AGENT_RELAY_MCP_PORT ?? marker.mcpPort ?? 3898);
  const proxyPort = Number(process.env.AGENT_RELAY_PROXY_PORT ?? marker.proxyPort ?? 8081);

  if (marker.runtime === 'pidfile') {
    const runtimeDir = path.join(configDir, 'runtime');
    const mcp = pidfileAlive(runtimeDir, 'mcp-app');
    const proxy = pidfileAlive(runtimeDir, 'auth-proxy');
    checks.push({
      id: 'mcp-app-process',
      status: mcp.alive ? 'PASS' : 'FAIL',
      message: mcp.alive ? `MCP App pidfile alive (pid ${mcp.pid})` : 'MCP App not running (pidfile)',
      required: true,
    });
    checks.push({
      id: 'auth-proxy-process',
      status: proxy.alive ? 'PASS' : 'FAIL',
      message: proxy.alive ? `Auth proxy pidfile alive (pid ${proxy.pid})` : 'Auth proxy not running (pidfile)',
      required: true,
    });
  } else if (marker.runtime === 'systemd') {
    const mcpUnit = marker.mcpUnit || 'agent-relay-mcp-app';
    const proxyUnit = marker.proxyUnit || 'agent-relay-auth-proxy';
    const mcpSt = systemdUserActive(mcpUnit);
    const proxySt = systemdUserActive(proxyUnit);
    checks.push({
      id: 'mcp-app-process',
      status: mcpSt === 'active' ? 'PASS' : 'FAIL',
      message: `MCP unit ${mcpUnit}: ${mcpSt}`,
      required: true,
    });
    checks.push({
      id: 'auth-proxy-process',
      status: proxySt === 'active' ? 'PASS' : 'FAIL',
      message: `Auth proxy unit ${proxyUnit}: ${proxySt}`,
      required: true,
    });
  }

  const mcpProbe = probeHttpMcpSync(mcpPort);
  checks.push({
    id: 'mcp-app-health',
    status: mcpProbe.ok ? 'PASS' : 'FAIL',
    message: mcpProbe.ok
      ? `MCP App health OK on 127.0.0.1:${mcpPort}`
      : `MCP App health FAIL on 127.0.0.1:${mcpPort}${mcpProbe.error ? ` (${mcpProbe.error})` : ''}`,
    required: true,
  });

  const proxyProbe = probeHttpMcpSync(proxyPort);
  checks.push({
    id: 'auth-proxy-health',
    status: proxyProbe.ok ? 'PASS' : 'FAIL',
    message: proxyProbe.ok
      ? `Auth proxy health OK on 127.0.0.1:${proxyPort}`
      : `Auth proxy health FAIL on 127.0.0.1:${proxyPort}${proxyProbe.error ? ` (${proxyProbe.error})` : ''}`,
    required: true,
  });

  const uri = marker.localMcpUri || `http://127.0.0.1:${proxyPort}/mcp`;
  checks.push({
    id: 'chatgpt-local-uri',
    status: 'PASS',
    message: `ChatGPT-facing local MCP URI: ${uri}`,
    required: false,
  });

  const tunnelStatus = marker.tunnel?.status || 'HUMAN_GATE_REQUIRED';
  if (tunnelClientPresent()) {
    checks.push({
      id: 'tunnel',
      status: 'WARN',
      message: `tunnel-client present; status=${tunnelStatus} — create YOUR own profile (never reuse another host tunnel id)`,
      required: false,
    });
  } else {
    checks.push({
      id: 'tunnel',
      status: 'WARN',
      message: 'tunnel-client not on PATH — Human Gate required before ChatGPT Secure MCP Tunnel',
      required: false,
    });
  }

  const uiState = path.join(dataRoot, '_relay', 'ui-state.json');
  if (fs.existsSync(uiState)) {
    checks.push({ id: 'bootstrap-readiness', status: 'PASS', message: 'ui-state present (project selection may exist)', required: false });
  } else {
    checks.push({
      id: 'bootstrap-readiness',
      status: 'WARN',
      message: 'No ui-state yet — first-run bootstrap expected after ChatGPT connect',
      required: false,
    });
  }

  return { checks };
}
