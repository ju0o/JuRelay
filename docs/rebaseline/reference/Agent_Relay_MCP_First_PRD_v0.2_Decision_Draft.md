# Agent Relay — MCP-first V1 제품 요구사항 정의서 (PRD v0.2)

**작성 기준:** 2026-10-18  
**제품 방향:** `DR-001 / FOUNDER_APPROVED / MCP + WIDGET FIRST`  
**이 PRD의 상태:** `FOUNDER_REVIEW / PLAN_ONLY` — 제품 방향만 확정. 이 문서 전체, 구현 범위, 코드 변경, 데이터 이전 및 배포는 미승인.  
**기준:** `ju0o/JuRelay` Public, 개발 브랜치 `ar/chatgpt-goal-relay` (`b9473f5438f7e4ec2b4679b6e148d516de45eb76`), `main` (`1127c96ca4dc370dc3e69346f92fa707ffd964cd`), 기존 v0.1 Rebaseline 및 실제 Host QA 보고.  
**근거 구분:** `[확정]` Founder 결정, `[관찰]` 소스/QA에서 확인된 상태, `[제안]` 제품 사양 초안, `[미검증]` 추가 E2E 필요.

---

## 0. 결정 기록 (Decision Register)

| ID | 내용 | 상태 | 의미 |
|---|---|---|---|
| DR-001 | V1은 **MCP + ChatGPT Widget 중심**으로 출시 방향 전환 | **FOUNDER APPROVED** | 독립 GUI 동시 출시는 요구하지 않음 |
| DR-002 | ChatGPT 대화 = PM, Widget = 관제/제한적 승인, ASUS Runtime = 실행·정본 저장 | PRD PROPOSED | 구현 구조·데이터 계약은 별도 승인 |
| DR-003 | 기존 Electron GUI/TUI는 우선 보존, 필요 시 후속 독립 GUI로 확장 | PRD PROPOSED | 삭제/이전 지시 아님 |
| DR-004 | V1 첫 타깃: 단일 사용자·ASUS Linux dogfood, 다중 사용자 후속 | PRD PROPOSED | 대상 범위 추가 승인 필요 |
| DR-005 | Task별 Builder와 QA의 Agent/Model은 명시적 선택·저장, 임의 대체 금지 | USER REQUIREMENT / DESIGN PROPOSED | Builder 일부 구현됨, QA 선택 미완성 |
| DR-006 | 수정 재시도 및 새 Task dispatch는 최초 V1에서 승인 우선 | PRD PROPOSED | 자동 반복을 영구 금지한다는 뜻 아님 |
| DR-007 | Private Archive 생성·이동·삭제는 별도 Founder Gate | **HOLD** | 본 문서는 권한 부여가 아님 |

## 1. 제품 요약

**한 줄 정의:** Agent Relay는 ChatGPT에서 프로젝트 목표를 계획하고, 사용자가 지정한 AI 작업자에게 Task를 안전하게 위임하며, 실행·QA·PM 판정·복구의 근거를 영속화하는 **로컬 실행 기반 MCP-first AI 업무 관제 제품**이다.

**우리가 해결할 문제:**

1. AI가 “완료”라고 말해도 실제 작업·검증·승인 여부를 구분하기 어렵다.
2. 여러 AI의 모델·프로젝트·작업 폴더·현재 작업을 추적하기 어렵다.
3. ChatGPT 대화 전환·MCP 재시작·Worker 장애 시 업무 문맥이 끊기거나 중복 실행된다.
4. PM/Builder/QA의 역할이 섞여 누가 어떤 근거로 승인했는지 흐려진다.

**차별적 약속:** 단순 AI 대화창이나 일반 Task 앱이 아니라, **Task 정본 + 실제 Worker Run + 검증 가능한 Evidence + 명시적 인간 승인**을 연결한다.

## 2. 대상 사용자와 V1 범위

- **핵심 사용자 [제안]:** Founder 본인, ASUS Linux 호스트에서 Claude/Codex/OpenCode 등 CLI Worker 사용.
- **주요 환경 [관찰]:** ChatGPT에 연결된 `Agent Relay Local` MCP와 Widget, 로컬/원격 Runtime.
- **V1 비목표 [제안]:** 멀티테넌트 SaaS, 타인용 원클릭 설치, macOS·Windows 네이티브 GUI 정식 출시, 무인 야간 자동 운영, 자율 모델 선택/유료 fallback, 전체 코드 구조 일괄 재작성.
- **후속 후보:** 고급 데스크톱 GUI, 프로젝트 포트폴리오 전체 관제, 다중 사용자 권한, 복수 호스트 분산 실행, 모델 사용량 기반 자동화.

## 3. 제품 원칙 (변경하면 Founder 재승인)

1. **SSOT:** ChatGPT 채팅 기록이나 Widget state가 아니라 Runtime 저장소의 Project/Goal/Task/Run/Approval/Evidence가 정본이다.
2. **Tool-first:** MCP의 조회·작업 API는 Widget 마운트 실패에도 단독으로 의미 있고 안전하게 동작해야 한다.
3. **Widget as view:** Widget은 빠른 관제에 집중하며, 모든 고급 설정을 첫 화면에 펼치지 않는다.
4. **Project scope:** 현재 선택한 프로젝트의 Goal/Task만 기본 표면에 표시한다. 전역 PM 수신함은 출처와 별도 레이어를 명시한다. `projectId=null`은 추정 보정하지 않는다.
5. **Owner choice:** Agent 선택·Model 선택·선택 저장·Owner 승인·작업 시작은 각각 다른 단계. 모델 목록 자동 조회 ≠ 모델 자동 선택.
6. **QA independence:** QA 역할과 QA 모델/검증 기준은 Builder와 독립적이다. QA 미설정·미인증 시 임의 대체하지 않는다.
7. **Honest status:** `READY`, `RUNNING`, `RESULT_RECEIVED`, `VERIFYING`, `ACCEPTED`, `STALE`, `ORPHAN`, `BLOCKED` 등을 논리적으로 구분하며, 저장된 RUNNING과 실제 ACTIVE를 혼동하지 않는다.
8. **Fail-closed:** 불명확한 권한, 알 수 없는 모델, 프로젝트 충돌, 누락된 Evidence, 잘못된 Goal/Task 귀속은 실행/최종 승인 차단.
9. **Traceability:** 모든 변경·승인·재시도는 범위와 Task/Run lineage 및 증거에 연결된다.
10. **Conservative migration:** 삭제보다 보존, 대규모 이동보다 작은 리뷰 가능 변경, 정본 데이터와 코드를 분리한다.

## 4. 사용자 여정 (V1 E2E)

### J1. 연결·프로젝트 선택

ChatGPT 대화에서 MCP 연결 확인 → 프로젝트 선택 → ASUS Workspace를 읽기 전용으로 확인 → 접근/역할 충돌과 인증 차단 사유 표시 → Dashboard 진입.

**완료 기준:** 선택 프로젝트 변경 시 Goal/Task/헤더/진행 지표가 함께 바뀌고, 과거 프로젝트의 Task/Goal이 남지 않는다. 연결만으로 Goal/Task/Run은 생성되지 않는다.

### J2. 자연어 목표 → Goal·Task 계획

사용자가 목표를 자연어로 제시 → PM이 기존 Goal/Task와 중복 확인 → 범위·완료 기준·위험·의존성 초안 제시 → 사용자가 저장을 별도 승인 → 정본 Goal/Task 생성 → Widget 목록 반영.

**완료 기준:** 저장 전 초안과 저장된 정본을 구분한다. 기존 Task를 재활용할 수 있으면 불필요한 신규 ID를 만들지 않는다.

### J3. 작업 준비·선택

READY Task 클릭 → Task가 속한 Goal, Git preflight, 작업 디렉터리, 대상 파일, 완료 기준 확인 → Builder Agent 선택 → 해당 Worker 카탈로그에서 모델 목록 조회 → Builder 모델 **사용자가 직접 선택** → QA Agent / QA 모델 / QA 방법을 별도 명시 또는 유효 계약 확인 → **선택 저장**.

**완료 기준:** 드롭다운 탐색은 저장이나 승인 아님. 인증/무료 정책/허용 모델과 실제 Run 모델이 일치. 모델이 지원되지 않을 경우 실패를 알리고 대체하지 않음.

### J4. 승인·실행

저장된 정확한 Agent·Model·Task·Workspace·Scope 요약 제시 → Owner 별도 승인 → **작업 시작**으로 단 하나의 dispatch → 영속 Run 생성 및 관찰 시작.

**완료 기준:** 선택 저장만으로 Run 0; 승인만으로 Run 0; 작업 시작 시 최대 1 Run. 이중 클릭/요청 재전송은 무해하거나 중복 차단. GOAL의 광범위 권한을 영구 상향하지 않음.

### J5. 진행·결과·QA·PM

Worker 작업 → 실제 Run 이벤트와 결과 캡처 → diff/수정 파일·테스트·Evidence 기록 → 독립 QA 실행/평가(결정적 검사 및 필요 시 의미 기반 검토) → PM이 ACCEPT / CHANGES_REQUESTED / HUMAN_GATE 판정.

**완료 기준:** 결과 도착 ≠ PASS. ACCEPT된 Task는 다음 화면에서 다시 검증 요청으로 노출되지 않음. 실패·불명확·증거 누락은 정확히 표시.

### J6. 대화·서비스 재진입

새 ChatGPT 대화에서 `현재 상태` 질문 또는 Widget 열기 → 기존 프로젝트/Task/Run 정본 읽기 → 승인, QA 및 결과 상태 복원. MCP 재시작·Worker 종료/재연결 시 STALE/ORPHAN 정확 표시.

**완료 기준:** 상태 오염·중복 실행 없음. 새 대화에서 Widget 미마운트는 현재 알려진 제한으로서 릴리스 게이트에서 별도 해결/검증.

## 5. 정보 구조 (IA)와 Widget UX

**첫 화면 설계 원칙:** 실행 폼이 아니라 **프로젝트 → 지금 목표(Goal) → Task 진행 목록 → 다음 행동** 순서. 현재 ACTIVE Goal과 다음 READY Task의 Goal이 다를 수 있음을 명시한다.

| 영역 | 기본 노출 | 눌렀을 때 | 데이터 출처 |
|---|---|---|---|
| 헤더 | 현재 프로젝트, 실행 호스트, 연결 상태 | 프로젝트 선택 | `get_project` / Profile |
| 목표 | 진행 목표 명칭, 상태, 관련 Task 수 | 해당 Goal의 Task 목록 | Goal 정본 + 연결 관계 |
| 요약 | 실제 작업 중 / 실행 준비 / QA / PM 검토 / 차단 | 필터된 Task 목록 | runtime-truth/Project dashboard |
| Task 리스트 | ID, 짧은 제목, 상태, 담당자, 다음 행동 | Task 상세 Drawer | Task + Run/Evidence |
| 내게 필요한 일 | 승인이 필요한 Task 또는 검토해야 할 Result | 권한 분리된 명시 작업 | eligibility + approval |
| 활동 | 최근 실제 이벤트, 실행자, 모델, QA 결과 | 타임라인/Evidence | persisted event/Run |
| 더보기 | 설정·진단·이력·기존 고급 화면 | 서브패널 | explicit diagnostics |

**Task 상세:** Goal 연결, Workspace/Scope, 완료 기준, Builder+Model, QA+Model/방법, Git baseline, Run 로그·diff·Evidence, 승인 버튼(요건 충족 시). 처음부터 모든 내용을 펼치지 않는다.

**디자인 수용:** 최소 320/380/540px+데스크톱; Light/Dark; 키보드·스크린리더; 긴 경로 전체 확인; 프로젝트 전환; 버튼 잘림/가로 넘침 없음. 색이나 캐릭터가 검증 상태를 대신하지 않는다.

**상태 라벨 규칙:** 사용자용 친숙한 표현은 `READY/PENDING`, `RESULT_RECEIVED/ACCEPTED`, `STALE/ORPHAN`의 복합 판정을 기반으로 생성하고 기술 원문은 상세 보기에서 접근 가능하게 한다.

## 6. MVP 기능 요구사항과 인수조건

| ID | 우선 | 요구사항 | 검증 가능한 인수조건 |
|---|---|---|---|
| F-01 | P0 | 프로젝트 선택과 격리 | 주 프로젝트 A↔B↔A 변경 시 목록/상태 섞임 0, 출처 불명 레거시 분리 |
| F-02 | P0 | 정본 Goal·Task 트리 및 현재 상황 | 특정 Task의 Goal ID/제목/완료 기준이 정본과 문자 단위 일치; 이전 ACCEPTED가 READY를 가리지 않음 |
| F-03 | P0 | ChatGPT PM의 Goal/Task 계획·저장 | 읽기→초안→사용자 저장 승인→정본 반영; 무승인 신규 생성 0 |
| F-04 | P0 | Agent/모델 자동 카탈로그 목록 | 선택 Agent의 신뢰 카탈로그 조회, auth·지원 범위 표시, 미지원 ID 차단, 자동 모델 선택 0 |
| F-05 | P0 | Task 단위 Builder 설정·Owner 승인·dispatch 분리 | 저장/승인/작업 시작 사이 Run 수 증가 0/0/1; 중복 0 |
| F-06 | P0 | QA Agent·모델/검증 계약 | Task 정본에 QA 선택/검증 기준 결합, Builder와 분리, 변경 시 승인 규칙 적용, 실패 시 무단 fallback 0 |
| F-07 | P0 | 작업 결과·Evidence·PM 판정 | Run-Task-Git diff-Evidence 추적; PM ACCEPT/CHANGES/HUMAN_GATE의 근거와 권한 확인 |
| F-08 | P0 | 세션·MCP 재시작 복구 | 기존 Task/Run/승인/판정 재조회, 상태 왜곡·중복 실행 0 |
| F-09 | P0 | Widget 없이 조회/지휘 가능 | Host Widget 미마운트 시에도 MCP Tool로 동일 정본 조회, 위험한 변경은 명시 승인 |
| F-10 | P1 | 관제 Widget UI 간결화 | 상단 Goal/Task/다음 행동, Activity와 Task 상세 분리, 프로젝트 범위 일치 |
| F-11 | P1 | 배포·연결 Doctor / 모델 인증 안내 | 실패 원인별 복구 안내, 비밀값 노출 0, tunnel/Host 상태 구분 |
| F-12 | P1 | 백업·복원·유지보수 지침 | 파일 데이터와 비밀·설치본 분리, 복구 시 Task/Run ID·Evidence 일치 |

**현재 구현 상태 [관찰/QA 보고 기반]:** F-01/02의 주요 Host 흐름, F-04/05의 Builder 선택 경로는 일부 검증됨. F-06 Task별 QA 모델 선택, F-08 새 대화 Host 정상 마운트, 전체 J3~J5 실제 E2E는 **완료 증거 부족**. 따라서 PRD의 항목이 기존에 모두 구현됐다고 가정하지 않는다.

## 7. 권한·상태·API 계약

| 행동 | 현재 원칙 | 안전 게이트 |
|---|---|---|
| Goal/Task 조회 | read-only | 프로젝트 범위·권한 확인 |
| Goal/Task 생성·수정 | 명시적 사용자 승인 | 초안 vs 영속 상태 구분·감사 로그 |
| Task Agent/Model 선택 | 자동 조회, 직접 선택 | 지원 목록·인증·스코프 검사 |
| 선택 저장 | 설정만 영속, 이전 승인 무효화 | READY·프로젝트 소속 일치 |
| 실행 승인 | 해당 Task·선택 조합에 한정 | 저장된 설정 존재, 변경 없음을 검증 |
| dispatch | 별도 Owner GO 효과, 단 한 번 | CAS/idempotency, Workspace·Worker·모델 재검증 |
| QA 평가·수정 요청 | 정본 QA 계약 우선 | 테스트/Evidence/QA Worker 바인딩 |
| PM ACCEPT | QA/Result 증거 확인 뒤 | Worker의 성공 주장만으로 ACCEPT 금지 |
| retry / recovery | 기록·기존 Run lineage 보존 | 최초 V1에서는 사람 승인 우선 **[제안]** |
| Archive / 삭제 / Git 배포 | 별도 Founder Gate | 안전 백업·범위 diff·Rollback |

**QA 결정을 요구하는 지점:** 현재 프로젝트 기본 QA Assignment 및 `qaContract.semantic.qaWorkerId`는 Task별 QA 모델 선택/승인을 완전히 대체하지 않는다. 실제 저장 포맷·승인 변경 규칙은 RB-02 계약 동결 시 별도 설계 승인을 받아야 한다.

## 8. 비기능 요구사항 (NFR)과 안전

- **NFR-01 정합성:** 읽기 모델/Widget/Task 상세의 Project/Goal/Task 식별자·상태 일치; 재조회 후 stale UI 미잔존.
- **NFR-02 보안:** least privilege, Host 확인 외 서버 재검증, 실행 가능한 Workspace allowlist, secret/키 로그 비노출, 구조화된 이벤트 감사.
- **NFR-03 신뢰성:** 중복 dispatch 0, 조용한 모델 전환 0, Run 실종 0, 장애는 STALE/ORPHAN/UNKNOWN으로 노출.
- **NFR-04 유지보수성:** MCP 도구/뷰 모델/Widget 렌더를 논리적으로 분리. 대량 파일 이동 전에 계약 테스트·빌드 참조 검사.
- **NFR-05 가용성:** Host Widget 실패 시 MCP Tool로 읽기/안전한 업무 연속; 서버 중단 시 마지막 정본 상태 보전.
- **NFR-06 개인정보/저장:** `DATA_ROOT`의 실제 프롬프트, Run log, Evidence와 Git repo 분리. 보존·삭제·복원 정책을 사용자용 문서로 제공.
- **NFR-07 설치 범위:** 단일 ASUS 설치 dogfood 범위에서 재시작·재연결·버전 호환성 재현. 타 플랫폼 출시 보증 금지.

**외부 구현 지침:** MCP 도구/데이터와 선택적 Widget 렌더 분리, UI 없이도 동작하는 도구, 최소 권한, UI 내부 비밀 데이터 비노출.

## 9. V1 출시 Gate (Founder의 승인과 별개)

| Gate | 내용 | Exit evidence |
|---|---|---|
| G0 | 제품 PRD·아키텍처 기준 확정 | Founder PRD ACCEPT, 범위/비목표/미결 항목 문서 |
| G1 | 코드/데이터 인벤토리 | 소스 경로·의존성·빌드·테스트·정본 지도, 모듈 분류 |
| G2 | MCP/Widget 최소 계약 | 권한·상태·렌더 일치, 320/380/540/키보드 Host QA |
| G3 | Task별 Builder/QA·모델 선택 | 모델 목록·바인딩·승인·실행 계약 안전 QA |
| G4 | 실사용 E2E | 기존 `TASK-0089` 1건 실제 코드 수정→Result→QA→PM 판정; 이후 서로 다른 Task 합계 3건 |
| G5 | 오류/복구 | 중복 요청·모델 미지원·Worker 죽음·MCP 재시작·새 채팅의 상태 복원 |
| G6 | 패키지/문서·보안 | README/Doctor/연결/백업/업데이트/secret 스캔/rollback 확인 |
| G7 | MCP-first V1 Release | 미해결 P0/P1 0, 필수 계약 테스트, 사용자 Host QA, Founder Release GO |

**알려진 미결:** 새 ChatGPT 대화에서의 Widget 마운트, `test:p2-c-chatgpt-connect`의 터널 클라이언트 환경 의존 실패(79/80로 보고됨), Task별 QA Agent/Model 저장·선택. 성능 SLO는 실제 기준 측정 뒤 확정한다. 환경 의존 실패를 완전 PASS로 세지 않는다.

## 10. WBS 및 실행 순서 (계획만)

| WBS | 작업 | 범위·산출 | 상태/권한 |
|---|---|---|---|
| RB-00 | MCP-first 방향 | 본 PRD의 DR-001 | **완료: 방향 승인** |
| RB-01 | 읽기 전용 전체 감사 | 인벤토리, build/runtime/test/data dependency, KEEP/UNKNOWN 증거 | 계획. Code mutate 금지 |
| RB-02 | PRD/QA/권한/Widget IA 계약 | 사용 흐름, 선택·승인·복구·실패 상태 | Founder 별도 PRD ACCEPT 필요 |
| RB-03 | Tool/Widget Core 리베이스라인 | 작은 리뷰 단위, 기능 변경 최소화 | Owner IMPLEMENT GO 필요 |
| RB-04 | 관제 우선 Widget UX | Goal/Task/Next action/활동/Task Drawer | Founder UX + Host QA |
| RB-05 | QA Agent/Model와 Builder 선택 완성 | Task별 QA 계약·실행 연결 및 검증 | Security/Owner GO |
| RB-06 | 실사용 E2E | TASK-0089·동일 Workspace·범위 diff·QA 판정 | OWNER ONE-RUN GO |
| RB-07 | 안정화 | Host 연속성, 장애복구, 중복방지, baseline 테스트 | Reliability gate |
| RB-08 | Archive/선별 정리 | 별도 보존 정책에 따른 단계별 이전 | FOUNDER ARCHIVE GO |
| RB-09 | V1 출시 | 배포 문서/실사용 검증/버전 태그 | FOUNDER RELEASE GO |

**중요:** RB-01 read-only와 RB-02 기획은 실행 승인 없이 수행 가능. RB-08에서 **소스 제거/이관은 RB-03 및 핵심 E2E 검증 후**. V1 출시 전 Archive의 실제 이전이 필수 조건은 아니다.

## 11. 수용·미결 기록

**지금 확정한 것:** `MCP + Widget 중심`, `GUI 동시 출시 제외`, `기존 Runtime 보존하며 재기획 우선`, `코드/Archive 실행은 미승인`.

**Founder 추가 결정 필요 [미결]:**

1. 단일 사용자+ASUS dogfood를 V1 출시의 공식 대상 범위로 확정할지.
2. Task별 QA Agent/Model을 모든 Task에 필수로 둘지, 결정적 검사 전용 Task는 QA 모델 없이 허용할지.
3. QA 실패 후 자동 재시도 허용 범위 (기본값 제안: V1은 Owner 승인 우선).
4. Widget의 작업 시작/승인 UI를 V1에 유지할지, 읽기 전용 관제 + ChatGPT 대화 승인에만 둘지(현재 구현은 Widget 동작 보존).
5. 아카이브 보존 시점과 별도 Private Repo 생성 승인, 실제 이관 권한.

**아직 승인되지 않은 작업:** Git commit/push, Task/Goal/Run 변경, Worker dispatch, MCP restart, Private 저장소 생성/접근권한 변경, Archive·이동·삭제, main merge, release.

---

### 참조

- 내부 v0.1: `Agent_Relay_MCP_First_Product_Rebaseline_v0.1.md`
- 원격: `https://github.com/ju0o/JuRelay/tree/ar/chatgpt-goal-relay`
- 기존 Runtime·모델 선택: `docs/P2-OWNER-R01-TASK-AGENT-MODEL-SELECTION.md`
- 현재 Widget: `src/mcp/app/pm-widget-resource.ts`
- OpenAI 공식: `https://developers.openai.com/plugins/build/chatgpt-ui`, `https://developers.openai.com/plugins/concepts/plugins`, `https://developers.openai.com/plugins/guides/security-privacy`

> **결정 경계:** 이 문서는 구현 지시서가 아니라 Founder의 다음 승인에 제출할 제품 요구사항 초안이다.