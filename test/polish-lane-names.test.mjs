/* 계획 화면: 프로젝트 이름은 등록 이름 → 보드 name → id, 목표 카드는 한국어 한 줄. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  PLAN_GOAL_UNSET,
  PROJECT_LABELS,
  foldedManifestGoal,
  isLatinSentence,
  planLaneDisplayName,
  planVisibleGoal,
} from '../dist/server/shared/projectLabels.js';

const root = new URL('..', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const MANIFEST = 'Founder 2026-09-24 오후 (settled, do not re-ask): launch bar = stay';

test('label fallback is registered name, then folder, then lane name, then id', () => {
  const labels = {
    juai: { name: 'JuAi', goal: '대화로 일을 맡기는 비서' },
    juradar: { name: 'JuRadar', goal: '돌아가는 작업을 한눈에 살피는 레이더' },
    'ai-agent-marketplace': { name: 'AI 인력사무소', goal: '일감을 맡기고 결과를 받는 장터' },
    'folder-only': { name: '', goal: '', path: '/repos/내폴더' },
  };
  assert.equal(planLaneDisplayName('juai', '다른 이름', labels), 'JuAi');
  assert.equal(planLaneDisplayName('JURADAR', 'juradar', labels), 'JuRadar');
  assert.equal(planLaneDisplayName('AI-AGENT-MARKETPLACE', undefined, labels), 'AI 인력사무소');
  assert.equal(planLaneDisplayName('folder-only', '보드 이름', labels), '내폴더');
  assert.equal(planLaneDisplayName('juai', '다른 이름'), '다른 이름');
  assert.equal(planLaneDisplayName('custom-lane', '보드에 적힌 이름'), '보드에 적힌 이름');
  assert.equal(planLaneDisplayName('custom-lane', '   '), 'custom-lane');
  assert.equal(planLaneDisplayName('custom-lane'), 'custom-lane');
  assert.equal(planLaneDisplayName('  ', ''), '알 수 없는 프로젝트');
});

test('visible goal is the Korean label, and the raw manifest stays folded', () => {
  const labels = {
    juai: { name: 'JuAi', goal: '대화로 일을 맡기는 비서' },
    juradar: { name: 'JuRadar', goal: '돌아가는 작업을 한눈에 살피는 레이더' },
    'ai-agent-marketplace': { name: 'AI 인력사무소', goal: '일감을 맡기고 결과를 받는 장터' },
  };
  assert.equal(labels.juai.name, 'JuAi');
  assert.equal(PROJECT_LABELS.juai, undefined);
  for (const id of ['juai', 'ai-agent-marketplace', 'juradar', 'agent-relay', 'missing-lane']) {
    const goal = planVisibleGoal(id, id === 'missing-lane' || id === 'agent-relay' ? undefined : labels);
    assert.equal(goal.includes('\n'), false);
    assert.equal(isLatinSentence(goal), false, goal);
  }
  for (const id of ['juai', 'ai-agent-marketplace', 'juradar']) {
    assert.doesNotMatch(planVisibleGoal(id, labels), /[A-Za-z]{3,}/);
  }
  assert.equal(planVisibleGoal('missing-lane'), PLAN_GOAL_UNSET);
  assert.equal(isLatinSentence(MANIFEST), true);
  const folded = foldedManifestGoal(planVisibleGoal('juradar', labels), MANIFEST, MANIFEST, '  ');
  assert.equal(folded, MANIFEST);
  assert.equal(foldedManifestGoal(planVisibleGoal('juai', labels), planVisibleGoal('juai', labels)), '');
});

test('plan goal card shows the Korean goal and hides the manifest under 원문 보기', async () => {
  const studio = await read('src/frontend/planStudio.tsx');
  const card = studio.slice(studio.indexOf('aria-label="목표"'), studio.indexOf('aria-label="작업 순서"'));
  assert.match(card, /<p className="plan-goal">\{goalText\}<\/p>/);
  assert.equal(card.split('<details>')[0].includes('draft.goal'), false);
  assert.match(card, /<summary>원문 보기<\/summary>[\s\S]*\{manifestGoal\}/);
  assert.match(studio, /const goalText = presentation\.goal;/);
  assert.match(studio, /planLaneDisplayName\(project, lane\?\.name, PROJECT_LABELS\)/);
  assert.match(studio, /planVisibleGoal\(project, PROJECT_LABELS\)/);
  assert.doesNotMatch(studio, /draft\.goal\.trim\(\) \|\| presentation\.goal/);
});
