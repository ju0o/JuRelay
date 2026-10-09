# UX-V3 Founder-first redesign

**Status:** `UX_V3_READY_FOR_FOUNDER_VISUAL_QA`  
**Commit:** `1508dbe` · **URI:** `ui://agent-relay/pm-widget-002aa1c0`  
**Host QA gate:** `HG-20261009-e693f9`  
**Not complete until ChatGPT Host QA evidence.**

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
