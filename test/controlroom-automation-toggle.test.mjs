import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

test("control room screen has an automation toggle, its three ops, and the status label", async () => {
  const source = await read("src/frontend/controlRoom.tsx");
  assert.match(source, /function AutomationToggle\(/);
  assert.match(source, /<AutomationToggle \/>/);
  assert.match(source, /automationEnabledFromStatus\(status\)/);
  assert.match(source, /automationToggleOp\(enabled\)/);
  assert.match(source, /automationToggleLabel\(enabled, phase\)/);
  assert.match(source, /automationResultText\(op\)/);
  assert.match(source, /must\(\{ op: 'controlRoom:automationStatus' \}\)/);
  assert.match(source, /must\(\{ op: 'controlRoom:automationOn' \}\)/);
  assert.match(source, /must\(\{ op: 'controlRoom:automationOff' \}\)/);
});
