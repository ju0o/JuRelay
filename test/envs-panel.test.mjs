import assert from "node:assert/strict";
import test from "node:test";
import { ControlRoomError, runControlRoomEnvs } from "../dist/server/backend/controlRoom.js";
import { barPercent, envReasonText, envTone, normalizeEnvs, ramText } from "../dist/server/shared/projectLabels.js";

const BASE = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "asus", "~/.agents/skills/auto-night-orchestrator/scripts/night"];
const fake = {
  envs: [
    { id: "asus", ok: true, cpu_pct: 22.4, ram_free_gb: 9.2, ram_total_gb: 16, ais: ["codex", "claude-team", "codex"] },
    { id: "mainpc", ok: true, cpu_pct: 91, ram_free_gb: 8, ram_total_gb: 32, ais: [] },
    { id: "cloud", ok: false, reason: "ssh: connect timed out" },
  ],
};

test("envs runs the fixed ssh argv with a 30s timeout and shell:false", async () => {
  let call;
  const value = await runControlRoomEnvs(async (...a) => { call = a; return { stdout: JSON.stringify(fake), stderr: "" }; });
  assert.deepEqual(value, fake);
  assert.equal(call[0], "ssh");
  assert.deepEqual(call[1], [...BASE, "envs", "--json"]);
  assert.deepEqual(call[2], { shell: false, timeout: 30_000 });
});

test("envs tells remote failure from offline", async () => {
  const remote = await runControlRoomEnvs(async () => { throw Object.assign(new Error("x"), { code: 1, stderr: "boom" }); }).catch(e => e);
  assert.ok(remote instanceof ControlRoomError);
  assert.equal(remote.code, "REMOTE_FAILED");
  const off = await runControlRoomEnvs(async () => { throw Object.assign(new Error("x"), { code: 255 }); }).catch(e => e);
  assert.equal(off.code, "EXEC_FAILED");
  assert.match(off.message, /연결할 수 없습니다/);
});

test("normalizeEnvs maps labels, friendly AI names, and ok=false", () => {
  const rows = normalizeEnvs(fake);
  assert.deepEqual(rows.map(r => r.label), ["ASUS (이 컴퓨터)", "MainPC", "클라우드"]);
  assert.deepEqual(rows[0].ais, ["Codex", "Claude Team"]);
  assert.equal(rows[2].ok, false);
  assert.equal(rows[2].cpuPct, null);
  assert.deepEqual(normalizeEnvs(null), []);
  assert.equal(normalizeEnvs([{ id: "asus" }]).length, 1);
});

test("barPercent clamps and handles missing values", () => {
  assert.equal(barPercent(22.4), 22);
  assert.equal(barPercent(150), 100);
  assert.equal(barPercent(-5), 0);
  assert.equal(barPercent(null), 0);
  assert.equal(barPercent(8, 16), 50);
  assert.equal(barPercent(3, 0), 0);
});

test("envTone: green plenty, amber at RAM<3.5 or CPU>80, red only RAM<1.5", () => {
  const [asus, mainpc, cloud] = normalizeEnvs(fake);
  assert.equal(envTone(asus), "ok");
  assert.equal(envTone(mainpc), "warn");
  assert.equal(envTone(cloud), "warn");
  assert.equal(envTone({ ok: true, cpuPct: 10, ramFreeGb: 3.4 }), "warn");
  assert.equal(envTone({ ok: true, cpuPct: 10, ramFreeGb: 3.5 }), "ok");
  assert.equal(envTone({ ok: true, cpuPct: 80, ramFreeGb: 8 }), "ok");
  assert.equal(envTone({ ok: true, cpuPct: 99, ramFreeGb: 1.4 }), "danger");
  assert.equal(envTone({ ok: true, cpuPct: 99, ramFreeGb: 1.5 }), "warn");
});

test("plain-Korean text keeps English reasons off the surface", () => {
  const [asus, , cloud] = normalizeEnvs(fake);
  assert.equal(ramText(asus), "메모리 남은 9.2GB / 전체 16GB");
  assert.doesNotMatch(envReasonText(cloud), /ssh|timed out/);
  assert.equal(cloud.rawReason, "ssh: connect timed out");
  assert.equal(envReasonText(asus), "");
});
