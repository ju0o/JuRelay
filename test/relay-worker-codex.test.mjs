/**
 * relay-worker-codex tests: relay-arg allowlist (+strict --model),
 * bounded prompt, prompt.md idempotency, spawn shape (injected).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildCodexArgv,
  buildWorkerPrompt,
  main,
  parseRelayArgs,
  writePromptMd,
} from '../scripts/relay-worker-codex.mjs';

const RELAY = [
  '--dataRoot', '/tmp/xr-data',
  '--project', 'p',
  '--taskId', 'TASK-1',
  '--runId', 'RUN-1',
  '--workspaceRoot', '/tmp/xr-work',
];

describe('parseRelayArgs', () => {
  it('accepts the five relay args plus optional --model', () => {
    const out = parseRelayArgs(RELAY);
    assert.equal(out.taskId, 'TASK-1');
    assert.equal(out.model, undefined);
    assert.equal(parseRelayArgs([...RELAY, '--model', 'gpt-5.6-terra']).model, 'gpt-5.6-terra');
  });
  it('rejects unknown flags and bad models', () => {
    assert.throws(() => parseRelayArgs([...RELAY, '--print', 'hi']), /Unknown argument/);
    assert.throws(() => parseRelayArgs([...RELAY, '--model', 'evil;rm']), /Invalid --model/);
    assert.throws(() => parseRelayArgs(['--taskId']), /Missing value/);
  });
});

describe('buildWorkerPrompt', () => {
  it('embeds identity and caps at 16 KiB', () => {
    const p = buildWorkerPrompt(
      { taskId: 'T', title: 'ti', goal: 'g', reason: 'r', scope: 's', completionCriteria: ['c'] },
      'R',
    );
    assert.match(p, /Task ID: T/);
    const big = 'x'.repeat(20 * 1024);
    assert.throws(() => buildWorkerPrompt({ taskId: 'T', title: big, goal: '', reason: '', scope: '' }, 'R'), /exceeds size limit/);
  });
});

describe('writePromptMd', () => {
  it('writes once, stays idempotent, refuses divergence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cximpl-'));
    assert.deepEqual(writePromptMd(dir, 'hello'), { wrote: true });
    assert.deepEqual(writePromptMd(dir, 'hello'), { wrote: false });
    assert.throws(() => writePromptMd(dir, 'other'), /DIFFERENT content/);
  });
});

describe('buildCodexArgv', () => {
  it('headless shape with optional model pin', () => {
    assert.deepEqual(
      buildCodexArgv('/w', undefined, 'do it'),
      ['exec', '--skip-git-repo-check', '--cd', '/w', '--sandbox', 'workspace-write', 'do it'],
    );
    assert.deepEqual(
      buildCodexArgv('/w', 'gpt-5.6-terra', 'do it'),
      ['exec', '--skip-git-repo-check', '--cd', '/w', '--sandbox', 'workspace-write', '-m', 'gpt-5.6-terra', 'do it'],
    );
  });
});

describe('main (injected deps, no real spawn)', () => {
  it('spawns codex with model pin and relay prompt', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cximpl-work-'));
    const calls = [];
    const task = { taskId: 'TASK-1', title: 't', goal: 'g', reason: 'r', scope: 's', completionCriteria: [] };
    const res = await main(
      ['--dataRoot', '/tmp/xr-data', '--project', 'p', '--taskId', 'TASK-1', '--runId', 'RUN-1', '--workspaceRoot', work, '--model', 'gpt-5.6-terra'],
      {
        spawn: (exe, args, opts) => {
          calls.push({ exe, args, opts });
          return { once: (ev, fn) => { if (ev === 'close') queueMicrotask(() => fn(0)); } };
        },
        loadTask: async () => task,
        runFolderFor: () => work,
      },
    );
    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
    assert.ok(['codex', process.env['CODEX_BIN']].includes(calls[0].exe));
    assert.deepEqual(calls[0].args.slice(0, 8), ['exec', '--skip-git-repo-check', '--cd', work, '--sandbox', 'workspace-write', '-m', 'gpt-5.6-terra']);
    assert.match(calls[0].args[8], /Task ID: TASK-1/);
    assert.equal(fs.readFileSync(path.join(work, 'prompt.md'), 'utf8'), calls[0].args[8]);
    assert.equal(calls[0].opts.shell, false);
  });
});
