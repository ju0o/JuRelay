import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isSelfReviewChain } from "../dist/server/shared/projectLabels.js";

const root = new URL("..", import.meta.url);
const read = file => readFile(new URL(file, root), "utf8");

test("shared project labels are not a built-in product list", async () => {
  const source = await read("src/shared/projectLabels.ts");
  assert.match(source, /export const PROJECT_LABELS: Record<string, ProjectLabel> = \{[\s\S]*jutell:\s*\{\s*name: 'JuTell',\s*goal: '짧고 쉬운 작업 보고서'/);
  for (const name of ["JuPlan", "JuCeipt", "통합 관제 화면", "JuCeipt 기획", "에이전트 릴레이", "주플랜", "주싯", "주컨트롤러"]) {
    assert.equal(source.includes(name), false, name);
  }
});

test("Control Room and Plan Studio consume the shared map and render goals separately", async () => {
  const [controlRoom, planStudio] = await Promise.all([read("src/frontend/controlRoom.tsx"), read("src/frontend/planStudio.tsx")]);
  for (const source of [controlRoom, planStudio]) {
    assert.match(source, /PROJECT_LABELS/);
    assert.doesNotMatch(source, /에이전트 릴레이|주플랜|주싯|주컨트롤러/);
  }
  assert.match(controlRoom, /<span>\{presentation\.name\}<\/span>[\s\S]*?<small[^>]*>\{presentation\.goal\}<\/small>/);
  assert.match(planStudio, />\{item\.name\}<\/button>/);
  assert.match(planStudio, /<p className="plan-goal">\{goalText\}<\/p>/);
});

test("QA editor blocks self-review by the first worker AI", async () => {
  const [labels, controlRoom] = await Promise.all([read("src/shared/projectLabels.ts"), read("src/frontend/controlRoom.tsx")]);
  assert.match(labels, /export function isSelfReviewChain\s*\(/);
  assert.match(controlRoom, /isSelfReviewChain/);
  assert.match(controlRoom, /workerChain/);
  assert.match(controlRoom, /만든 AI가 스스로 검수할 수 없어요\. 다른 AI를 첫 번째로 골라 주세요\./);
  assert.match(controlRoom, /disabled=\{[^}]*selfReview/);
});

test("isSelfReviewChain is true only when the first QA AI equals the first worker AI", () => {
  assert.equal(isSelfReviewChain(["codex", "opencode"], ["codex", "claude"]), true);
  assert.equal(isSelfReviewChain(["codex"], ["codex"]), true);
  assert.equal(isSelfReviewChain(["codex"], ["opencode"]), false);
  assert.equal(isSelfReviewChain(["codex", "claude"], ["claude", "codex"]), false);
  assert.equal(isSelfReviewChain([], ["codex"]), false);
  assert.equal(isSelfReviewChain(["codex"], []), false);
  assert.equal(isSelfReviewChain([], []), false);
});

test("QA editor save stays blocked while self-review is true, including submit re-check", async () => {
  const controlRoom = await read("src/frontend/controlRoom.tsx");
  // selfReview derives from the lane worker chain + the picked QA chain, QA role only.
  assert.match(controlRoom, /role === 'qa' \? isSelfReviewChain\(workerChain[^)]*picked\)/);
  // warning + disabled save are both gated on selfReview.
  assert.match(controlRoom, /\{selfReview && <p[^>]*>만든 AI가 스스로 검수할 수 없어요/);
  assert.match(controlRoom, /disabled=\{[^}]*selfReview/);
  // submit re-checks the same helper so a bypassed disabled button cannot save.
  assert.match(controlRoom, /async function submit\([\s\S]*?isSelfReviewChain\(workerChain[\s\S]*?picked\)[\s\S]*?return/);
  // real helper drives the same blocking decision the UI uses.
  const blocked = isSelfReviewChain(["codex"], ["codex", "claude"]);
  const allowed = isSelfReviewChain(["codex"], ["opencode", "codex"]);
  assert.equal(blocked, true);
  assert.equal(allowed, false);
});
