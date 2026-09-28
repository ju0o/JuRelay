/**
 * Worker-fallback routing pins (Founder 2026-09-28).
 * Provider/runtime deaths suggest the next worker; task deaths stay FAILED.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const m = await import('../dist/server/backend/worker-fallback.js');

describe('worker-fallback', () => {
  it('classifies provider outages', () => {
    for (const s of [
      'Service temporarily overloaded',
      'quota exceeded, out of credits',
      '429 rate limit',
      'hook dispatch failed',
      'model not found: big-pickle',
      'socket hang up',
    ]) {
      assert.equal(m.classifyExitFailure(s).kind, 'provider', s);
    }
  });
  it('classifies task failures and unknowns', () => {
    assert.equal(m.classifyExitFailure('FAIL tests: 2 failed, assertion error').kind, 'task');
    assert.equal(m.classifyExitFailure('error TS2322: type mismatch').kind, 'task');
    assert.equal(m.classifyExitFailure('').kind, 'unknown');
    assert.equal(m.classifyExitFailure('weird exit, no markers').kind, 'unknown');
  });
  it('picks next worker in Founder order, terra last only when complex', () => {
    assert.equal(m.pickFallbackWorker(['builder-codex']), 'builder-opencode');
    assert.equal(m.pickFallbackWorker(['builder-codex', 'builder-opencode']), 'builder-cline');
    assert.equal(m.pickFallbackWorker(['builder-codex', 'builder-opencode', 'builder-cline']), null);
    assert.equal(
      m.pickFallbackWorker(['builder-codex', 'builder-opencode', 'builder-cline'], { complex: true }),
      'builder-codex-terra',
    );
  });
  it('round-trips fallback.json records', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-'));
    m.writeFallbackRecord(dir, { taskId: 'T1', fromWorkerId: 'builder-cline', toWorkerId: 'builder-opencode', reason: 'r' });
    const back = m.readFallbackRecord(dir);
    assert.equal(back.toWorkerId, 'builder-opencode');
    assert.equal(back.schemaVersion, 1);
    assert.equal(m.readFallbackRecord(path.join(os.tmpdir(), 'no-such-dir-xyz')), null);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
