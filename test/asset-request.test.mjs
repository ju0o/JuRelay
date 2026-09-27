/**
 * Asset Request kernel tests (Image Asset Harness T1).
 * Full lifecycle: create (idempotent) → route → generate → deliver →
 * verify; rework budget; stale-CAS rejection; path traversal rejection.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ar = await import('../dist/server/backend/asset-request.js');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-asset-'));
const WS = path.join(ROOT, 'ws');
fs.mkdirSync(WS, { recursive: true });

const base = {
  asset_kind: 'hero_image',
  purpose: 'landing test',
  prompt: 'clean hero',
  aspect_ratio: '16:9',
  output_path: 'public/hero.png',
  owner_task_id: 'TASK-1',
  requester_run_id: 'RUN-1',
  workspaceRoot: WS,
};

describe('create', () => {
  it('creates REQUESTED with deterministic id', () => {
    const a = ar.createAssetRequest(ROOT, 'p', base);
    const b = ar.createAssetRequest(ROOT, 'p', base);
    assert.equal(a.record.assetId, b.record.assetId);
    assert.equal(b.created, false);
    assert.equal(a.record.status, 'REQUESTED');
    assert.match(a.record.assetId, /^AST-[0-9a-f]{12}$/);
  });
  it('rejects bad kind, oversize prompt, traversal, bad count', () => {
    assert.throws(() => ar.createAssetRequest(ROOT, 'p', { ...base, asset_kind: 'video' }), /asset_kind/);
    assert.throws(() => ar.createAssetRequest(ROOT, 'p', { ...base, prompt: 'x'.repeat(20 * 1024) }), /16 KiB/);
    assert.throws(() => ar.createAssetRequest(ROOT, 'p', { ...base, output_path: '../evil.png' }), /벗어납니다/);
    assert.throws(() => ar.createAssetRequest(ROOT, 'p', { ...base, output_path: '/abs.png' }), /상대경로/);
    assert.throws(() => ar.createAssetRequest(ROOT, 'p', { ...base, count: 9 }), /1\.\.4/);
    assert.throws(() => ar.createAssetRequest(ROOT, 'p', { ...base, aspect_ratio: 'wide' }), /W:H/);
  });
});

describe('transitions', () => {
  let id;
  before(() => {
    id = ar.createAssetRequest(ROOT, 'p', { ...base, output_path: 'public/flow.png' }).record.assetId;
  });
  it('REQUESTED → ROUTED → GENERATING → DELIVERED → VERIFIED', () => {
    assert.equal(ar.routeAssetRequest(ROOT, 'p', id, 'stub').status, 'ROUTED');
    assert.equal(ar.markAssetGenerating(ROOT, 'p', id).status, 'GENERATING');
    const d = ar.markAssetDelivered(ROOT, 'p', id, { path: 'public/flow.png', source: 'stub' });
    assert.equal(d.status, 'DELIVERED');
    assert.equal(ar.markAssetVerified(ROOT, 'p', id).status, 'VERIFIED');
  });
  it('stale CAS is rejected without write', () => {
    assert.throws(() => ar.markAssetDelivered(ROOT, 'p', id, { path: 'x', source: 's' }), (e) => e.code === 'CONFLICT');
    assert.throws(() => ar.routeAssetRequest(ROOT, 'p', id, 'stub'), (e) => e.code === 'CONFLICT');
  });
  it('rework loops to GENERATING until budget, then FAILED', () => {
    const r = ar.createAssetRequest(ROOT, 'p', { ...base, output_path: 'public/rw.png' }).record;
    ar.routeAssetRequest(ROOT, 'p', r.assetId, 'stub');
    ar.markAssetGenerating(ROOT, 'p', r.assetId);
    ar.markAssetDelivered(ROOT, 'p', r.assetId, { path: 'public/rw.png', source: 'stub' });
    assert.equal(ar.requestAssetRework(ROOT, 'p', r.assetId, 'again').status, 'REWORK');
    ar.markAssetGenerating(ROOT, 'p', r.assetId);
    ar.markAssetDelivered(ROOT, 'p', r.assetId, { path: 'public/rw.png', source: 'stub' });
    assert.equal(ar.requestAssetRework(ROOT, 'p', r.assetId, 'again').status, 'REWORK');
    ar.markAssetGenerating(ROOT, 'p', r.assetId);
    ar.markAssetDelivered(ROOT, 'p', r.assetId, { path: 'public/rw.png', source: 'stub' });
    assert.equal(ar.requestAssetRework(ROOT, 'p', r.assetId, 'again').status, 'FAILED');
  });
  it('fail records reason', () => {
    const r = ar.createAssetRequest(ROOT, 'p', { ...base, output_path: 'public/f.png' }).record;
    assert.equal(ar.markAssetFailed(ROOT, 'p', r.assetId, 'boom').status, 'FAILED');
  });
  it('lists records', () => {
    assert.ok(ar.listAssetRequests(ROOT, 'p').length >= 4);
    assert.deepEqual(ar.listAssetRequests(ROOT, 'nope'), []);
  });
});
