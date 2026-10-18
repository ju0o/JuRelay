# JuRelay — instructions for contributors and coding agents

**Product name: JuRelay.** `Agent Relay` is the former product name used in historic notes and current technical identifiers. The repo is `ju0o/JuRelay`. Do not treat JuRelay and JuCrew as the same product.

## Canonical start here

1. Read [docs/rebaseline/README.md](docs/rebaseline/README.md).
2. Read [Founder-approved decisions (2026-10-18)](docs/rebaseline/JURELAY-FOUNDER-DECISIONS-2026-10-18.md).
3. Read [MCP-first engine architecture v0.4](docs/rebaseline/JuRelay_Engine_Rebaseline_v0.4_Architecture.md).

The latest Founder decisions override conflicting previous **planning proposals**; this does not automatically modify persisted Goal/Task records, existing certified code contracts, or release policy.

## Current product contract

- ChatGPT is the **only PM** and **only final Task ACCEPT authority**.
- User plans in ChatGPT; ChatGPT drafts **functional (not micro-sized)** WBS/Goal/Task contracts and asks for approval before persisting.
- User explicitly selects project folder, Builder+model and QA+model. Selection save, Task approval, dispatch are distinct.
- Worker → QA first-pass. **QA FAIL → same Task Worker retry**, bounded, with Run+QA Attempt history preserved; **no normal PM final-review delivery on QA FAIL**.
- **QA PASS → durable PM Delivery → Host-dependent ChatGPT Wake attempt → ChatGPT PM ACCEPT or CHANGES.**
- PM CHANGES → same Task's Worker→QA loop; PM ACCEPT → successor becomes READY. **No automatic next Task dispatch without separately approved policy.**
- QA BLOCKED/budget exhausted → safe Incident/Human Gate, not synthetic QA PASS/ACCEPT.
- Widget shows Project, Goal, WBS, Task, Worker/QA progress and Inbox; it does not decide acceptance or silently execute.
- JuCrew is a separate CLI orchestration harness, optional future Worker adapter only.
- Free self-hosted software; model and ChatGPT usage belongs to the user.

## Safety and scope

- This documentation push is **not approval to implement**. No files under `src/` or `test/` should be changed until explicit Owner GO.
- Never auto-create/alter Goal/Task/Run records, save Agent/model selections, change workspace assignment, dispatch Worker, archive/delete source, create private repos, merge `main`, or release on the strength of this document alone.
- Avoid global renames of `AGENT_RELAY_*`, `agent-relay`, MCP tool names, data-root paths, CLI names or historical URLs: protocol and storage compatibility need a separate migration.
- Preserve existing work/evidence; fail closed on inconsistent identity, unauthorized execution or missing QA contracts.
- Prefer read-only dependency trace, evidence-backed implementation slices and focused regression tests. Each implementation slice needs independent Founder GO.

## Verified implementation gaps (not yet solved)

1. `src/backend/qa-gate.ts` may generate ordinary PM Delivery for QA FAIL budget exhaustion or BLOCKED; split normal PM review from incidents.
2. `src/backend/result-bridge.ts` bypasses QA for old Tasks lacking contracts. New JuRelay V1 Tasks must be QA-gated; grandfather existing records explicitly.
3. `src/backend/execution-plan-continuation.ts` can auto-dispatch successors; gate against per-Task Owner approval.
4. `src/backend/auto-advance.ts` has overlapping policy for retries/advance; audit actual callers.
5. `src/backend/goal-planner.ts` uses a separate Codex PM plan draft; V1 planning identity is the **ChatGPT conversation**.
6. PM wake is host-dependent; durable inbox and reconnect must work even when chat/widget is closed.
7. Per-Task QA Agent/model choice, functional WBS import/versioning, end-to-end behavior and GUI/Widget simplification remain not fully verified.

**Release status:** MCP-first direction APPROVED, implementation and archive actions HOLD.