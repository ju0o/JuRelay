# JuRelay — Founder decisions / source of truth

**Date:** 2026-10-18  
**Decision status:** Product direction and workflow PRINCIPLES APPROVED; implementation, data migration, archiving, release, and production execution NOT APPROVED.  
**Product name:** **JuRelay** (not "Agent Relay"). GitHub repository: `ju0o/JuRelay`.

## 1. Identity and separation
- **JuRelay** makes **ChatGPT the project PM**, with an MCP bridge and a WBS/Goal/Task monitoring Widget. It connects the conversation's approved plan to local Worker/QA runs and returns results to ChatGPT for the final Task judgment.
- **JuCrew** is a different CLI multi-agent harness; JuRelay V1 must work without JuCrew. Optional future adapter only; do not duplicate JuCrew's orchestration.
- Users supply their own ChatGPT/CLI model accounts or local models. Self-hosted source is free; "all AI usage is free" is NOT a product claim.

## 2. Approved user flow (MCP-first)
1. User plans a project conversationally with ChatGPT.
2. ChatGPT PM assembles PRD, a WBS, functional Goal/Task drafts and clear acceptance criteria **from the context actually available to the conversation**. The MCP server cannot automatically read the user's entire ChatGPT chat history.
3. User reviews/confirms the plan before canonical Goal/Task persistence.
4. Widget opens for project/workspace, Builder, QA, and respective model selection. Models are enumerated from a trusted catalog; selecting a list entry NEVER silently saves or executes anything.
5. Task selection/save, per-Task explicit execution approval, and one-time dispatch remain distinct.
6. Worker produces an evidence-bearing Result for a **functional Task**.
7. QA performs independent first-pass verification. QA FAIL loops back to the **same Task's Worker** (new Run + QA Attempt; history preserved) within an explicit retry budget. **Ordinary final-review PM Delivery MUST NOT be created for each QA FAIL.**
8. **Only QA PASS** creates the **normal** final-review PM Delivery. JuRelay durably queues the result, attempts to wake the active ChatGPT PM via MCP/Widget, and the PM retrieves canonical Result/diff/Evidence for judgment.
9. **Only ChatGPT PM** chooses ACCEPT or CHANGES for the Task. ACCEPT marks the Task accepted and makes eligible successors READY; CHANGES reopens the **same Task**, and its next Worker result must pass QA again.
10. The next Task does NOT auto-dispatch by default: each new Task needs the approved execution contract and an explicit Owner GO. Widget only visualizes durable runtime truth, plus narrowly gated setup controls.

**Exceptions:** retry budget exhaustion, QA BLOCKED, failed Worker launch, lost auth, or wake/transport errors are incident/human gates, **not QA PASS and not ordinary PM final-review delivery**. Preserve evidence; do not silently invent a success or loop indefinitely. Specific alert channels and default retry budget remain to be finalized before implementation.

## 3. Functional WBS / Task sizing
- WBS is the product's **Goal → feature-level Task → Worker Runs / QA Attempts** view.
- A Task represents a user-recognizable, independently testable feature or cohesive vertical slice (UI + backend + error handling + tests where relevant). Avoid per-file/per-button micro-Tasks.
- Split when the scope/permissions are too broad, acceptance is ambiguous, or a feature cannot be tested independently.
- Worker/QA iterations remain within one Task; no new Task for each correction.

## 4. Technical truth and known mismatches
- Preserve the canonical kernels in `src/backend/` (Goal/Task, dispatcher, QA, Result, PM Delivery/Wake/Judgment) and `src/mcp/`; this is **not** permission to refactor or delete them now.
- `src/backend/qa-gate.ts`: current behavior can escalate budget-exhausted FAIL/BLOCKED into ordinary PM Delivery. That conflicts with §2; introduce a **separate incident/human gate** without fake QA PASS.
- `src/backend/result-bridge.ts`: older Tasks without `qaContract` may bypass QA. Require QA for newly created JuRelay V1 Tasks; preserve old historical Tasks without rewriting their data.
- `src/backend/execution-plan-continuation.ts` can dispatch successor automatically; compare against per-Task GO before enabling any future continuation.
- `src/backend/auto-advance.ts` has a separate outcome policy; reconcile it with the single QA retry/incident policy.
- `src/backend/goal-planner.ts` uses separate Codex planning. The agreed V1 PM is the **ChatGPT conversation**; do not silently substitute another PM.
- `src/mcp/app/pm-widget-resource.ts` combines UI/controller code; modularize only after workflow contracts are pinned.
- Widget wake is host-dependent; offline/closed ChatGPT conversation wake cannot be promised. Durable Inbox + resume is mandatory.

## 5. Naming and source compatibility
- Product copy, documentation, future onboarding and release identity: **JuRelay**.
- Old literal references `Agent Relay`, `agent-relay`, `AGENT_RELAY_*`, MCP tool names and storage paths may be historical **protocol identifiers**. Do **not** bulk-rename them before a compatibility/migration plan and test evidence.
- Prior planning docs in `docs/rebaseline/reference/` are historical drafts, not the latest approved behavior. Specific feature contracts and legacy implementation docs remain evidence but cannot override §2.
- Code in existing public Git history remains public even if later archived to private.

## 6. Change control / permission gates
- This rebaseline is **documentation-only**. No code changes, schema/data migration, auto dispatch, Goal/Task creation, new Private archive, deletions, main merge, or public release is authorized by it.
- Each implementation slice requires explicit Founder GO and independently reviewable diff/tests/Host QA where needed.
- First engineering work after authorization: read-only dependency/contract trace; then isolate and fix the three P0 policy conflicts (QA delivery gating, missing QA contract, successor auto-dispatch) with focused regression tests.
- Existing Task-0089 / GOAL-0026 and their history must remain unchanged absent a separate explicit Owner instruction.

## 7. Definition of done for V1
- A feature-sized Task is created from a reviewed ChatGPT WBS.
- User selects workspace, Builder + model, QA + model, and explicitly approves initial run.
- Worker → QA FAIL → same Worker retry → QA PASS, with **no ordinary PM review on FAIL**.
- Exactly one durable final-review Delivery is handled by ChatGPT PM; PM CHANGES runs through QA again; PM ACCEPT is the only terminal acceptance.
- Next Task is READY, **not automatically started**.
- Runtime restart, ChatGPT remount/re-entry, idempotent delivery, no duplicate dispatch, no cross-project leakage, error recovery and installer/OSS onboarding are tested.
- QA BLOCKED/budget-exhausted cases produce safe incidents rather than fake ACCEPT or infinite retries.

See [Architecture v0.4](./JuRelay_Engine_Rebaseline_v0.4_Architecture.md) and [Document index](./README.md).
