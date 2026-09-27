/**
 * relay-worker-opencode-impl tests: arg allowlist, free-tier gating,
 * bounded prompt, prompt.md idempotency, spawn shape (injected).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildOpencodeArgv,
  buildWorkerPrompt,
  isFreeTierModel,
  main,
  parseRelayArgs,
  readRetryContext,
  resolvePrompt,
  resolveWorkerModel,
  writePromptMd,
} from '../scripts/relay-worker-opencode-impl.mjs';

const RELAY = [
  '--dataRoot', '/tmp/xr-data',
  '--project', 'p',
  '--taskId', 'TASK-1',
  '--runId', 'RUN-1',
  '--workspaceRoot', '/tmp/xr-work',
];

describe('parseRelayArgs', () => {
  it('accepts the five relay args', () => {
    const out = parseRelayArgs(RELAY);
    assert.equal(out.taskId, 'TASK-1');
    assert.equal(out.workspaceRoot, '/tmp/xr-work');
  });
  it('rejects unknown flags (no arbitrary CLI passthrough)', () => {
    assert.throws(() => parseRelayArgs([...RELAY, '--print', 'hi']), /Unknown argument/);
  });
  it('rejects missing values and missing required args', () => {
    assert.throws(() => parseRelayArgs(['--taskId']), /Missing value/);
    assert.throws(() => parseRelayArgs(['--dataRoot', '/a']), /Missing required/);
  });
});

describe('isFreeTierModel / resolveWorkerModel', () => {
  it('allows -free and big-pickle only', () => {
    assert.equal(isFreeTierModel('opencode/nemotron-3-ultra-free'), true);
    assert.equal(isFreeTierModel('big-pickle'), true);
    assert.equal(isFreeTierModel('opencode/gpt-5'), false);
    assert.equal(isFreeTierModel(''), false);
  });
  it('defaults to the free big-pickle model', () => {
    assert.equal(resolveWorkerModel(), 'opencode/big-pickle');
  });
  it('refuses metered override', () => {
    process.env['AGENT_RELAY_WORKER_MODEL'] = 'opencode/gpt-5';
    assert.throws(() => resolveWorkerModel(), /FREE TIER ONLY/);
    delete process.env['AGENT_RELAY_WORKER_MODEL'];
  });
  it('accepts free override', () => {
    process.env['AGENT_RELAY_WORKER_MODEL'] = 'opencode/mimo-v2.5-free';
    assert.equal(resolveWorkerModel(), 'opencode/mimo-v2.5-free');
    delete process.env['AGENT_RELAY_WORKER_MODEL'];
  });
});

describe('buildWorkerPrompt', () => {
  it('embeds task identity and caps at 16 KiB', () => {
    const p = buildWorkerPrompt(
      { taskId: 'T', title: 'ti', goal: 'g', reason: 'r', scope: 's', completionCriteria: ['c'] },
      'R',
    );
    assert.match(p, /Task ID: T/);
    assert.match(p, /Run ID: R/);
    const big = 'x'.repeat(20 * 1024);
    assert.throws(() => buildWorkerPrompt({ taskId: 'T', title: big, goal: '', reason: '', scope: '' }, 'R'), /exceeds size limit/);
  });
});

describe('writePromptMd', () => {
  it('writes once, stays idempotent, refuses divergence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opimpl-'));
    assert.deepEqual(writePromptMd(dir, 'hello'), { wrote: true });
    assert.deepEqual(writePromptMd(dir, 'hello'), { wrote: false });
    assert.throws(() => writePromptMd(dir, 'other'), /DIFFERENT content/);
  });
});

describe('main (injected deps, no real spawn)', () => {
  it('spawns opencode run with free model and relay prompt', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'opimpl-work-'));
    const calls = [];
    const fakeSpawn = (exe, args, opts) => {
      calls.push({ exe, args, opts });
      const handlers = {};
      return { once: (ev, fn) => { handlers[ev] = fn; }, __close: (code) => handlers['close'](code) };
    };
    const task = { taskId: 'TASK-1', title: 't', goal: 'g', reason: 'r', scope: 's', completionCriteria: [] };
    const pending = main(
      ['--dataRoot', '/tmp/xr-data', '--project', 'p', '--taskId', 'TASK-1', '--runId', 'RUN-1', '--workspaceRoot', work],
      {
        spawn: (exe, args, opts) => {
          const child = fakeSpawn(exe, args, opts);
          queueMicrotask(() => child.__close(0));
          return child;
        },
        loadTask: async () => task,
        runFolderFor: () => work,
      },
    );
    const res = await pending;
    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].exe, 'opencode');
    assert.deepEqual(calls[0].args.slice(0, 4), ['run', '--dir', work, '--auto']);
    assert.equal(calls[0].args[4], '-m');
    assert.match(calls[0].args[5], /(-free$|big-pickle$)/);
    assert.match(calls[0].args[6], /Task ID: TASK-1/);
    assert.equal(fs.readFileSync(path.join(work, 'prompt.md'), 'utf8'), calls[0].args[6]);
  });

  it('propagates non-zero exit to the dispatcher failure path', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'opimpl-work-'));
    await assert.rejects(
      main(
        ['--dataRoot', '/d', '--project', 'p', '--taskId', 'T', '--runId', 'R', '--workspaceRoot', work],
        {
          spawn: () => ({ once: (ev, fn) => { if (ev === 'close') queueMicrotask(() => fn(3)); } }),
          loadTask: async () => ({ taskId: 'T', title: '', goal: '', reason: '', scope: '' }),
          runFolderFor: () => work,
        },
      ),
      /exited with code 3/,
    );
  });
});

describe('readRetryContext / resolvePrompt', () => {
  it('returns null without retry-context.json and builds the base prompt', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opimpl-'));
    assert.equal(readRetryContext(dir), null);
    const task = { taskId: 'T', title: 't', goal: 'g', reason: 'r', scope: 's' };
    const p = await resolvePrompt('/d', 'p', task, 'R', dir);
    assert.match(p, /Task ID: T/);
  });
  it('uses the retry composer when retry-context.json exists', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opimpl-'));
    fs.writeFileSync(path.join(dir, 'retry-context.json'), '{"taskId":"T"}', 'utf8');
    const task = { taskId: 'T' };
    const p = await resolvePrompt('/d', 'p', task, 'R2', dir, {
      buildRetryPrompt: async () => 'RETRY-PROMPT',
    });
    assert.equal(p, 'RETRY-PROMPT');
  });
});
describe('buildOpencodeArgv', () => {
  it('keeps headless non-interactive shape', () => {
    assert.deepEqual(
      buildOpencodeArgv('/w', 'opencode/x-free', 'do it'),
      ['run', '--dir', '/w', '--auto', '-m', 'opencode/x-free', 'do it'],
    );
  });
});
