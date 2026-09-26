/* Lovable 계획 · 승인 규칙 · 작업 기록.
   문장과 칩은 기존 데이터에서 만들고, 샘플 프로젝트 이름은 넣지 않는다. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const planSrc = fs.readFileSync(path.join(root, 'src/frontend/planStudio.tsx'), 'utf8');
const approvalSrc = fs.readFileSync(path.join(root, 'src/frontend/approvals.tsx'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'src/frontend/App.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/frontend/style.css'), 'utf8');

async function loadModule(file) {
  const { build } = await import('esbuild');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { createRequire } = await import('node:module');
  const out = await build({
    entryPoints: [path.join(root, file)],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  });
  const dir = await mkdtemp(`${tmpdir()}/lovable-prl-`);
  try {
    const bundled = path.join(dir, 'mod.cjs');
    await writeFile(bundled, out.outputFiles[0].text);
    return createRequire(bundled)(bundled);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const plan = await loadModule('src/frontend/planStudio.tsx');
const approvals = await loadModule('src/frontend/approvals.tsx');
const app = await loadModule('src/frontend/App.tsx');

const surface = (html) => html.replace(/<details>.*?<\/details>/gs, '').replace(/<[^>]+>/g, ' ');

test('plan chips and recommended answers come from the task, not a sample list', () => {
  assert.deepEqual(plan.planTaskStateChip({ stage: 6 }), { label: '끝남', tone: 'teal' });
  assert.deepEqual(plan.planTaskStateChip({ stage: 'DONE' }), { label: '끝남', tone: 'teal' });
  assert.deepEqual(plan.planTaskStateChip({ stage: 'HOLD' }), { label: '확인 필요', tone: 'amber' });
  assert.deepEqual(plan.planTaskStateChip({ stage: 2, blocker: '막힘' }), { label: '확인 필요', tone: 'amber' });
  assert.deepEqual(plan.planTaskStateChip({ stage: 0 }), { label: '대기', tone: 'muted' });
  assert.deepEqual(plan.planTaskStateChip({ stage: 'queued' }), { label: '대기', tone: 'muted' });
  assert.deepEqual(plan.planTaskStateChip({ stage: 2 }), { label: '진행 중', tone: 'teal' });

  const ordered = plan.planAnswersRecommendedFirst(['돈이 드는 일만 물어보기', '추천이면 자동 진행', '매번 대표님께 물어보기'], 1);
  assert.deepEqual(ordered.map((row) => row.option), ['추천이면 자동 진행', '돈이 드는 일만 물어보기', '매번 대표님께 물어보기']);
  assert.deepEqual(ordered.map((row) => row.index), [1, 0, 2]);
  assert.equal(ordered[0].recommended, true);
  assert.equal(plan.planAnswersRecommendedFirst(['하나만'], 9)[0].recommended, true);

  assert.equal(plan.planSendButtonLabel(false), '보내기');
  assert.equal(plan.planSendButtonLabel(true), '보냈어요 ✓');
  assert.equal(plan.planSendButtonLabel(false, true), '보내는 중...');

  const now = new Date(2026, 0, 2, 9, 50, 0).getTime();
  assert.equal(plan.planGateAutoLine('2026-01-02T14:40:00', now), '안 고르면 14:40에 추천대로 진행해요');
  assert.equal(plan.planGateAutoLine('2026-01-02T09:00:00', now), '');
  assert.equal(plan.planGateAutoLine('', now), '');

  assert.match(planSrc, /PM에게 바꿔 달라고 말하기/);
  assert.match(planSrc, /planSendButtonLabel/);
  assert.match(planSrc, /planAnswersRecommendedFirst/);
  assert.match(planSrc, /className="plan-seq-num"/);
  assert.match(planSrc, /op: 'planStudio:request'/);
  assert.match(planSrc, /op: 'planStudio:chat'/);
  assert.doesNotMatch(planSrc, /window\.alert|window\.confirm|window\.prompt/);
});

test('approval rows keep current category labels and count real uses', () => {
  assert.equal(approvals.approvalGroupHeading('scope'), '범위');
  assert.equal(approvals.approvalGroupHeading('agents'), '에이전트 배치');
  assert.equal(approvals.approvalGroupHeading('permissions'), '권한 — 항상 대표님께');
  assert.equal(approvals.approvalGroupHeading('merge-push'), '병합·올리기 — 항상 대표님께');
  assert.equal(approvals.approvalGroupHeading('product-decision'), '제품 결정 — 항상 대표님께');
  assert.equal(approvals.approvalGroupHeading('visual-decision'), '화면 결정 — 항상 대표님께');
  assert.equal(approvals.approvalGroupHeading('physical-e2e'), '실물 E2E — 항상 대표님께');
  assert.equal(approvals.approvalGroupHeading('deploy'), '기타');
  assert.equal(approvals.isAlwaysAskApprovalCategory('scope'), false);
  assert.equal(approvals.isAlwaysAskApprovalCategory('permissions'), true);

  assert.equal(approvals.approvalApplyCountText({}), '자동 적용 0회');
  assert.equal(approvals.approvalApplyCountText({ usedCount: 12 }), '자동 적용 12회');
  assert.equal(approvals.approvalSentenceProblem('  '), '규칙 문장을 적어 주세요.');
  assert.equal(approvals.approvalSentenceProblem('가'.repeat(201)), '문장이 너무 길어요. 200자 안으로 줄여 주세요.');
  assert.equal(approvals.approvalSentenceProblem('고객에게 보이는 말은 짧게'), null);
  assert.equal(approvals.approvalCategoryCanSave('scope'), true);
  assert.equal(approvals.approvalCategoryCanSave('기타'), false);

  const choices = approvals.approvalCategoryChoices();
  assert.equal(choices[0].label, '범위');
  assert.ok(choices.some((choice) => choice.label.includes('항상 대표님께')));
  assert.ok(choices.every((choice) => /[가-힣]/.test(choice.label)));

  const offline = approvals.approvalFailureLines('작업 PC(ASUS)에 연결할 수 없습니다.');
  assert.match(offline[1], /꺼져 있거나 네트워크가 끊긴/);
  assert.doesNotMatch(offline.join('\n'), /ASUS|연결할 수 없습니다/);
  const remote = approvals.approvalFailureLines('작업 PC는 켜져 있는데 요청을 처리하다 오류가 났어요.', '규칙을 추가하지 못했어요.');
  assert.match(remote[0], /규칙을 추가하지 못했어요/);
  assert.match(remote[1], /켜져 있는데/);
  assert.doesNotMatch(remote.join('\n'), /오류가 났어요/);
  const other = approvals.approvalFailureLines('ECONNRESET /tmp/secret.json');
  assert.doesNotMatch(other.join('\n'), /ECONNRESET|\/tmp|secret/);
  assert.match(other[2], /원문 보기/);

  const confirm = approvalSrc.slice(approvalSrc.indexOf('rule-confirm'));
  assert.ok(confirm.indexOf('남겨 두기') !== -1 && confirm.indexOf('남겨 두기') < confirm.indexOf('>지우기<'));
  assert.match(approvalSrc, /자동 적용/);
  assert.match(approvalSrc, /'고치기'/);
  assert.match(approvalSrc, /열었어요 ✓/);
  assert.match(approvalSrc, /지웠어요 ✓/);
  assert.match(approvalSrc, /고쳤어요 ✓/);
  assert.match(approvalSrc, /<h3>규칙 추가<\/h3>/);
  assert.match(approvalSrc, /추가했어요 ✓/);
  assert.match(approvalSrc, /op: 'controlRoom:approvalAdd'/);
  assert.match(appSrc, /approvalGroupHeading/);
  assert.match(appSrc, /<ApprovalAddForm/);
  assert.doesNotMatch(approvalSrc, /window\.alert|window\.confirm|window\.prompt/);
});

test('work log groups real runs by local date and copies the line', async () => {
  const now = new Date(2026, 8, 26, 17, 0, 0);
  assert.equal(app.recordDateLabel('2026-09-26', now), '오늘');
  assert.equal(app.recordDateLabel('2026-09-25', now), '어제');
  assert.equal(app.recordDateLabel('2026-09-01', now), '9월 1일');
  assert.equal(app.recordDateLabel('2025-12-31', now), '2025년 12월 31일');
  assert.equal(app.recordDateLabel('nope', now), '날짜 없음');
  assert.equal(app.recordPairLine('  화면을\n쉽게  ', '통과했어요'), '화면을 쉽게 → 통과했어요');
  assert.equal(app.recordPairLine('', ''), '지시가 아직 없어요 → 결과가 아직 없어요');

  const groups = app.recordLogGroups([
    { date: '2026-09-25', prompt: '어제 지시', result: '어제 결과' },
    { date: '2026-09-26', prompt: '오늘 지시', result: '오늘 결과' },
    { date: '2026-09-26', prompt: '두 번째', result: '' },
  ], now);
  assert.deepEqual(groups.map((group) => group.label), ['오늘', '어제']);
  assert.equal(groups[0].entries[0].line, '오늘 지시 → 오늘 결과');
  assert.equal(groups[0].entries[1].line, '두 번째 → 결과가 아직 없어요');
  assert.equal(groups[0].entries[0].key.includes('/'), false);

  const offline = app.recordFailureLines('작업 PC(ASUS)에 연결할 수 없습니다.');
  assert.match(offline[1], /꺼져 있거나 네트워크가 끊긴/);
  assert.doesNotMatch(offline.join('\n'), /ASUS/);
  const remote = app.recordFailureLines('작업 PC는 켜져 있는데 요청을 처리하다 오류가 났어요.');
  assert.match(remote[1], /켜져 있는데/);
  assert.doesNotMatch(remote.join('\n'), /오류가 났어요/);
  const other = app.recordFailureLines('ENOENT /home/secret/prompt.md');
  assert.doesNotMatch(other.join('\n'), /ENOENT|secret|prompt\.md/);

  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const html = renderToStaticMarkup(React.createElement(app.RecordLog, {
    groups,
    copiedKey: groups[0].entries[0].key,
    onCopy: () => undefined,
    loading: false,
    emptyText: '아직 작업 기록이 없어요.',
    failure: null,
    onRetry: () => undefined,
  }));
  const text = surface(html);
  assert.match(text, /오늘 지시 → 오늘 결과/);
  assert.match(text, /복사했어요 ✓/);
  assert.match(html, />복사</);
  assert.doesNotMatch(text, /2026-09-26|HOLD|folder/);
  assert.match(appSrc, /recordLogGroups/);
  assert.match(appSrc, /op: 'run:read'/);
  assert.match(appSrc, /작업 기록 — AI에게 준 지시와 받은 결과를 날짜별로 모아 둬요/);
});

test('the three screens use the dark reference look and stay on a phone', () => {
  const block = css.slice(css.indexOf('/* ── 계획 · 승인 규칙 · 작업 기록'));
  for (const token of ['#0b0d10', '#12151a', '#232830', '#7dd3c0', '#e8c170', '#8b93a1', 'Noto Sans KR', 'JetBrains Mono', '16px', '44px', '14px', '0.38s', 'fade-slide-in', '250px']) {
    assert.ok(block.includes(token) || css.includes(token), `missing ${token}`);
  }
  assert.match(css, /\.plan-studio-grid\s*\{[^}]*250px/);
  assert.match(block, /@media\s*\(\s*max-width:\s*720px\s*\)/);
  assert.match(block, /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
  assert.doesNotMatch(block, /#e06c5f|color:\s*red|--danger/);
  assert.match(planSrc, /고급 \(개발용\)/);
  assert.match(appSrc, /고급 \(개발용\)/);
});
