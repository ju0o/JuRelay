#!/usr/bin/env node
/**
 * MCP auth proxy — a local reverse proxy that injects the Agent Relay bearer token.
 *
 * Why this exists (2026-09-29): the PM widget is reached over a Cloudflare Tunnel from ChatGPT. A
 * Cloudflare Worker used to sit in front of it doing the same 15 lines of header injection. Moving
 * that here takes the request path off workers.dev entirely, which is the whole point: a Worker
 * counts against Workers quota, and this never leaves the machine.
 *
 * Why not nginx: nginx cannot read a file inside `proxy_set_header`, so the token would have to sit
 * in the config file in plain text. Here the token only ever exists in one place — the 0600
 * EnvironmentFile named by the systemd unit — and never in any file this process writes, never in a
 * URL, and never in a log line.
 *
 * The token is read from the environment (MCP_TOKEN) and never from argv, so it cannot appear in
 * `ps` output. The upstream port is loopback-only, so this process is the only way in.
 */
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const TOKEN = process.env.MCP_TOKEN?.trim();
const PORT = Number(process.env.MCP_PROXY_PORT ?? 8081);
const UPSTREAM_HOST = process.env.MCP_UPSTREAM_HOST ?? "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.MCP_UPSTREAM_PORT ?? 3898);
const PATH = process.env.MCP_PROXY_PATH ?? "/mcp";

if (!TOKEN) {
  // Fail loudly rather than starting an unauthenticated proxy in front of the MCP server.
  console.error("mcp-auth-proxy: MCP_TOKEN is not set; refusing to start. Check the unit's EnvironmentFile.");
  process.exit(1);
}

const agent = TOKEN.startsWith("http") ? httpsRequest : httpRequest;
let failures = 0;

createServer((req, res) => {
  const upstreamPath = req.url?.startsWith(PATH) ? req.url : `${PATH}${req.url || "/"}`;
  const headers = { ...req.headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}`, authorization: `Bearer ${TOKEN}` };
  delete headers["content-length"];   // re-chunked by the pipe below
  const upstream = agent({ hostname: UPSTREAM_HOST, port: UPSTREAM_PORT, path: upstreamPath, method: req.method, headers }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", (error) => {
    failures += 1;
    // The message can contain the upstream host, never the token.
    console.error(`mcp-auth-proxy: upstream error (${failures} total): ${error.message}`);
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "upstream unavailable" }));
  });
  req.pipe(upstream);
}).listen(PORT, "127.0.0.1", () => {
  // Logs the shape, not the secret.
  console.log(`mcp-auth-proxy: 127.0.0.1:${PORT}${PATH} -> http://${UPSTREAM_HOST}:${UPSTREAM_PORT}${PATH} (auth: bearer, ${TOKEN.length} chars)`);
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));
