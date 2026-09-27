/**
 * T7 tests: ChatGPT deliver path (relay_pm_deliver_asset / list_assets).
 * Local HTTP fixture stands in for ChatGPT image URLs; the host allowlist
 * is extended via AGENT_RELAY_ASSET_HOSTS for loopback only.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

const gt = await import('../dist/server/backend/goal-task.js');
const pmTools = await import('../dist/server/mcp/asset-tools.js');
const kernel = await import('../dist/server/backend/asset-request.js');
const verify = await import('../dist/server/backend/asset-verify.js');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-assett7-'));
const WS = path.join(ROOT, 'ws');
const RUNF = path.join(ROOT, 'runfolder');
fs.mkdirSync(WS, { recursive: true });
fs.mkdirSync(RUNF, { recursive: true });
const PROJECT = 'AssetT7Proj';

let server;
let pm;
let TASK_ID;

async function callTool(name, args) {
  const tool = pm.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} registered`);
  return tool.handler(args);
}

before(async () => {
  process.env['AGENT_RELAY_ASSET_HOSTS'] = '127.0.0.1,localhost';
  server = http.createServer((req, res) => {
    if (req.url === '/img.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(PNG);
    } else if (req.url === '/txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('not an image');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const goal = await gt.createGoal(ROOT, PROJECT, {
    title: 'g', goalStatement: 'gs', completionCriteria: ['done'], permissionPolicy: { mode: 'BYPASS' },
  });
  const task = await gt.createTask(ROOT, PROJECT, {
    goalId: goal.goalId, title: 't', goal: 'g', reason: 'r', scope: 's', completionCriteria: ['done'],
  });
  TASK_ID = task.taskId;
  const file = path.join(ROOT, PROJECT, '_relay', 'tasks', TASK_ID, 'task.json');
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  rec.linkedRuns = [{ runId: 'RUN-1', folder: RUNF, taskRunSequence: 1 }];
  fs.writeFileSync(file, JSON.stringify(rec, null, 2));
  fs.writeFileSync(path.join(RUNF, 'meta.json'), JSON.stringify({ workspaceRoot: WS }));
  pm = pmTools.buildAssetPmTools({ dataRoot: ROOT, project: PROJECT });
});

after(() => {
  delete process.env['AGENT_RELAY_ASSET_HOSTS'];
  server.close();
});

const port = () => server.address().port;

describe('relay_pm_deliver_asset (ChatGPT path)', () => {
  it('downloads, validates, writes, marks DELIVERED', async () => {
    const created = kernel.createAssetRequest(ROOT, PROJECT, {
      asset_kind: 'og_image', purpose: 'share', prompt: 'sunset', output_path: 'public/og.png',
      owner_task_id: TASK_ID, requester_run_id: 'RUN-1', workspaceRoot: WS,
    });
    const out = await callTool('relay_pm_deliver_asset', {
      assetId: created.record.assetId,
      imageUrl: `http://127.0.0.1:${port()}/img.png`,
      width: 1200, height: 630,
    });
    assert.equal(out.status, 'DELIVERED');
    assert.equal(out.outputPath, 'public/og.png');
    assert.ok(fs.readFileSync(path.join(WS, 'public/og.png')).equals(PNG));
    assert.ok(verify.allAssetChecksPass(verify.verifyAssetFile(WS, 'public/og.png')));
    assert.equal(kernel.markAssetVerified(ROOT, PROJECT, created.record.assetId).status, 'VERIFIED');
  });
  it('rejects non-image bytes, unknown host, missing asset', async () => {
    const a = kernel.createAssetRequest(ROOT, PROJECT, {
      asset_kind: 'icon', purpose: 'p', prompt: 'x', output_path: 'public/i.png',
      owner_task_id: TASK_ID, requester_run_id: 'RUN-1', workspaceRoot: WS,
    }).record;
    await assert.rejects(
      callTool('relay_pm_deliver_asset', { assetId: a.assetId, imageUrl: `http://127.0.0.1:${port()}/txt` }),
      /not a PNG/,
    );
    await assert.rejects(
      callTool('relay_pm_deliver_asset', { assetId: a.assetId, imageUrl: 'https://evil.example/x.png' }),
      /허용되지 않은 이미지 호스트/,
    );
    await assert.rejects(
      callTool('relay_pm_deliver_asset', { assetId: 'AST-deadbeefcafe', imageUrl: `http://127.0.0.1:${port()}/img.png` }),
      /찾을 수 없습니다/,
    );
  });
});

describe('relay_pm_list_assets', () => {
  it('lists with optional status filter', async () => {
    const all = await callTool('relay_pm_list_assets', {});
    assert.ok(all.assets.length >= 2);
    const verified = await callTool('relay_pm_list_assets', { status: 'VERIFIED' });
    assert.ok(verified.assets.every((a) => a.status === 'VERIFIED'));
  });
});
