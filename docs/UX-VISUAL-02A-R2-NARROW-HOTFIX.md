# UX-VISUAL-02A-R2 — Narrow Layout Final Hotfix

**Status:** `UX_VISUAL_02A_R2_READY_FOR_HOST_QA`  
**Commit:** `6e0b1c4`  
**Baseline:** `5055cf1` / `ui://agent-relay/pm-widget-70c18571`  
**Prior Host QA:** `HG-20261009-f64da3` → `UX_VISUAL_02A_CHANGES_REQUESTED`  
**Host QA gate:** `HG-20261009-c4b7b4`  
**New URI:** `ui://agent-relay/pm-widget-9f4ab921`  
**Evidence:** `.agent-relay/cert/ux-visual-02a-r2/`

Light theme contrast and shared PM inbox (02A) stay PASS — this pass touches only three narrow-layout defects.

## FIX 1 — 380/320px `작업 시작`

- `.card` is a size container (`container-type: inline-size`)
- `@container arwidget (max-width:380px)` + `@media (max-width:380px)` stack `.taskprev .row` as column
- Primary Run `order:-1`, every action button `width:100%`, `min-height:44px`
- Does not hide overflow to claim PASS; click handler `explicitOwnerRun` unchanged
- Local measure (cardW 320/380): `flex-direction:column`, run width ~272/332, clipped=false

## FIX 2 — 320px path preview (`tpWorkspace` / `tpScope`)

- Display-only `summarizePathDisplay` + `<details class="path-reveal">`
- Summary shows readable short path; `전체 경로 보기` / `경로 접기` (keyboard via details/summary)
- Full path in `<code class="path-full">`; path string unchanged; no workspace API calls

## FIX 3 — 320px project card path (`.boot-card .bp`)

- Removed `word-break:break-all` from `.boot-card .bp`
- Ellipsis + monospace; project `.bn` keeps `word-break:keep-all`
- Configured paths use `buildBootPathReveal` (same open/close pattern)
- Boot card is `div[role=option]` so path details can nest; path click `stopPropagation`

## Local evidence

| Viewport | Themes | Run full-width | Path open | Boot name intact |
|---|---|---|---|---|
| 320px | Light/Dark | PASS | PASS | PASS |
| 380px | Light/Dark | PASS | PASS | PASS |
| 720px desktop | Light/Dark | row (expected) | PASS | PASS |

Files: `light-320.png`, `dark-320.png`, `light-380.png`, `dark-380.png`, `light-320-path-open.png`, `measure.json`

## Tests

- `test:ux-visual-02a-r2-narrow-hotfix`
- Mandatory 78/78 (`mandatory-2026-10-09T11-03-44-977Z.json`)
- Typecheck / Build PASS

## Safety (unchanged)

TASK-0089 not executed · GOAL-0026 unchanged · Agent/Model save·approve·dispatch off · Project Assignment off · no new Goal/Task · tunnel/proxy untouched · no main merge

## Host QA required

Aside must remount `ui://agent-relay/pm-widget-9f4ab921` after tool refresh. UX is **not** complete until ChatGPT host evidence lands.
