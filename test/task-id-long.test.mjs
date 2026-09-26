import assert from 'node:assert/strict';
import test from 'node:test';
import { TASK_ID_PATTERN } from '../dist/server/backend/controlRoom.js';

test('long redesigned task ids (…-R2) are accepted, junk is not', () => {
  assert.ok(TASK_ID_PATTERN.test('JUTELL-SCENARIO-10-2-INTERNAL-CHANGE-CHECKS-R2'));
  assert.ok(!TASK_ID_PATTERN.test('bad id; rm -rf'));
  assert.ok(!TASK_ID_PATTERN.test('A'.repeat(120)));
});
