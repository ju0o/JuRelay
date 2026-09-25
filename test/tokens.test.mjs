import assert from "node:assert/strict";
import test from "node:test";
import { ControlRoomError, runControlRoomTokens } from "../dist/server/backend/controlRoom.js";
import { TOKENS_REFRESH_MS, formatTokens, normalizeTokens, topTokenProjects, tokensSummaryLine } from "../dist/server/shared/tokens.js";

const BASE = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "asus", "~/.agents/skills/auto-night-orchestrator/scripts/night"];
const TOKENS = {
  summary: "오늘 토큰을 많이 썼어요.",
  totals: { fresh: 123_456_789, cache: 2_500_000_000 },
  projects: [
    { project: "juplan", fresh: 100, cache: 5 },
    { project: "agent-relay", fresh: 90_000_000, cache: 1 },
    ...[0, 1, 2, 3, 4].map(i => ({ project: `p${i}`, fresh: 10 + i, cache: 0 })),
  ],
  findings: [
    { kind: "leak", severity: "info", text: "같은 파일을 반복해서 읽어요", why: "캐시가 계속 다시 읽혀요", action: "작업을 나눠 주세요", folder: "/home/x/y", session: "s-1" },
    { kind: "spike", severity: "warn", text: "토큰이 갑자기 늘었어요", why: "10분 만에 5배", action: "작업을 멈춰 보세요", taskId: "T-1", runtime: "codex" },
  ],
};

test("tokens runs the fixed ssh argv with shell:false", async () => {
  let call;
  const value = await runControlRoomTokens(async (...a) => { call = a; return { stdout: JSON.stringify(TOKENS), stderr: "" }; });
  assert.deepEqual(value, TOKENS);
  assert.equal(call[0], "ssh");
  assert.deepEqual(call[1], [...BASE, "tokens", "--json"]);
  assert.equal(call[2].shell, false);
});

test("tokens tells remote failure from offline", async () => {
  const remote = await runControlRoomTokens(async () => { throw Object.assign(new Error("x"), { code: 1, stderr: "boom" }); }).catch(e => e);
  assert.ok(remote instanceof ControlRoomError);
  assert.equal(remote.code, "REMOTE_FAILED");
  const off = await runControlRoomTokens(async () => { throw Object.assign(new Error("x"), { code: 255 }); }).catch(e => e);
  assert.equal(off.code, "EXEC_FAILED");
  assert.match(off.message, /연결할 수 없습니다/);
});

test("formatTokens uses 억/만", () => {
  assert.equal(formatTokens(2_500_000_000), "25억");
  assert.equal(formatTokens(123_456_789), "1억 2,345만");
  assert.equal(formatTokens(52_000), "5만 2천");
  assert.equal(formatTokens(50_000), "5만");
  assert.equal(formatTokens(830), "830");
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(null), "확인 중");
});

test("normalizeTokens: anomalies before leaks, friendly names, top 6, raw kept aside", () => {
  const v = normalizeTokens(TOKENS);
  assert.deepEqual(v.findings.map(f => f.kind), ["spike", "leak"]);
  assert.equal(v.findings[0].severity, "warn");
  assert.equal(v.findings[1].severity, "info");
  assert.equal(v.findings[0].text, "토큰이 갑자기 늘었어요");
  assert.deepEqual(v.findings[0].raw, { taskId: "T-1", runtime: "codex" });
  assert.equal(v.findings[0].why, "10분 만에 5배");
  assert.equal(v.fresh, 123_456_789);
  assert.equal(v.cache, 2_500_000_000);
  const top = topTokenProjects(v);
  assert.equal(top.length, 6);
  assert.equal(top[0].label, "Agent Relay");
  assert.equal(top[1].label, "JuPlan");
});

test("normalizeTokens merges separate anomalies/leaks arrays and survives junk", () => {
  const v = normalizeTokens({ leaks: [{ kind: "idle-loop", text: "L" }], anomalies: [{ kind: "burst" }, { kind: "heavy-task", text: "H" }] });
  assert.deepEqual(v.findings.map(f => f.kind), ["burst", "heavy-task", "idle-loop"]);
  assert.equal(v.findings[0].text, "짧은 시간에 토큰을 몰아 썼어요");
  for (const junk of [null, 5, "x", [], {}]) {
    const j = normalizeTokens(junk);
    assert.deepEqual(j.findings, []);
    assert.equal(j.fresh, null);
  }
});

test("summary line and empty state", () => {
  assert.equal(tokensSummaryLine(normalizeTokens(TOKENS)), "오늘 토큰을 많이 썼어요.");
  assert.match(tokensSummaryLine(normalizeTokens({ findings: [] })), /새는 곳 없이/);
  assert.match(tokensSummaryLine(normalizeTokens({ findings: [{ kind: "spike" }] })), /1건/);
});

test("refresh is not faster than 5 minutes", () => {
  assert.ok(TOKENS_REFRESH_MS >= 5 * 60_000);
});
