# Agent Relay — MCP-first Product Rebaseline v0.1

**작성 기준일:** 2026-10-18  
**상태:** `FOUNDER_REVIEW / PLANNING_ONLY` — 제품 방향 제안서. Git/운영 데이터/서비스 변경 승인 문서가 아님.  
**기준 저장소:** `ju0o/JuRelay` (Public)  
**기준 브랜치:** `ar/chatgpt-goal-relay` / `b9473f5438f7e4ec2b4679b6e148d516de45eb76`  
**기준 main:** `1127c96ca4dc370dc3e69346f92fa707ffd964cd`  
**검수 기준:** 원격 소스 트리·README·설계 문서, Agent Relay 실제 Host QA 보고, OpenAI MCP Apps/UI 지침  
**이번 문서로 승인되지 않은 것:** 코드 수정, Goal/Task 변경, 실행 승인, Worker dispatch, 아카이브 저장소 생성, 삭제·이동, main merge, 릴리스.

---

## 1. 제품 재정의

> **Agent Relay는 ChatGPT에서 PM과 대화해 업무를 정의하고, 로컬/원격 AI 작업자에게 안전하게 일을 배정하며, Goal → Task → Worker → QA → PM 판정을 하나의 지속적인 상태로 관리하는 MCP-first 오케스트레이션 제품이다.**

**중심 경험:** ChatGPT 대화 + 작은 관제 Widget.  
**핵심 실행 자산:** ASUS의 Agent Relay Runtime/Worker Registry/Result Capture/Evidence/QA Gate.  
**후속 경험:** 상세 로그·diff·다중 워크스페이스 조작용 독립 GUI. 초기 V1 출시에 필수 아님.

### 사용자에게 제공하는 가치

- "AI가 뭘 하고 있지?"에 대해 추측이 아닌 실제 Run/Task 상태로 답한다.
- 자연어로 업무를 지시하되 **사용자가 Agent·모델·QA 및 실행 권한을 선택**한다.
- 작업 이후 결과·검증·수정 요청·재시도·복구가 영속적으로 기록된다.
- 채팅을 바꾸거나 서버가 다시 시작돼도 정본 작업 기록으로 이어갈 수 있다.
- ChatGPT UI가 실패해도 독립적인 MCP Tool/CLI로 읽기·복구가 가능하다.

### 목표와 비목표

| 범주 | 이번 V1 목표 | 이번 V1에서 제외/후순위 |
|---|---|---|
| PM | ChatGPT 대화로 계획/정본 조회/결과 판정 | 자율 야간 전자동 운영 |
| 관제 | Project·Goal·Task·상태·승인 필요·QA 표시 | 모든 디버그/ERD/프로토타입의 첫 화면 노출 |
| 실행 | Task별 명시적 Builder+Model 선택 및 1회 승인 | 자동 모델 추천·자동 선택·암묵적 GO |
| 검증 | Task별 QA 책임과 모델을 명확히 지정/검증, 결과 증거 표시 | 검증 없는 PASS·QA 자동 임의 대체 |
| 복구 | 중복 실행 차단, 서버 재시작 후 동일 작업 재조회 | 분산 다중 호스트 자율 복구 완전 자동화 |
| 배포 | 먼저 ASUS 단일 사용자 안정화 | Windows/macOS GUI 동시 출시, 멀티테넌트 SaaS |

---

## 2. 현재 제품·코드 사실 (확인된 범위)

### 저장소

- Public `ju0o/JuRelay`의 원격 `main`과 개발 브랜치는 서로 다르다. 개발 브랜치 트리는 약 551개 엔트리, main은 약 138개 엔트리다(파일뿐 아니라 디렉터리 포함). **차이가 크다는 사실만으로 dirty 코드라는 뜻은 아님.**
- 개발 브랜치 `src/`의 파일 약 201개, `test/` 약 166개, `scripts/` 약 26개, `docs/` 약 56개(2026-10-18 원격 트리 기준). 이는 정식 출시 코드 크기나 품질 판정이 아니라 인벤토리다.
- 개발 README는 제품을 `Electron · CLI · TUI · MCP` 네 가지 표면으로 설명한다. 반면 GitHub 저장소 설명과 `package.json`에는 이전 Windows 앱/Prompt-Result 로그 도구로서의 표현이 남아 있다. **제품 정체성이 문서 사이에서 달라져 있다.**
- Electron은 `src/backend/main.ts`, `src/frontend/App.tsx` 등으로 존재한다. MCP 서버는 `src/mcp/`, Widget은 `src/mcp/app/pm-widget-resource.ts`, 실행·작업·QA 엔진은 `src/backend/` 등의 모듈에 있다.
- 최신 확인 Widget은 `ui://agent-relay/pm-widget-c7ed503e`(2026-10-10 QA), 프로젝트 전환 Host 핵심 검증 PASS. ESC/외부 클릭/키보드/320~540px 스위처 검사는 별도 미검증.
- 기존 실제 TASK-0089는 `READY / PENDING`, Run 0, execution-config null, GOAL-0026은 PLANNING이었다(마지막 운영 검수). **이 문서가 현재 실시간 상태를 갱신한 것은 아님.**
- Mandatory 79/80: `test:p2-c-chatgpt-connect`의 `TUNNEL_CLIENT_MISSING` 대 `TUNNEL_SETUP_REQUIRED` 환경 의존 실패가 사전 존재한다고 보고됨. **전부 PASS로 취급하지 않는다.**
- 새 ChatGPT 대화에서 Widget 마운트 실패는 아직 별도 해결·재검증이 필요한 블로커다.

### 보유한 자산: 폐기 금지 후보

| 그룹 | 실제 위치 예 | 원칙 |
|---|---|---|
| 정본 상태·작업 계약 | `src/backend/goal-task.ts`, `task-execution-config.ts` | 유지/분리 |
| 실제 실행·멱등성·권한 | `dispatcher.ts`, `v1-dispatch.ts`, `runtime-truth.ts` | 수정 전에 계약 테스트 |
| QA·Evidence | `qa-contract.ts`, `qa-gate.ts`, Evidence/Result 관련 코드 | 절대 성급히 제거하지 않음 |
| Worker/모델 카탈로그 | `agent-model-catalog.ts`, Registry·Adapters | Task별 Builder/QA 선택의 기반 |
| MCP 표면 | `src/mcp/` | V1의 중심 |
| Widget UI | `src/mcp/app/pm-widget-resource.ts` | **뷰 분리/재구성 후보**, 무조건 버리지는 않음 |
| Electron·TUI·설치 도구 | `src/frontend/`, `src/tui/`, Electron packaging | 필요성 감사 후 유지/격리/보관 결정 |
| 이전 시험·증거·프로토타입 | `test/`, `docs/`, `docs/prototypes/` | 증거 체인 보존 후 분류 |

---

## 3. 시스템 역할과 권한

```text
사용자(Founder)
   │ 자연어로 Goal·Task 구상 / 명시적으로 선택·승인
   ▼
ChatGPT PM ────── MCP Tool API ─────────> Agent Relay Runtime / SSOT
   │                                        ├── Project·Goal·Task
   └── Widget(조회/관제/필요한 승인)         ├── Worker Registry·Model Catalog
                                            ├── Dispatcher·Run·Result Capture
                                            ├── QA·Evidence·Retry/Recover
                                            └── Audit Log / Backup
                                              │
                                              ▼
                                      ASUS CLI Workers
```

**권한 원칙**

1. ChatGPT는 PM 인터페이스이지 상태 저장소가 아니다. 정본은 Agent Relay Runtime에 있다.
2. Widget은 읽기 모델을 표시하고, 명시적 사용자가 선택한 안전한 작업만 실행 API로 전달한다.
3. 프로젝트 기본 Assignment와 이번 Task의 선택을 구분한다.
4. **Builder Agent 선택과 Builder Model 선택은 별개**이고, 변경 전 저장 승인·실행 승인·dispatch를 별도 단계로 유지한다.
5. **QA Agent와 QA Model도 독립적으로 보여주고 지정**할 수 있어야 한다. 현행 `qaContract.semantic.qaWorkerId`/프로젝트 QA 지정이 있다고 해서 Task별 QA 모델 UI가 이미 완성된 것은 아니다.
6. 승인하지 않은 자동 dispatch, 다른 모델로 조용한 fallback, 다른 프로젝트 Workspace 변경은 금지한다.
7. PM ACCEPT는 Worker 스스로 할 수 없고, Evidence를 근거로 이루어진다.
8. AI가 출력한 성공 문구와 실제 Git diff·검증 결과를 구분한다.

---

## 4. 사용자 경험: 한 번의 작업 흐름

### A. 프로젝트 연결 (한 번)

1. ChatGPT에서 Agent Relay MCP 연결·인증 확인.
2. 프로젝트와 실제 로컬 Workspace 선택. 다중 프로젝트가 있더라도 한 번에 하나가 현재 스코프.
3. PM/Builder/QA 후보와 사용 가능 상태 확인.
4. 권한·계정·폴더 충돌이 있으면 작업 시작을 차단하고 해소 절차 표시.

### B. Goal/Task 계획

1. 사용자가 대화로 "OO 프로젝트에서 이 기능 만들자" 요청.
2. PM이 목표, Task 단위, 파일 범위, 완료 기준, 위험·의존성을 **초안**으로 제안.
3. 사용자가 **Goal/Task 저장**을 별도로 승인.
4. Widget에서 Goal 카드/하위 Task 목록/다음 행동이 확인된다. 초안과 확정된 Task를 혼동하지 않는다.

### C. 실행 준비

1. READY Task를 선택해 범위·Git Preflight·완료 기준을 검토.
2. Builder Agent를 직접 선택.
3. 선택한 Agent의 실제 모델 목록을 CLI/캐시에서 조회(신뢰 출처·인증 상태·무료 제한 표시). 사용자가 모델을 직접 선택.
4. QA Agent와 QA 모델/검증 종류를 선택하거나 유효한 기존 계약을 확인. QA 미설정 또는 인증 불가 시 명시적 차단.
5. **선택 저장**: 선택값만 영속 저장, 실행 승인 무효화/초기화 규칙 적용.
6. **실행 승인**: 해당 Task+선택 조합에 한정한 명시적 승인.
7. **작업 시작**: 한 번의 owner dispatch. 중복 클릭/재호출은 멱등성 정책으로 차단.

### D. 실행·QA·판정

1. Worker가 정확한 Workspace, 선택한 모델, Task 스코프에서 실행.
2. Widget은 단계 상태와 최근 실증 이벤트를 보여준다.
3. Result가 도착하면 코드/diff, 변경 파일, 테스트, Evidence, 오류를 영속 저장.
4. 결정적 체크 및 필요 시 Semantic QA가 Task 계약에 따라 실행. QA FAIL/UNVERIFIED는 숨기지 않는다.
5. PM이 **ACCEPT / CHANGES_REQUESTED / HUMAN_GATE** 판단. (자동 재시도의 허용·승인 정책은 별도 제품 계약으로 확정 필요.)
6. 완료된 Task는 다시 `PM 검토 필요`로 보이지 않으며 Goal 진행도가 업데이트된다.

### E. 회복과 이어가기

- ChatGPT 새 대화·Widget 재마운트·MCP 재시작 → 정본에서 Project/Goal/Task/Run/승인·QA 결과를 다시 조회.
- STALE, ORPHAN, FAILED, UNKNOWN, BLOCKED를 RUNNING/PASS로 바꾸지 않는다.
- 재시도는 기존 Task/Run lineage와 Evidence를 유지하고, 중복/파일오염 확인 후 수행.

---

## 5. Widget UX vNext: 관제 우선

### 기본 화면: 내 프로젝트 관제판

```text
Agent Relay                       [JuControler ▾]
현재 목표  GOAL-0026   공개 저장소 README 정리
상태: 계획 / 실행 준비 중

[작업 중 0]  [시작 대기 1]  [QA 대기 0]  [PM 검토 0]

Task 진행 상황
 • TASK-0089 README·gitignore 정리    실행 대기
   Builder 미선택 · QA 미확정
 • TASK-0085 Git 상태 확인             PM 승인 완료

다음 할 일: TASK-0089의 Builder/모델 선택
[Task 자세히] [전체 활동]
```

- 첫 화면에 `Project → 현재 목표 → Task 목록 → 지금의 다음 행동` 순서.
- 상단에 이미 완료된 이전 Goal이 남더라도 **현재 Task의 Goal과 혼합하지 않고**, 각 Goal이 서로 다름을 명시.
- Task 목록 항목을 누르면 소속 Goal, 계약, 담당 Builder/QA, 모델, 현재 Run, Evidence, 수정 요청 등을 연다.
- 실행 준비 Drawer/상세 화면에서만 Agent·모델/QA·모델 및 위험한 제어 노출.
- 활동 기록은 시간순, `PM 수신함`은 소속 프로젝트 및 전역 이벤트 구분. 소속 없는 레거시 기록은 **소속 미확인**으로 표시.
- 설계·프로토타입·ERD·과도한 통계는 V1 첫 화면에서 제거하고 개발자 진단으로 격리한다.
- 320/380/540px, Light/Dark, 키보드, 긴 경로 접근성, 스크린리더 라벨을 포함하여 검증.

### 언어 표현 원칙

| 내부 상태 | 사용자 표시 예시 |
|---|---|
| `READY/PENDING` | 시작 준비 완료 / AI 선택 필요 (조건에 따라 구분) |
| `RUNNING/ACTIVE` | 작업 중 |
| `RESULT_RECEIVED` | 결과 도착 (QA/PM 상태를 함께 반영) |
| `VERIFYING` | 검토 중 |
| `ACCEPTED` | 검토 완료 |
| `STALE/ORPHAN` | 연결 확인 필요 / 실행 상태 불명 |
| `PLANNING` | 계획 중 |
| `BLOCKED` | 조치 필요 |

표현은 UI에만 적용한다. 내부 계약 필드의 의미/값을 바꾸지 않는다.

---

## 6. 코드 구조 정리 방안

### 제안하는 논리적 구조 (즉시 이동 지시 아님)

```text
src/
  core/          # Goal/Task/Run 계약, permission, evidence, state
  runtime/       # Dispatch, Worker adapters, capture, recovery
  mcp/           # Tool API, schema, authorization, render entry
  widget/        # 독립 렌더 소스/스타일/UX 상태 (현재 거대 HTML 분리)
  integrations/  # Provider model catalog, project connectors
  legacy/        # 반드시 감사 이후에만 보존할 후보 (즉시 이관 금지)
```

현실적인 순서는 **기존 파일명을 당장 대거 변경하지 않고** 구조 매핑 → 무동작 변경(adapter/뷰 분리) → 계약 회귀 → 점진적으로 이동이다.

### 모듈별 처리 판정 체계

| 등급 | 의미 | 예시·결정 |
|---|---|---|
| KEEP | V1 핵심 사용, 검증됨 | MCP Tool, Task/Run 상태·권한·QA·Capture |
| REFACTOR | 실제 사용되지만 응집도 낮음 | `pm-widget-resource.ts` UI/CSS/이벤트 혼재: 분리 후보 |
| DEFER | 이후에도 쓸 수 있지만 V1 비필수 | Electron UI·TUI·고급 설치 흐름 |
| ARCHIVE | 연결·호출·시험 근거상 현재 경로에서 미사용 | 오래된 프로토타입/구현 분기 중 **검증 완료된 것만** |
| DELETE_CANDIDATE | 생성물/중복/비밀 포함 여부가 명확한 파일 | 의존성·실환경 참조 검사 후 Founder 승인 필요 |
| UNKNOWN | 정체·사용처 불확실 | 삭제·이관 금지. 참조·호출·빌드 감사 먼저 |

**`dirty`는 느낌이 아닌 근거로 판정한다:** 미참조/중복 구현, 테스트-코드 불일치, 무효 배선, 장기 사용되지 않은 표면, 민감정보 유출 위험 등. 스냅샷만 보고 삭제하지 않는다.

### 감사를 위한 증거

- 모든 파일의 Git 추적 상태, 런타임 import/reference, 빌드 포함 여부, 테스트 포함 여부.
- Electron/CLI/TUI/MCP 공통 코어 의존도.
- `main` 대 개발 브랜치의 인가된 변경 이유 및 인증 결과.
- 데이터 마이그레이션/데이터 루트와 소스 Git의 분리.
- 환경·SSH·인증·터널·패키징의 민감정보 탐지(값 자체 출력 금지).
- `test:p2-c-chatgpt-connect` 기존 실패의 환경 격리 및 CI/fixture 개선.

---

## 7. Private 아카이빙 / Git 정책

### 권장: 먼저 스냅샷으로 보존, 나중에 선별 정리

**Phase A — Read-only inventory**

- repo/branch/tag/worktree/현행 런타임 버전 기록, `git status`, 리스크 파일 목록.
- 오프라인 백업·정본 데이터 별도 백업·복구 시험. 비밀값은 백업 매체와 접근 정책을 구분.
- 기준점 태그/백업 후보를 정하고 사용자 승인 전에는 생성하지 않는다.

**Phase B — Founder 승인 후 보존**

- 새 Private GitHub 저장소 예: `JuRelay-Archive` *(가칭, 아직 생성되지 않음)*.
- 옛 GUI/TUI/실험 문서 스냅샷, 소스 파일, 동작 설명서, 빌드/검증 방법, 이전 SHA와 의존 링크를 보존.
- Private 저장소라고 해서 비밀번호/Token/실제 사용자 기록을 커밋하지 않는다. Git LFS/아카이브 비밀 자료도 동일.
- 이미 Public에 기록된 커밋은 Private로 옮긴다고 외부 노출이 되돌아가지 않는다. 원본 Public 히스토리 재작성/강제 Push는 별도 보안 사고 프로세스 없이는 금지.
- 필요한 핵심 코어는 Public Runtime에서 참조하므로 **archive한 뒤 곧장 제거하지 않는다**.

**Phase C — 분리·감축**

- MCP 제품의 최소 API 계약과 테스트가 재현되고, GUI·TUI 빌드 참조가 분리된 후에만 단계별로 옮긴다.
- 1개 모듈/기능군씩, diff + smoke + 회귀 + Host QA + 백업 복원으로 검증.
- 데이터 구조·ID·Run/Evidence lineage는 유지, 기존 데이터 삭제 금지.

**출시 브랜치 제안:** 기존 `main` 유지, `ar/chatgpt-goal-relay`는 현재 검증/개발 기준, 신규 rebaseline 설계 문서는 별도 docs branch에서 Review 후 PR. Founder 승인 없이 main이나 remote archive 변경 없음.

---

## 8. 새 WBS (재기획 우선)

| WBS | 단계 | 완료 기준 | Gate |
|---|---|---|---|
| RB-00 | Founder 제품 방향 고정 | MCP-first/Widget 중심/GUI 후순위 서명 | FOUNDER_DIRECTION_GO |
| RB-01 | 코드/데이터/배포 감사 | KEEP/REFACTOR/DEFER/ARCHIVE/UNKNOWN + SHA + 의존성 리포트 | READ_ONLY |
| RB-02 | PRD·상태/권한 계약 고정 | Goal/Task/Run/QA/PM의 SSOT, 안전 상태표, 화면 IA | FOUNDER_PRD_ACCEPT |
| RB-03 | MCP Core 계약 재정리 | Tool 입력·출력·권한/멱등성 회귀, 데이터 루트 복구 | OWNER_IMPLEMENT_GO |
| RB-04 | Widget 관제 중심 UX | Goal/Task/Next action, 드릴다운, 중요 버튼 최소화 | HOST_QA + FOUNDER_UX_ACCEPT |
| RB-05 | Task별 Builder·QA·모델 선택 | 목록 조회+명시적 저장·승인·실행 연결 | SAFETY_CERT |
| RB-06 | 첫 실제 E2E | TASK-0089의 Builder→Result→QA→PM ACCEPT, 범위 diff 증명 | OWNER_ONE_RUN_GO |
| RB-07 | 지속성·복구 | Host 새 대화 마운트, 재시작/중복 실행·STALE/ORPHAN 복구 | RELIABILITY_CERT |
| RB-08 | Private 아카이빙 | 검증된 보존/복원/권한/참조 리포트, 한정 이관 | FOUNDER_ARCHIVE_GO |
| RB-09 | MCP-first V1 후보 | 실사용 검수·문서/설치/보안·회귀 PASS, 제한사항 공개 | FOUNDER_RELEASE_GO |

**의존성:** RB-00~02를 먼저 수행. RB-01은 read-only로 즉시 가능. RB-08의 실제 파일 이동은 RB-03/06 성공 이전에 하지 않는다. 기존 첫 Task 실행(RB-06)은 제품 기준 계약과 사용자 승인 후 진행.

---

## 9. V1 ACCEPTANCE CRITERIA (초안)

1. ChatGPT에서 Project/Goal/Task가 정본과 일치하며 다른 프로젝트 항목이 혼입되지 않는다.
2. 대화만으로 Goal/Task의 초안·승인·상태 조회가 가능하며 Widget이 없더라도 안전하게 작동한다.
3. 모델 카탈로그 조회가 인증·제한 상태와 함께 나타나고, 임의 모델/유료 fallback이 없다.
4. Builder와 QA의 선택·모델·검증 계약이 서로 독립적이며 Task에 귀속된다.
5. Task 설정 저장, Owner 승인, 딱 한 번 실행이 기술적으로 분리된다.
6. 실제 사용자 지정 Task 최소 3건에서 서로 다른 상태 및 결과/QA/PM 판정까지 Evidence로 검증한다.
7. CHANGES_REQUESTED 이후 같은 Task와 Run lineage를 보존하고, 허용된 재실행만 일어난다.
8. 재시작/새 채팅·재마운트/오류 이후 상태 복구, 중복 실행 불가가 실증된다.
9. 320/380/540px 및 키보드 입력에서 프로젝트 전환·접기·실행 승인 컨트롤이 정상 작동한다.
10. Mandatory 완전 통과 또는 실패 1건 이상을 명시한 제한 출시 판정(단, 보안·권한·실행 관련 P0/P1 미해결 시 출시 금지).
11. Private/로컬 백업 복구 증거, 시크릿 미노출, 설치/업데이트/데이터 보존 정책이 명확하다.
12. 제품 README/PRD/기본 소개가 실제 MCP-first 제품 기능과 일치한다.

---

## 10. Founder 결정이 필요한 항목

**제안 기본값 A (추천):** `MCP-first, Widget dashboard-first, GUI deferred`. 사용자에게 지휘·상태·승인은 ChatGPT 내 제공하고, 고급 기능만 후속 독립 GUI로 옮긴다.

**대안 B:** `Dual-surface release`. Widget과 Electron GUI를 함께 주력 출시한다. 개발·QA 범위가 두 배로 늘고 안정화 지연 위험이 커진다.

**대안 C:** `MCP-only`. Electron/TUI 전체를 적극 축소한다. 첫 고객 범위는 단순해질 수 있으나 데이터 복구·오프라인 도구의 독립성이 약해질 수 있다.

추가 결정:

- V1 사용자: **단일 Founder/ASUS dogfood** 먼저인지, 다중 사용자까지 포함할지 → 추천: 개인 실사용 먼저.
- QA 선택: **Task별 명시 선택**을 필수로 할지, 유효한 QA 계약이 존재할 때 보여주고 확인만 받을지 → 추천: Task별 지정 또는 확인, 임의 대체 금지.
- 자동화 범위: 수정 재실행을 기본으로 막을지, 승인된 QA 정책 내에서만 제한적으로 허용할지 → 추천: 첫 V1은 명시적 승인 우선.
- Private Archive: GitHub의 새로운 별도 Private Repo를 만들지, 같은 Repo 내부 `archive` branch/tag를 우선할지 → 추천: 불변 스냅샷·별도 Private 보관 + 복구 시험 후 단계별 정리.

## 11. 다음 대화/작업 계약

**현재 승인된 일:** 코드 읽기, 설계 문서 작성, 가설/미확정 사항 분리, WBS 작성.  
**현재 금지된 일:** 작업 시작·Goal/Task 추가/수정·Agent/model 선택 저장·Git 변경·Private repo 생성·파일 삭제/이동·MCP 서비스 재시작·릴리스.

제안 다음 순서:

1. Founder가 A/B/C 중 제품 방향 선택.
2. PM이 이 문서를 `v0.2 DECISION_DRAFT`로 업데이트하고 새 제품 기준과 Non-Goals 고정.
3. 승인된 read-only 코드 인벤토리/전환 영향표를 발행.
4. Founder가 마이그레이션/아카이브 대상과 작성 권한을 별도 승인.
5. 변화가 작은 PR부터 검증하며 추진. 모든 단계는 RUN/Evidence/원상복구 가능 여부로 판정.

---

## 참고·근거

- GitHub 코드 기준: https://github.com/ju0o/JuRelay/tree/ar/chatgpt-goal-relay
- 개발 README: https://github.com/ju0o/JuRelay/blob/ar/chatgpt-goal-relay/README.md
- Widget: https://github.com/ju0o/JuRelay/blob/ar/chatgpt-goal-relay/src/mcp/app/pm-widget-resource.ts
- 기존 PRD/로드맵: https://github.com/ju0o/JuRelay/blob/ar/chatgpt-goal-relay/docs/ROADMAP-WBS-01.md
- Model selection: https://github.com/ju0o/JuRelay/blob/ar/chatgpt-goal-relay/docs/P2-OWNER-R01-TASK-AGENT-MODEL-SELECTION.md
- OpenAI MCP UI 지침: https://developers.openai.com/plugins/build/chatgpt-ui
- OpenAI Widget UI 지침: https://developers.openai.com/plugins/concepts/ui-guidelines

**검증 분리:** 실제 소스·조회 사실, QA 보고, 제품 기획 제안은 서로 구분한다. 위 문서는 미승인 제품 PRD 제안이며 외부 저장소에 아직 반영되지 않았다.