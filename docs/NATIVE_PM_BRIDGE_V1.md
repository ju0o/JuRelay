# Agent-Relay Native PM Bridge V1 (진행 중 기록)

> 목표: `codex-chatgpt-web` 없이 ChatGPT가 Agent-Relay의 Native PM으로 동작하고,
> Agent-Relay가 Worker → Independent QA → PM Verification → Retry/NEXT 전체 흐름을 소유한다.
> 상태(2026-09-27, 슈퍼바이저 기록): P0 완료 · P1 로컬 PASS/ChatGPT 확인 대기 · P2 부분(라이브 워커 대기)

## Architecture

```text
ChatGPT PM
    ↕  MCP Apps (Streamable HTTP) + Widget (wake only)
Agent-Relay (goal-loop kernel)
    ↕  dispatch / observe
Worker (trusted registry)      QA (independent runtime, read-only)
    ↕  RESULT (claim + adapter observation)
Agent-Relay Delivery → Wake → PM Judgment (ACCEPT/CHANGES) → Retry/NEXT
```

## Source of truth

- GitHub SSOT: `ju0o/Agent-Relay`, 브랜치 `ar/chatgpt-goal-relay` (= `4658448`).
- MCP/Widget 표면(`src/mcp/` 11 files)은 브랜치 전용이며 `origin/main`(`d16c60c`)에는 없다.
  `git diff --stat origin/main..HEAD` = 360 files (+104175/-259).
- 배포 바이트는 브랜치 빌드 + ephemeral tunnel URL을 따라간다. `night-runtime`에는
  `src/mcp/`이 없어서 여기서 MCP를 빌드할 수 없다.

## Deployment path

```text
GitHub SSOT (ar/chatgpt-goal-relay)
↓  npx tsc -p tsconfig.server.json  (dist/는 gitignored, 배포 시 재빌드)
MCP App  127.0.0.1:3899  (npm run mcp:app / app-server-main.js --dataRoot --project)
↓  cloudflared Quick Tunnel (URL은 매번 바뀜, uptime 보장 없음)
ChatGPT Connector → /mcp
```

- 배포 리비전(2026-09-27): `4658448` 소스에서 `dist/` 재빌드됨(빌드 전 dist는 09-25).
- 배포에만 있던 코드는 없다. 단 `dist/`가 소스보다 이틀 stale했던 것이 drift vector였음(해소).
- Quick Tunnel URL 예시(일회성): `https://portfolio-people-bizrate-genuine.trycloudflare.com`
  (docs의 기존 URL `ana-grass-…`, `workstation-examine-…`는 이미 stale).

## MCP tools (PM surface)

intake/dispatch/verification/judgment/retry/execution-plan + wake + widget:

- `relay_pm_create_task` (V1-G1 intake, READY+PENDING, goal 컨테이너 자동)
- `relay_pm_activate_goal` (PLANNING→ACTIVE, CAS)
- `relay_pm_dispatch_task` / `relay_pm_dispatch_owner_approved` (READY→DISPATCHED→RUNNING)
- `relay_pm_accept_result` / `relay_pm_request_changes` / `relay_pm_request_retry` (dual CAS, stale 거부)
- `relay_pm_submit_judgment`, `relay_pm_complete_goal`, delivery tools
  (`mark_delivered/ack/ignore`, `mark_delivery_delivered/ack_delivery/ignore_delivery`)
- `relay_pm_get_next_work` (NEXT discovery), `relay_pm_get_verification_context`,
  `relay_pm_list_pending_deliveries`, `relay_pm_get_delivery`
- wake: `relay_pm_claim_wake`, `relay_pm_mark_wake_failed`, `relay_pm_get_wake_status`
- worker surface(별도 프로세스): `relay_worker_get_assignment/task_context/run_context`,
  `relay_worker_submit_claim/result/progress`, `relay_worker_report_blocked`

## Widget lifecycle

- `relay_pm_open_widget` 핸들러(`src/mcp/app-server.ts:122`)는 infallible:
  항상 `{ok:true, widget: ui://agent-relay/pm-widget-v2}`.
- Widget HTML(`src/mcp/app/pm-widget-resource.ts`)은 1.5초마다
  `relay_pm_list_pending_deliveries` 폴링 → `relay_pm_claim_wake` →
  `ui/message`로 bounded `AGENT_RELAY_PM_WAKE` 발사 → 실패 시 `relay_pm_mark_wake_failed`.
- Contract: 판단/ACCEPT/CHANGES 안 함(wake only), identity만 전달
  (deliveryId/project/taskId), credential/path/secret/raw CoT 금지,
  duplicate wake 방지, ACK 재노출 금지, 실패 wake는 bounded retry.

## Worker / QA flow

- Worker는 trusted registry(`writeWorkerRegistryRecord`, schema `G.2`)에만 등록.
  launchCommand는 단일 실행파일(allowlist `node` 또는 절대경로), 임의 shell 금지.
- Dispatcher가 spawn + capture arm + observation binding. 어댑터
  (opencode/claude-code/codex/commandcode/cline/grok/actl-managed)는
  CaptureManager 생성 시 등록된다.
- 구현 워커 래퍼: `scripts/relay-worker-claude.mjs` (Builder relay path).
  `relay-worker-opencode.mjs`는 QA-only passthrough(구현 워커 아님).
- QA: 독립 runtime + read-only. `Worker == QA` 거부, stale run 거부,
  stale CAS 거부, history를 current처럼 accept 금지(커널이 강제).

## PM judgment / Retry flow

- RESULT → QA verdict → Delivery → Wake → verification context →
  PM judgment(ACCEPT: dual CAS, CHANGES: reason 10..2000자) →
  retry는 fresh attempt + independent QA → VERIFIED_DONE → NEXT discovery.

## Security boundaries

1. Owner GO 없는 arbitrary dispatch 금지 (`dispatch_owner_approved` 1회성).
2. PM 입력으로 임의 shell 실행 금지. 3. 임의 workspace/path injection 금지
   (workingDirectory는 dataRoot 하위로 강제).
3. Trusted worker만. 4. QA 독립 runtime + read-only. 5. stale 판단 금지.
4. CAS guard 유지. 7. history accept 금지. 8. delivery identity verification.
5. secret/env를 ChatGPT context로 노출 금지.
6. browser automation을 Native처럼 위장 금지. 11. 실패를 성공으로 기록 금지.

## Legacy dependency status (P3 대기)

- `codex-chatgpt-web`: **STILL_REQUIRED 판정 보류** (Native E2E 미PASS이므로 제거 금지).
  - `src/backend/chatgpt-review.ts`: EXTERNAL tool로만 취급(vendor 금지). MCP 경로에서 import 안 함.
  - 살아있는 리스너 `:17841` (bun, codex-chatgpt-web).
  - `night-runtime`/`config/portfolio.json`의 `pmTransport: codex-chatgpt-web`은
    repo-file intake 임시 계약(메타데이터)이며 영구 의존성이 아님.
- 분류는 Native E2E PASS 후: REMOVE / KEEP TEMPORARILY / OPTIONAL DEV TOOL.

## Rollback

- MCP App: 프로세스 종료(`:3899`) + tunnel 종료. ChatGPT connector는 이전 URL로 복원.
- `dist/`는 gitignored이므로 `git status` clean 유지. 되돌리려면 브랜치 HEAD(`4658448`)에서 재빌드.
- portfolio-runner(nightly)는 손대지 않음. `/tmp/native-pm-e2e/` scratch는 삭제 가능.

## Implementation worker (Founder-approved scope exception, 2026-09-27)

- `scripts/relay-worker-opencode-impl.mjs` (new): Builder relay path for OpenCode,
  mirroring `relay-worker-claude.mjs` discipline (relay args only, bounded 16 KiB
  prompt, prompt.md idempotency incl. retry-prompt recompute via dist composer,
  no MCP/evidence writes, exit-code failure path).
- Billing: FREE TIER ONLY (`-free`/`big-pickle` allowlist). Default
  `opencode/big-pickle` (verified live; `nemotron-3-ultra-free` returned empty,
  `mimo-v2.5-free` errored on this host that day).
- Test: `test/relay-worker-opencode-impl.test.mjs` (14 tests PASS).

## Known limitations (2026-09-27)

1. ChatGPT connector가 stale URL을 가리키고 있어 PM 연결은 Founder 재지정 전까지 DOWN.
   (`relay_pm_open_widget` internal error = 죽은 서버/stale tunnel이지 핸들러 버그가 아님.)
2. ~~라이브 구현-워커 dispatch 미검증~~ 해소됨(아래 P2 E2E). 남은 것은 ChatGPT-UI 단계.
3. `night-runtime`에서 MCP를 빌드할 수 없음(소스 부재). SSOT는 Core/Agent-Relay 브랜치.

## P2 E2E (live, scratch project e2e-probe, 2026-09-27)

Scenario A (ACCEPT): `create → owner-dispatch → opencode worker(hello.txt) →
RESULT_RECEIVED → delivery → wake claim → verification context →
judgment ACCEPT → pmState ACCEPTED`. (goal-closure는 PLAN-mode gate가 정상 거부.)

Scenario B (CHANGES/RETRY): `... → judgment CHANGES → auto retry-prep(run seq 2) →
worker(retry prompt) → bye/retry.txt → judgment ACCEPT → ACCEPTED`.
중간에 래퍼의 retry-prompt 미대응 버그 발견 → dist composer 재사용으로 수정 후 재검증 PASS.

## Exact test evidence

`qa/NATIVE_PM_BRIDGE_V1_REPORT.md` 참조. Live(2026-09-27):
`tools/list`, `tools/call relay_pm_open_widget → {ok:true}`,
`resources/read ui://agent-relay/pm-widget-v2`, tunnel 경유 동일 3종 PASS,
`relay_pm_create_task → TASK-0001 READY/PENDING` PASS.
