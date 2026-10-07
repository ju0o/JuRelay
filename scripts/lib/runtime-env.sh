#!/usr/bin/env bash
# Shared path/port resolution for setup + lifecycle.
# Sourced by setup.sh and agent-relay-svc. Never prints secrets.

set -euo pipefail

ar_resolve_paths() {
  local home_dir="${HOME:-}"
  if [[ -z "$home_dir" ]]; then
    echo "HOME is unset" >&2
    return 1
  fi

  local xdg_config="${XDG_CONFIG_HOME:-$home_dir/.config}"
  local xdg_data="${XDG_DATA_HOME:-$home_dir/.local/share}"

  AR_INSTANCE="${AGENT_RELAY_INSTANCE:-default}"
  AR_CONFIG_DIR="${AGENT_RELAY_CONFIG_DIR:-$xdg_config/agent-relay}"
  AR_DATA_ROOT="${AGENT_RELAY_DATA_ROOT:-$xdg_data/agent-relay}"
  AR_TOKEN_FILE="${AR_CONFIG_DIR}/mcp-token"
  AR_PROXY_ENV="${AR_CONFIG_DIR}/mcp-proxy.env"
  AR_INSTALL_JSON="${AR_CONFIG_DIR}/install.json"
  AR_RUNTIME_DIR="${AR_CONFIG_DIR}/runtime"
  AR_SECRETS_DIR="${AR_CONFIG_DIR}/secrets"

  AR_MCP_PORT="${AGENT_RELAY_MCP_PORT:-3898}"
  AR_PROXY_PORT="${AGENT_RELAY_PROXY_PORT:-8081}"
  AR_PROJECT="${AGENT_RELAY_PROJECT:-ws}"
  AR_HOST="127.0.0.1"

  if [[ "$AR_INSTANCE" == "default" ]]; then
    AR_UNIT_PREFIX="agent-relay"
  else
    # sanitize instance for systemd unit names
    local safe
    safe=$(printf '%s' "$AR_INSTANCE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')
    [[ -n "$safe" ]] || safe="custom"
    AR_UNIT_PREFIX="agent-relay-${safe}"
  fi
  AR_MCP_UNIT="${AR_UNIT_PREFIX}-mcp-app"
  AR_PROXY_UNIT="${AR_UNIT_PREFIX}-auth-proxy"

  AR_RUNTIME_MODE="${AGENT_RELAY_RUNTIME:-}"
  if [[ -z "$AR_RUNTIME_MODE" ]]; then
    if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
      AR_RUNTIME_MODE="systemd"
    else
      AR_RUNTIME_MODE="pidfile"
    fi
  fi

  if [[ -z "${AR_REPO_ROOT:-}" ]]; then
    local here
    here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
    AR_REPO_ROOT="$here"
  fi
  AR_NODE="${AGENT_RELAY_NODE:-$(command -v node)}"
}

ar_port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$port" 2>/dev/null | grep -q ":$port"
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  # fallback: try bind via node
  "$AR_NODE" -e "const n=require('net');const s=n.createServer();s.once('error',e=>{process.exit(e.code==='EADDRINUSE'?0:2)});s.listen($port,'127.0.0.1',()=>{s.close();process.exit(1)});" >/dev/null 2>&1
}

ar_chmod_secret() {
  local f="$1"
  chmod 600 "$f" 2>/dev/null || true
  # directory containing secrets
  local d
  d="$(dirname "$f")"
  chmod 700 "$d" 2>/dev/null || true
}

ar_generate_token_if_missing() {
  if [[ -f "$AR_TOKEN_FILE" ]]; then
    ar_chmod_secret "$AR_TOKEN_FILE"
    echo "already configured: mcp-token"
    return 0
  fi
  mkdir -p "$AR_CONFIG_DIR"
  chmod 700 "$AR_CONFIG_DIR" 2>/dev/null || true
  # 32 bytes hex; never echo the value
  "$AR_NODE" -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" >"$AR_TOKEN_FILE"
  ar_chmod_secret "$AR_TOKEN_FILE"
  echo "created: mcp-token (0600)"
}

ar_write_proxy_env() {
  mkdir -p "$AR_CONFIG_DIR"
  chmod 700 "$AR_CONFIG_DIR" 2>/dev/null || true
  local token
  token="$(tr -d '\n\r' <"$AR_TOKEN_FILE")"
  if [[ -z "$token" ]]; then
    echo "ERROR: mcp-token is empty" >&2
    return 1
  fi
  if [[ -f "$AR_PROXY_ENV" ]]; then
    # Refresh ports/upstream without rotating the token value unnecessarily.
    # Keep existing MCP_TOKEN if file already has one.
    local existing=""
    existing="$(grep -E '^MCP_TOKEN=' "$AR_PROXY_ENV" 2>/dev/null | head -1 | cut -d= -f2- || true)"
    if [[ -n "$existing" ]]; then
      token="$existing"
    fi
  fi
  umask 077
  cat >"$AR_PROXY_ENV" <<EOF
MCP_TOKEN=$token
MCP_PROXY_PORT=$AR_PROXY_PORT
MCP_UPSTREAM_HOST=$AR_HOST
MCP_UPSTREAM_PORT=$AR_MCP_PORT
MCP_PROXY_PATH=/mcp
EOF
  ar_chmod_secret "$AR_PROXY_ENV"
}

ar_write_install_json() {
  mkdir -p "$AR_CONFIG_DIR" "$AR_RUNTIME_DIR" "$AR_SECRETS_DIR" "$AR_DATA_ROOT"
  chmod 700 "$AR_CONFIG_DIR" "$AR_RUNTIME_DIR" "$AR_SECRETS_DIR" 2>/dev/null || true
  local created=""
  if [[ -f "$AR_INSTALL_JSON" ]]; then
    created="$("$AR_NODE" -e "try{const j=require(process.argv[1]);process.stdout.write(j.createdAt||'')}catch{}" "$AR_INSTALL_JSON" 2>/dev/null || true)"
  fi
  if [[ -z "$created" ]]; then
    created="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  fi
  umask 022
  cat >"$AR_INSTALL_JSON" <<EOF
{
  "schemaVersion": "install.v1",
  "instance": "$AR_INSTANCE",
  "repoRoot": "$AR_REPO_ROOT",
  "dataRoot": "$AR_DATA_ROOT",
  "configDir": "$AR_CONFIG_DIR",
  "mcpPort": $AR_MCP_PORT,
  "proxyPort": $AR_PROXY_PORT,
  "runtime": "$AR_RUNTIME_MODE",
  "unitPrefix": "$AR_UNIT_PREFIX",
  "mcpUnit": "$AR_MCP_UNIT",
  "proxyUnit": "$AR_PROXY_UNIT",
  "project": "$AR_PROJECT",
  "tokenFile": "$AR_TOKEN_FILE",
  "proxyEnvFile": "$AR_PROXY_ENV",
  "localMcpUri": "http://$AR_HOST:$AR_PROXY_PORT/mcp",
  "tunnel": {
    "status": "HUMAN_GATE_REQUIRED",
    "note": "Create your own tunnel-client profile; do not reuse another host tunnel id."
  },
  "createdAt": "$created",
  "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
}

ar_load_install_json() {
  if [[ ! -f "$AR_INSTALL_JSON" ]]; then
    return 1
  fi
  # shellcheck disable=SC2046
  eval "$("$AR_NODE" <<'NODE'
const fs = require('fs');
const p = process.env.AR_INSTALL_JSON;
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const esc = (s) => String(s ?? '').replace(/'/g, "'\\''");
const out = (k, v) => process.stdout.write(`${k}='${esc(v)}'\n`);
out('AR_INSTANCE', j.instance || 'default');
out('AR_REPO_ROOT', j.repoRoot || '');
out('AR_DATA_ROOT', j.dataRoot || '');
out('AR_CONFIG_DIR', j.configDir || '');
out('AR_MCP_PORT', j.mcpPort || 3898);
out('AR_PROXY_PORT', j.proxyPort || 8081);
out('AR_RUNTIME_MODE', j.runtime || 'pidfile');
out('AR_UNIT_PREFIX', j.unitPrefix || 'agent-relay');
out('AR_MCP_UNIT', j.mcpUnit || 'agent-relay-mcp-app');
out('AR_PROXY_UNIT', j.proxyUnit || 'agent-relay-auth-proxy');
out('AR_PROJECT', j.project || 'ws');
out('AR_TOKEN_FILE', j.tokenFile || '');
out('AR_PROXY_ENV', j.proxyEnvFile || '');
NODE
)"
}

ar_ensure_data_layout() {
  mkdir -p "$AR_DATA_ROOT/_relay/workers"
  mkdir -p "$AR_CONFIG_DIR" "$AR_RUNTIME_DIR" "$AR_SECRETS_DIR"
  chmod 700 "$AR_CONFIG_DIR" "$AR_RUNTIME_DIR" "$AR_SECRETS_DIR" 2>/dev/null || true
}
