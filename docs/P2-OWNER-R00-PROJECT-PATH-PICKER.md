# P2-OWNER-R00 — Project Registration & Workspace Path Picker

**Status:** CODE  
**Branch:** `ar/chatgpt-goal-relay`

## Decision

No separate project DB. Registration appends a `WorkspaceConfigV2` lane on the MCP host (`goalLoop.workspaceRoot`, typically Agent-Relay). `projects.json` names are auxiliary only.

## Browse

Allowlisted ASUS roots (existence-checked):

- `~/Desktop/Projects/Core`
- `~/Desktop/Projects/Team`

Rules: directories only, one level per call, realpath containment, no file contents, no home/disk scan.

## Register

`relay_pm_preview_register_project` → Owner confirm → `relay_pm_register_project` with `confirm=true`.

Lane stubs: builder/qa `unconfigured`/`unset` without `workerId` → profile **PARTIAL**. No Agent/Model auto-select. Zero Goals/Tasks/Runs/Workers.

## Path change

`relay_pm_set_project_workspace_path` hard-blocks ACTIVE workers, READY/RUNNING/DISPATCHED tasks, VERIFYING pmState, linked runs, duplicate roots, and unresolved RoleConfig conflicts (unless `syncRoleConfig=true`).

Does **not** rewrite Task.scope, Run.workspaceRoot, or Evidence.

## MCP

- `relay_pm_list_workspace_browse_roots`
- `relay_pm_browse_workspace_directories`
- `relay_pm_preview_register_project`
- `relay_pm_register_project`
- `relay_pm_set_project_workspace_path`

Existing `relay_pm_select_project` remains selection-only.
