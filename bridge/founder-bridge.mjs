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
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FounderInboxBridge, founderBridgeLaunchOptions, loadFounderBridgeConfig } from "../src/v2/founder-bridge/index.mjs";

const bridge = new FounderInboxBridge(founderBridgeLaunchOptions(process.env, loadFounderBridgeConfig(dirname(fileURLToPath(import.meta.url)))));
const command = process.argv[2] || "run";
if (command === "once") console.log(JSON.stringify(await bridge.once(), null, 2));
else if (command === "run") await bridge.run();
else throw new Error(`usage: founder-bridge.mjs [run|once]`);
