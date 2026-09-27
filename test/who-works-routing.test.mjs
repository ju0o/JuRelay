import assert from 'node:assert/strict';
import test from 'node:test';
import { controlRoomWorkingRows } from '../dist/server/shared/types.js';

test('working rows use worker for worker stages and Korean task title', () => {
  assert.deepEqual(controlRoomWorkingRows([
    { project: 'agent-relay', current: { stage: 2, title: '라우팅 고치기' }, workerChain: ['opencode'], qaChain: ['cline'] },
  ]), ['agent-relay · 작업 · OpenCode · 라우팅 고치기']);
});

test('working rows use current QA for QA stages', () => {
  assert.deepEqual(controlRoomWorkingRows([
    { project: 'agent-relay', current: { stage: 3, title: '검수하기', qa: 'cline' }, workerChain: ['opencode'], qaChain: ['grok'] },
  ]), ['agent-relay · 검수 · Cline · 검수하기']);
});

test('unknown lanes keep a safe label', () => {
  assert.deepEqual(controlRoomWorkingRows([
    { project: 'unknown-lane', current: { stage: 2, title: '확인' }, workerChain: ['codex'] },
  ]), ['unknown-lane · 작업 · Codex · 확인']);
});

test('routing adds cooling and pool lines only when present', () => {
  assert.deepEqual(controlRoomWorkingRows([], {
    cooling: [{ runtime: 'cline', until: '20:28' }, { runtime: 'opencode', until: '20:20' }],
    pool: ['subscription', 'free'],
  }), [
    '쉬는 AI: Cline (20:28까지 쉼) · OpenCode (20:20까지 쉼)',
    '배정 순서: 구독 AI 먼저, 무료 모델은 예비',
  ]);
  assert.deepEqual(controlRoomWorkingRows([], undefined), []);
});
