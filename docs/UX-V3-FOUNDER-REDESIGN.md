# UX-V3 Founder-first redesign

**Status:** `UX_V3_GOAL_SCOPE_READY_FOR_HOST_QA`  
**Commit:** (see git) · **URI:** `ui://agent-relay/pm-widget-b2c4befa`  
**Host QA gate:** Goal list scope + project switch only (retry of `HG-20261010-f99773`)  
**Not complete until ChatGPT Host QA evidence.**

## Goal List Scope Hotfix (Host QA HG-20261010-f99773)

`더보기 → Goal` used unfiltered `dash.goals` (first 8), so jucontroller showed GOAL-0001~0008 from other projects. Fix: `relay_pm_get_dashboard` goals now include additive `projectId`; widget `filterGoalsForSelectedProject` keeps exact `projectId` matches only (never null/legacy guess); project-switch clears cards and ignores stale async responses. Expected jucontroller list: GOAL-0022 ACTIVE, GOAL-0024 ABANDONED, GOAL-0025 PLANNING, GOAL-0026 PLANNING (exactly 4).

## Final Correctness Hotfix (Host QA HG-20261010-21fe6f)

### FIX 1 — Goal title integrity
Host saw GOAL-0026 README title in the GOAL-0022 work card / 더보기 Goal panel. Durable store and `relay_pm_get_goal` were already correct. Root cause: ACCEPTED RESULT_RECEIVED headline + READY under another Goal conflated Active Goal with next Task Goal. Fix: `pickProjectActiveGoal` keeps status=`ACTIVE` Goal (GOAL-0022) on the Goal card with its own title; READY preview still loads GOAL-0026 via `openExistingTask`. Widget binds `data-goal-id`, clears title on project switch, shows goalId on 더보기 cards, and never writes `pdGoalTitle` from preview.

### FIX 2 — ACCEPTED next action
`nextActionFor`: `RESULT_RECEIVED` + `pmState=ACCEPTED` → `NONE` (no `PM_VERIFY_RESULT`). ACCEPTED tasks are excluded from headline candidates so READY (`PM_DISPATCH_TASK`) surfaces. When Active Goal ≠ Task Goal, `nextActionText` is `준비된 Task가 있어요 · 진행 중 Goal과 목표가 다릅니다`. Live jucontroller probe: Goal GOAL-0022 / Task TASK-0089·GOAL-0026 / nextAction `PM_DISPATCH_TASK`.

## Pre-Host Correctness Fix

### FIX A — READY preview Goal integrity
`updateGoalRunAffordance` no longer synthesizes `pendingPreview` from dashboard `view.goal` (which can be ACCEPTED leader GOAL-0022 while READY is TASK-0089 / GOAL-0026). Auto-open calls `openExistingTask(readyTask.taskId)` which loads canonical Task + Goal + execution-config + criteria. `previewLoadGen` + project-id checks prevent stale async merges; Goal fetch failure is fail-closed (no previous Goal shown).

### FIX B — 더보기 submenu
`#v3MoreSub` inside `#panel-more`: 파이프라인·진단 / Goal / 프로토타입 / 설계. Direct access without returning to 활동. Legacy 5 `data-tab` panes retained.

## Summary

Additive 3-panel shell for the PM widget (`src/mcp/app/pm-widget-resource.ts`):

| Nav | Panel | Contents |
|-----|-------|----------|
| 작업 | `#panel-work` (default) | `#projectDash` including `#pdCounts`, `#pdActions`, `#pdGoalFlow`, `#pdTaskPrev` |
| 활동 | `#panel-activity` | `#v3Metrics`, `#tabs`, `#pane-now`, `#pane-task`, `#update`, `#inbox` |
| 더보기 ⋯ | `#panel-more` | `#morePanel` (pipe/env/steps), `#pane-goal`, `#pane-proto`, `#pane-design`, `details.dbg` |

Existing element ids are preserved. Exactly one `#pipe`. Bootstrap stays above `#mainView`.

## Behavior

- `#v3Nav` switches `.on` on `#panel-work|activity|more` (default work).
- Existing `#tabs` handler still toggles now/task/goal/proto/design; goal/proto/design also switches to `#panel-more`, now/task to `#panel-activity`.
- `pickPrimaryReadyTask(view)` prefers `view.task` if runnable READY, else first runnable READY in `view.recentTasks`.
- `updateGoalRunAffordance` and Task-tab default selection use that helper; user `selectedTaskId` is not overridden.
- `#pdPath` shows `ASUS · last/two` brief with `title=` full path.

## Retained from 02A / R2

- Accent-panel tokens for `.taskprev` / `.pdash-next`
- `@container` + `@media` ≤380 Run button stack
- Path-reveal for tpWorkspace/tpScope and boot cards
- Shared inbox project origin enrichment
- No body `overflow-wrap:anywhere`

## Fingerprint

Reminted away from `9f4ab921`:

- `PM_WIDGET_CONTENT_FINGERPRINT` = `002aa1c0`
- `PM_WIDGET_RESOURCE_URI` = `ui://agent-relay/pm-widget-002aa1c0`
- Local cert screenshots: `.agent-relay/cert/ux-v3/` via `node scripts/ux-visual-v3-measure.mjs`

## Tests

- `test:ux-visual-v3-founder` (mandatory)
- Regression: `test:ux-visual-02a-r2-narrow-hotfix`, `test:r01-host-widget-fix`, `test:ux-visual-02a-hotfix`, `test:ux-visual-02-compact-layout`, `test/widget-crew.test.mjs`

## Host QA needs (remaining)

1. Refresh tools / remount new `ui://agent-relay/pm-widget-*` URI in ChatGPT.
2. Visual check light+dark at ~320 / 380 / 540: work default, activity metrics+inbox, more pipeline/design.
3. Confirm READY Task preview still opens without create/dispatch.
4. Confirm Run / Agent / model / approve controls still work on host.
5. Aside Founder Gate web evidence required — local fixture screenshots alone do not complete UX.
