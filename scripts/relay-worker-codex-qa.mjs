#!/usr/bin/env node
/**
 * relay-worker-codex-qa.mjs — Semantic QA passthrough worker backed by Codex CLI.
 *
 * Shape served: the exact invocation qa-semantic-evaluator.ts invokeOnce
 * produces against a worker registry row — `--print <prompt>` with no relay
 * args. Anything else fails closed; this wrapper is QA-only and never pretends
 * to be an implementation worker.
 *
 * Runs `codex exec` read-only (no workspace writes) with the config-default
 * model. stdout carries the response text; diagnostics go to stderr.
 */
import { spawn } from "node:child_process";

const RELAY_ARGS = new Set([
  "--dataRoot", "--project", "--taskId", "--runId",
  "--workspaceRoot", "--claudeConfigDir",
]);

/** Detect the QA passthrough shape; returns the prompt or null. */
function detectQaPrompt(argv) {
  for (const tok of argv) if (RELAY_ARGS.has(tok)) return null;
  const idx = argv.indexOf("--print");
  if (idx === -1) return null;
  const prompt = argv[idx + 1];
  if (prompt === undefined || prompt.startsWith("--")) return null;
  return prompt;
}

async function runQaPassthrough(prompt) {
  const exitCode = await new Promise((resolve) => {
    let child;
    try {
      child = spawn("codex", ["exec", "--skip-git-repo-check", "--sandbox", "read-only", prompt], {
        cwd: process.cwd(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      process.stderr.write(`[relay-worker-codex:qa] spawn threw: ${err?.message ?? err}\n`);
      resolve(1);
      return;
    }
    const onSig = (s) => () => { try { child.kill(s); } catch { /* already gone */ } };
    const onTerm = onSig("SIGTERM"), onInt = onSig("SIGINT");
    process.on("SIGTERM", onTerm);
    process.on("SIGINT", onInt);
    child.stdout.on("data", (d) => process.stdout.write(d));
    const errChunks = [];
    let errLen = 0;
    child.stderr.on("data", (d) => {
      if (errLen < 8000) { errChunks.push(d); errLen += d.length; }
    });
    child.on("error", (err) => {
      process.stderr.write(`[relay-worker-codex:qa] spawn error: ${err.message}\n`);
      resolve(1);
    });
    child.on("exit", (code, sig) => {
      process.stdout.write("\n");
      process.removeListener("SIGTERM", onTerm);
      process.removeListener("SIGINT", onInt);
      const excerpt = Buffer.concat(errChunks).toString("utf8").trim().slice(0, 2000);
      if (excerpt) process.stderr.write(`${excerpt}\n`);
      resolve(code ?? (sig ? 1 : 0));
    });
  });
  process.exit(exitCode);
}

const argv = process.argv.slice(2);
const prompt = detectQaPrompt(argv);
if (prompt === null) {
  process.stderr.write(
    `[relay-worker-codex:qa] refused: this worker serves only the QA passthrough ` +
    `shape (--print <prompt>, no relay args). It is not an implementation worker.\n`
  );
  process.exit(2);
}

await runQaPassthrough(prompt);
