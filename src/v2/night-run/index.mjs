"use strict";

import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(nodeExecFile);

export const DEFAULT_TIMEZONE = "Asia/Seoul";
export const DEFAULT_DEADLINE = "03:00";
export const DEFAULT_SEND_TO_MAINPC = "/home/skkse12/.agents/skills/send-to-mainpc/scripts/send-to-mainpc.sh";
const TERMINAL = new Set(["COMPLETE", "V1_COMPLETE", "HOLD", "FOUNDER_GATE", "BLOCKED_SCOPE"]);
const COMPLETE_REASONS = new Set(["WBS_EXHAUSTED", "DEADLINE_COMPLETE", "DEADLINE_FORCED_CHECKPOINT"]);

export function deadlineAt(now, value = DEFAULT_DEADLINE, timezone = DEFAULT_TIMEZONE) {
  if (timezone !== DEFAULT_TIMEZONE || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`invalid deadline/timezone: ${value}/${timezone}`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).filter(({ type }) => type !== "literal").map(({ type, value: part }) => [type, part]));
  const [hour, minute] = value.split(":").map(Number);
  const today = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour - 9, minute);
  const result = new Date(today);
  return result >= now ? result : new Date(today + 86_400_000);
}

export function laneExhausted(project, state, definitions = []) {
  const tasks = (state.tasks || []).filter((task) => task.projectId === project.id);
  const pending = tasks.some((task) => ["QUEUED", "RUNNING", "QA", "REQUEST_CHANGES"].includes(task.state));
  const remaining = definitions.some((definition) => !tasks.some((task) => task.taskId === definition.taskId && ["VERIFIED_DONE", "HOLD", "FOUNDER_GATE", "BLOCKED_SCOPE"].includes(task.state)));
  return !pending && (!remaining || ["HOLD", "FOUNDER_GATE", "BLOCKED_SCOPE"].includes(project.state)) && TERMINAL.has(project.state || "");
}

export function evaluateExhaustion(manifest, state) {
  const lanes = manifest.projects.filter((project) => project.active !== false && project.coreV1 !== false).map((project) => ({ project: project.id, exhausted: laneExhausted(state.projects?.find((item) => item.id === project.id) || project, state, project.tasks || (project.task ? [project.task] : [])) }));
  return { complete: lanes.every((lane) => lane.exhausted), lanes };
}

export function readCompletion(value) {
  const required = ["runId", "startedAt", "deadline", "freezeAt", "checkpointAt", "endedAt", "endReason", "shutdownState"];
  if (!value || value.schema !== "agent-relay.last-night-run.v1" || required.some((field) => !value[field]) || !Array.isArray(value.lanes) || !COMPLETE_REASONS.has(value.endReason)) return { ok: false, reason: "UNKNOWN_NIGHT_RUN" };
  return { ok: true, reason: value.endReason, resumeRequired: Boolean(value.resumeRequired) };
}

// node --test marks its processes with NODE_TEST_CONTEXT; a real power command from a test is always a bug.
const underTest = () => Boolean(process.env.NODE_TEST_CONTEXT);

export function runPoweroff({ checkpoint, command = "sudo", args = ["-n", "/usr/sbin/poweroff"] }) {
  if (underTest() && command === "sudo") return Promise.resolve({ ok: false, status: "REFUSED", reason: "REAL_POWEROFF_UNDER_TEST" });
  const gate = readCompletion(checkpoint);
  if (!gate.ok) return Promise.resolve({ ok: false, status: "REFUSED", reason: gate.reason });
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => resolve({ ok: false, status: "SHUTDOWN_PERMISSION_REQUIRED", reason: error.message }));
    child.once("close", (code) => resolve(code === 0 ? { ok: true, status: "POWEROFF_REQUESTED" } : { ok: false, status: "SHUTDOWN_PERMISSION_REQUIRED", reason: stderr.trim() || `exit ${code}` }));
  });
}

export async function drainManaged(entries = [], { graceMs = 1_000, sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)) } = {}) {
  const owned = entries.filter((entry) => entry?.managed === true && entry.owner === "agent-relay");
  await Promise.all(owned.map((entry) => entry.stop?.()));
  await sleep(graceMs);
  await Promise.all(owned.map((entry) => entry.kill?.()));
  return owned.map((entry) => entry.id);
}

export function mainPcTarget(env = process.env) {
  return env.MAINPC_SSH_TARGET || env.MAINPC_SSH_ALIAS || (env.MAINPC_SSH_USER && env.MAINPC_SSH_HOST ? `${env.MAINPC_SSH_USER}@${env.MAINPC_SSH_HOST}` : "User@100.86.210.95");
}

// Same key the send-to-mainpc script uses; explicit so no ~/.ssh/config alias is needed.
export function mainPcIdentity(env = process.env) {
  const key = env.MAINPC_SSH_KEY || `${env.HOME || ""}/.ssh/id_ed25519_mainpc`;
  return existsSync(key) ? key : null;
}

export function seoulDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

const LANE_KO = { "agent-relay": "Agent Relay", juactl: "actl", juplan: "JuPlan", juceipt: "JuCeipt", jucontroler: "JuControler 공개판", "jucontroler-app": "통합 관제 화면", "juceipt-planning": "JuCeipt 기획", jutell: "JuTell", juai: "JuAi", "ai-agent-marketplace": "AI 에이전트 마켓플레이스" };
const kst = (iso) => { try { return new Intl.DateTimeFormat("ko-KR", { timeZone: DEFAULT_TIMEZONE, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)); } catch { return "-"; } };

// Plain-Korean night report for the Founder (2026-09-25: "보고서가 전부 영어라 못 알아보겠음"). ctx = {state, manifest, holds}
// is best-effort context loaded at finalize time; without it the report still says what happened in Korean.
export function buildNightReport(record, ctx = {}) {
  const tasks = ctx.state?.tasks || [];
  const titles = {}; for (const p of ctx.manifest?.projects || []) for (const t of p.tasks || []) titles[t.taskId] = t.title || t.scope?.slice(0, 60);
  const from = Date.parse(record.startedAt || 0); const to = Date.parse(record.endedAt || new Date().toISOString());
  const done = tasks.filter((t) => t.state === "VERIFIED_DONE" && t.doneAt && Date.parse(t.doneAt) >= from && Date.parse(t.doneAt) <= to);
  const byLane = {}; for (const t of done) (byLane[t.projectId] ||= []).push(t);
  const holds = (ctx.holds || []).filter((h) => h.choice !== "skip");
  const lines = [`# 밤 작업 보고서 ${seoulDate(new Date(record.startedAt || Date.now()))}`, ""];
  if (record.shutdownState === "REPORTING") lines.push("> 이 보고서가 MainPC에 보이면 전송은 성공했어요. 그다음 MainPC(30초 뒤) → ASUS 순서로 꺼져요. 아침에 ASUS를 켜면 자동 작업이 알아서 다시 시작돼요.", "");
  lines.push("## 한눈에", `- 시간: ${kst(record.startedAt)} ~ ${kst(record.endedAt || record.deadline)}`,
    `- 끝낸 작업: **${done.length}개** (프로젝트 ${Object.keys(byLane).length}곳)`,
    `- 멈춘 작업: ${holds.length}개${holds.length ? " — 쉬운 설명과 선택지가 준비돼 있고, 답이 없으면 30분 뒤 추천대로 다시 설계돼요" : ""}`,
    `- 끝난 이유: ${record.endReason === "DEADLINE_COMPLETE" ? "정한 시간이 되어 마무리했어요" : record.endReason === "WBS_EXHAUSTED" ? "할 일을 다 끝냈어요" : "예상과 다르게 끝났어요 (" + (record.endReason || "알 수 없음") + ")"}`, "");
  lines.push("## 프로젝트별로 끝낸 것");
  if (!done.length) lines.push("- 이번 밤에 끝난 작업이 없어요.");
  for (const [lane, list] of Object.entries(byLane).sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`### ${LANE_KO[lane] || lane} — ${list.length}개`);
    for (const t of list.slice(0, 12)) lines.push(`- ${titles[t.taskId] || t.taskId}`);
    if (list.length > 12) lines.push(`- 그 밖에 ${list.length - 12}개`);
  }
  lines.push("", "## 멈춘 작업");
  if (!holds.length) lines.push("- 없어요.");
  for (const h of holds.slice(0, 10)) lines.push(`- ${LANE_KO[h.projectId] || h.projectId} · ${titles[h.taskId] || h.taskId} — ${h.explain?.sentence || "쉬운 설명을 만드는 중이에요"}`);
  lines.push("", "## 아침에 할 일", "- ASUS를 켜기만 하면 돼요. 자동 작업이 이어서 진행돼요.",
    "- 통합 관제 화면에 새로 끝난 게 있으면, Supervisor가 시험·확인한 뒤 반영용 한 줄 명령을 드려요.", "",
    "<details><summary>기술 정보 (개발자용)</summary>", "", `runId ${record.runId} · 마지막 작업 ${record.taskId || "-"} · 종료 ${record.endReason} · 전송 ${record.reportTransferState || "-"} · 끄기 ${record.shutdownState}`, "", "</details>", "");
  return lines.join("\n");
}

export async function sendReportToMainPc({ reportPath, target = mainPcTarget(), scriptPath = process.env.AGENT_RELAY_SEND_TO_MAINPC || DEFAULT_SEND_TO_MAINPC, execFileImpl = execFile }) {
  const localSha = createHash("sha256").update(await readFile(reportPath)).digest("hex");
  const result = await execFileImpl(scriptPath, [reportPath, target], { env: process.env });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const remoteSha = output.match(/SHA256:\s*([0-9a-f]{64})/i)?.[1]?.toLowerCase();
  if (!output.includes("SENT:") || remoteSha !== localSha) throw new Error(`REPORT_TRANSFER_FAILED: expected ${localSha}, got ${remoteSha || "none"}`);
  return { state: "DELIVERED", target, remoteSha, output: output.trim(), path: output.match(/SENT:\s*(\S+)/)?.[1] || null };
}

export async function requestMainPcShutdown({ target = mainPcTarget(), identity = mainPcIdentity(), execFileImpl = execFile } = {}) {
  if (underTest() && execFileImpl === execFile) throw new Error("REAL_MAINPC_SHUTDOWN_UNDER_TEST");
  const key = identity ? ["-i", identity, "-o", "IdentitiesOnly=yes"] : [];
  const result = await execFileImpl("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", ...key, target, "shutdown.exe /s /t 30"], { env: process.env });
  return { state: "REQUESTED", target, command: "shutdown.exe /s /t 30", at: new Date().toISOString(), output: String(result.stdout || "").trim() };
}

async function nightReportContext(dataDir) {
  const read = async (f) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return null; } };
  const state = await read(join(dataDir, "state.json"));
  const manifest = await read(new URL("../../../config/portfolio.json", import.meta.url).pathname);
  const holds = [];
  try { for (const f of await readdir(join(dataDir, "holds"))) { const h = await read(join(dataDir, "holds", f)); if (h && (state?.tasks || []).some((t) => t.taskId === h.taskId && t.state === "HOLD")) holds.push(h); } } catch {}
  return { state, manifest, holds };
}

export async function finalizeNightRun({ record: initial, checkpointPath, persist, send = sendReportToMainPc, requestShutdown = requestMainPcShutdown, poweroff = runPoweroff, reportPath, dryRun = false, deferPoweroff = false, transport = "push" }) {
  let record = { ...initial, checkpointPath, shutdownState: "REPORTING", reportPathAsus: reportPath || `${dirname(checkpointPath)}/NIGHT_REPORT_${seoulDate(new Date(initial.startedAt))}.md`, reportPathMainPC: null, reportTransferState: "PENDING", mainPcShutdownRequested: false, mainPcShutdownAt: null, asusShutdownRequested: false, unfinishedTasks: initial.unfinishedTasks || [] };
  await mkdir(dirname(record.reportPathAsus), { recursive: true });
  await writeFile(record.reportPathAsus, buildNightReport(record, await nightReportContext(dirname(checkpointPath))));
  if (transport === "mainpc-pull") return persist({ ...record, shutdownState: "READY_FOR_MAINPC_PULL", reportState: "LOCAL_READY", reportTransferState: "LOCAL_ONLY", asusShutdownRequested: false });
  try { const transfer = dryRun ? { state: "DRY_RUN", path: `MainPC/Desktop/${record.reportPathAsus.split("/").pop()}`, remoteSha: createHash("sha256").update(await readFile(record.reportPathAsus)).digest("hex") } : await send({ reportPath: record.reportPathAsus }); record = { ...record, reportTransferState: transfer.state, reportPathMainPC: transfer.path || null, reportTransferSha256: transfer.remoteSha || null }; }
  catch (error) { record = { ...record, reportTransferState: "REPORT_TRANSFER_FAILED", reportTransferError: String(error.message || error) }; }
  // Fail closed: without a verified report on MainPC, nothing is shut down (the report stays on ASUS).
  if (!dryRun && record.reportTransferState !== "DELIVERED") return persist({ ...record, shutdownState: "REPORT_NOT_DELIVERED" });
  await persist(record);
  try { const shutdown = dryRun ? { state: "DRY_RUN", command: "shutdown.exe /s /t 30", at: new Date().toISOString() } : await requestShutdown(); record = { ...record, mainPcShutdownRequested: shutdown.state === "REQUESTED" || shutdown.state === "DRY_RUN", mainPcShutdownAt: shutdown.at, mainPcShutdownState: shutdown.state }; }
  catch (error) { record = { ...record, mainPcShutdownState: "FAILED", mainPcShutdownError: String(error.message || error) }; }
  // MainPC goes first; if it could not be scheduled, ASUS stays on.
  if (!dryRun && record.mainPcShutdownState !== "REQUESTED") return persist({ ...record, shutdownState: "MAINPC_SHUTDOWN_FAILED" });
  await persist(record);
  if (dryRun || deferPoweroff) return persist({ ...record, shutdownState: dryRun ? "DRY_RUN_COMPLETE" : "READY_FOR_ASUS_POWEROFF", asusShutdownRequested: false });
  record = { ...record, asusShutdownRequested: true, shutdownState: "ASUS_POWEROFF_REQUESTED" }; await persist(record);
  const asus = await poweroff({ checkpoint: record });
  return persist({ ...record, asusShutdownState: asus.status, shutdownState: asus.ok ? "POWEROFF_REQUESTED" : asus.status });
}

function currentTask(state) {
  return (state.tasks || []).find((task) => !["VERIFIED_DONE"].includes(task.state)) || (state.tasks || []).at(-1) || null;
}

function record({ runId, startedAt, deadline, freezeAt, checkpointAt, endedAt = null, endReason, shutdownState = "NOT_REQUESTED", state, resumeRequired }) {
  const task = currentTask(state);
  const completedTaskCount = (state.tasks || []).filter((item) => item.state === "VERIFIED_DONE").length;
  return {
    schema: "agent-relay.last-night-run.v1", runId, startedAt, deadline, freezeAt, checkpointAt, endedAt, endReason, shutdownState,
    service: state.service || "NIGHT_RUN", currentProject: task?.projectId || null, currentTask: task?.taskId || null, completedTaskCount, lastTransition: state.lastTransition || null,
    project: task?.projectId || null, taskId: task?.taskId || null,
    pmState: state.projects?.find((project) => project.id === task?.projectId)?.state || null,
    runtime: state.projects?.find((project) => project.id === task?.projectId)?.runtime || null,
    workerState: task?.state || null, qaState: task?.qa?.verdict || null,
    attempts: task?.attempts || 0, worktree: task?.builderEvidence?.workspace || null,
    commitSha: task?.result?.commitSha || null, promotionRef: task?.promotionRef || null,
    blocker: task?.error || task?.blocker || null, resumeRequired,
    lanes: state.projects || [], reportPathAsus: state.reportPathAsus || null, reportState: state.reportState || null, updatedAt: new Date().toISOString(),
  };
}

export class NightRunSupervisor {
  constructor({ runner, checkpointPath, clock = () => new Date(), sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)), runId = `night-${Date.now()}`, finalize = null }) {
    this.runner = runner; this.checkpointPath = checkpointPath; this.clock = clock; this.sleep = sleep; this.runId = runId; this.finalize = finalize;
  }

  async persist(value) {
    await mkdir(dirname(this.checkpointPath), { recursive: true });
    const temp = `${this.checkpointPath}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temp, this.checkpointPath);
    return value;
  }

  async status() { try { return JSON.parse(await readFile(this.checkpointPath, "utf8")); } catch { return null; } }

  async once({ deadline = DEFAULT_DEADLINE } = {}) {
    const started = this.clock();
    let state = await this.runner.reconcile();
    const cutoff = deadlineAt(started, deadline);
    const times = { deadline: cutoff.toISOString(), freezeAt: new Date(cutoff - 5 * 60_000).toISOString(), checkpointAt: new Date(cutoff - 2 * 60_000).toISOString() };
    if (started >= cutoff) return this.persist(record({ runId: this.runId, startedAt: started.toISOString(), ...times, endedAt: started.toISOString(), endReason: "DEADLINE_COMPLETE", shutdownState: "DRAIN_REQUIRED", state, resumeRequired: true }));
    if (evaluateExhaustion(this.runner.manifest, state).complete) return this.persist(record({ runId: this.runId, startedAt: started.toISOString(), ...times, endedAt: started.toISOString(), endReason: "WBS_EXHAUSTED", shutdownState: "DRAIN_REQUIRED", state, resumeRequired: false }));
    state = await this.runner.runOnce();
    const complete = evaluateExhaustion(this.runner.manifest, state).complete;
    return this.persist(record({ runId: this.runId, startedAt: started.toISOString(), ...times, endedAt: complete ? this.clock().toISOString() : null, endReason: complete ? "WBS_EXHAUSTED" : "RUNNING", shutdownState: complete ? "DRAIN_REQUIRED" : "NOT_REQUESTED", state, resumeRequired: !complete }));
  }

  // holdUntilDeadline (Founder 2026-09-24: "5시까지 계속, 5시에 종료"): running out of WBS does not end the night;
  // the loop keeps polling (the PM refills lanes meanwhile) and only the deadline path finishes and shuts down.
  async run({ deadline = DEFAULT_DEADLINE, intervalMs = 15_000, signal, holdUntilDeadline = false } = {}) {
    const exhausted = (value) => !holdUntilDeadline && evaluateExhaustion(this.runner.manifest, value).complete;
    const started = this.clock();
    const cutoff = deadlineAt(started, deadline);
    const freezeAt = new Date(cutoff - 5 * 60_000);
    const checkpointAt = new Date(cutoff - 2 * 60_000);
    const drainAt = new Date(cutoff - 60_000);
    let state = await this.runner.reconcile();
    const write = (endReason, endedAt = null, shutdownState = "NOT_REQUESTED", resumeRequired = true) => this.persist({ ...record({ runId: this.runId, startedAt: started.toISOString(), deadline: cutoff.toISOString(), freezeAt: freezeAt.toISOString(), checkpointAt: checkpointAt.toISOString(), endedAt, endReason, shutdownState, state, resumeRequired }), checkpointPath: this.checkpointPath });
    const finish = async (reason, resumeRequired) => { await this.runner.stop?.(); const result = await write(reason, this.clock().toISOString(), "FINALIZING", resumeRequired); return this.finalize ? this.finalize(result) : result; };
    const drain = async () => { await this.runner.stop?.(); while (this.clock() < drainAt && !signal?.aborted) await this.sleep(Math.max(1, drainAt - this.clock())); };
    state.service = "NIGHT_RUN_ACTIVE"; state.lastTransition = "NIGHT_RUN_STARTED"; await write("RUNNING", null, "ACTIVE", true);
    if (exhausted(state)) return finish("WBS_EXHAUSTED", false);
    while (!signal?.aborted) {
      const now = this.clock(); state.lastTransition = now >= freezeAt ? "DISPATCH_FREEZE" : "RUN_ONCE";
      if (now >= cutoff) return finish("DEADLINE_COMPLETE", true);
      if (now >= checkpointAt) {
        state = await this.runner.load(); await write("CHECKPOINTED_DEADLINE", null, "CHECKPOINT_REQUIRED", true);
        await drain();
        return finish("DEADLINE_COMPLETE", true);
      }
      if (now >= freezeAt) {
        state = await this.runner.load();
        if (exhausted(state)) return finish("WBS_EXHAUSTED", false);
        await this.sleep(Math.min(intervalMs, Math.max(1, checkpointAt - now)));
        continue;
      }
      const childSignal = new AbortController();
      const abort = () => childSignal.abort(); signal?.addEventListener("abort", abort, { once: true });
      let completed = false;
      // Continuous wave when the runner has it (lanes do not wait for each other); dispatch closes at the freeze time.
      const wave = this.runner.runWave ? this.runner.runWave({ signal: childSignal.signal, dispatchUntil: freezeAt }) : this.runner.runOnce({ signal: childSignal.signal });
      const work = wave.then((value) => { completed = true; return value; });
      const untilCheckpoint = this.sleep(Math.max(1, checkpointAt - now)).then(() => null);
      state = (await Promise.race([work, untilCheckpoint])) || state;
      signal?.removeEventListener("abort", abort);
      if (!completed) { childSignal.abort(); state = await this.runner.load(); await write("CHECKPOINTED_DEADLINE", null, "CHECKPOINT_REQUIRED", true); await drain(); return finish("DEADLINE_COMPLETE", true); }
      if (exhausted(state)) return finish("WBS_EXHAUSTED", false);
      await this.sleep(intervalMs);
    }
    await this.runner.stop?.(); state = await this.runner.load(); return write("STOPPED", this.clock().toISOString(), "DRAINED", true);
  }
}
