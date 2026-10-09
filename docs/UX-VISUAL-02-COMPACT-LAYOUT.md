# UX-VISUAL-02 — Compact Layout / Readability / Asset Placement

**Status:** `UX_VISUAL_02_CHANGES_REQUESTED` → see **UX-VISUAL-02A** (`docs/UX-VISUAL-02A-HOTFIX.md`)  
**Branch:** `ar/chatgpt-goal-relay`  
**Baseline widget:** `ui://agent-relay/pm-widget-c7f1fa3f`  
**02 ship widget:** `ui://agent-relay/pm-widget-519c1794`  
**02A hotfix widget:** `ui://agent-relay/pm-widget-70c18571`  
**Primary file:** `src/mcp/app/pm-widget-resource.ts`  
**Evidence:** `.agent-relay/cert/ux-visual-02/` · `.agent-relay/cert/ux-visual-02a/`

## A. Screen investigation (local fixture)

ChatGPT host capture is **NOT_PROVEN** until Aside Host QA. Local slim fixtures painted the post-bootstrap dashboard (project / path / Goal / Task / lanes) from the R00 HTML (`c7f1fa3f`) and the new bundle.

| Observation | Before (`c7f1fa3f`) | Notes |
|---|---|---|
| First-screen height | 918px | hdr + projectDash + pipe + env + steps + tabs + pane-now |
| Card height | 1017px | |
| Vertical duplication | pipe + env + steps + nowcard all expanded | pipeline/env overlap dashboard counts |
| Tiny text | livecard/runtime 9px, several labels 10–11px | |
| Light theme lanes | hardcoded `#161a21` | poor contrast on light |
| Sprites in chips | dig / qa (+ idle fallback) | 20×30 cell, slight aspect squash |
| Unused sheets | run, climb, sleep, done, blocked | ladder/track UI not mounted; done/blocked had no state map |

Unconfirmed without ChatGPT host: exact ChatGPT chrome chrome-padding, host theme injection timing, live sprite CSP on production origin.

## B. Compact layout

- Wrapped `#pipe` / `#env` / `#steps` in collapsed `<details id="morePanel">` (“파이프라인 · 환경 · 진단”).
- Tightened body/card/pdash/lane/nowcard paddings and margins.
- Kept first-screen priority: project, path, Goal/Task, next action, Run controls, 5 tabs.

### Height (420×1200 fixture)

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| First screen | 918px | 723px | **−21.2%** |
| Card | 1017px | 792px | **−22.1%** |

Target 20–30% met on local fixture. Host ChatGPT chrome may differ → Aside must re-measure.

## C. Readability

- Body stays 14px; agent name 13px; live titles 13px; path 12px with ellipsis + `title` full path.
- Status shown as text on chips (`역할 · 상태`), not color alone.
- Light/dark lane + pipe tokens; `data-theme=light|dark` supported.
- Hangul `word-break: keep-all`; narrow width uses wrap / ellipsis (no intentional horizontal page scroll on main stack).

## D. Asset placement

Source frames: 340×520 (run sheet 6×340; others 4×340). Display cell **26×40** (aspect-locked).

| Sheet | Used on screen? | Mapping | Reason if unused |
|---|---|---|---|
| idle | yes (default) | no usable state | safe default — never invent dig/done |
| dig | yes | `working` / `running` / `active` builder | existing working animation |
| qa | yes | QA role | existing QA animation |
| blocked | yes | `blocked` / `error` / `failed` | state-gated |
| done | yes | `done` / `completed` / `accepted` | state-gated |
| sleep | only if `state=sleep` | explicit sleep | otherwise not painted |
| run | no | — | track/runner UI not mounted on v6 tower |
| climb | no | — | ladder UI not mounted on v6 tower |

Original PNGs under `assets/widgets/crew/` and `public/widgets/crew/` were **not** regenerated. Load failure keeps text chip + `cav-miss`.

## E. Preserved features

Project select, ASUS Core/Team path picker, Goal/Task select, explicit Agent/Model, save · approve · run separation, Result/PM Wake, 5 tabs, existing task/execution data paths — unchanged in behavior. No Goal/Task create from this UX pass beyond existing controls. TASK-0089 / GOAL-0026 / production assignment / tunnel / main merge untouched.

## F. Tests

- `test:ux-visual-02-compact-layout`
- `test:widget-crew`, `test:r01-host-widget-fix`
- Mandatory / Build / Typecheck (record in cert after run)

## Host QA required

Aside must remount `ui://agent-relay/pm-widget-519c1794` in a normal ChatGPT conversation, refresh tools once, and capture Desktop / narrow / Light / Dark plus Idle·Working·QA·Blocked·Done (live or fixture). UX is **not** complete until that evidence lands.
