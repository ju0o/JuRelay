/**
 * Image Asset Harness integration tests (T2–T5).
 * Worker tools over a real Task+linked Run; stub backend; QA verify; presets.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const gt = await import('../dist/server/backend/goal-task.js');
const workerTools = await import('../dist/server/mcp/worker-tools.js');
const stub = await import('../dist/server/backend/asset-stub.js');
const backend = await import('../dist/server/backend/asset-backend.js');
const verify = await import('../dist/server/backend/asset-verify.js');
const presets = await import('../dist/server/backend/asset-presets.js');
const kernel = await import('../dist/server/backend/asset-request.js');
const coderender = await import('../dist/server/backend/asset-coderender.js');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-assetharness-'));
const WS = path.join(ROOT, 'ws');
const RUNF = path.join(ROOT, 'runfolder');
fs.mkdirSync(WS, { recursive: true });
fs.mkdirSync(RUNF, { recursive: true });

const PROJECT = 'AssetHarnessProj';
let tools;
let TASK_ID;

async function callTool(name, args) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} registered`);
  return tool.handler(args);
}

async function expectCode(fn, code) {
  try {
    await fn();
  } catch (err) {
    assert.equal(err.mcpCode ?? err.code, code);
    return;
  }
  assert.fail(`expected throw ${code}`);
}

before(async () => {
  const goal = await gt.createGoal(ROOT, PROJECT, {
    title: 'g', goalStatement: 'gs', completionCriteria: ['done'], permissionPolicy: { mode: 'BYPASS' },
  });
  const task = await gt.createTask(ROOT, PROJECT, {
    goalId: goal.goalId, title: 't', goal: 'g', reason: 'r', scope: 's', completionCriteria: ['done'],
  });
  TASK_ID = task.taskId;
  // Link a run the way the dispatcher would (folder + meta with workspaceRoot).
  const file = path.join(ROOT, PROJECT, '_relay', 'tasks', TASK_ID, 'task.json');
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  rec.linkedRuns = [{ runId: 'RUN-1', folder: RUNF, taskRunSequence: 1 }];
  fs.writeFileSync(file, JSON.stringify(rec, null, 2));
  fs.writeFileSync(path.join(RUNF, 'meta.json'), JSON.stringify({ workspaceRoot: WS }));
  tools = workerTools.buildAllWorkerTools({ dataRoot: ROOT, project: PROJECT, taskId: TASK_ID, runId: 'RUN-1' });
});

describe('relay_worker_request_asset', () => {
  it('creates REQUESTED and is idempotent', async () => {
    const a = await callTool('relay_worker_request_asset', {
      asset_kind: 'hero_image', purpose: 'landing', prompt: 'clean hero', output_path: 'public/hero.png',
    });
    assert.match(a.assetId, /^AST-[0-9a-f]{12}$/);
    assert.equal(a.status, 'REQUESTED');
    const b = await callTool('relay_worker_request_asset', {
      asset_kind: 'hero_image', purpose: 'landing', prompt: 'clean hero', output_path: 'public/hero.png',
    });
    assert.equal(a.assetId, b.assetId);
    assert.equal(b.created, false);
  });
  it('rejects unknown fields, bad kind, traversal', async () => {
    await expectCode(() => callTool('relay_worker_request_asset', {
      asset_kind: 'hero_image', purpose: 'p', prompt: 'x', output_path: 'a.png', evil: 1,
    }), 'INVALID_ARGUMENT');
    await expectCode(() => callTool('relay_worker_request_asset', {
      asset_kind: 'video', purpose: 'p', prompt: 'x', output_path: 'a.png',
    }), 'INVALID_ARGUMENT');
    await expectCode(() => callTool('relay_worker_request_asset', {
      asset_kind: 'icon', purpose: 'p', prompt: 'x', output_path: '../evil.png',
    }), 'INVALID_ARGUMENT');
  });
});

describe('relay_worker_get_asset', () => {
  it('reads own asset, forbids foreign runs', async () => {
    const a = await callTool('relay_worker_request_asset', {
      asset_kind: 'icon', purpose: 'p', prompt: 'x', output_path: 'public/i.png',
    });
    const got = await callTool('relay_worker_get_asset', { assetId: a.assetId });
    assert.equal(got.status, 'REQUESTED');
    const other = workerTools.buildAllWorkerTools({ dataRoot: ROOT, project: PROJECT, taskId: TASK_ID, runId: 'RUN-2' });
    await assert.rejects(
      other.find((t) => t.name === 'relay_worker_get_asset').handler({ assetId: a.assetId }),
      (e) => (e.mcpCode ?? e.code) === 'FORBIDDEN',
    );
  });
});

describe('stub backend + verify (T3/T4)', () => {
  it('generates deterministic file and QA checks pass', async () => {
    backend.clearAssetBackends();
    backend.registerAssetBackend(stub.stubBackend);
    assert.deepEqual(backend.listAssetBackends(), ['asset-stub']);
    const rec = kernel.createAssetRequest(ROOT, PROJECT, {
      asset_kind: 'thumbnail', purpose: 'p', prompt: 'x', output_path: 'public/t.png',
      owner_task_id: TASK_ID, requester_run_id: 'RUN-1', workspaceRoot: WS,
    }).record;
    kernel.routeAssetRequest(ROOT, PROJECT, rec.assetId, 'asset-stub');
    kernel.markAssetGenerating(ROOT, PROJECT, rec.assetId);
    const out = await stub.stubBackend.generate({ record: rec, workspaceRoot: WS });
    assert.equal(out.source, 'asset-stub');
    assert.ok(fs.existsSync(path.join(WS, 'public/t.png')));
    const done = kernel.markAssetDelivered(ROOT, PROJECT, rec.assetId, { ...out, path: 'public/t.png' });
    assert.equal(done.status, 'DELIVERED');
    const checks = verify.verifyAssetFile(WS, 'public/t.png');
    assert.ok(verify.allAssetChecksPass(checks));
    assert.equal(kernel.markAssetVerified(ROOT, PROJECT, rec.assetId).status, 'VERIFIED');
    backend.clearAssetBackends();
  });
  it('verify catches missing/corrupt/traversal', () => {
    assert.equal(verify.allAssetChecksPass(verify.verifyAssetFile(WS, 'nope.png')), false);
    assert.equal(verify.allAssetChecksPass(verify.verifyAssetFile(WS, '../evil.png')), false);
    fs.writeFileSync(path.join(WS, 'bad.png'), 'not a png');
    assert.equal(verify.allAssetChecksPass(verify.verifyAssetFile(WS, 'bad.png')), false);
  });
});

describe('presets (T5)', () => {
  it('has hero/og/thumbnail presets and safe naming', () => {
    assert.equal(presets.presetFor('hero_image').width, 1600);
    assert.equal(presets.presetFor('og_image').aspectRatio, '1200:630');
    assert.equal(presets.presetFor('nope'), null);
    assert.equal(presets.suggestOutputPath('hero_image', 'AI 스터디 모집!'), 'public/assets/ai-스터디-모집.png');
  });
});

describe('code-render backend (T8)', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#123456"/><text x="20" y="40" font-size="28" fill="white">T8</text></svg>';
  it('renders SVG to PNG with preset dimensions', () => {
    const rec = kernel.createAssetRequest(ROOT, PROJECT, {
      asset_kind: 'thumbnail', purpose: 'p', prompt: 'x', output_path: 'public/t8.png',
      svg: SVG, owner_task_id: TASK_ID, requester_run_id: 'RUN-1', workspaceRoot: WS,
    }).record;
    kernel.routeAssetRequest(ROOT, PROJECT, rec.assetId, 'code-render');
    kernel.markAssetGenerating(ROOT, PROJECT, rec.assetId);
    return coderender.codeRenderBackend.generate({ record: rec, workspaceRoot: WS }).then((out) => {
      assert.equal(out.source, 'code-render');
      assert.equal(out.width, 640);
      assert.equal(out.height, 360);
      assert.ok(verify.allAssetChecksPass(verify.verifyAssetFile(WS, 'public/t8.png')));
      assert.equal(kernel.markAssetDelivered(ROOT, PROJECT, rec.assetId, { ...out, path: 'public/t8.png' }).status, 'DELIVERED');
    });
  });
  it('refuses missing svg', async () => {
    const rec = kernel.createAssetRequest(ROOT, PROJECT, {
      asset_kind: 'diagram', purpose: 'p', prompt: 'x', output_path: 'public/nosvg.png',
      owner_task_id: TASK_ID, requester_run_id: 'RUN-1', workspaceRoot: WS,
    }).record;
    await assert.rejects(
      coderender.codeRenderBackend.generate({ record: rec, workspaceRoot: WS }),
      /inline svg/,
    );
  });
});
