param(
  [string]$BridgeRoot = "$env:LOCALAPPDATA\AgentRelay\FounderBridge",
  # Where the engine runs. "local" copies files on this computer; "ssh" needs -RemoteAlias and -RemoteDataRoot.
  [ValidateSet("local", "ssh")][string]$RunLocation = $(if ($env:AGENT_RELAY_SSH_ALIAS) { "ssh" } else { "local" }),
  [string]$RemoteAlias = $env:AGENT_RELAY_SSH_ALIAS,
  [string]$RemoteDataRoot = $env:AGENT_RELAY_REMOTE_DATA_ROOT,
  [string]$LocalInbox = "$env:USERPROFILE\Desktop\FounderInbox"
)
$ErrorActionPreference = "Stop"
if ($RunLocation -eq "ssh" -and (-not $RemoteAlias -or -not $RemoteDataRoot)) {
  throw "RunLocation ssh needs -RemoteAlias and -RemoteDataRoot (or AGENT_RELAY_SSH_ALIAS / AGENT_RELAY_REMOTE_DATA_ROOT)."
}
if ($RunLocation -eq "local" -and -not $RemoteDataRoot) {
  throw "RunLocation local needs -RemoteDataRoot: the Agent Relay data folder on this computer."
}
New-Item -ItemType Directory -Force -Path $BridgeRoot | Out-Null
# The scheduled task does not inherit this shell's environment, so the launcher reads this file.
@{ kind = $RunLocation; alias = $RemoteAlias; remoteRoot = $RemoteDataRoot; localInbox = $LocalInbox; pollIntervalMs = 15000 } |
  ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $BridgeRoot "founder-bridge.config.json")
$node = Join-Path $BridgeRoot "founder-bridge.mjs"
$source = Join-Path $PSScriptRoot "founder-bridge.mjs"
if ([IO.Path]::GetFullPath($source) -ne [IO.Path]::GetFullPath($node)) { Copy-Item -Force $source $node }
$moduleDir = Join-Path $BridgeRoot "src\v2\founder-bridge"
New-Item -ItemType Directory -Force -Path $moduleDir | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot "index.mjs") (Join-Path $moduleDir "index.mjs")
$uiModuleDir = Join-Path $BridgeRoot "src\v2\founder-ui"
New-Item -ItemType Directory -Force -Path $uiModuleDir | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot "founder-ui.mjs") (Join-Path $uiModuleDir "index.mjs")
Copy-Item -Force (Join-Path $PSScriptRoot "founder-gate-ui.mjs") (Join-Path $BridgeRoot "founder-gate-ui.mjs")
$env:AGENT_RELAY_RUN_LOCATION = $RunLocation
$env:AGENT_RELAY_SSH_ALIAS = $RemoteAlias
$env:AGENT_RELAY_REMOTE_DATA_ROOT = $RemoteDataRoot
$env:LOCAL_INBOX = $LocalInbox
$env:POLL_INTERVAL_MS = "15000"
& node $node once
$task = "Agent Relay Founder Inbox Bridge"
$action = New-ScheduledTaskAction -Execute "node.exe" -Argument "`"$node`" run"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Description "Pull Agent Relay Founder Gate packets and upload responses" -Force | Out-Null
Start-ScheduledTask -TaskName $task
$uiTask = "Agent Relay Founder Gate UI"
$uiAction = New-ScheduledTaskAction -Execute "node.exe" -Argument "`"$(Join-Path $BridgeRoot 'founder-gate-ui.mjs')`""
Register-ScheduledTask -TaskName $uiTask -Action $uiAction -Trigger $trigger -Description "Local Founder Gate web UI" -Force | Out-Null
Start-ScheduledTask -TaskName $uiTask
Write-Output "FOUNDER_BRIDGE_STARTED: $task"
Write-Output "FOUNDER_GATE_UI_STARTED: http://127.0.0.1:3847"
