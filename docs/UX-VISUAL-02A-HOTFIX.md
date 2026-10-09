# UX-VISUAL-02A Hotfix

**Status:** Host QA `HG-20261009-f64da3` → `CHANGES_REQUESTED` → see **UX-VISUAL-02A-R2** (`docs/UX-VISUAL-02A-R2-NARROW-HOTFIX.md`)  
**Baseline:** `e1e1433` / `ui://agent-relay/pm-widget-519c1794`  
**02A URI:** `ui://agent-relay/pm-widget-70c18571`  
**R2 URI:** `ui://agent-relay/pm-widget-9f4ab921`  
**Prior Host QA:** `HG-20261009-597d70` → `CHANGES_REQUESTED` (archived); `HG-20261009-f64da3` narrow defects → R2

## Fixes

### A — Light theme contrast
- `.taskprev` / `.pdash-next` use `--accent-panel-*` tokens
- Light: bg `#e8effc`, fg `#1a1a1a`, muted `#555`
- Dark: preserves `#121a2a` / light-on-dark look
- Labels, values, selects, disabled buttons, errors stay readable

### B — 380/320 responsive
- Removed body `overflow-wrap: anywhere` (caused mid-word splits on `JuControler` / `한국어`)
- Header: `flex-wrap`, `.app` / `.lang button` `white-space:nowrap`
- Path: ellipsis + `title` full path; 2-line clamp ≤380px
- Task titles: 2-line clamp on narrow rows

### C — Shared inbox project origin
- Inbox section title: **전체 프로젝트 · PM 수신함**
- `relay_pm_list_pending_deliveries` adds read-only `taskProjectId` / `taskProjectName` from Task (null → widget **소속 미확인**)
- Does not rewrite Delivery/Task/Goal; does not attribute legacy to jucontroller
- Wake / Claim / ACK unchanged

## Evidence
`.agent-relay/cert/ux-visual-02a/` — light/dark/n380/n320 + `deliveries-enrichment.json`

## Tests
- `test:ux-visual-02a-hotfix`
- Mandatory 77/77, typecheck PASS
