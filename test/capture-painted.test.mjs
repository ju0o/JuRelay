/* Capture painted-frame decision — pure helper tests (compiled shared module). */
import assert from "node:assert/strict";
import test from "node:test";
import { captureLoadingError } from "../dist/server/shared/capture.js";

test("captureLoadingError — loading text means the capture is not ok", () => {
  assert.notEqual(captureLoadingError("설정을 불러오는 중…"), "");
  assert.notEqual(captureLoadingError("관제실\n데이터를 불러오는 중"), "");
});

test("captureLoadingError — fully painted page is ok", () => {
  assert.equal(captureLoadingError("관제실\n지금 하실 일은 없어요."), "");
  assert.equal(captureLoadingError(""), "");
});
