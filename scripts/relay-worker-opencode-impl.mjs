#!/usr/bin/env node
/**
 * relay-worker-opencode-impl.mjs — Relay-aware OpenCode implementation worker.
 *
 * Protocol adapter between Relay Dispatcher argv and the real OpenCode CLI.
 * Mirrors scripts/relay-worker-claude.mjs discipline on the Builder relay path:
 *
 * Accepts (and consumes) Relay internal args:
 *   --dataRoot, --project, --taskId, --runId, --workspaceRoot
 * Anything else fails closed.
 *
 * Shape:
 *   1. Load Task SSOT via dist backend getTask() (never from narrative).
 *   2. Build a deterministic, bounded Worker prompt (16 KiB cap).
 *   3. Write prompt.md into the existing Run folder (idempotent).
 *   4. Spawn `opencode run --dir <workspace> --auto -m <free-model> <prompt>`.
 *   5. Exit 0 on normal completion. NOT RESULT_RECEIVED by itself.
 *
 * Billing posture: FREE TIER ONLY (same as relay-worker-opencode.mjs QA wrapper).
 * Model allowlist mirrors role-loop.ts isFreeTierModel: `-free` suffix or `big-pickle`.
 * Default: opencode/nemotron-3-ultra-free (portfolio free default).
 * AGENT_RELAY_WORKER_MODEL override is accepted only if free-allowlisted.
 *
 * Never calls markResultReceived, never writes Evidence, never calls MCP.
 * Observation is handled by the opencode adapter, not by this wrapper.
 * Exit semantics: 0 → completed normally; non-zero → Dispatcher failure path.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROMPT_SIZE_LIMIT_BYTES = 16 * 1024;
const DEFAULT_MODEL = 'opencode/big-pickle';
const RELAY_ARGS = new Set([
  '--dataRoot', '--project', '--taskId', '--runId', '--workspaceRoot',
]);

export function isFreeTierModel(model) {
  if (!model || typeof model !== 'string') return false;
  const bare = model.includes('/') ? model.slice(model.indexOf('/') + 1) : model;
  return /-free$/.test(bare) || bare === 'big-pickle';
}

export function resolveWorkerModel() {
  const override = (process.env['AGENT_RELAY_WORKER_MODEL'] || '').trim();
  if (override) {
    if (!isFreeTierModel(override)) {
      throw new Error(
        `AGENT_RELAY_WORKER_MODEL '${override}' refused: implementation worker is FREE TIER ONLY ` +
        `(-free suffix or big-pickle).`,
      );
    }
    return override;
  }
  return DEFAULT_MODEL;
}

export function parseRelayArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!RELAY_ARGS.has(tok)) {
      throw new Error(`Unknown argument '${tok}'. Only relay args are accepted.`);
    }
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) {
      throw new Error(`Missing value for '${tok}'.`);
    }
    out[tok.slice(2)] = val;
    i++;
  }
  for (const key of ['dataRoot', 'project', 'taskId', 'runId', 'workspaceRoot']) {
    if (!out[key]) throw new Error(`Missing required relay arg --${key}.`);
  }
  return out;
}

export function buildWorkerPrompt(task, runId) {
  const criteria = (task.completionCriteria ?? [])
    .map((c) => `- ${c}`)
    .join('\n') || '- (none)';
  const prompt = [
    'You are executing one Agent Relay Task.',
    '',
    `Task ID: ${task.taskId}`,
    `Run ID: ${runId}`,
    '',
    'Title:',
    task.title,
    '',
    'Goal:',
    task.goal,
    '',
    'Reason:',
    task.reason || '(none)',
    '',
    'Scope:',
    task.scope || '(none)',
    '',
    'Completion criteria:',
    criteria,
    '',
    'Instructions:',
    '- Work only inside the provided coding workspace.',
    '- Complete the requested task.',
    '- Do not alter Agent Relay state files directly.',
    '- When finished, provide a concise final response describing what changed,',
    '  verification performed, and remaining blockers.',
  ].join('\n');
  const encoded = Buffer.byteLength(prompt, 'utf8');
  if (encoded > PROMPT_SIZE_LIMIT_BYTES) {
    throw new Error(
      `Worker prompt exceeds size limit: ${encoded} bytes > ${PROMPT_SIZE_LIMIT_BYTES} bytes (16 KiB).`,
    );
  }
  return prompt;
}

function distBackendPath(dataRoot, rel) {
  void dataRoot;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', 'dist', 'server', 'backend', rel);
}

export function readRetryContext(runFolder) {
  const ctxPath = path.join(runFolder, 'retry-context.json');
  if (!fs.existsSync(ctxPath)) return null;
  return JSON.parse(fs.readFileSync(ctxPath, 'utf8'));
}

export async function buildRetryPrompt(dataRoot, project, task, retryCtx) {
  if (retryCtx.taskId !== task.taskId) {
    throw new Error(`retry-context taskId mismatch.`);
  }
  const retryPromptPath = distBackendPath(dataRoot, 'retry-prompt.js');
  const pmJudgmentPath = distBackendPath(dataRoot, 'pm-judgment.js');
  if (!fs.existsSync(retryPromptPath) || !fs.existsSync(pmJudgmentPath)) {
    throw new Error('Relay backend dist not found for retry prompt composition.');
  }
  const rp = await import(pathToFileURL(retryPromptPath).href);
  const pmJud = await import(pathToFileURL(pmJudgmentPath).href);
  const judgment = pmJud.getPmJudgment(dataRoot, project, retryCtx.judgmentId);
  const instruction = pmJud.getRetryInstructionForDelivery(dataRoot, project, retryCtx.deliveryId);
  const sourceLink = (task.linkedRuns || []).find((r) => r.runId === retryCtx.sourceRunId);
  if (!sourceLink) {
    throw new Error(`Source Run ${retryCtx.sourceRunId} is no longer linked.`);
  }
  const prior = rp.readPriorResultExcerpt(sourceLink.folder);
  return rp.composeRetryPrompt({
    task,
    preparationId: retryCtx.preparationId,
    sourceRunId: retryCtx.sourceRunId,
    reason: judgment.reason || '',
    retryInstruction: instruction,
    priorExcerpt: prior.excerpt,
    priorAvailable: prior.available,
  });
}

export async function resolvePrompt(dataRoot, project, task, runId, runFolder, deps = {}) {
  const retryCtx = (deps.readRetryContext || readRetryContext)(runFolder);
  if (!retryCtx) return buildWorkerPrompt(task, runId);
  return (deps.buildRetryPrompt || buildRetryPrompt)(dataRoot, project, task, retryCtx);
}

export async function loadTask(dataRoot, project, taskId) {
  const gt = await import(pathToFileURL(distBackendPath(dataRoot, 'goal-task.js')).href);
  return gt.getTask(dataRoot, project, taskId);
}

export function runFolderFor(task, runId) {
  const linked = (task.linkedRuns || []).find((r) => r.runId === runId);
  if (!linked) {
    throw new Error(
      `runId '${runId}' is not linked to Task '${task.taskId}'. ` +
      `Linked runs: [${(task.linkedRuns || []).map((r) => r.runId).join(', ')}]`,
    );
  }
  const current = (task.linkedRuns || []).reduce((a, b) =>
    (b.taskRunSequence || 0) > (a.taskRunSequence || 0) ? b : a, linked);
  if (current.runId !== runId) {
    throw new Error(`runId '${runId}' is not the current attempt.`);
  }
  if (!linked.folder || !path.isAbsolute(linked.folder) || !fs.existsSync(linked.folder)) {
    throw new Error(`Run folder missing for runId='${runId}'.`);
  }
  return linked.folder;
}

export function writePromptMd(runFolder, prompt) {
  const promptPath = path.join(runFolder, 'prompt.md');
  if (fs.existsSync(promptPath)) {
    const existing = fs.readFileSync(promptPath, 'utf8');
    if (existing === prompt) return { wrote: false };
    throw new Error('prompt.md already exists in Run folder with DIFFERENT content.');
  }
  fs.writeFileSync(promptPath, prompt, 'utf8');
  return { wrote: true };
}

export function resolveOpencodeExecutable() {
  const envOverride = (process.env['OPENCODE_BIN'] || '').trim();
  if (envOverride) return envOverride;
  return 'opencode';
}

export function buildOpencodeArgv(workspaceRoot, model, prompt) {
  return ['run', '--dir', workspaceRoot, '--auto', '-m', model, prompt];
}

function writeLaunchLog(runFolder, entry) {
  try {
    const logPath = path.join(runFolder, 'worker-launch.log');
    const data = JSON.stringify(entry, null, 2) + '\n';
    if (fs.existsSync(logPath)) fs.appendFileSync(logPath, '\n---\n' + data, 'utf8');
    else fs.writeFileSync(logPath, data, 'utf8');
  } catch {
    // Diagnostic log write must never crash the wrapper.
  }
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const spawnFn = deps.spawn || spawn;
  const parsed = parseRelayArgs(argv);
  const { dataRoot, project, taskId, runId, workspaceRoot } = parsed;
  if (!path.isAbsolute(workspaceRoot) || !fs.existsSync(workspaceRoot)) {
    throw new Error('workspaceRoot must be an existing absolute directory.');
  }
  const model = resolveWorkerModel();
  const task = await (deps.loadTask || loadTask)(dataRoot, project, taskId);
  const runFolder = (deps.runFolderFor || runFolderFor)(task, runId);
  const prompt = await resolvePrompt(dataRoot, project, task, runId, runFolder, deps);
  if (Buffer.byteLength(prompt, 'utf8') > PROMPT_SIZE_LIMIT_BYTES) {
    throw new Error(`Worker prompt exceeds size limit (${PROMPT_SIZE_LIMIT_BYTES} bytes).`);
  }
  writePromptMd(runFolder, prompt);
  const opencodeExe = resolveOpencodeExecutable();
  const opencodeArgs = buildOpencodeArgv(workspaceRoot, model, prompt);
  writeLaunchLog(runFolder, {
    worker: 'relay-worker-opencode-impl',
    taskId, runId, model,
    at: new Date().toISOString(),
  });
  const exitCode = await new Promise((resolvePromise, reject) => {
    let child;
    try {
      child = spawnFn(opencodeExe, opencodeArgs, {
        cwd: workspaceRoot, shell: false, stdio: 'ignore',
      });
    } catch (err) {
      reject(err);
      return;
    }
    child.once('error', reject);
    child.once('close', (code) => resolvePromise(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(`opencode worker exited with code ${exitCode}.`);
  }
  return { ok: true, taskId, runId, model };
}

const invokedAsMain = (() => {
  try {
    return path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedAsMain) {
  main().then(
    () => process.exit(0),
    (err) => {
      process.stderr.write(`[relay-worker-opencode-impl] ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    },
  );
}
