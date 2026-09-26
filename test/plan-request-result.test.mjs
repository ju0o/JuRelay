/* PM 요청 뒤 새로 생긴 작업: id 비교 헬퍼와 요청 상자 아래 문구. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const planSrc = fs.readFileSync(path.join(root, 'src/frontend/planStudio.tsx'), 'utf8');

async function loadPlanStudio() {
  const { build } = await import('esbuild');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { createRequire } = await import('node:module');
  const out = await build({
    entryPoints: [path.join(root, 'src/frontend/planStudio.tsx')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  });
  const dir = await mkdtemp(`${tmpdir()}/plan-request-result-`);
  try {
    const bundled = path.join(dir, 'mod.cjs');
    await writeFile(bundled, out.outputFiles[0].text);
    return createRequire(bundled)(bundled);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 접힌 원문을 뺀 화면 글. */
function visibleText(html) {
  return html
    .replace(/<details>.*?<\/details>/gs, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const plan = await loadPlanStudio();

test('newTasksAfterRequest keeps only ids that were not in the previous list', () => {
  const before = [
    { id: 'A', title: '기존 작업' },
    { taskId: 'KEEP', title: '남겨 둔 작업' },
  ];
  const after = [
    { id: 'C', title: '영수증 화면 쉽게' },
    { id: 'A', title: '기존 작업' },
    { taskId: 'KEEP', id: 'other', title: '남겨 둔 작업' },
    { id: 'B', title: '검사 문구 고치기' },
    { id: 'B', title: '검사 문구 고치기' },
    { title: '번호 없는 줄' },
  ];
  const beforeCopy = structuredClone(before);
  const afterCopy = structuredClone(after);
  const created = plan.newTasksAfterRequest(before, after);

  assert.deepEqual(created, [
    { id: 'C', title: '영수증 화면 쉽게' },
    { id: 'B', title: '검사 문구 고치기' },
  ]);
  assert.deepEqual(before, beforeCopy);
  assert.deepEqual(after, afterCopy);
  assert.deepEqual(plan.newTasksAfterRequest(null, undefined), []);
  assert.deepEqual(
    plan.newTasksAfterRequest(undefined, [{ id: 'B', title: '검사 문구 고치기' }]),
    [{ id: 'B', title: '검사 문구 고치기' }],
  );

  const unnamed = plan.newTasksAfterRequest([], [{ id: 'AGENTRELAY-X', title: 'Fix the button' }]);
  assert.deepEqual(unnamed, [{ id: 'AGENTRELAY-X', title: '새 작업 (이름 짓는 중)' }]);
});

test('PlanRequestResult shows Korean titles and folds task ids', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const tasks = plan.newTasksAfterRequest(
    [{ id: 'OLD', title: '이미 있던 작업' }],
    [
      { id: 'OLD', title: '이미 있던 작업' },
      { id: 'AGENTRELAY-PLAN-1', title: '영수증 화면 쉽게' },
      { id: 'AGENTRELAY-PLAN-2', title: '검사 문구 고치기' },
    ],
  );
  const html = renderToStaticMarkup(React.createElement(plan.PlanRequestResult, { tasks }));
  const text = visibleText(html);

  assert.match(text, /PM이 만든 작업 2개/);
  assert.match(text, /영수증 화면 쉽게/);
  assert.match(text, /검사 문구 고치기/);
  assert.doesNotMatch(text, /AGENTRELAY-PLAN-1|AGENTRELAY-PLAN-2|OLD/);
  assert.match(html, /원문 보기/);
  assert.match(html, /AGENTRELAY-PLAN-1/);
  assert.match(html, /AGENTRELAY-PLAN-2/);

  const emptyHtml = renderToStaticMarkup(React.createElement(plan.PlanRequestResult, { tasks: [] }));
  const emptyText = visibleText(emptyHtml);
  assert.match(emptyText, /새로 생긴 작업은 없어요 — PM 답을 기다리는 중이에요/);
  assert.doesNotMatch(emptyText, /PM이 만든 작업/);
  assert.doesNotMatch(emptyHtml, /<details>/);
});

test('submitRequest lists new tasks only after the request and refresh succeed', () => {
  const fn = planSrc.slice(planSrc.indexOf('async function submitRequest'), planSrc.indexOf('async function approve'));
  const requestAt = fn.indexOf("op: 'planStudio:request'");
  const refreshAt = fn.indexOf("op: 'planStudio:get'");
  const helperAt = fn.indexOf('newTasksAfterRequest');
  assert.ok(requestAt >= 0 && refreshAt > requestAt && helperAt > refreshAt);
  assert.match(fn, /setRequestResult\(created\)/);

  const card = planSrc.slice(planSrc.indexOf('PM에게 바꿔 달라고 말하기'));
  assert.match(card, /<PlanRequestResult tasks=\{requestResult\} \/>/);
  assert.match(planSrc, /PM이 만든 작업/);
  assert.match(planSrc, /새로 생긴 작업은 없어요 — PM 답을 기다리는 중이에요/);
});
