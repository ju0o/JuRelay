/**
 * relay-worker-grok tests: relay-arg allowlist, required --model (strict charset),
 * buildGrokArgv shape.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGrokArgv,
  parseRelayArgs,
} from '../scripts/relay-worker-grok.mjs';

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
      () => parseRelayArgs([...RELAY, '--model', 'grok-4', '--print', 'hi']),
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
    const out = parseRelayArgs([...RELAY, '--model', 'grok-4']);
    assert.equal(out.model, 'grok-4');
    assert.equal(out.taskId, 'TASK-1');
  });
});

describe('buildGrokArgv', () => {
  it('emits -p prompt -m model --always-approve', () => {
    assert.deepEqual(
      buildGrokArgv('grok-4', 'do it'),
      ['-p', 'do it', '-m', 'grok-4', '--always-approve'],
    );
  });
});
