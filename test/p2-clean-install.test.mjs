/**
 * P2-A/B clean install contract tests (A–K + production isolation).
 * Uses an isolated HOME + pidfile runtime + non-production ports.
 * Never mutates production systemd units or ports 3898/8081.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as net from 'node:net';
import { spawnSync, spawn } from 'node:child_process';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SETUP = path.join(REPO, 'setup.sh');
const SVC = path.join(REPO, 'scripts', 'agent-relay-svc');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

function run(cmd, args, env, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: opts.timeout ?? 120_000,
  });
}

function modeOf(p) {
  return (fs.statSync(p).mode & 0o777).toString(8).padStart(3, '0');
}

function prodPortsStillOurs() {
  // Production must remain on 3898/8081 if it was up. We only assert listeners
  // that existed at suite start stay present — captured below.
  return true;
}

describe('P2 clean install', () => {
  let home;
  let mcpPort;
  let proxyPort;
  let env;
  let prodMcpPid;
  let prodProxyPid;

  before(async () => {
    // Snapshot production listeners (must remain untouched).
    const ss = spawnSync('bash', ['-lc', "ss -ltnp 2>/dev/null | grep -E '3898|8081' || true"], { encoding: 'utf8' });
    const m3898 = /:3898\b.*pid=(\d+)/.exec(ss.stdout || '');
    const m8081 = /:8081\b.*pid=(\d+)/.exec(ss.stdout || '');
    prodMcpPid = m3898?.[1] ?? null;
    prodProxyPid = m8081?.[1] ?? null;

    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-clean-'));
    mcpPort = await freePort();
    proxyPort = await freePort();
    // Ensure distinct from production defaults
    assert.notEqual(mcpPort, 3898);
    assert.notEqual(proxyPort, 8081);

    env = {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
      AGENT_RELAY_INSTANCE: 'clean-test',
      AGENT_RELAY_MCP_PORT: String(mcpPort),
      AGENT_RELAY_PROXY_PORT: String(proxyPort),
      AGENT_RELAY_RUNTIME: 'pidfile',
      AGENT_RELAY_SETUP_SKIP_DEPS: '1',
    };

    // Build once if needed so SKIP_DEPS is valid.
    if (!fs.existsSync(path.join(REPO, 'dist/server/mcp/app-server-main.js'))) {
      const b = run('npm', ['run', 'build'], {}, { timeout: 180_000 });
      assert.equal(b.status, 0, `build failed: ${b.stderr}`);
    }
  });

  after(() => {
    try {
      run('bash', [SVC, 'stop'], env, { timeout: 15_000 });
    } catch { /* ignore */ }
    try {
      fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch { /* ignore */ }
  });

  it('A. clean data root setup PASS', () => {
    // Starting files: empty home — no _relay, roles, workers, secrets
    const data = path.join(home, '.local', 'share', 'agent-relay');
    const cfg = path.join(home, '.config', 'agent-relay');
    assert.equal(fs.existsSync(data), false);
    assert.equal(fs.existsSync(cfg), false);

    const r = run('bash', [SETUP], env, { timeout: 180_000 });
    assert.equal(r.status, 0, `setup failed:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /local services: READY/i);

    assert.ok(fs.existsSync(path.join(cfg, 'install.json')));
    assert.ok(fs.existsSync(path.join(cfg, 'mcp-token')));
    assert.ok(fs.existsSync(path.join(cfg, 'mcp-proxy.env')));
    assert.ok(fs.existsSync(data));
    // No historical ASUS paths
    assert.equal(fs.existsSync(path.join(home, '.local', 'share', 'AgentRelay')), false);
    const marker = JSON.parse(fs.readFileSync(path.join(cfg, 'install.json'), 'utf8'));
    assert.equal(marker.mcpPort, mcpPort);
    assert.equal(marker.proxyPort, proxyPort);
    assert.equal(marker.runtime, 'pidfile');
    assert.match(marker.tunnel?.status || '', /HUMAN_GATE/);
    // No hard-coded production tunnel identity
    const blob = JSON.stringify(marker);
    assert.doesNotMatch(blob, /tunnel_6abd/i);
    assert.doesNotMatch(blob, /org-eTRXK/i);
    assert.doesNotMatch(blob, /agent-relay-asus/i);
  });

  it('B. second setup idempotent PASS', () => {
    const tokenPath = path.join(home, '.config', 'agent-relay', 'mcp-token');
    const before = fs.readFileSync(tokenPath);
    const r = run('bash', [SETUP], env, { timeout: 180_000 });
    assert.equal(r.status, 0, `second setup failed:\n${r.stdout}\n${r.stderr}`);
    const after = fs.readFileSync(tokenPath);
    assert.deepEqual(before, after, 'token must not regenerate');
    assert.match(r.stdout, /already configured/i);
  });

  it('C. no historical data dependency', () => {
    const data = path.join(home, '.local', 'share', 'agent-relay');
    // Fresh tree must not carry over ASUS/production selection or Goals/Tasks
    const ui = path.join(data, '_relay', 'ui-state.json');
    assert.equal(fs.existsSync(ui), false);
    assert.equal(fs.existsSync(path.join(data, 'ws', '_relay', 'goals')), false);
    assert.equal(fs.existsSync(path.join(home, '.local', 'share', 'AgentRelay')), false);
    // Built-in worker seeds from ensureBuiltInWorkers are allowed; historical
    // host-specific names must not appear.
    const workers = path.join(data, '_relay', 'workers');
    if (fs.existsSync(workers)) {
      const entries = fs.readdirSync(workers).filter((n) => !n.startsWith('.'));
      for (const e of entries) {
        assert.doesNotMatch(e, /asus|agent-relay-asus/i);
      }
    }
  });

  it('D. secret files restrictive and ignored by git', () => {
    const tokenPath = path.join(home, '.config', 'agent-relay', 'mcp-token');
    const envPath = path.join(home, '.config', 'agent-relay', 'mcp-proxy.env');
    assert.equal(modeOf(tokenPath), '600');
    assert.equal(modeOf(envPath), '600');
    // Values must not appear in setup stdout
    const token = fs.readFileSync(tokenPath, 'utf8').trim();
    const first = run('bash', [SETUP], env, { timeout: 180_000 });
    assert.ok(!first.stdout.includes(token), 'setup must not print token');
    assert.ok(!first.stderr.includes(token), 'setup stderr must not print token');

    // Repo gitignore covers secret basenames
    const gi = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
    assert.match(gi, /mcp-token/);
    assert.match(gi, /mcp-proxy\.env/);
    assert.match(gi, /\.agent-relay\//);

    // Accidental git status in repo must not list home secrets (they are outside repo)
    const st = spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' });
    assert.ok(!st.stdout.includes(tokenPath));
    assert.ok(!st.stdout.includes('mcp-token') || !st.stdout.split('\n').some((l) => l.includes('mcp-token') && !l.includes('.gitignore')));
  });

  it('E. start/status PASS', () => {
    const st = run('bash', [SVC, 'status'], env);
    assert.equal(st.status, 0, st.stdout + st.stderr);
    assert.match(st.stdout, /mcp-app: active/);
    assert.match(st.stdout, /auth-proxy: active/);
    assert.match(st.stdout, new RegExp(`:${mcpPort}`));
    assert.match(st.stdout, new RegExp(`:${proxyPort}`));
  });

  it('F. restart PASS', () => {
    const r = run('bash', [SVC, 'restart'], env, { timeout: 30_000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const st = run('bash', [SVC, 'status'], env);
    assert.equal(st.status, 0, st.stdout + st.stderr);
    assert.match(st.stdout, /mcp-app: active/);
    assert.match(st.stdout, /auth-proxy: active/);
  });

  it('G. stop/start PASS', () => {
    const stop = run('bash', [SVC, 'stop'], env);
    assert.equal(stop.status, 0, stop.stdout + stop.stderr);
    const st1 = run('bash', [SVC, 'status'], env);
    // status may exit non-zero when unhealthy; still assert inactive text
    assert.match(st1.stdout + st1.stderr, /mcp-app: inactive/);
    const start = run('bash', [SVC, 'start'], env, { timeout: 30_000 });
    assert.equal(start.status, 0, start.stdout + start.stderr);
    const st2 = run('bash', [SVC, 'status'], env);
    assert.equal(st2.status, 0, st2.stdout + st2.stderr);
    assert.match(st2.stdout, /mcp-app: active/);
  });

  it('H. doctor reports healthy isolated install', () => {
    const cli = path.join(REPO, 'dist/server/cli/index.js');
    const r = spawnSync(process.execPath, [cli, 'doctor', '--json'], {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: 30_000,
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, true);
    assert.ok(j.summary === 'PASS' || j.summary === 'WARN');
    const byId = Object.fromEntries(j.checks.map((c) => [c.id, c]));
    assert.equal(byId['install-marker']?.status, 'PASS');
    assert.equal(byId['mcp-app-health']?.status, 'PASS');
    assert.equal(byId['auth-proxy-health']?.status, 'PASS');
    assert.equal(byId['mcp-token-perms']?.status, 'PASS');
    assert.ok(byId.tunnel?.status === 'WARN' || byId.tunnel?.status === 'PASS');
    // No secret leakage
    const token = fs.readFileSync(path.join(home, '.config', 'agent-relay', 'mcp-token'), 'utf8').trim();
    assert.ok(!r.stdout.includes(token));
  });

  it('I. broken prerequisite fails clearly', () => {
    const badHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-clean-prereq-'));
    const bin = path.join(badHome, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    // Fake `node` that reports an ancient version so setup fail-closes.
    fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\necho v12.0.0\n', { mode: 0o755 });
    // Keep real npm/tmux/ss available further down PATH.
    const r = run('bash', [SETUP], {
      HOME: badHome,
      XDG_CONFIG_HOME: path.join(badHome, '.config'),
      XDG_DATA_HOME: path.join(badHome, '.local', 'share'),
      AGENT_RELAY_INSTANCE: 'prereq-fail',
      AGENT_RELAY_MCP_PORT: '19998',
      AGENT_RELAY_PROXY_PORT: '19999',
      AGENT_RELAY_RUNTIME: 'pidfile',
      AGENT_RELAY_SETUP_SKIP_DEPS: '1',
      PATH: `${bin}:${process.env.PATH}`,
    }, { timeout: 20_000 });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /too old|Need >= 18|ERROR/i);
    fs.rmSync(badHome, { recursive: true, force: true });
  });

  it('J. port collision fails clearly', async () => {
    run('bash', [SVC, 'stop'], env);
    // Wait until MCP port is free
    for (let i = 0; i < 40; i++) {
      const free = await new Promise((resolve) => {
        const s = net.createServer();
        s.once('error', () => resolve(false));
        s.listen(mcpPort, '127.0.0.1', () => s.close(() => resolve(true)));
      });
      if (free) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const blocker = net.createServer();
    await new Promise((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(mcpPort, '127.0.0.1', resolve);
    });
    try {
      const start = run('bash', [SVC, 'start'], env, { timeout: 15_000 });
      assert.notEqual(start.status, 0);
      assert.match(start.stderr + start.stdout, /already in use|port/i);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
      run('bash', [SVC, 'start'], env, { timeout: 30_000 });
    }
  });

  it('K. no production service mutation', () => {
    const ss = spawnSync('bash', ['-lc', "ss -ltnp 2>/dev/null | grep -E '3898|8081' || true"], { encoding: 'utf8' });
    if (prodMcpPid) {
      assert.match(ss.stdout, new RegExp(`:3898\\b.*pid=${prodMcpPid}`));
    }
    if (prodProxyPid) {
      assert.match(ss.stdout, new RegExp(`:8081\\b.*pid=${prodProxyPid}`));
    }
    // Isolated units must not overwrite production unit names when instance=clean-test
    const marker = JSON.parse(fs.readFileSync(path.join(home, '.config', 'agent-relay', 'install.json'), 'utf8'));
    assert.notEqual(marker.mcpUnit, 'agent-relay-mcp-app');
    assert.match(marker.mcpUnit, /clean-test/);
    // Production unit files untouched timestamps — at least still present and active
    const prod = spawnSync('systemctl', ['--user', 'is-active', 'agent-relay-mcp-app', 'agent-relay-auth-proxy', 'agent-relay-tunnel'], { encoding: 'utf8' });
    assert.match(prod.stdout, /active/);
    void prodPortsStillOurs;
  });
});
