#!/usr/bin/env bash
# Agent Relay V1 clean-install entrypoint.
# Usage: ./setup.sh
# Isolation overrides: HOME, XDG_*, AGENT_RELAY_INSTANCE, AGENT_RELAY_*_PORT, AGENT_RELAY_RUNTIME=pidfile|systemd
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/runtime-env.sh
source "$ROOT/scripts/lib/runtime-env.sh"
AR_REPO_ROOT="$ROOT"
ar_resolve_paths

umask 022
FAIL() { echo "ERROR: $*" >&2; exit 1; }
INFO() { echo "→ $*"; }
OK() { echo "✓ $*"; }

echo "Agent Relay setup"
echo "  instance:  $AR_INSTANCE"
echo "  config:    $AR_CONFIG_DIR"
echo "  dataRoot:  $AR_DATA_ROOT"
echo "  runtime:   $AR_RUNTIME_MODE"
echo "  ports:     mcp=$AR_MCP_PORT proxy=$AR_PROXY_PORT"
echo ""

# ── 1. Prerequisites ─────────────────────────────────────────────────────
INFO "Checking prerequisites"

case "$(uname -s)" in
  Linux) OK "OS: Linux" ;;
  *) FAIL "V1 install is Linux-only (found $(uname -s)). Windows/WSL/macOS are later targets — see docs/V1-CLEAN-INSTALL.md" ;;
esac

if ! command -v node >/dev/null 2>&1; then
  FAIL "Node.js not found. Install Node >= 18 (LTS 20+ recommended)."
fi
NODE_VER="$(node -v 2>/dev/null || true)"
NODE_MAJOR="${NODE_VER#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if ! [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]]; then
  FAIL "Could not parse Node version from '${NODE_VER:-unknown}'. Need Node >= 18."
fi
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  FAIL "Node ${NODE_VER} is too old. Need >= 18."
fi
OK "Node ${NODE_VER}"

if ! command -v npm >/dev/null 2>&1; then
  FAIL "npm not found. Install Node with npm."
fi
OK "npm $(npm -v)"

if ! command -v tmux >/dev/null 2>&1; then
  FAIL "tmux not found. Install tmux (required for Worker session runtimes)."
fi
OK "tmux present"

if [[ "$AR_RUNTIME_MODE" == "systemd" ]]; then
  if ! command -v systemctl >/dev/null 2>&1; then
    FAIL "systemd requested but systemctl not found. Set AGENT_RELAY_RUNTIME=pidfile for fallback."
  fi
  if ! systemctl --user show-environment >/dev/null 2>&1; then
    FAIL "systemd --user unavailable. Set AGENT_RELAY_RUNTIME=pidfile or enable lingering."
  fi
  OK "systemd --user available"
else
  OK "runtime mode: pidfile"
fi

# Refuse accidental collision with live production defaults on same host
# when this is a non-default isolated instance OR when ports are already taken
# by another process and we have no install marker yet.
if [[ ! -f "$AR_INSTALL_JSON" ]]; then
  if ar_port_in_use "$AR_MCP_PORT"; then
    FAIL "port $AR_MCP_PORT already in use. Free it or set AGENT_RELAY_MCP_PORT to a free port (isolated installs must not steal production ports)."
  fi
  if ar_port_in_use "$AR_PROXY_PORT"; then
    FAIL "port $AR_PROXY_PORT already in use. Free it or set AGENT_RELAY_PROXY_PORT to a free port."
  fi
fi

# ── 2–3. Dependencies + Build ────────────────────────────────────────────
cd "$ROOT"
if [[ "${AGENT_RELAY_SETUP_SKIP_DEPS:-}" == "1" && -f dist/server/mcp/app-server-main.js && -f dist/server/cli/index.js && -d node_modules ]]; then
  OK "dependencies/build already present (AGENT_RELAY_SETUP_SKIP_DEPS=1)"
else
  INFO "Installing dependencies"
  if [[ -f package-lock.json ]]; then
    npm ci --no-audit --no-fund || npm install --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
  OK "dependencies installed"
  INFO "Building"
  npm run build
  [[ -f dist/server/mcp/app-server-main.js ]] || FAIL "build did not produce dist/server/mcp/app-server-main.js"
  [[ -f dist/server/cli/index.js ]] || FAIL "build did not produce dist/server/cli/index.js"
  OK "build present"
fi

# ── 4. Local dirs ────────────────────────────────────────────────────────
INFO "Creating local data/config directories"
ar_ensure_data_layout
OK "data/config directories ready"

# ── 5. Secrets ───────────────────────────────────────────────────────────
INFO "Ensuring local secrets"
ALREADY_TOKEN=0
if [[ -f "$AR_TOKEN_FILE" ]]; then ALREADY_TOKEN=1; fi
ar_generate_token_if_missing
ar_write_proxy_env
OK "secrets present (mode 0600; values not printed)"

# ── 6. Install marker + units ────────────────────────────────────────────
INFO "Writing install marker"
HAD_INSTALL=0
if [[ -f "$AR_INSTALL_JSON" ]]; then HAD_INSTALL=1; fi
ar_write_install_json
if [[ "$HAD_INSTALL" -eq 1 ]]; then
  echo "already configured: install.json"
else
  OK "install.json written"
fi

if [[ "$AR_RUNTIME_MODE" == "systemd" ]]; then
  INFO "Installing systemd --user units"
  UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  mkdir -p "$UNIT_DIR"
  NODE_BIN="$AR_NODE"
  render() {
    local in="$1" out="$2"
    sed -e "s|@INSTANCE@|$AR_INSTANCE|g" \
        -e "s|@REPO_ROOT@|$AR_REPO_ROOT|g" \
        -e "s|@NODE@|$NODE_BIN|g" \
        -e "s|@DATA_ROOT@|$AR_DATA_ROOT|g" \
        -e "s|@PROJECT@|$AR_PROJECT|g" \
        -e "s|@MCP_PORT@|$AR_MCP_PORT|g" \
        -e "s|@TOKEN_FILE@|$AR_TOKEN_FILE|g" \
        -e "s|@PROXY_ENV_FILE@|$AR_PROXY_ENV|g" \
        -e "s|@MCP_UNIT@|$AR_MCP_UNIT|g" \
        "$in" >"$out"
  }
  MCP_UNIT_FILE="$UNIT_DIR/${AR_MCP_UNIT}.service"
  PROXY_UNIT_FILE="$UNIT_DIR/${AR_PROXY_UNIT}.service"
  if [[ -f "$MCP_UNIT_FILE" ]]; then
    echo "already configured: ${AR_MCP_UNIT}.service"
  fi
  render "$ROOT/packaging/systemd/agent-relay-mcp-app.service.in" "$MCP_UNIT_FILE"
  render "$ROOT/packaging/systemd/agent-relay-auth-proxy.service.in" "$PROXY_UNIT_FILE"
  systemctl --user daemon-reload
  OK "systemd units registered (${AR_MCP_UNIT}, ${AR_PROXY_UNIT})"
else
  OK "pidfile runtime prepared at $AR_RUNTIME_DIR"
fi

# ── 7. Start services ────────────────────────────────────────────────────
INFO "Starting local services"
"$ROOT/scripts/agent-relay-svc" start

# ── 8. Health ────────────────────────────────────────────────────────────
INFO "Health checks"
sleep 0.4
if ! "$ROOT/scripts/agent-relay-svc" status >/tmp/ar-setup-status.$$.txt 2>&1; then
  cat /tmp/ar-setup-status.$$.txt >&2 || true
  rm -f /tmp/ar-setup-status.$$.txt
  FAIL "service status failed after start"
fi
cat /tmp/ar-setup-status.$$.txt
rm -f /tmp/ar-setup-status.$$.txt
OK "local services responding"

# ── 9. Next human action ─────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo "Agent Relay local services: READY"
echo "Secure connection: HUMAN_GATE_REQUIRED"
echo ""
echo "Local MCP (loopback): http://${AR_HOST}:${AR_PROXY_PORT}/mcp"
echo ""
echo "Next:"
echo "  1. Install tunnel-client if needed (OpenAI Secure MCP Tunnel)."
echo "  2. Create YOUR tunnel + runtime API key in the OpenAI org settings"
echo "     (do not reuse another machine's tunnel id or profile)."
echo "  3. When the browser/operator is ready, mint short-lived auth and approve."
echo "  4. Point tunnel-client at http://${AR_HOST}:${AR_PROXY_PORT}/mcp"
echo "  5. Open ChatGPT → Settings → Apps / Connectors → Developer Mode"
echo "     Connect Agent Relay Local using your Secure MCP Tunnel."
echo ""
echo "Lifecycle:"
echo "  ./scripts/agent-relay-svc status"
echo "  ./scripts/agent-relay-svc doctor"
echo "  ./scripts/agent-relay-svc stop | start | restart"
echo ""
echo "Contract: docs/V1-CLEAN-INSTALL.md"
echo "════════════════════════════════════════════════════"

if [[ "$ALREADY_TOKEN" -eq 1 && "$HAD_INSTALL" -eq 1 ]]; then
  echo "already configured: setup completed (idempotent re-run)"
fi
