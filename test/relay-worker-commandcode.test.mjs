/**
 * relay-worker-commandcode tests: relay-arg allowlist, required --model (strict charset),
 * buildCommandCodeArgv shape (permission-mode auto-accept, never --yolo).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommandCodeArgv,
  parseRelayArgs,
} from '../scripts/relay-worker-commandcode.mjs';

const RELAY = [
  '--dataRoot', '/tmp/xr-data',
  '--project', 'p',
  '--taskId', 'TASK-1',
  '--runId', 'RUN-1',
  '--workspaceRoot', '/tmp/xr-work',
];

describe('parseRelayArgs', () => {
  it('rejects unknown flags', () => {
    assert.throws(
      () => parseRelayArgs([...RELAY, '--model', 'laguna-s', '--yolo']),
      /Unknown argument/,
    );
  });

  it('rejects missing --model', () => {
    assert.throws(() => parseRelayArgs(RELAY), /Missing required relay arg --model/);
  });

  it('rejects invalid --model charset', () => {
    assert.throws(() => parseRelayArgs([...RELAY, '--model', 'evil;rm']), /Invalid --model/);
    assert.throws(() => parseRelayArgs([...RELAY, '--model', '']), /Missing required relay arg --model/);
  });

  it('accepts required --model with valid charset', () => {
    const out = parseRelayArgs([...RELAY, '--model', 'laguna-s']);
    assert.equal(out.model, 'laguna-s');
    assert.equal(out.taskId, 'TASK-1');
  });
});

describe('buildCommandCodeArgv', () => {
  it('emits -p prompt -m model --permission-mode auto-accept (no yolo)', () => {
    const argv = buildCommandCodeArgv('laguna-s', 'do it');
    assert.deepEqual(argv, ['-p', 'do it', '-m', 'laguna-s', '--permission-mode', 'auto-accept']);
    assert.ok(!argv.includes('--yolo'));
    assert.ok(!argv.includes('--dangerously-skip-permissions'));
  });
});
