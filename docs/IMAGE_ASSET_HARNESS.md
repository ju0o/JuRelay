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

## T7: ChatGPT 경유 전달 (우리 MCP, API키 없음)

- `relay_pm_deliver_asset` (PM 도구): ChatGPT가 그림을 만들고 `{assetId, imageUrl}`
  전달 → Relay가 직접 다운로드·검증·기록. REQUESTED는 chatgpt 백엔드로 자동 라우팅.
- 보안: https 전용(loopback 제외), 호스트 allowlist(oaistatic/oaiusercontent +
  `AGENT_RELAY_ASSET_HOSTS` env 확장), 10MB 상한, PNG/JPG 매직 검사,
  workspace 하위 강제, CAS(GENERATING).
- `relay_pm_list_assets`: 상태 필터 조회 (읽기 전용).
- `src/backend/asset-chatgpt.ts` + `src/mcp/asset-tools.ts`
  (PM·App 양 표면에 등록). 테스트 `test/asset-chatgpt.test.mjs` (3 PASS).
- 프로덕션 (`mcp.relay-agent.site`)에 반영됨. 위젯에 에셋 요청 표시는 TODO.

## T8: 코드 렌더 백엔드 (자체 생성, AI-아트 제외)

- `code-render`: 작업자가 낸 인라인 SVG → headless Chrome 스크린샷 → PNG.
  다이어그램/OG/썸네일/아이콘은 Agent-Relay가 직접 만듦 (외부모델 불필요).
- `src/backend/asset-coderender.ts` + `svg` 필드(64KiB, `<svg>` 필수).
  치수는 preset 기준 (thumbnail 640x360 등).
- 사진풍 AI-아트는 여전히 외부 백엔드(ChatGPT 전달) 필요.
- 테스트 2개 PASS (실제 PNG·치수 검증).

## 보안

- output_path는 run workspace 하위로 강제 (탈출 거부).
- prompt 16 KiB 상한, count 1..4, aspect `W:H` 형식.
- 작업자는 자기 run의 에셋만 조회 (FORBIDDEN).
- 사진풍 생성은 ChatGPT 전달(T7) 경로로, API키 방식은 씀 (결정됨).

## 롤백

신규 파일만 추가, 기존 경로 수정은 `worker-tools.ts` spread 2개뿐.
제거 시 위 7개 파일 + spread 삭제하면 됨. 마이그레이션 없음.
