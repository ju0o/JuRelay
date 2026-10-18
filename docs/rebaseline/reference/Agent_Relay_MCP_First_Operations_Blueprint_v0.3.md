# Agent Relay — MCP-first V1 운영·배포 설계 보충서 v0.3

**작성:** 2026-10-18  
**상태:** `DESIGN_PROPOSAL / PLAN_ONLY / IMPLEMENTATION_HOLD`  
**상위 결정:** DR-001 = MCP + Widget 중심 (Founder approved). 본 문서는 신규 세부 구현·Git 조작·아카이빙·배포 승인 아님.  
**기준:** `Agent_Relay_MCP_First_PRD_v0.2_Decision_Draft.md`; public `ju0o/JuRelay` `main=1127c96`, development `ar/chatgpt-goal-relay=b9473f5` (확인 시점 기준).  
**근거 구분:** `[관찰]` GitHub 코드/기존 QA, `[공식]` 공개 OpenAI 제품 문서, `[제안]` 아직 승인되지 않은 V1 사양.

## 1. 제품 약속

> ChatGPT에서 목표를 정하고, 사용자의 컴퓨터에서 AI 직원이 작업하고, 독립 QA가 검사하며, Agent Relay가 상태와 증거를 남기는 무료·오픈소스 로컬 MCP 관제 시스템.

- **제품은 무료·오픈소스:** 소스 공개, 로컬 런타임과 기본 진단 도구에 별도 Agent Relay 요금 없음.
- **컴퓨팅/모델은 사용자의 선택:** 개인 PC·서버 전기, CLI 공급자 구독, API 비용 또는 로컬 모델 설치비용은 소프트웨어 가격과 분리.
- **ChatGPT 통합은 선택 가능성에 좌우됨:** 플랫폼·계정·워크스페이스·연결 지원 범위는 외부 조건. 무료 ChatGPT 계정에서 모든 custom MCP write tool과 Widget이 가능하다고 홍보 금지.
- **각자 설치:** 개발자 ASUS의 Worker/인증을 여러 이용자에게 공유하는 중앙 무료 AI 서버 방식 금지.

## 2. 배포 형태 / 무료의 경계

| 트랙 | 사용자 배포 | ChatGPT 의존 | 운영비 부담 | V1 판정 |
|---|---|---|---|---|
| A Local Open Source | GitHub release + 각자 자기 PC/서버 설치. CLI/TUI/기본 상태 조회 | 없음 | PC·모델 사용자가 부담 | 첫 공개 배포의 필수 기반 [제안] |
| B ChatGPT 개인 연결 | 사용자 로컬 MCP + 본인 소유 tunnel 또는 허용 HTTPS 연결 | 해당 계정의 custom MCP 가능 범위 | 선택 연결 비용·구독 각자 부담 | 주력 사용자 경험 [제안] |
| C 공용 ChatGPT Directory | 안정적 공개 HTTPS MCP, 인증/OAuth, 장치별 라우팅/gateway | 디렉터리 정책·심사 | 운영자 비용·보안/가용성 의무 발생 | V1 비목표/후속 [제안] |

**공식 주의사항:** 공개 디렉터리 MCP 제출에 Stable Public HTTPS endpoint가 필요하고, Secure MCP Tunnel만으로는 공개 제출 요건을 충족하지 않음. ChatGPT custom MCP 권한, 특히 write, 요금제/워크스페이스에 따라 달라짐. 사용자에게 `모두 무료·누구나 ChatGPT에서 완전 사용`이라고 약속하지 않음.

**License Gate:** `main`에는 MIT LICENSE가 있지만 dev 브랜치 루트에는 LICENSE 파일이 없었음(관찰). 공개 릴리스 후보 브랜치/패키지에 LICENSE 및 저작권/서드파티 의무를 명시하는 작업은 별도 구현 승인 이후에 수행.

## 3. 3층 아키텍처

```
사용자 자연어 ──> ChatGPT PM ── (MCP tools) ──┐
                       ↑          ↓            │
                  Widget 관제 <── Project View  │
                                                  ▼
                          인증/권한을 가진 MCP Tool Gateway
                                   │ (server-side check)
                 ┌─────────────────┼───────────────────┐
                 ▼                 ▼                   ▼
         SSOT Project/Goal/Task   Dispatcher      Read Models/Event API
                 │                 │                   │
                 │              Worker CLI             │
                 │                 │                   │
                 │        Result Capture + Evidence   │
                 │                 ▼                   │
                 └──────────── QA Engine <─────────────┘
                                  │
                             PM Verdict
                        ACCEPT / CHANGES / HUMAN_GATE
```

- `[제안]` Widget은 단순 view/interaction, Runtime 정본 저장소는 장기 상태, MCP 도구는 인증·권한 경계를 집행. UI 자체가 dispatch 권한을 만들지 않는다.
- `[관찰]` 이미 `src/mcp/app-server.ts`, `src/backend/{goal-task,dispatcher,v1-dispatch,task-execution-config,agent-model-catalog,qa-gate,runtime-truth}.ts`가 존재한다. 전부 V1 E2E 통과라고 가정하지 않는다.
- `[제안]` 서버는 세션이 종료되어도 Worker/QA를 추적하고, durable Inbox를 통해 대화 재진입 시 미처리 결과를 복원. Widget iframe은 작업 수행을 위한 상시 실행 주체가 아니다.

## 4. V1 Widget 설계

- **기본:** 선택 프로젝트 및 호스트·연결, ACTIVE Goal(둘 이상이면 명확한 목록), Task 리스트(소속 Goal 명시), 실제 ACTIVE vs saved RUNNING 구분, QA 대기/PM 검토, 다음 행동 1개.
- **Task 펼침:** Goal 관계, 작업 범위/완료 조건/Git, Builder Agent/Model 선택, QA 방식·Agent/Model, 설정 저장, 승인과 실행 별도, 최근 Run·log·diff·Evidence 및 재시도 통제.
- **활동:** 시간순 Run 상태, 이벤트, QA attempt, 현재 Worker/모델, 에러·복구·중단/재시도 상태.
- **더보기:** 연결 Doctor, 프로필, 고급 원문 상태, 설정, 레거시 진단.
- **강제 정합성:** projectId 필터 엄격; null 레거시 추측 금지; `RESULT_RECEIVED`와 `ACCEPTED` 분리; stale/unknown 표시; 앞 8개만 표시하는 전역 데이터 섞임 금지.
- **UI 계약:** 320/380/540px+데스크톱, Light/Dark, 탭/스크린리더/키보드, 오프라인·연결 끊김 메시지, 큰 작업에서 장시간 스크롤 없이 요약 가능.

## 5. End-to-end와 상태/권한

1. **목표:** ChatGPT PM이 대화에서 요구 파악 → 기존 Goal/Task 중복/범위 조회 → 계획 제안 → 사용자의 **정본 저장 승인**.
2. **준비:** Task READY, 기본 프로젝트/Workspace/Git preflight 확인; Builder Agent/Model 카탈로그 자동 조회, Owner 직접 선택.
3. **QA 계약:** 정적 검사(`typecheck`, test, diffScope 등)를 기본으로, SEMANTIC 필요 시 독립 QA Agent/Model 지정. 선택·모델/기준 변경을 기록하고 미지원/무인증이면 차단.
4. **선택 저장:** 설정만 영속; Run 0. 재선택 시 이전 실행 승인 무효화.
5. **승인:** 정확한 taskId/projectId/workspace/workerId/modelId/scope 기준 Owner 승인만 기록; Run 0.
6. **작업 시작:** 별도 Owner GO, server-side CAS/idempotency 확인 후 **단 한 번 dispatch**, Run/Worker 실행. Widget 닫혀도 지속.
7. **수행:** Worker가 수정하고 Result Packet/Git diff/tests/로그/Evidence를 로컬에 기록. 성공 선언만으로 PASS 금지.
8. **QA:** 기계적으로 검증 가능한 항목 우선, 필요 시 별도 QA Worker. `QA_PASS`는 PM ACCEPT와 다름.
9. **PM 판정:** ChatGPT에 Delivery/Inbox 도착. PM이 Evidence를 확인해 ACCEPT/CHANGES/HUMAN_GATE. ChatGPT가 없거나 wake에 실패해도 **durable PM inbox 보존**.
10. **복구:** 서버 재시작, Run 완료/실종, 새 대화에서는 정본 재조회. STALE/ORPHAN 구별, 미승인 무조건 재실행 금지.

**중요 충돌 확인:** 기존 `qa-gate.ts`에는 QA FAIL시 같은 Task의 자동 remediation dispatch까지 포함된 코드가 존재한다. `V1은 Owner의 재시도 승인 우선`을 제품 정책으로 확정하려면 해당 기존 경로의 승인/실행 의미를 설계 심사·E2E 후 정렬해야 한다. 현재 자동 재시도 기능이 안전 계약대로 동작한다고 임의로 단정하지 않는다.

## 6. 모델·무료 사용 정책

- 모델 카탈로그는 각 사용자 로컬 CLI 또는 허용 캐시에서 `workerId`별로 탐색. `available`/`authOk`/구독 여부/쿼터는 별도 진실값으로 표시.
- **자동 발견 ≠ 자동 선택.** Builder/QA 모두 사용자가 직접 선택. 등록되지 않은 modelId, 인증 부재, 무료 워커에서 유료 모델 발견 시 fail-closed.
- 0원 옵션은 `로컬 무료 모델`(하드웨어·라이선스 점검 필요), 또는 사용자의 `검증된 무료 제공량`으로 제한된 AI Worker, 코드/설정 비용 0원. 모든 공급자의 무료 API/CLI 이용 가능성을 지속 보증하지 않음.
- ChatGPT 구독 이용권을 외부 Worker 실행을 위한 무제한 API 크레딧으로 간주하지 않음.
- 초기 QA는 deterministic first; semantic QA는 실제 이용 가능 모델이 있을 때만 사용.

## 7. 공개 배포·온보딩

1. GitHub 소스+OS 라이선스·클린 릴리스·체크섬·문서·security policy.
2. 사용자 OS에서 설치 `agent-relay doctor` → runtime 로컬 정상/권한/폴더 검사.
3. `agent-relay agents`로 모델/CLI auth/권한 확인.
4. `agent-relay connect`는 연결 기능 이용 가능한 사용자에게만 ChatGPT MCP 연결 안내. 원격 호스트는 Secure Tunnel/HTTPS를 명시적으로 선택, 비밀키 미노출.
5. 계정·플랜 제약으로 ChatGPT 연결이 안 되면 기존 CLI/TUI(향후 최소 로컬 웹 상태 화면 선택)로 **Agent Relay Core 사용 가능**하도록 보장.
6. 샘플 프로젝트에서 write 전 보호 장벽 시연. 자기 작업 폴더에 대한 최소 권한만 부여.
7. 결과 복원·업데이트·이전·삭제·백업 문서/명령어 포함.

**공개 디렉터리 검토(후속):** 모든 이용자의 사설 PC와 단일 공개 HTTPS MCP 주소를 연결하려면 계정별 인증·장치별 라우팅·공개 Gateway 또는 user-owned connection 구조가 필요. 기본 보안/운영비 없이 '단일 Plugin 설치 → 모든 개인 로컬 파일 접근'은 실현되지 않는다. 각 사용자별 Tunnel은 개인 연결로는 가능하지만 디렉터리 공개 MCP 엔드포인트 요건을 자동 충족하지 않는다.

## 8. 코드 정리/Private Archive

- KEEP CORE: 영속 Goal/Task/Run, Evidence, Dispatcher, Permission, QA/Recovery, MCP Tool.
- REFACTOR: monolithic Widget, 중복 렌더 상태, 프로젝트 스코프·비동기 race.
- DEFER/PRESERVE: Electron UI/TUI/legacy CLI 중 실제 사용하지 않는 표면 — 의존성 감사 전에는 제거 금지.
- ARCHIVE CANDIDATE: proven-unused prototype, 예전 설치·실험 모듈(의존성/복원 테스트 후 개별 승인).
- EXCLUDE: 토큰, 실제 프롬프트, 개인 데이터/Run log, `.env`, local evidence, 자격증명. Private Git에서도 금지.
- 라이선스·보존/복원 및 Public history exposure를 선확인. 아카이빙·삭제·Git push는 별도 Founder Gate.

## 9. 실제 구현 상태 (2026-10-18 감사 범위)

| 기능 | 상태 |
|---|---|
| V3 Host 프로젝트 선택/Goal-Task 범위 | 이전 QA 시 핵심 PASS |
| Runtime Tool/모델 카탈로그/Task owner selection | 코드 존재, 사용 일부 검증 |
| Task별 QA Agent+Model 선택/바인딩 | 미완료/추가 구현 |
| TASK-0089 실제 Builder→QA→PM E2E | 아직 미완료 |
| 새 ChatGPT 대화에서 Widget 연속성 | 알려진 blocker |
| Mandatory | 이전 보고 79/80, CLI tunnel-client 환경 의존 baseline fail (풀 PASS 아님) |
| 범용 다른 사용자 설치/OS 호환 | 미검증 |
| 공개 Directory OAuth/공통 Endpoint | 후속 설계·구현 필요 |

## 10. 구현 우선 순서와 승인 게이트

- **P0 문서:** DR-002~DR-007 미확정 정책 동결, 특히 V1 QA 실패 처리와 무료 사용자 경계.
- **P1 코드 감사:** 실제 Runtime/빌드/Electron/TUI/MCP 의존성 지도, 오픈소스 릴리스 후보 정리.
- **P2 첫 Loop E2E:** 기존 `TASK-0089`, 선택 저장→승인→작업 시작→Result→QA→PM 판정, Owner 1회 승인 필요.
- **P3 QA 설정:** Task별 QA/모델/검사 계약 및 fail-closed; P2 E2E 뒤 변경 시 재검증.
- **P4 Widget 관제:** P2/P3 안정된 상태 모델을 가볍게 표현하는 컴포넌트 분리.
- **P5 신뢰성:** 비활성 ChatGPT, 중복 클릭, 실패 복구, MQTT 등 신규 인프라 없이 Run/Inbox 영속 복구, 여러 실제 Task.
- **P6 공개 OSS:** 개인 설치·연결 Doctor·라이선스·Secrets scan·release branch·문서·롤백→ Founder Release GO.
- **P7 Directory:** 안정적 HTTPS endpoint/OAuth/개인 로컬 agent 연결/비용 계획을 별도 프로젝트 승인.

## 11. 결정 대기

- V1 제품 공개를 '무료 self-hosted core + 선택적 ChatGPT 통합'으로 명시할지.
- 첫 QA는 deterministic only 허용, semantic QA 필요 Task만 독립 AI QA 모델을 요구할지.
- 기존 자동 QA remediation의 자동 dispatch를 V1에서 허용할지(권장: 명시 승인 우선).
- GitHub OSS self-host 배포를 먼저 출시하고 Directory 등재는 나중으로 둘지.
- 공개 릴리스 지원 OS 최소 조건(Linux만 1차? Windows/WSL 지원 계획?).

## 12. 공식 출처 (방향/외부 요건)

- https://developers.openai.com/plugins/build/chatgpt-ui (MCP Apps, UI-Tool 분리, 세션/영속 상태)
- https://developers.openai.com/plugins/build/mcp-server (Public Plugin의 stable HTTPS endpoint, Secure Tunnel 한계)
- https://developers.openai.com/plugins/deploy/submission (public plugin 심사/연결/인증)
- https://help.openai.com/en/articles/20001256-plugins-in-chatgpt (플랫폼/계정별 plugin 가용성)
- https://help.openai.com/en/articles/12584461-creating-custom-mcp-apps-in-chatgpt (custom MCP 지원/권한)

**실제 파일/저장소/Worker 변경 없음.**