# Agent Relay — 코드 분류·Private Archive·보존 정책 v0.1

**기준일:** 2026-10-18  
**상태:** `POLICY_DRAFT / READ_ONLY / NO_ARCHIVE_AUTHORIZATION`  
**상위 결정:** Agent Relay V1 = MCP + Widget first (`DR-001 FOUNDER_APPROVED`).  
**기준 저장소:** Public `ju0o/JuRelay`; `main` `1127c96ca4dc370dc3e69346f92fa707ffd964cd`; 개발 `ar/chatgpt-goal-relay` `b9473f5438f7e4ec2b4679b6e148d516de45eb76`.

## 1. 왜 정리하는가

목표는 무조건 코드 수를 줄이는 게 아니다. 제품 역할이 달라진 만큼 **V1 핵심 경로의 의존성과 신뢰 경계를 명확하게 만들고, 사용하지 않는 UI/실험 자산을 복구 가능하게 보존**한다.

- 코드가 크다는 이유만으로 dirty가 아니다.
- 구형 기능이라도 V1이 import/빌드/실행/복구에 의존하면 삭제 불가.
- 실제 사용자 데이터, 인증 파일, Git 소스는 **서로 다른 자산**이다.
- 아카이빙은 디렉터리 이동보다 먼저 **증거·서명·복원 가능성**이 필요하다.

## 2. 단계별 분류 체계

| Classification | 의미 | 기본 조치 | 이동·삭제 가능 여부 |
|---|---|---|---|
| `KEEP_CORE` | 현재 Runtime/SSOT/권한/QA/MCP 필수 경로 | 수정 없이 우선 보존, 계약 테스트 고정 | 원칙상 NO |
| `REFACTOR_IN_PLACE` | V1에 필요하지만 파일이 비대·역할 혼재 | 동일 동작 보장하며 작게 분리 | 코어 검증·승인 후 가능 |
| `DEFER_PRESERVE` | 차기 GUI/TUI 등에 필요한 자산, V1 출시 핵심은 아님 | 기존 브랜치에서 보존, 빌드 분리 계획 | 즉시 삭제 NO |
| `ARCHIVE_CANDIDATE` | 사용되지 않는 것으로 증명된 레거시 실험·프로토타입 | Archive manifest 작성, 출처·복원 검증 | Founder Gate 후 YES |
| `DELETE_CANDIDATE` | 재생성 가능하며 불필요함이 증명된 생성물/중복 | 제외/정리 계획, diff 제시 | 별도 삭제 승인 후 YES |
| `UNKNOWN_HOLD` | 참조·실행 여부 모름, 혼재 | 추가 감사 | NO |
| `SENSITIVE_EXCLUDE` | 비밀키·인증·실사용 데이터·개인정보 등 | Git 반입 금지, 접근 권한/별도 백업 | **Private Git에도 반입 금지** |

**정리 규칙:** 단 하나의 경로가 Runtime에서 참조될 가능성이 남으면 `UNKNOWN_HOLD` 또는 `KEEP_CORE`로 유지. 파일명·설명만으로 `ARCHIVE_CANDIDATE` 확정 불가.

## 3. 현재 모듈별 사전 분류 (수정 권한 없음)

| 경로/자산 예시 | 임시 분류 | 근거·다음 확인 |
|---|---|---|
| `src/backend/goal-task.ts`, `task-execution-config.ts`, `runtime-truth.ts` | `KEEP_CORE` | Project/Goal/Task와 실행 설정·상태 정본 |
| `src/backend/dispatcher.ts`, `v1-dispatch.ts`, `qa-gate.ts`, `qa-contract.ts` | `KEEP_CORE` | Run/QA/권한과 최종 판정의 신뢰 경로 |
| `src/mcp/`, `src/mcp/app-server.ts`, MCP Tool | `KEEP_CORE` | MCP-first 제품의 인터페이스 |
| `src/mcp/app/pm-widget-resource.ts` | `REFACTOR_IN_PLACE` | HTML/CSS/JS·호출이 한 파일에 혼재, 동작 변경 없이 분리 후보 |
| `src/backend/agent-model-catalog.ts`, Worker adapters | `KEEP_CORE` | 실제 모델 조회·선택/실행 연결 |
| `src/frontend/`, `src/backend/main.ts`, `electron.builder.yml` | `DEFER_PRESERVE` **임시** | Electron 화면·패키지 보존; 공통 Runtime 의존성 확인 전 삭제 불가 |
| `src/tui/` 및 TUI CLI | `DEFER_PRESERVE` **임시** | 디버깅·복구 fallback 가능성, 실제 사용·테스트 영향 조사 |
| `docs/prototypes/`, 옛 디자인 시안 | `ARCHIVE_CANDIDATE` **초기 후보** | 문서/자산 참조·런타임 포함 여부 확인 필요 |
| 오래된 설치/패키징 스크립트 | `UNKNOWN_HOLD` | 현재 호스트 배포/설치/복구 의존성 추적 전 이동 금지 |
| `test/`, `docs/quality/`, 근거·인증 보고서 | `KEEP_CORE` 또는 `UNKNOWN_HOLD` | 회귀 근거/감사 체인을 함부로 제거 불가 |
| `.agent-relay/`, DATA_ROOT, `.env`, 개인 로그/키 | `SENSITIVE_EXCLUDE` 후보 | 실제 위치와 민감성 감사 후 Git 반입 금지 |

위 표는 **인벤토리 기반 임시 판단**이지, 파일별 import 그래프나 실호출 감사가 완료됐다는 주장이 아니다.

## 4. 파일별 Audit Manifest 요구사항

반드시 다음 필드를 한 행에 남긴다.

| 필드 | 뜻 |
|---|---|
| `path`, `blob_sha` | Git 정본 상대 경로·파일 식별자 |
| `branch_sha` | 읽은 커밋 기준 |
| `current_surface` | MCP / Runtime / Electron / CLI / TUI / Docs / Test / Data |
| `runtime_importers` | 실제 import/require/dynamic import/IPC/MCP/CLI 참조 목록 |
| `build_and_package_refs` | package scripts, tsconfig, bundler, installer, CI, service의 참조 |
| `test_refs` | 해당 파일의 테스트 및 회귀 커버리지 |
| `data_contract_refs` | 저장 파일·schema·ID·migration·recovery 영향 |
| `security_class` | Public code / Internal / Sensitive Exclude |
| `decision`, `confidence` | 분류 및 증거 수준 |
| `reason`, `evidence_paths` | 근거와 반례 |
| `replacement_or_restore` | 대체 경로·복원 명령/절차 |
| `owner_approval`, `date` | 승인과 실제 처리 이력 |

**READ_ONLY 감사 체크:** `git status`, tracked/untracked, import/ref 검색, dynamic import/CLI invocations, package scripts, TS server/client include, Vite/Electron packaging, service launch files, WorkerRegistry, external scripts, local metadata, GitHub Actions, test fixtures, DATA_ROOT, Host smoke. 다이내믹 참조는 단순 ripgrep 0건으로 미사용을 증명할 수 없다.

## 5. 보관 위치와 Git 정책

### Source repository

- 기존 Public `ju0o/JuRelay`은 그대로 유지하며 `main`과 개발 브랜치를 변경하지 않는다.
- Archive 대상 확정 전에는 **원격/로컬 전체 소스의 SHA·의존 참조·테스트 기준**을 먼저 남긴다.
- `archive/<date>-<purpose>` 태그/브랜치 생성도 Git 변경이므로 Founder 승인 전 금지.

### Private Archive repository (미생성, 가칭 `JuRelay-Archive`)

- 목적: 옛 GUI/TUI/프로토타입의 **검수된 소스 스냅샷과 보존 문서**. Private Repo 생성은 별도 Founder 승인 필요.
- 권장 1차 형태: **정리된 선택적 Snapshot + manifest + Restore Guide**. 전체 Git 미러는 유출된 히스토리·비밀정보·용량 영향 감사를 통과한 경우에만 고려.
- Public이었던 커밋을 Private에 복제해도 Public 히스토리, 포크, 이전 배포물에서 없어지지 않는다. 민감 데이터가 과거 Public에 있었다면 별도 보안 사고 대응.
- `main` force-push, 히스토리 덮어쓰기, Release 제거는 Archive 작업과 자동으로 묶지 않는다.
- 보존 Repo ACL: 최소 권한, 승인된 Maintainer만 쓰기, 불필요한 Collaborator 없음. 공개 전환 금지, 동작 로그 및 접근 권한 점검.

### Runtime/data backup (Git 아카이브와 분리)

- Workspace 소스, Runtime `DATA_ROOT`, 앱 설정, Worker 런타임 메타, Secret Store는 **각각 별도 보존 경로와 접근 정책**을 가진다.
- 실제 프로젝트 사용자 데이터/프롬프트/실행 로그/스크린샷/결과 Evidence에 개인·영업정보가 포함될 수 있으므로 GitHub Private에도 기본 금지.
- Secret은 Git Backup 대상이 아니라 별도 비밀 저장소·복구 절차 대상이다. 토큰을 문서나 테스트 로그로 출력하지 않는다.
- Backup 복원 검사는 **새 격리된 임시 환경**에서 수행하고, Production 덮어쓰기 금지.

## 6. 반입 금지 및 보안 선별

**원칙적 제외 예시:**

`node_modules/`, `dist/`, `build artifact`, `.env*`, `*.pem`, `*.key`, `id_rsa*`, `secrets/`, GitHub tokens/SSH keys, OAuth credential cache, Tunnel runtime key, live `.agent-relay/`, `DATA_ROOT/`, 사용자 대화 원문·로그·PII, Windows userData, 민감 화면 캡처, 임의 DB 백업.

※ 모든 `.json`/`.log`/`.png`가 무조건 비밀은 아니므로 확정 판정은 파일 내용을 안전하게 검사해야 한다. 부득이 보존이 필요한 실데이터는 Git 대신 암호화된 독립 매체·제한된 접근권한으로 관리.

**보안 검사:** 패턴 기반 secret scanning + 파일 위치 규칙 + 실제 공개 범위 검토. 의심 파일의 비밀값을 PM 보고에 복사하지 않는다. 발견 즉시 ARCHIVE STOP, 필요한 경우 키 폐기/재발급은 별도 Owner 승인.

## 7. Archive 준비와 실행 게이트

| Gate | 동작 | 출구 조건 | 승인 |
|---|---|---|---|
| A0 | READ_ONLY repo 및 Runtime 인벤토리 | 기준 HEAD/branch/status/파일 수, 미등록 파일, 의존성 지도 | 읽기 전용 |
| A1 | 분류 초안/민감성 감사 | 파일별 manifest, UNKNOWN 목록, 위험 평가 | PM 검토 |
| A2 | 보존 스냅샷·Restore Plan | 원본 SHA-256 manifest, 복구 절차, Test Plan, Private 정책 | Founder ARCHIVE PLAN GO |
| A3 | Archive Repo 생성·검수된 Snapshot 복제 | Private ACL 확인, 민감 제외, 리포트/링크 | **Founder CREATE/UPLOAD GO** |
| A4 | 격리 Restore Drill | checkout+빌드+핵심 Runtime/API smoke, 비교 Evidence | PM + Founder 검수 |
| A5 | 선택적 소스 분리·제거 | 이전 단계 PASS, 영향 테스트+Host QA, diff/rollback | **Founder REMOVE/MIGRATE GO**, 항목별 |
| A6 | Release/README 정리 | MCP-first 설명과 실제 제품·아카이브 링크 일치 | Founder release GO |

**순서:** A0/A1은 READ_ONLY로 진행 가능. A2 문서만 작성 가능하나 스냅샷 생성·태그·서버 Git 변경은 승인 후. A5는 핵심 MCP-first E2E 인증 후에만 검토한다.

## 8. 실제 삭제/이관을 허용하는 최소 증거

하나라도 없으면 `ARCHIVE_CANDIDATE`→`ARCHIVED` 또는 `DELETED`로 승격 금지:

1. **코드 근거:** import/CLI/IPC/MCP/service/config/CI/packaging 참조 제거 또는 안전한 대체 경로 확인.
2. **데이터 근거:** 정본 schema/Goal/Task/Run/Evidence/IDs에 영향 없거나 호환 마이그레이션·복원 증명.
3. **테스트 근거:** 변경 전 baseline, 변경 후 mandatory/도구 계약/Host 주요 흐름 비교, 알려진 실패 개별 표기.
4. **보관 근거:** Snapshot 파일 해시, 출처 SHA, Private Repo 권한, Restore Drill 통과.
5. **운영 근거:** MCP 기동/연결, Worker/QA, Widget 호출, 프로젝트 A↔B 스코프 유지.
6. **사람 근거:** 영향 목록과 제거/롤백 절차를 Founder가 개별 승인.

예외적으로 임시 생성물 정리는 Founder 승인 하에 별도 작은 묶음으로 처리할 수 있지만, 정본/로그의 보존기간과 장애 분석 의존성은 먼저 확인한다.

## 9. 의사결정 예시와 금지 패턴

- **예:** `pm-widget-resource.ts`가 길어 가독성이 나쁨 → `REFACTOR_IN_PLACE`, Widget 렌더/Tool binding을 안전하게 쪼개되 MCP Tool 계약 보존.
- **예:** UI 프로토타입이 런타임 미참조로 증명됨 → 스냅샷 준비 → `ARCHIVE_CANDIDATE` → Founder 업로드 승인 → 복원 시험 후 Public에서 제거 검토.
- **아니오:** Electron이 당장 V1 출시에 필수 아님 → `src/backend/`의 공통 Node 코드까지 지우기.
- **아니오:** `main`에 오래된 UI가 남음 → Git 히스토리 재작성/force push.
- **아니오:** Private Repo니까 로그/비밀키/개인 데이터 저장해도 됨.
- **아니오:** 테스트 79/80인데 전체 PASS로 표시하거나 Baseline Fail을 숨기기.

## 10. 결과물 템플릿

Archive Manifest (별도 CSV): `path,source_branch_sha,blob_sha,current_surface,runtime_importers,build_and_package_refs,test_refs,data_contract_refs,security_class,decision,confidence,reason,evidence_paths,replacement_or_restore,owner_approval,date`

Archive snapshot 내부 추천 구조(승인 후 적용):

```text
JuRelay-Archive/ (아직 존재하지 않음)
  README.md                     # 목적·범위·찾는 법·정본 위치
  manifests/<snapshot-id>.csv   # SHA/출처·분류·암호화 제외 기록
  snapshots/<snapshot-id>/      # 선별 승인된 소스·문서
  restore/<snapshot-id>.md      # 격리 복원 드릴
  decisions/<date>.md           # Founder 승인/결과
```

## 11. 이번 턴의 작업 경계

**수행:** v0.1과 원격 구조 조사, 정책/manifest 초안 작성.  
**수행하지 않음:** 소스·Git 변경, Private Repo 생성, 데이터 백업/복사, Archive/삭제, Workspace 이동, Task 실행, MCP restart, main merge/release.

---

### 관련 자료

- `Agent_Relay_MCP_First_PRD_v0.2_Decision_Draft.md`
- `Agent_Relay_MCP_First_Product_Rebaseline_v0.1.md`
- `https://github.com/ju0o/JuRelay`
- `https://developers.openai.com/plugins/build/chatgpt-ui`
- `https://developers.openai.com/plugins/guides/security-privacy`