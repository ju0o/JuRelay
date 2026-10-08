#!/usr/bin/env node
/**
 * relay-worker-commandcode.mjs — Relay-aware Command Code CLI implementation worker.
 *
 * Protocol adapter between Relay Dispatcher argv and the real Command Code CLI.
 * Mirrors scripts/relay-worker-codex.mjs discipline on the Builder relay path:
 *
 * Accepts (and consumes) Relay internal args:
 *   --dataRoot, --project, --taskId, --runId, --workspaceRoot
 *   --model <model-id> (required; strict charset for R01 explicit selection)
 * Anything else fails closed.
 *
 * Shape:
 *   1. Load Task SSOT via dist backend getTask() (never from narrative).
 *   2. Resolve run folder via Task.linkedRuns (current attempt only).
 *   3. Build a deterministic, bounded Worker prompt (16 KiB cap).
 *   4. Write prompt.md into the existing Run folder (idempotent).
 *   5. Spawn `commandcode -p <prompt> -m <model> --permission-mode auto-accept`
 *      with cwd=workspaceRoot, shell:false. Never uses --yolo.
 *   6. Exit 0 on normal completion. NOT RESULT_RECEIVED by itself.
 *
 * Never calls markResultReceived, never writes Evidence, never calls MCP.
 * Observation is handled by the commandcode adapter, not by this wrapper.
 * Exit semantics: 0 → completed normally; non-zero → Dispatcher failure path.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROMPT_SIZE_LIMIT_BYTES = 16 * 1024;
const RELAY_ARGS = new Set([
  '--dataRoot', '--project', '--taskId', '--runId', '--workspaceRoot', '--model',
]);
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

export function parseRelayArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!RELAY_ARGS.has(tok)) {
      throw new Error(`Unknown argument '${tok}'. Only relay args are accepted.`);
    }
    const val = argv[i + 1];
    if (val === undefined || (tok !== '--model' && val.startsWith('--'))) {
      throw new Error(`Missing value for '${tok}'.`);
    }
    out[tok.slice(2)] = val;
    i++;
  }
  for (const key of ['dataRoot', 'project', 'taskId', 'runId', 'workspaceRoot', 'model']) {
    if (!out[key]) throw new Error(`Missing required relay arg --${key}.`);
  }
  if (!MODEL_PATTERN.test(out.model)) {
    throw new Error(`Invalid --model '${out.model}'.`);
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

function distBackendPath(rel) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', 'dist', 'server', 'backend', rel);
}

export async function loadTask(dataRoot, project, taskId) {
  const gt = await import(pathToFileURL(distBackendPath('goal-task.js')).href);
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

export function resolveCommandCodeExecutable() {
  const envOverride = (process.env['COMMANDCODE_BIN'] || '').trim();
  if (envOverride) return envOverride;
  return 'commandcode';
}

export function buildCommandCodeArgv(model, prompt) {
  return ['-p', prompt, '-m', model, '--permission-mode', 'auto-accept'];
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
  const { dataRoot, project, taskId, runId, workspaceRoot, model } = parsed;
  if (!path.isAbsolute(workspaceRoot) || !fs.existsSync(workspaceRoot)) {
    throw new Error('workspaceRoot must be an existing absolute directory.');
  }
  const task = await (deps.loadTask || loadTask)(dataRoot, project, taskId);
  const prompt = buildWorkerPrompt(task, runId);
  const runFolder = (deps.runFolderFor || runFolderFor)(task, runId);
  writePromptMd(runFolder, prompt);
  const commandCodeExe = resolveCommandCodeExecutable();
  const commandCodeArgs = buildCommandCodeArgv(model, prompt);
  writeLaunchLog(runFolder, {
    worker: 'relay-worker-commandcode', taskId, runId, model,
    at: new Date().toISOString(),
  });
  const exitCode = await new Promise((resolvePromise, reject) => {
    let child;
    try {
      child = spawnFn(commandCodeExe, commandCodeArgs, {
        cwd: workspaceRoot, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(err);
      return;
    }
    child.once('error', reject);
    child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr?.on('data', (chunk) => process.stderr.write(chunk));
    child.once('close', (code) => resolvePromise(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(`commandcode worker exited with code ${exitCode}.`);
  }
  return { ok: true, taskId, runId };
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
      process.stderr.write(`[relay-worker-commandcode] ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    },
  );
}
