# V1 ChatGPT Connect UX

After `./setup.sh` leaves local MCP/proxy READY and Secure connection HUMAN_GATE_REQUIRED, use one command:

```bash
agent-relay connect
# or
./scripts/agent-relay-svc connect
```

This guides a fresh user to ChatGPT without requiring knowledge of tunnel IDs, org IDs, systemd units, or MCP JSON-RPC internals.

`agent-relay connect claude-code` remains a separate Claude Code helper. Default `connect` is ChatGPT.

---

## Connection states

| State | Meaning |
|---|---|
| `LOCAL_NOT_READY` | Setup/marker/MCP/proxy/token/build failed |
| `LOCAL_READY` | Local runtime healthy (internal checkpoint) |
| `TUNNEL_CLIENT_MISSING` | `tunnel-client` not on PATH |
| `TUNNEL_SETUP_REQUIRED` | User must create their own tunnel + profile |
| `TUNNEL_AUTH_REQUIRED` | Runtime key / auth needed; operator not finished |
| `AUTH_TRANSPORT_REQUIRED` | Browser/operator approval path unavailable |
| `TUNNEL_READY` | User-owned tunnel profile + credentials configured |
| `CHATGPT_APP_REQUIRED` | Create/enable Agent Relay Local in ChatGPT |
| `CHATGPT_TOOL_SCAN_REQUIRED` | Scan/refresh tools / verify widget |
| `CHATGPT_TOOL_REFRESH_REQUIRED` | Server has tools; ChatGPT catalog is stale |
| `CHATGPT_CONNECTED` | Human/Aside verified app + tools + widget |

`CHATGPT_CONNECTED` is never inferred from local proxy health alone.

Until ChatGPT proves capability:

```text
CHATGPT_CAPABILITY = USER_VERIFICATION_REQUIRED
```

Plan/workspace policy may block MCP apps. That is not a broken local install.

---

## Short-lived auth invariant

```text
browser/operator READY
→ mint / materialize credentials
→ immediate approval
→ CLI continues
→ verify
```

Never mint first and ask the user later. Never expire-and-remint in a loop.

```bash
# Wrong: missing --ready
agent-relay connect --tunnel-id tunnel_YOUR_ID

# Right: operator is ready first
agent-relay connect --ready --tunnel-id tunnel_YOUR_ID
```

---

## Fresh tunnel identity

Do **not** reuse another host's:

- tunnel id
- organization id
- `agent-relay-asus` profile
- runtime key file contents

Create yours:

1. [Tunnels management](https://platform.openai.com/settings/organization/tunnels)
2. [Runtime API keys](https://platform.openai.com/settings/organization/api-keys)
3. Place the runtime key at `~/.config/agent-relay/secrets/tunnel-runtime-key` (`0600`)
4. `agent-relay connect --ready --tunnel-id tunnel_YOUR_ID`
5. `tunnel-client run --profile <your-profile>` (profile defaults to `agent-relay-local` or `agent-relay-<instance>`)

---

## ChatGPT Developer Mode / custom MCP app (concept)

UI labels vary by plan and release. Conceptually:

1. Enable Developer Mode if your plan/workspace supports it.
2. Create/add a custom app.
3. Provide the Secure MCP endpoint / tunnel connector metadata from your running tunnel.
4. Scan tools.
5. Complete authorization when prompted.
6. Create/enable the app (**Agent Relay Local**).
7. Confirm it appears in chat.
8. After Agent Relay upgrades tools: **Refresh / Scan Tools** again.

Do not automate clicks in the ChatGPT UI.

Canonical connector settings entry: [ChatGPT Connectors](https://chatgpt.com/#settings/Connectors).

---

## Tool catalog cache

When Agent Relay upgrades MCP tools:

```text
Agent Relay Local
→ App management
→ Refresh / Scan Tools
```

Do **not** delete/reconnect as the first diagnosis.

If the server exposes a tool (for example `relay_pm_cancel_ready_task`) but ChatGPT does not list it:

```text
CHATGPT_TOOL_REFRESH_REQUIRED
```

not `TUNNEL_FAILED`.

---

## Expected permanent tools (catalog check)

Minimum product path (existence only; no write invocations during connect):

- `relay_pm_open_widget`
- `relay_pm_list_project_profiles`
- `relay_pm_select_project`
- `relay_pm_get_project_assignments`
- `relay_pm_set_project_assignments`
- `relay_pm_get_project`
- `relay_pm_create_goal`
- `relay_pm_create_task`
- `relay_pm_resolve_run`
- `relay_pm_dispatch_owner_approved`
- `relay_pm_cancel_ready_task`

Widget mount: call only `relay_pm_open_widget` and confirm the production iframe mounts (not a probe widget). Fresh data roots should show first-run Project preparation / Bootstrap.

---

## Zero-work rule

Connect may write connection/config metadata only (`connect-state.json`, tunnel profile, secret file paths).

It must not create Goals, Tasks, Runs, or Workers. First harmless Task is P2-D.

---

## Doctor summary shape

```text
Local runtime: PASS
Secure tunnel: PASS | PENDING
ChatGPT app: VERIFY IN CHATGPT
Overall: HUMAN_GATE_REQUIRED
```

---

## Recovery

| Event | Expected |
|---|---|
| Local restart | Tunnel profile/identity preserved; restart local services; re-run tunnel daemon if needed |
| MCP tool upgrade | Refresh / Scan Tools in ChatGPT |
| Stale ChatGPT catalog | `CHATGPT_TOOL_REFRESH_REQUIRED` |
| Tunnel auth expired | `TUNNEL_AUTH_REQUIRED` — fix key once; no remint loop |
