/* Headless capture flag — pure helper tests (compiled shared module). */
import assert from "node:assert/strict";
import test from "node:test";
import { parseCapturePath } from "../dist/server/shared/capture.js";

test("parseCapturePath — valid absolute .png path", () => {
  assert.equal(parseCapturePath(["--capture=/tmp/a.png"]), "/tmp/a.png");
  assert.equal(parseCapturePath(["x", "--view=home", "--capture=/tmp/A.PNG"]), "/tmp/A.PNG");
});

test("parseCapturePath — missing/relative/non-png/empty is ignored", () => {
  assert.equal(parseCapturePath([]), "");
  assert.equal(parseCapturePath(["--capture="]), "");
  assert.equal(parseCapturePath(["--capture=a.png"]), "");
  assert.equal(parseCapturePath(["--capture=./a.png"]), "");
  assert.equal(parseCapturePath(["--capture=/tmp/a.jpg"]), "");
  assert.equal(parseCapturePath(["--capture=/tmp/a.png.txt"]), "");
  assert.equal(parseCapturePath(["--capture=/tmp/a\0.png"]), "");
});

test("parseCapturePath — last flag wins", () => {
  assert.equal(parseCapturePath(["--capture=/a.png", "--capture=/b.png"]), "/b.png");
  assert.equal(parseCapturePath(["--capture=/a.png", "--capture=bad"]), "");
});
