/* Docs-truth regression — docs stay in line with the app.
   README describes the current app (control room); the night-run doc states
   the operational deadline. Reads the two markdown files as plain text. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const nightDoc = fs.readFileSync(
  path.join(root, 'docs/CORE_V1_AUTO_NIGHT_RUN.md'),
  'utf8',
);

test('README describes the control room app', () => {
  assert.ok(readme.includes('관제실'), "README should mention '관제실'");
  assert.ok(readme.includes('승인 규칙'), "README should mention '승인 규칙'");
  assert.ok(readme.includes('계획'), "README should mention '계획'");
});

test('night-run doc states the operational deadline', () => {
  assert.ok(
    nightDoc.includes('05:00'),
    'night-run doc should state the 05:00 deadline',
  );
});

// Every app string the README quotes must exist verbatim in the app source.
const appSrc = [
  'src/backend/controlRoom.ts',
  'src/shared/projectLabels.ts',
  'src/frontend/controlRoom.tsx',
]
  .map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
  .join('\n');

test('README quotes of app copy exist in the app source', () => {
  for (const q of [
    '아무것도 안 고르면',
    '에 추천대로 진행해요',
    '에 연결할 수 없습니다',
    '다시 시도',
    '다음 작업으로 진행',
    '내가 직접 볼게요',
    '원문 보기',
    '무료 모델(예비)',
  ]) {
    assert.ok(readme.includes(q), `README should quote '${q}'`);
    assert.ok(appSrc.includes(q), `app source should contain '${q}'`);
  }
  assert.ok(!readme.includes('연결 안 됨'), "README must not quote '연결 안 됨'");
});

test('developer doc describes the existing watch launcher', () => {
  const devDoc = fs.readFileSync(path.join(root, 'docs/DEVELOPER.md'), 'utf8');
  const backlog = fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8');
  assert.ok(devDoc.includes('scripts/dev.mjs'), 'DEVELOPER.md should name scripts/dev.mjs');
  assert.ok(!devDoc.includes('watch/HMR 없음'), 'DEVELOPER.md still says watch/HMR is missing');
  assert.ok(backlog.includes('[x] `npm run dev` watch/HMR'), 'BACKLOG should mark watch/HMR done');
});

test('records doc matches the first-run folder screen', () => {
  const records = fs.readFileSync(path.join(root, 'docs/RECORDS_AND_DOGFOODING.md'), 'utf8');
  assert.ok(records.includes('기본 폴더 사용 (문서 › Agent Relay)'));
  assert.ok(records.includes('저장 폴더'));
  assert.ok(!records.includes('데이터 폴더를 먼저 선택하세요'));
  assert.ok(!records.includes('설정 → Storage'));
});

test('backlog records the founder-polish items as done', () => {
  const backlog = fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8');
  for (const line of [
    '[x] 피드백 종류 화면 글자',
    '[x] 피드백 패널 제목',
    '[x] 알림에 폴더 경로를 그대로 쓰지 않음',
    '[x] 본문 글자 14px 이상',
    '[x] 빠져 있던 화면 검사',
    '[x] 기록 삭제 확인',
    '[x] 기록 화면 첫 안내',
    '[x] 기록 버튼 글자',
    '[x] 기록 알림을 결과 한 줄로',
    '[x] 계획 화면에서 지운 뒤',
  ]) {
    assert.ok(backlog.includes(line), `BACKLOG missing ${line}`);
  }
});
