"use strict";

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const safe = (value) => String(value).replace(/[^A-Za-z0-9._-]/g, "_");

/**
 * 실행 위치 환경 변수 — 앱(settings.json)과 같은 이름을 쓴다 (src/shared/projectManager.ts RUN_LOCATION_ENV).
 * 코드에는 특정 사람의 별칭·경로가 없다. 별칭과 데이터 폴더는 설정 또는 환경 변수로만 온다.
 */
export const BRIDGE_ENV = Object.freeze({
  kind: "AGENT_RELAY_RUN_LOCATION",
  alias: "AGENT_RELAY_SSH_ALIAS",
  dataRoot: "AGENT_RELAY_REMOTE_DATA_ROOT",
});
const SSH_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const text = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * 옵션 → 환경 변수 → 기본값('이 컴퓨터') 순으로 위치를 정한다. 예외 없음.
 * @returns {{ kind: 'local' | 'ssh', alias: string, remoteRoot: string }}
 */
export function resolveBridgeLocation({ kind, alias, remoteRoot } = {}, env = process.env) {
  const pickedAlias = text(alias) || text(env[BRIDGE_ENV.alias]);
  const pickedRoot = text(remoteRoot) || text(env[BRIDGE_ENV.dataRoot]);
  const pickedKind = (text(kind) || text(env[BRIDGE_ENV.kind]) || (pickedAlias ? "ssh" : "local")).toLowerCase();
  const ssh = (pickedKind === "ssh" || pickedKind === "remote") && SSH_ALIAS_PATTERN.test(pickedAlias);
  return { kind: ssh ? "ssh" : "local", alias: ssh ? pickedAlias : "", remoteRoot: pickedRoot };
}

/** 다른 컴퓨터(SSH)와 파일을 주고받는다. 별칭이 없으면 첫 호출에서 분명한 오류를 낸다. */
export class FounderBridgeTransport {
  constructor({ alias, remoteRoot, ssh = "ssh", scp = "scp" } = {}) {
    const location = resolveBridgeLocation({ kind: "ssh", alias, remoteRoot });
    this.alias = location.alias; this.remoteRoot = location.remoteRoot; this.ssh = ssh; this.scp = scp;
  }
  _requireAlias() {
    if (!this.alias) throw new Error(`Founder bridge needs an SSH alias: pass alias or set ${BRIDGE_ENV.alias}`);
    if (!this.remoteRoot) throw new Error(`Founder bridge needs the other computer's data root: pass remoteRoot or set ${BRIDGE_ENV.dataRoot}`);
  }
  async discover() {
    this._requireAlias();
    const { stdout } = await exec(this.ssh, [this.alias, "find", `${this.remoteRoot}/founder-outbox`, "-type", "f", "-path", "*/packets/*.md"]);
    return stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  }
  async pull(remotePath, localPath) { this._requireAlias(); await exec(this.scp, [`${this.alias}:${remotePath}`, localPath]); }
  async hash(remotePath) { this._requireAlias(); const { stdout } = await exec(this.ssh, [this.alias, "sha256sum", remotePath]); return stdout.trim().split(/\s+/)[0]; }
  async push(localPath, remotePath) {
    this._requireAlias();
    await exec(this.ssh, [this.alias, "mkdir", "-p", dirname(remotePath)]);
    await exec(this.scp, [localPath, `${this.alias}:${remotePath}`]);
  }
}

/** 같은 컴퓨터 안에서 파일을 옮긴다 — 기본 실행 위치('이 컴퓨터'). ssh/scp를 쓰지 않는다. */
export class LocalFounderBridgeTransport {
  constructor({ remoteRoot } = {}) {
    this.remoteRoot = resolveBridgeLocation({ kind: "local", remoteRoot }).remoteRoot;
  }
  _requireRoot() {
    if (!this.remoteRoot) throw new Error(`Founder bridge needs the engine data root: pass remoteRoot or set ${BRIDGE_ENV.dataRoot}`);
  }
  async discover() {
    this._requireRoot();
    const outbox = join(this.remoteRoot, "founder-outbox");
    let projects; try { projects = await readdir(outbox, { withFileTypes: true }); } catch { return []; }
    const found = [];
    for (const project of projects.filter((entry) => entry.isDirectory())) {
      const packets = join(outbox, project.name, "packets");
      let names; try { names = await readdir(packets); } catch { continue; }
      for (const name of names.filter((x) => x.endsWith(".md"))) {
        const path = join(packets, name);
        if ((await stat(path)).isFile()) found.push(path);
      }
    }
    return found.sort();
  }
  async pull(remotePath, localPath) { await copyFile(remotePath, localPath); }
  async hash(remotePath) { return sha256(await readFile(remotePath)); }
  async push(localPath, remotePath) { await mkdir(dirname(remotePath), { recursive: true }); await copyFile(localPath, remotePath); }
}

/** 위치에 맞는 전송기. ssh 별칭이 정해져 있으면 SSH, 아니면 이 컴퓨터. */
export function createFounderBridgeTransport(options = {}) {
  const location = resolveBridgeLocation(options);
  return location.kind === "ssh"
    ? new FounderBridgeTransport({ alias: location.alias, remoteRoot: location.remoteRoot, ssh: options.ssh, scp: options.scp })
    : new LocalFounderBridgeTransport({ remoteRoot: location.remoteRoot });
}

export class FounderInboxBridge {
  constructor({ transport, localInbox, kind, alias, remoteRoot, pollIntervalMs = 15_000, lockPath } = {}) {
    const location = resolveBridgeLocation({ kind, alias, remoteRoot });
    this.transport = transport || createFounderBridgeTransport(location);
    this.localInbox = localInbox;
    this.remoteRoot = location.remoteRoot;
    this.pollIntervalMs = pollIntervalMs;
    this.lockPath = lockPath || join(localInbox, ".founder-bridge.lock");
    this.lock = null;
  }

  async acquireSingleInstance() {
    await mkdir(dirname(this.lockPath), { recursive: true });
    try { this.lock = await open(this.lockPath, "wx"); await this.lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); return true; }
    catch { throw new Error("Founder Inbox Bridge already running"); }
  }
  async releaseSingleInstance() { await this.lock?.close().catch(() => {}); this.lock = null; await rm(this.lockPath, { force: true }); }

  _remoteProject(remotePath) {
    const parts = remotePath.split("/"); const index = parts.lastIndexOf("packets"); return parts[index - 1] || "unknown";
  }
  async _localProject(remoteProject) {
    try { const existing = await readdir(this.localInbox); return existing.find((name) => name.toLowerCase() === remoteProject.toLowerCase()) || remoteProject; }
    catch { return remoteProject; }
  }
  async _receipt(gateId, project, destination, contentHash) {
    return { GATE_ID: gateId, gateId, project, localDestination: destination, deliveredAt: new Date().toISOString(), contentHash };
  }
  async _writeTemp(path, bytes) { const temp = `${path}.bridge-${process.pid}.tmp`; await writeFile(temp, bytes); await rename(temp, path); }

  async syncOnce() {
    const results = []; const remotePackets = await this.transport.discover();
    for (const remotePath of remotePackets) {
      const remoteProject = this._remoteProject(remotePath); const project = await this._localProject(remoteProject);
      const remoteName = basename(remotePath);
      const localDir = join(this.localInbox, project); const localPath = join(localDir, remoteName);
      await mkdir(localDir, { recursive: true });
      let localBytes; try { localBytes = await readFile(localPath); } catch { localBytes = null; }
      const remoteHash = this.transport.hash ? await this.transport.hash(remotePath) : null;
      if (localBytes && remoteHash && sha256(localBytes) !== remoteHash) throw new Error(`local packet hash mismatch: ${localPath}`);
      if (!localBytes) { await this.transport.pull(remotePath, localPath); localBytes = await readFile(localPath); }
      const content = localBytes.toString("utf8"); const match = content.match(/^GATE_ID:\s*(\S+)\s*$/m); const packetProject = content.match(/^PROJECT:\s*(\S+)\s*$/m)?.[1];
      if (!match) throw new Error(`packet missing GATE_ID: ${remotePath}`);
      if (!packetProject || packetProject.toLowerCase() !== remoteProject.toLowerCase()) throw new Error(`packet project mismatch: ${remotePath}`);
      const contentHash = sha256(localBytes); const receipt = await this._receipt(match[1], project, localPath, contentHash);
      const receiptPath = join(localDir, `${match[1]}.delivery.json`); await this._writeTemp(receiptPath, JSON.stringify(receipt, null, 2));
      const remoteReceipt = `${this.remoteRoot}/founder-outbox/${remoteProject}/receipts/${match[1]}.json`;
      await this.transport.push(receiptPath, remoteReceipt);
      results.push({ gateId: match[1], project, localPath, contentHash, remoteReceipt, state: "DELIVERED" });
    }
    return results;
  }

  async uploadResponses() {
    const uploaded = [];
    for (const project of await readdir(this.localInbox)) {
      const directory = join(this.localInbox, project); let entries; try { entries = await readdir(directory); } catch { continue; }
      for (const name of entries.filter((x) => /^FG-[A-Za-z0-9_-]+\.response\.json$/.test(x))) {
        const path = join(directory, name); const response = JSON.parse(await readFile(path, "utf8"));
        const gateId = response.GATE_ID || response.gateId; const decision = response.DECISION || response.decision;
        if (!/^FG-[A-Za-z0-9_-]+$/.test(gateId || "") || !decision || !response.timestamp) throw new Error(`invalid Founder response: ${path}`);
        const packet = await readFile(join(directory, `${gateId}.md`), "utf8").catch(() => "");
        if (!packet.match(new RegExp(`^GATE_ID:\\s*${gateId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*$`, "m"))) throw new Error(`stale Founder response: ${path}`);
        const remoteProject = packet.match(/^PROJECT:\s*(\S+)\s*$/m)?.[1] || project;
        const remotePath = `${this.remoteRoot}/founder-outbox/${remoteProject}/responses/${gateId}.json`;
        await this.transport.push(path, remotePath); await writeFile(`${path}.uploaded`, new Date().toISOString());
        uploaded.push({ gateId, project, remotePath });
      }
    }
    return uploaded;
  }

  async once() { return { packets: await this.syncOnce(), responses: await this.uploadResponses() }; }
  async run({ signal } = {}) {
    await this.acquireSingleInstance();
    try { do { await this.once(); await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs)); } while (!signal?.aborted); }
    finally { await this.releaseSingleInstance(); }
  }
}
