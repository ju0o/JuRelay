# Image Asset Harness (T1–T6)

Worker가 이미지/에셋이 필요할 때 Relay를 통해 구조화된 요청을 보내는 capability.
chat-mcp 하드 의존 없음 (provider-agnostic, backend-swappable).

## 구조

```text
Worker --relay_worker_request_asset--> Asset Request (Task 산하 sub-resource)
                                            | route (backend 선택)
                                            v
                                   AssetBackend.generate()
                                    (기본 asset-stub, 차후 교체)
                                            | 파일 기록
                                            v
                                   DELIVERED --> QA 파일검사 --> VERIFIED
```

## 파일

- `src/backend/asset-request.ts` — 상태머신·CAS·멱등·라우팅 (Task 상태 불변)
- `src/backend/asset-backend.ts` — 백엔드 인터페이스 + 레지스트리
- `src/backend/asset-stub.ts` — 결정적 stub 백엔드 (`asset-stub`)
- `src/backend/asset-verify.ts` — QA용 순수 파일 검사
- `src/backend/asset-presets.ts` — hero/og/thumbnail preset + 명명규칙
- `src/mcp/worker-tools.ts` — `relay_worker_request_asset`, `relay_worker_get_asset`
- `test/asset-request.test.mjs` (7), `test/asset-harness.test.mjs` (6)

## 상태

REQUESTED → ROUTED → GENERATING → DELIVERED | FAILED,
DELIVERED → VERIFIED | REWORK (→GENERATING, 3회 한도).

멱등: `AST-sha12(task|run|kind|path|prompt)` — 동일 요청은 기존 기록 반환.

## 보안

- output_path는 run workspace 하위로 강제 (탈출 거부).
- prompt 16 KiB 상한, count 1..4, aspect `W:H` 형식.
- 작업자는 자기 run의 에셋만 조회 (FORBIDDEN).
- 진짜 생성 백엔드(T7)는 별도 결정 필요 (API키=비밀 게이트).

## 롤백

신규 파일만 추가, 기존 경로 수정은 `worker-tools.ts` spread 2개뿐.
제거 시 위 7개 파일 + spread 삭제하면 됨. 마이그레이션 없음.
