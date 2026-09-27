#!/usr/bin/env node
/**
 * Founder Gate UI launcher.
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
import { FounderGateUiServer } from "../src/v2/founder-ui/index.mjs";

const options = founderBridgeLaunchOptions(process.env, loadFounderBridgeConfig(dirname(fileURLToPath(import.meta.url))));
const bridge = new FounderInboxBridge(options);
const server = new FounderGateUiServer({ localInbox: options.localInbox, bridge, port: Number(process.env.FOUNDER_UI_PORT || 3847) });
const port = await server.start();
console.log(`FOUNDER_GATE_UI_READY http://127.0.0.1:${port}`);
const stop = async () => { await server.stop(); process.exit(0); };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
