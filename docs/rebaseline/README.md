# JuRelay — MCP-first documentation index

**Official product name:** **JuRelay** · **GitHub:** [ju0o/JuRelay](https://github.com/ju0o/JuRelay) · **as of:** 2026-10-18

**Product identity:** Make **ChatGPT the project PM** for functional Goal/WBS/Task planning, Worker delivery, QA-first verification, and the **only final Task ACCEPT**. The MCP bridge supplies durable state, dispatch/approval controls, result delivery and wake attempts; the Widget is a WBS progress monitor, not an alternate PM or orchestration authority. **JuCrew is a separate CLI harness.**

## Read these in order

1. **[Founder decisions / canonical V1 policy](./JURELAY-FOUNDER-DECISIONS-2026-10-18.md)** — latest approved name, role split, QA FAIL loop, PM PASS gate, function-level Task size, safety boundaries, contradictions to resolve. **Read first; approved product behavior supersedes old planning drafts.**
2. [Engine architecture v0.4 (two Mermaid diagrams)](./JuRelay_Engine_Rebaseline_v0.4_Architecture.md) — intended modules, decision path, risks, phased refactor. Architecture design, not proof of shipped E2E.
3. [Product PRD v0.2 — historical decision draft](./reference/Agent_Relay_MCP_First_PRD_v0.2_Decision_Draft.md) — pre-final role and workflow proposal; **some QA policy statements may be superseded by #1**.
4. [MCP-first operations blueprint v0.3 — historical draft](./reference/Agent_Relay_MCP_First_Operations_Blueprint_v0.3.md) — self-hosted operation, free software/user-owned model fees and limitations.
5. [Product rebaseline v0.1 — historical draft](./reference/Agent_Relay_MCP_First_Product_Rebaseline_v0.1.md) — initial GUI→MCP reorientation.
6. [Archive & retention policy v0.1 — proposed only](./reference/Agent_Relay_Code_Archive_Retention_Policy_v0.1.md) and [audit manifest template](./reference/Agent_Relay_Code_Audit_Manifest_Template_v0.1.csv).

## Important status / gates

- **Direction approved:** ChatGPT PM first, JuRelay MCP+Widget, functional Tasks, QA FAIL→same Worker, QA PASS→ChatGPT PM for final judgment.
- **NOT approved:** production code modification, refactor, renaming protocol IDs or folders, Goal/Task state changes, Worker dispatch, archive transfer/deletion, Private repo creation, or merge/release.
- **Current code is NOT yet certified for the new workflow.** In particular, review `qa-gate.ts`, `result-bridge.ts`, `auto-advance.ts`, `execution-plan-continuation.ts`, `goal-planner.ts`, and PM Wake resume. Design decisions may differ from legacy implementation.
- **Older code names are compatibility identifiers:** `Agent Relay` in existing README, `agent-relay` in binaries, protocol/tool IDs and paths must not be mass-renamed without a migration.
- **Do not invent Host QA success or model usage being free.** Users pay/use their own model credentials; ChatGPT connectivity depends on user/client support.

## Next work: planning gate or implementation?

Only two short gates remain before coding; do not start another open-ended PRD rewrite:

**GATE A — Contract freeze (Founder approval):** confirm retry budget and incident notification on exhausted QA, per-Task or batch continuation permissions, WBS import/versioning, and Task-level QA/model selection. The default shown in #1 is fail-closed, per-Task GO, no next auto-run.

**GATE B — Read-only dependency trace:** enumerate every direct/indirect call site that can mint normal PM Delivery, dispatch successor, bypass QA or select a planning LLM. Baseline tests; classify which live path can be changed without breaking certified legacy paths.

After explicit Owner GO, implement small, independent slices:
- SLICE-01: QA PASS-only ordinary PM Delivery + separate QA_BLOCKED incident, with crash/restart tests.
- SLICE-02: require QA for new JuRelay Tasks; task-specific QA Agent+model selection and consistent snapshots.
- SLICE-03: ChatGPT-authored functional WBS approved into canonical Goal/Task (never auto save the full conversation).
- SLICE-04: PM ACCEPT→next READY only; PM CHANGES→same Task retry after QA; safe wake/re-entry E2E.
- SLICE-05: reorganize Widget into Goal/WBS/Task observability, with minimal gated setup.
- SLICE-06: packaging, MIT license/third-party review, local install/doctor/onboarding, OSS V1.
- Any archive/private migration is separate, later, and requires its own authorization and rollback proof.

**Other legacy docs** in `docs/` are retained as historical implementation and certification evidence; their dates do not make them overriding product decisions. This index and the Founder decisions above establish the current direction only.