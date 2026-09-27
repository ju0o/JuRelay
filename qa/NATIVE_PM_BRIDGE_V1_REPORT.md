# NATIVE_PM_BRIDGE_V1 Report (2026-09-27, 슈퍼바이저)

## Live evidence (scratch project e2e-probe, dataRoot /tmp/native-pm-e2e/data)

| # | check | result |
|---|---|---|
| 1 | `GET /health` (127.0.0.1:3899) | PASS `{"ok":true,"name":"agent-relay-mcp-app"}` |
| 2 | `tools/call relay_pm_open_widget` (local) | PASS `{"ok":true,"widget":"ui://agent-relay/pm-widget-v2"}` |
| 3 | `resources/read ui://agent-relay/pm-widget-v2` | PASS HTML (`Agent Relay PM`, mime `text/html;profile=mcp-app`) |
| 4 | tunnel `GET /health` (trycloudflare URL) | PASS |
| 5 | `tools/call relay_pm_open_widget` via tunnel | PASS, 동일 응답 |
| 6 | `tools/call relay_pm_create_task` (harmless probe) | PASS → `GOAL-0001`/`TASK-0001`, `executionState=READY`, `pmState=PENDING` |
| 7 | `tools/call relay_pm_get_next_work` | PASS → `STOP_POLICY`, `PLAN mode: owner-dispatch-required` (정책대로) |

배포: `https://portfolio-people-bizrate-genuine.trycloudflare.com`
(Quick Tunnel 일회성 URL. ChatGPT connector 재지정 필요.)

## P2 live E2E (scratch e2e-probe, opencode/big-pickle worker)

Scenario A — TASK-0003: create→READY, owner-dispatch→RUNNING(pid),
worker writes hello.txt=HELLO-NATIVE-PM, RESULT_RECEIVED/VERIFYING,
delivery PENDING→wake SENT(AGENT_RELAY_PM_WAKE)→verification context→
judgment ACCEPT→pmState ACCEPTED. Stale-CAS accept correctly CONFLICTed.
Goal-closure denied in PLAN mode (gate working as designed).

Scenario B — TASK-0004/0005: judgment CHANGES→auto retry-prep (run seq 2,
retry-context.json)→worker with recomposed retry prompt→file rewritten→
judgment ACCEPT→ACCEPTED. (Found + fixed: wrapper initially rejected retry
prompt.md as DIFFERENT; now recomposes via dist retry-prompt.js.)

Evidence IDs: goal GOAL-0001; runs 5f05ff15(→ACCEPT), df92294a(→CHANGES),
80bff134/b88e2599(→CHANGES→retry→ACCEPT); deliveries PMD-TASK-*/PENDING→judged;
worker e2e-opencode-1 (observationAdapterId opencode); QA mechanics covered by
v1-qa-loop (6/6) + phase-h-closed-loop (PASS) on current build.

## Regression tests (current branch build, 2026-09-27)

| test | result |
|---|---|
| `npx tsc -p tsconfig.server.json --noEmit` | PASS (exit 0) |
| `npx tsc -p tsconfig.server.json` (dist 재빌드) | PASS (exit 0) |
| `git diff --check` | PASS |
| `node --test test/g6-mcp-pm-wake.test.mjs` | PASS 1/1 |
| `node --test test/v15-plan-mcp-surface.test.mjs` | PASS 1/1 |
| `node --test test/v1-qa-loop.test.mjs` | PASS 6/6 |
| `node --test test/phase-h-closed-loop.test.mjs` | PASS 1/1 |

| `node --test test/relay-worker-opencode-impl.test.mjs` | PASS 14/14 |

## Not yet proven (Founder gate)

- ChatGPT에서 `relay_pm_open_widget` 호출 → 렌더링 (connector URL 재지정 필요).
- ChatGPT PM 판단 ACCEPT/CHANGES → VERIFIED_DONE → NEXT (연결 후).

## Provenance

- SSOT: `ju0o/Agent-Relay` 브랜치 `ar/chatgpt-goal-relay` @ `4658448`.
- 배포 코드 = 동 브랜치 소스에서 2026-09-27 재빌드한 `dist/` (gitignored).
- `codex-chatgpt-web` 미삭제 (E2E PASS 전 제거 금지 준수).
