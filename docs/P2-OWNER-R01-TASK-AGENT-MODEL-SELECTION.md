# P2-OWNER-R01 — Task별 Agent / Model / Profile / GO

**현재 판정:** `TASK_AGENT_MODEL_SELECTION_PASS`  
**변경일:** 2026-10-08  
**Branch:** `ar/chatgpt-goal-relay`  
**근거:** mandatory 74/74; live E2E Claude Pro(`haiku`) + Grok(`grok-4.5`); cert `.agent-relay/cert/owner-r01-task-agent-model-selection-pass.json`

## 목적

프로젝트 Assignment를 매번 바꾸지 않고, Task/Run 단위로 Agent·모델·실행 프로필·owner GO를 선택한다. 기본 Builder가 있어도 새 Task에서 실행자를 자동 확정하지 않는다.

## 아키텍처 (Option C)

- SSOT: `{dataRoot}/{scope}/_relay/tasks/{taskId}/execution-config.json` (`TaskExecutionConfigV1`)
- 코드: `src/backend/task-execution-config.ts`, `src/backend/agent-model-catalog.ts`
- Resolve blocker: `TASK_EXECUTION_SELECTION_REQUIRED` / `OWNER_APPROVAL_REQUIRED` / `UNSUPPORTED_MODEL` / `WORKER_AUTH_REQUIRED`
- Dispatch: `requireApprovedExecutionConfig` in `v1-dispatch.ts`; RunMeta `model` + `selectionSource: TASK_EXECUTION_CONFIG`
- MCP: `relay_pm_list_executable_agents`, `relay_pm_list_agent_models`, `relay_pm_get/set_task_execution_config`, `relay_pm_approve_task_execution`
- Widget: Task preview Agent/model/profile/approve (모델 변경만으로는 dispatch 없음; explicit GO만)

## 모델 카탈로그 출처

| Agent | 출처 | supportsExplicitModel |
|-------|------|------------------------|
| Claude Pro (`builder-claude-pro`) | `~/.claude-pro/cache/model-catalog` + `/model` aliases | true |
| Grok (`builder-grok`) | `grok models` | true |
| CommandCode (`builder-commandcode`) | `commandcode --list-models` | true |
| Codex | `~/.codex/models_cache.json` | true |
| OpenCode | `opencode models` | true |
| Cline | 없음 (interactive auth) | **false / BLOCKED** |
| Cursor | WorkerRegistry 없음 | **BLOCKED** |
| Claude Team | Founder 폐기, 재등록 금지 | **BLOCKED** |

임의 모델 ID 생성 금지. 구독 플랜명(Pro/Pass) ≠ modelId. 실패 시 다른 유료 모델로 자동 전환하지 않음.

## E2E 증거 (2026-10-08)

| Task | Worker | Model | RunMeta.model | Launch log |
|------|--------|-------|---------------|------------|
| TASK-0001 (isolated) | builder-claude-pro | haiku | haiku | `model: haiku` |
| TASK-0002 (isolated) | builder-grok | grok-4.5 | grok-4.5 | `model: grok-4.5` |

추가 검증: 선택 전 Worker null; unsupported model fail-closed; duplicate GO blocked; jucontroller Assignment 불변; TASK-0085 R01 E2E에서 미수정; Production tunnel PID 불변(1976/1978).

## 남은 차단 / 다음

- OWNER-02B: R01 PASS 전까지 자동 시작 금지. 이 문서 PASS 이후에도 Founder/계획 지시 없이 자동 시작하지 말 것.
- Cline / Cursor: BLOCKED (위 표).
- CommandCode / Codex / OpenCode: 카탈로그·래퍼 준비됨; 이번 PASS의 최소 2종 E2E는 Claude+Grok로 충족.

## 금지

- Production Tunnel / Installer / Tray 변경
- main merge / release
- JuControler 기존 Task 본문 수정(R01 범위)
- Claude Team 재등록
- 비밀값 출력
