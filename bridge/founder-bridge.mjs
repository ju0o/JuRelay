#!/usr/bin/env node
/**
 * Founder Inbox Bridge launcher.
 *
 * Where the engine runs is a setting, not a code default:
 *   1. environment — AGENT_RELAY_RUN_LOCATION (local|ssh), AGENT_RELAY_SSH_ALIAS,
 *      AGENT_RELAY_REMOTE_DATA_ROOT (legacy REMOTE_ALIAS / REMOTE_DATA_ROOT still read)
 *   2. founder-bridge.config.json next to this file — written by install-founder-bridge.ps1
 *   3. otherwise 'this computer' (local file copy, no ssh)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FounderInboxBridge } from "../src/v2/founder-bridge/index.mjs";

function readConfig() {
  try {
    const parsed = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "founder-bridge.config.json"), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const config = readConfig();
const env = process.env;
const bridge = new FounderInboxBridge({
  kind: env.AGENT_RELAY_RUN_LOCATION || config.kind,
  alias: env.AGENT_RELAY_SSH_ALIAS || env.REMOTE_ALIAS || config.alias,
  remoteRoot: env.AGENT_RELAY_REMOTE_DATA_ROOT || env.REMOTE_DATA_ROOT || config.remoteRoot,
  localInbox: env.LOCAL_INBOX || config.localInbox || `${env.USERPROFILE || env.HOME}/Desktop/FounderInbox`,
  pollIntervalMs: Number(env.POLL_INTERVAL_MS || config.pollIntervalMs || 15000),
});
const command = process.argv[2] || "run";
if (command === "once") console.log(JSON.stringify(await bridge.once(), null, 2));
else if (command === "run") await bridge.run();
else throw new Error(`usage: founder-bridge.mjs [run|once]`);
