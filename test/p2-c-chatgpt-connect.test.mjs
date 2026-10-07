/**
 * P2-C ChatGPT connect UX tests (A–K + regression hooks).
 * Uses isolated HOME. Never touches production tunnel profile agent-relay-asus.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function writeInstall(home, overrides = {}) {
  const configDir = path.join(home, '.config', 'agent-relay');
  const dataRoot = path.join(home, '.local', 'share', 'agent-relay');
  fs.mkdirSync(path.join(configDir, 'secrets'), { recursive: true });
  fs.mkdirSync(path.join(dataRoot, '_relay', 'workers'), { recursive: true });
  fs.writeFileSync(path.join(configDir, 'mcp-token'), 'a'.repeat(64), { mode: 0o600 });
  fs.writeFileSync(path.join(configDir, 'mcp-proxy.env'), 'MCP_TOKEN=dummy\n', { mode: 0o600 });
  const marker = {
    schemaVersion: 'install.v1',
    instance: 'p2c-test',
    repoRoot: REPO,
    dataRoot,
    configDir,
    mcpPort: 23998,
    proxyPort: 28081,
    runtime: 'pidfile',
    unitPrefix: 'agent-relay-p2c-test',
    mcpUnit: 'agent-relay-p2c-test-mcp-app',
    proxyUnit: 'agent-relay-p2c-test-auth-proxy',
    project: 'ws',
    tokenFile: path.join(configDir, 'mcp-token'),
    proxyEnvFile: path.join(configDir, 'mcp-proxy.env'),
    localMcpUri: 'http://127.0.0.1:28081/mcp',
    tunnel: { status: 'HUMAN_GATE_REQUIRED' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
  fs.writeFileSync(path.join(configDir, 'install.json'), JSON.stringify(marker, null, 2));
  return { configDir, dataRoot, marker };
}

function envFor(home, extra = {}) {
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    AGENT_RELAY_INSTANCE: 'p2c-test',
    AGENT_RELAY_CONNECT_TEST_LOCAL: 'PASS',
    TUNNEL_CLIENT_PROFILE_DIR: path.join(home, '.config', 'tunnel-client'),
    ...extra,
  };
}

describe('P2-C ChatGPT connect', () => {
  let mod;
  let homes = [];

  before(async () => {
    if (!fs.existsSync(path.join(REPO, 'dist/server/cli/chatgpt-connect.js'))) {
      const b = spawnSync('npm', ['run', 'build'], { cwd: REPO, encoding: 'utf8', timeout: 180_000 });
      assert.equal(b.status, 0, b.stderr);
    }
    mod = await import('../dist/server/cli/chatgpt-connect.js');
  });

  after(() => {
    for (const h of homes) {
      try { fs.rmSync(h, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* ignore */ }
    }
  });

  function mkHome() {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-p2c-'));
    homes.push(h);
    return h;
  }

  function withHome(home, fn) {
    const prev = { ...process.env };
    Object.assign(process.env, envFor(home));
    try {
      return fn();
    } finally {
      for (const k of Object.keys(process.env)) {
        if (!(k in prev)) delete process.env[k];
      }
      Object.assign(process.env, prev);
    }
  }

  it('A. connect on uninstalled instance → LOCAL_NOT_READY', () => {
    const home = mkHome();
    withHome(home, () => {
      delete process.env.AGENT_RELAY_CONNECT_TEST_LOCAL;
      const a = mod.runChatgptConnect({ statusOnly: true, tunnelClientPresentImpl: () => true });
      assert.equal(a.state, 'LOCAL_NOT_READY');
      assert.equal(a.local.status, 'FAIL');
    });
  });

  it('B. local healthy + tunnel-client missing → TUNNEL_CLIENT_MISSING', () => {
    const home = mkHome();
    writeInstall(home);
    withHome(home, () => {
      const a = mod.runChatgptConnect({ statusOnly: true, tunnelClientPresentImpl: () => false });
      assert.equal(a.state, 'TUNNEL_CLIENT_MISSING');
    });
  });

  it('C. local healthy + no profile → TUNNEL_SETUP_REQUIRED', () => {
    const home = mkHome();
    writeInstall(home);
    withHome(home, () => {
      const a = mod.runChatgptConnect({ statusOnly: true, tunnelClientPresentImpl: () => true });
      assert.equal(a.state, 'TUNNEL_SETUP_REQUIRED');
      assert.match(a.nextActions.join('\n'), /Create YOUR tunnel/i);
    });
  });

  it('D. auth needed → TUNNEL_AUTH_REQUIRED', () => {
    const home = mkHome();
    const { configDir } = writeInstall(home);
    const profileDir = path.join(home, '.config', 'tunnel-client');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'agent-relay-p2c-test.yaml'), 'config_version: 1\n');
    fs.writeFileSync(path.join(configDir, 'connect-state.json'), JSON.stringify({
      schemaVersion: 'connect.v1',
      state: 'TUNNEL_AUTH_REQUIRED',
      profileName: 'agent-relay-p2c-test',
      profileDir,
      localMcpUri: 'http://127.0.0.1:28081/mcp',
      tunnelIdConfigured: true,
      tunnelIdPrefix: 'tunnel_test',
      auth: { readyConfirmedAt: null, mintAttempts: 0, runtimeKeyRef: 'file:x' },
      chatgpt: {
        capability: 'USER_VERIFICATION_REQUIRED',
        appName: 'Agent Relay Local',
        toolScan: 'REQUIRED',
        widgetMount: 'UNVERIFIED',
        cancelReadyTaskVisible: null,
        verifiedAt: null,
      },
      updatedAt: new Date().toISOString(),
    }, null, 2));
    withHome(home, () => {
      const spawn = () => ({ status: 1, stdout: '', stderr: 'CONTROL_PLANE_API_KEY missing' });
      const a = mod.assessChatgptConnect({
        tunnelClientPresentImpl: () => true,
        spawnSyncImpl: spawn,
      });
      assert.ok(
        a.state === 'TUNNEL_AUTH_REQUIRED' || a.state === 'AUTH_TRANSPORT_REQUIRED',
        `got ${a.state}`,
      );
    });
  });

  it('E. short-lived auth does not mint until ready', () => {
    const home = mkHome();
    writeInstall(home);
    withHome(home, () => {
      const calls = [];
      const spawn = (cmd, args) => {
        calls.push([cmd, args]);
        return { status: 0, stdout: 'ok', stderr: '' };
      };
      const a = mod.runChatgptConnect({
        tunnelId: 'tunnel_abcdef0123456789abcdef01234567',
        ready: false,
        tunnelClientPresentImpl: () => true,
        spawnSyncImpl: spawn,
      });
      assert.ok(
        a.state === 'TUNNEL_AUTH_REQUIRED' || a.state === 'AUTH_TRANSPORT_REQUIRED',
        `got ${a.state}`,
      );
      assert.match(a.error || a.nextActions.join('\n'), /--ready|READY|Refusing/i);
      assert.equal(calls.filter((c) => c[0] === 'tunnel-client' && c[1]?.[0] === 'init').length, 0);
    });
  });

  it('F. successful tunnel → TUNNEL_READY / CHATGPT_APP_REQUIRED', () => {
    const home = mkHome();
    const { configDir } = writeInstall(home);
    const profileDir = path.join(home, '.config', 'tunnel-client');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'agent-relay-p2c-test.yaml'), 'config_version: 1\ncontrol_plane: {}\n');
    fs.writeFileSync(path.join(configDir, 'secrets', 'tunnel-runtime-key'), 'sk-test-not-real-key-value', { mode: 0o600 });
    fs.writeFileSync(path.join(configDir, 'connect-state.json'), JSON.stringify({
      schemaVersion: 'connect.v1',
      state: 'TUNNEL_READY',
      profileName: 'agent-relay-p2c-test',
      profileDir,
      localMcpUri: 'http://127.0.0.1:28081/mcp',
      tunnelIdConfigured: true,
      tunnelIdPrefix: 'tunnel_abcd',
      auth: { readyConfirmedAt: new Date().toISOString(), mintAttempts: 1, runtimeKeyRef: `file:${path.join(configDir, 'secrets', 'tunnel-runtime-key')}` },
      chatgpt: {
        capability: 'USER_VERIFICATION_REQUIRED',
        appName: 'Agent Relay Local',
        toolScan: 'REQUIRED',
        widgetMount: 'UNVERIFIED',
        cancelReadyTaskVisible: null,
        verifiedAt: null,
      },
      updatedAt: new Date().toISOString(),
    }, null, 2));
    withHome(home, () => {
      const spawn = (cmd, args) => {
        if (args?.[0] === 'doctor') return { status: 0, stdout: 'ok', stderr: '' };
        if (args?.[0] === 'health') return { status: 0, stdout: '{"ready":true}', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      };
      const a = mod.assessChatgptConnect({
        tunnelClientPresentImpl: () => true,
        spawnSyncImpl: spawn,
      });
      assert.ok(
        a.state === 'TUNNEL_READY' || a.state === 'CHATGPT_APP_REQUIRED',
        `got ${a.state}`,
      );
      assert.equal(a.tunnel.status, 'PASS');
      assert.equal(a.chatgpt.capability, 'USER_VERIFICATION_REQUIRED');
    });
  });

  it('G. connection output contains no secrets', () => {
    const home = mkHome();
    const { configDir } = writeInstall(home);
    const secret = 'SUPER_SECRET_RUNTIME_KEY_VALUE_9f3a';
    fs.writeFileSync(path.join(configDir, 'secrets', 'tunnel-runtime-key'), secret, { mode: 0o600 });
    withHome(home, () => {
      const a = mod.runChatgptConnect({
        statusOnly: true,
        tunnelClientPresentImpl: () => true,
      });
      const human = mod.renderChatgptConnectHuman(a);
      const blob = JSON.stringify(a) + '\n' + human;
      assert.ok(!blob.includes(secret));
      assert.ok(!blob.includes(fs.readFileSync(path.join(configDir, 'mcp-token'), 'utf8')));
      assert.match(human, /HIDDEN/);
    });
  });

  it('H. current-user tunnel/org IDs absent', () => {
    const home = mkHome();
    writeInstall(home);
    withHome(home, () => {
      assert.throws(
        () => mod.runChatgptConnect({
          ready: true,
          tunnelId: 'tunnel_6abd3863deadbeef',
          tunnelClientPresentImpl: () => true,
          spawnSyncImpl: () => ({ status: 0, stdout: '', stderr: '' }),
        }),
        /forbidden|Refusing/i,
      );
      assert.throws(
        () => mod.runChatgptConnect({
          ready: true,
          tunnelId: 'tunnel_ok_fresh_user_0001',
          profile: 'agent-relay-asus',
          tunnelClientPresentImpl: () => true,
          spawnSyncImpl: () => ({ status: 0, stdout: '', stderr: '' }),
        }),
        /forbidden|asus/i,
      );
      const a = mod.runChatgptConnect({ statusOnly: true, tunnelClientPresentImpl: () => true });
      const blob = JSON.stringify(a) + mod.renderChatgptConnectHuman(a);
      assert.doesNotMatch(blob, /org-eTRXK/i);
      assert.doesNotMatch(blob, /agent-relay-asus/i);
    });
  });

  it('I. local restart preserves tunnel configuration', () => {
    const home = mkHome();
    const { configDir } = writeInstall(home);
    const profileDir = path.join(home, '.config', 'tunnel-client');
    fs.mkdirSync(profileDir, { recursive: true });
    const profilePath = path.join(profileDir, 'agent-relay-p2c-test.yaml');
    fs.writeFileSync(profilePath, 'config_version: 1\n# user profile\n');
    fs.writeFileSync(path.join(configDir, 'secrets', 'tunnel-runtime-key'), 'key-material', { mode: 0o600 });
    fs.writeFileSync(path.join(configDir, 'connect-state.json'), JSON.stringify({
      schemaVersion: 'connect.v1',
      state: 'TUNNEL_READY',
      profileName: 'agent-relay-p2c-test',
      profileDir,
      localMcpUri: 'http://127.0.0.1:28081/mcp',
      tunnelIdConfigured: true,
      tunnelIdPrefix: 'tunnel_keep',
      auth: { readyConfirmedAt: '2026-01-01T00:00:00.000Z', mintAttempts: 1, runtimeKeyRef: 'file:x' },
      chatgpt: {
        capability: 'USER_VERIFICATION_REQUIRED',
        appName: 'Agent Relay Local',
        toolScan: 'REQUIRED',
        widgetMount: 'UNVERIFIED',
        cancelReadyTaskVisible: null,
        verifiedAt: null,
      },
      updatedAt: new Date().toISOString(),
    }, null, 2));
    const beforeProfile = fs.readFileSync(profilePath, 'utf8');
    const beforeState = fs.readFileSync(path.join(configDir, 'connect-state.json'), 'utf8');
    withHome(home, () => {
      // Simulate local-only restart assessment — must not wipe identity
      mod.assessChatgptConnect({
        tunnelClientPresentImpl: () => true,
        spawnSyncImpl: () => ({ status: 0, stdout: 'ok', stderr: '' }),
      });
    });
    assert.equal(fs.readFileSync(profilePath, 'utf8'), beforeProfile);
    assert.equal(JSON.parse(fs.readFileSync(path.join(configDir, 'connect-state.json'), 'utf8')).tunnelIdConfigured, true);
    assert.equal(JSON.parse(beforeState).tunnelIdPrefix, 'tunnel_keep');
  });

  it('J. stale catalog maps to CHATGPT_TOOL_REFRESH_REQUIRED', () => {
    const home = mkHome();
    const { configDir } = writeInstall(home);
    const profileDir = path.join(home, '.config', 'tunnel-client');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'agent-relay-p2c-test.yaml'), 'config_version: 1\n');
    fs.writeFileSync(path.join(configDir, 'secrets', 'tunnel-runtime-key'), 'key', { mode: 0o600 });
    fs.writeFileSync(path.join(configDir, 'connect-state.json'), JSON.stringify({
      schemaVersion: 'connect.v1',
      state: 'TUNNEL_READY',
      profileName: 'agent-relay-p2c-test',
      profileDir,
      localMcpUri: 'http://127.0.0.1:28081/mcp',
      tunnelIdConfigured: true,
      auth: { readyConfirmedAt: new Date().toISOString(), mintAttempts: 1, runtimeKeyRef: 'file:x' },
      chatgpt: {
        capability: 'VERIFIED',
        appName: 'Agent Relay Local',
        toolScan: 'VERIFIED',
        widgetMount: 'VERIFIED',
        cancelReadyTaskVisible: false,
        verifiedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    }, null, 2));
    withHome(home, () => {
      const a = mod.runChatgptConnect({
        markToolRefreshRequired: true,
        tunnelClientPresentImpl: () => true,
        spawnSyncImpl: () => ({ status: 0, stdout: 'ok', stderr: '' }),
      });
      assert.equal(a.state, 'CHATGPT_TOOL_REFRESH_REQUIRED');
      assert.match(a.nextActions.join('\n'), /CHATGPT_TOOL_REFRESH_REQUIRED/);
      assert.match(a.nextActions.join('\n'), /do not treat this as a tunnel outage/i);
      assert.notEqual(a.state, 'TUNNEL_CLIENT_MISSING');
      assert.notEqual(a.tunnel.status, 'FAIL');
    });
  });

  it('K. no Goal/Task/Run/Worker side effect from connect', () => {
    const home = mkHome();
    const { dataRoot } = writeInstall(home);
    withHome(home, () => {
      const before = mod.countWorkArtifacts(dataRoot);
      mod.runChatgptConnect({
        statusOnly: false,
        tunnelClientPresentImpl: () => true,
        spawnSyncImpl: () => ({ status: 1, stdout: '', stderr: 'no' }),
      });
      const after = mod.countWorkArtifacts(dataRoot);
      assert.deepEqual(after.goals, before.goals);
      assert.deepEqual(after.tasks, before.tasks);
      assert.deepEqual(after.runs, before.runs);
      // Built-in workers may exist only after MCP start; connect itself must not add worker files
      assert.equal(after.workers, before.workers);
      // connect-state may exist — that is connection metadata, not work
      assert.ok(fs.existsSync(path.join(home, '.config', 'agent-relay', 'connect-state.json')));
    });
  });

  it('CLI connect --status JSON smoke', () => {
    const home = mkHome();
    writeInstall(home);
    const cli = path.join(REPO, 'dist/server/cli/index.js');
    const r = spawnSync(process.execPath, [cli, 'connect', '--status', '--json'], {
      cwd: REPO,
      encoding: 'utf8',
      env: envFor(home),
      timeout: 20_000,
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.schemaVersion, 'cli.chatgpt-connect.v1');
    assert.equal(j.state, 'TUNNEL_SETUP_REQUIRED');
    assert.equal(j.secretsHidden, true);
  });
});
