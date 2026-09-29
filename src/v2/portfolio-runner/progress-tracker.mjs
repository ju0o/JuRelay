/**
 * progress-tracker — durable "meaningful progress" for the portfolio runner.
 *
 * Replaces the heartbeat model entirely. Per JuControler's state contract
 * (N00_STATE_CONTRACTS.md:19) a heartbeat is FALSE: progress must come from an
 * artifact the worker actually produced. This module therefore derives
 * liveness from four signals, all of which are evidence of work, not of time:
 *
 *   1. FILE CONTENT HASH — sha256 over the Task's file set. A touched-but-
 *      unchanged file is not progress, and mtime alone is explicitly FALSE
 *      (a build can rewrite a byte-identical file).
 *   2. GIT HEAD — a new commit in the Task worktree is unambiguous work.
 *   3. TEST STATE — a test line that changed verdict (pass/fail counts) is
 *      the strongest signal there is.
 *   4. PHASE TRANSITION — the runner moving the Task between its own phases.
 *
 * Plus the worker's own stdout/stderr, already piped by exec() in index.mjs:
 * new output means the process is still talking, which is evidence, not a tick.
 *
 * The tracker is a pure state machine over injected signals, so it can be
 * tested with no process and no filesystem. Index.mjs stays untouched in shape:
 * this is additive, and additive survives the copy divergence between the
 * source worktree and the running night-runtime copy.
 */
import { createHash } from "node:crypto";
import { appendFile, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const STALL_MS = Number(process.env.ARL_STALL_MS ?? 20 * 60 * 1000);
export const MAX_RETRIES = Number(process.env.ARL_MAX_RETRIES ?? 3);

export const PROGRESS_KINDS = Object.freeze([
  "file-hash",   // file content changed
  "git-head",    // new commit
  "test-state",  // test verdict changed
  "phase",       // runner phase transition
  "output",      // worker produced new stdout/stderr
]);

/** Signals the contract marks FALSE — accepted only as context, never as progress. */
export const FALSE_SIGNALS = Object.freeze([
  "heartbeat", "sse-tick", "pane-text", "spinner", "file-mtime",
]);

/** sha256 of concatenated per-file content hashes; missing files count as empty. */
export function hashFileSet(entries) {
  const hash = createHash("sha256");
  // Sort by path explicitly: Array#sort on plain objects stringifies them to
  // "[object Object]", so the order would never actually change.
  const sorted = [...entries].sort((a, b) => String(a.path ?? "").localeCompare(String(b.path ?? "")));
  for (const entry of sorted) {
    hash.update(String(entry.path ?? ""));
    hash.update("\0");
    hash.update(entry.hash ?? "");
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function diffVerdict(prev, next) {
  if (!prev) return true;
  if (!next) return false;
  return String(prev) !== String(next);
}

export class ProgressTracker {
  constructor({ taskId, project = "", stallMs = STALL_MS, maxRetries = MAX_RETRIES, now = () => Date.now() } = {}) {
    this.taskId = taskId;
    this.project = project;
    this.stallMs = stallMs;
    this.maxRetries = maxRetries;
    this.now = now;
    this.state = {
      taskId,
      attempts: 0,
      lastProgressKind: null,
      lastProgressAtMs: null,
      fileHash: null,
      gitHead: null,
      testVerdict: null,
      phase: null,
      outputSeen: 0,
      history: [],
    };
  }

  /** Record a signal. Returns the progress entry when it actually moved. */
  record(kind, detail = {}) {
    if (FALSE_SIGNALS.includes(kind)) return null;   // contract: never progress
    if (!PROGRESS_KINDS.includes(kind)) return null;
    if (kind === "file-hash" && !diffVerdict(this.state.fileHash, detail.hash)) return null;
    if (kind === "git-head" && !diffVerdict(this.state.gitHead, detail.head)) return null;
    if (kind === "test-state" && !diffVerdict(this.state.testVerdict, detail.verdict)) return null;
    if (kind === "phase" && !diffVerdict(this.state.phase, detail.phase)) return null;
    if (kind === "output" && !(detail.chars > 0)) return null;

    if (kind === "file-hash") this.state.fileHash = detail.hash;
    if (kind === "git-head") this.state.gitHead = detail.head;
    if (kind === "test-state") this.state.testVerdict = detail.verdict;
    if (kind === "phase") this.state.phase = detail.phase;
    if (kind === "output") this.state.outputSeen += detail.chars;

    const at = this.now();
    this.state.lastProgressKind = kind;
    this.state.lastProgressAtMs = at;
    const entry = { kind, atMs: at, detail };
    this.state.history.push(entry);
    return entry;
  }

  /**
   * Spend one retry. evaluate() calls this itself when it grants a retry, so
   * the ladder cannot drift from the caller's bookkeeping; call it directly only
   * for an out-of-band resume.
   */
  attempt() {
    this.state.attempts += 1;
    return this.state.attempts;
  }

  /** Milliseconds since the last real progress (null = nothing recorded yet). */
  idleMs() {
    if (this.state.lastProgressAtMs === null) return null;
    return this.now() - this.state.lastProgressAtMs;
  }

  /**
   * The stall ladder: nothing meaningful for stallMs → retry, until the retry
   * budget is spent, then hand the Task to a human. Returns null while work is
   * still moving.
   */
  evaluate() {
    const idle = this.idleMs();
    if (idle === null || idle < this.stallMs) return null;
    if (this.state.attempts >= this.maxRetries) {
      return { action: "founder-gate", reason: `no meaningful progress for ${Math.round(idle / 60000)}min after ${this.state.attempts} retries`, idleMs: idle, attempts: this.state.attempts };
    }
    // Spend the retry here so the budget and the ladder cannot disagree.
    const spent = this.attempt();
    return { action: "retry", reason: `no meaningful progress for ${Math.round(idle / 60000)}min`, idleMs: idle, attempts: spent };
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }
}

// ── Real-signal collectors ───────────────────────────────────────────────────

/** sha256 per file; unreadable files are reported as such rather than skipped silently. */
export async function hashFiles(paths) {
  const out = [];
  for (const p of paths) {
    try {
      const buf = await readFile(p);
      out.push({ path: p, hash: createHash("sha256").update(buf).digest("hex") });
    } catch (err) {
      out.push({ path: p, hash: `unreadable:${err.code ?? "ERR"}` });
    }
  }
  return out;
}

export async function gitHead(cwd) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Parse a test verdict summary out of worker output; null when absent. */
export function parseTestVerdict(output) {
  const s = String(output ?? "");
  const line = s.split("\n").find((l) => /\d+\s+(passed|failed|failing)/i.test(l));
  if (!line) return null;
  return line.trim().replace(/\s+/g, " ");
}

/** mtime is explicitly FALSE, but is kept for diagnostics only. */
export async function mtimeOf(path) {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Append-only progress log. index.mjs state.json is a snapshot that gets
 * overwritten, so there is no append history anywhere today; this creates the
 * first one. Bounded so a long night cannot fill the disk.
 */
export async function appendProgress(root, entry, { maxBytes = 2_000_000 } = {}) {
  await appendFile(root, JSON.stringify(entry) + "\n");
  try {
    const { size } = await stat(root);
    if (size > maxBytes) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(root, "");
    }
  } catch { /* diagnostics never break progress */ }
}
