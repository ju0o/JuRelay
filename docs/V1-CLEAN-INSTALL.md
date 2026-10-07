# V1 Clean Install Contract

Agent Relay V1 install target for a new self-hosted user.

Product journey:

```text
git clone
→ ./setup.sh
→ ./scripts/agent-relay-svc start
→ connect Agent Relay Local in ChatGPT
→ first-run bootstrap
→ first harmless Task
```

Agent Relay stays local-first, self-hosted, OSS, structurally free. No maintainer SaaS, no mandatory paid backend, no central Agent Relay account.

---

## Supported environment (V1)

| Item | Requirement |
|---|---|
| OS | **Linux only** (systemd --user preferred; pidfile fallback) |
| Node | **>= 18** (LTS 20+ recommended; verified on 22) |
| Package manager | **npm** (ships with Node; lockfile is npm) |
| tmux | Required for Worker session runtimes |
| systemd | Preferred for durable local services (`systemctl --user`) |
| Network | Loopback for MCP/proxy; outbound HTTPS for OpenAI tunnel control plane when connecting ChatGPT |
| ChatGPT | ChatGPT Apps / Connectors with Developer Mode; Secure MCP Tunnel via `tunnel-client` |

### Unsupported in V1

- Windows native
- Windows WSL (later target)
- macOS (later target)
- Docker-only “one click” without the Linux host contract above
- Hosted Agent Relay control plane

Do not pretend unsupported OS paths work.

---

## Paths (fresh install)

| Kind | Canonical path |
|---|---|
| Config | `$XDG_CONFIG_HOME/agent-relay` or `~/.config/agent-relay` |
| Data | `$XDG_DATA_HOME/agent-relay` or `~/.local/share/agent-relay` |
| MCP token | `<config>/mcp-token` (mode `0600`) |
| Proxy env | `<config>/mcp-proxy.env` (mode `0600`) |
| Install marker | `<config>/install.json` |
| Runtime pidfiles | `<config>/runtime/` (pidfile mode) |

Legacy note: some existing hosts use `~/.local/share/AgentRelay/data`. V1 setup does **not** migrate or overwrite that tree. Fresh installs use the lowercase `agent-relay` data root above.

---

## Default ports

| Service | Default | Override |
|---|---|---|
| MCP App | `127.0.0.1:3898` | `AGENT_RELAY_MCP_PORT` |
| Auth proxy | `127.0.0.1:8081` | `AGENT_RELAY_PROXY_PORT` |

Isolated/dev instances must pick free ports and a distinct `AGENT_RELAY_INSTANCE` so they never collide with a live production install on the same host.

---

## Setup entrypoint

```bash
git clone <repo>
cd Agent-Relay
./setup.sh
```

`./setup.sh` will:

1. Check prerequisites (OS, Node, npm, tmux)
2. Install npm dependencies
3. Build
4. Create local config/data directories
5. Generate local secret material only when missing (`0600`)
6. Register local services (systemd --user) or prepare pidfile runtime
7. Start MCP App + auth proxy
8. Health-check each layer
9. Print the next human action (ChatGPT connect + tunnel Human Gate)

Failures stop the script with an actionable error. No silent success.

### Idempotency

A second `./setup.sh` is safe:

- does not regenerate secrets when present
- does not duplicate systemd units
- does not destroy user data
- prints `already configured` where applicable

---

## Lifecycle commands

```bash
./scripts/agent-relay-svc start
./scripts/agent-relay-svc stop
./scripts/agent-relay-svc restart
./scripts/agent-relay-svc status
./scripts/agent-relay-svc doctor
```

Equivalent CLI (after build):

```bash
npx agent-relay services start|stop|restart|status
npx agent-relay doctor
```

Users do not need individual systemd unit names for normal operation.

---

## Doctor

`agent-relay doctor` / `./scripts/agent-relay-svc doctor` checks at least:

- Node/runtime version
- build artifacts
- local data directory + permissions
- MCP App health
- auth proxy health
- tunnel/client state (WARN until Human Gate completed)
- worker registry readability
- selected project / bootstrap readiness when config exists
- ChatGPT-facing local MCP URI when knowable (`http://127.0.0.1:<proxy>/mcp`)

Never prints secret values. Final summary: **PASS / WARN / FAIL**.

---

## Secrets

- Stay under the local config directory
- Mode `0600` (owner read/write only)
- Never enter Git (see root `.gitignore`)
- Never print full secret values in logs, docs, or evidence
- Accidental `git status` must not list token/env/runtime-key files from the repo tree

---

## Tunnel / ChatGPT connect (Human Gate)

Fresh install must **not** reuse another user's tunnel id, org id, profile name, or runtime key.

Creating a Secure MCP Tunnel requires browser/device authorization. That step is an explicit **Human Gate**:

1. Install `tunnel-client` (OpenAI) on PATH if missing
2. Create your own tunnel in [Tunnels management](https://platform.openai.com/settings/organization/tunnels)
3. Create a Runtime API key in [API keys](https://platform.openai.com/settings/organization/api-keys)
4. `tunnel-client init` with **your** tunnel id → local MCP proxy URL `http://127.0.0.1:<proxyPort>/mcp`
5. Ready the browser/operator, then mint/approve short-lived auth only when ready
6. `tunnel-client doctor --profile <yours>` then `tunnel-client run --profile <yours>`
7. Open ChatGPT → Settings → Apps / Connectors → Developer Mode → connect **Agent Relay Local**

Setup never continuously regenerates device codes. Mint only when the operator is ready.

---

## Production isolation on shared hosts

When a production Agent Relay is already running (typical ports 3898/8081, units `agent-relay-mcp-app` / `agent-relay-auth-proxy` / `agent-relay-tunnel`):

- Do **not** stop or replace it to test setup
- Use an isolated `HOME` / `XDG_*` / `AGENT_RELAY_INSTANCE` / alternate ports
- Prefer `AGENT_RELAY_RUNTIME=pidfile` for disposable clean tests

---

## Verification checklist

- [ ] Fresh data root (no `_relay`, roles, workers, projects, ui-state, secrets)
- [ ] First `./setup.sh` PASS
- [ ] Second `./setup.sh` idempotent PASS
- [ ] Secrets ignored + mode `0600`
- [ ] start / status / restart / stop / start PASS
- [ ] doctor healthy (PASS or WARN only for pending tunnel Human Gate)
- [ ] Broken prerequisite / port collision fail closed
- [ ] Production services untouched
