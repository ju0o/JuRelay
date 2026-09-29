import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'src', 'frontend', 'App.tsx'), 'utf8');

// App.tsx is TSX — extract the pure visibleRecordAgents helper and evaluate it
// with a minimal normalizeModelUsage stub (keys → runtimeId), mirroring
// test/v03.test.mjs conventions.
function loadVisibleRecordAgents() {
  const m = src.match(/export function visibleRecordAgents[\s\S]*?\n\}/);
  assert.ok(m, 'visibleRecordAgents not found in App.tsx source');
  const ts = m[0].replace(/^export\s+/, '');
  const js = ts
    .replace(/activeAgent\?:/g, 'activeAgent:')
    .replace(/:\s*string\[\]/g, '')
    .replace(/:\s*unknown/g, '')
    .replace(/:\s*string/g, '')
    .replace(/<string>/g, '');
  function normalizeModelUsage(models) {
    if (!models || typeof models !== 'object' || Array.isArray(models)) return [];
    return Object.entries(models).map(([runtimeId]) => ({ runtimeId }));
  }
  const fn = new Function('normalizeModelUsage', `${js}; return visibleRecordAgents;`)(normalizeModelUsage);
  assert.equal(typeof fn, 'function', 'visibleRecordAgents did not evaluate to a function');
  return fn;
}

const visibleRecordAgents = loadVisibleRecordAgents();

describe('record screen plain Korean', () => {
  it('shows plain-Korean header on 기록', () => {
    assert.match(src, /<h1>\{headerTitle\}<\/h1>/);
    assert.match(src, /<p className="shell-lead">\{pageCopy\.lead\}<\/p>/);
    assert.equal(src.includes('<h2>작업 기록'), false);
    assert.equal(src.includes('className="record-head"'), false);
  });

  it("renames PROJECTS to 프로젝트", () => {
    assert.ok(src.includes('프로젝트'), 'missing 프로젝트 label');
    assert.doesNotMatch(src, /PROJECTS/);
    assert.doesNotMatch(src, />Projects</);
  });

  it('uses plain paste placeholder for result', () => {
    assert.ok(
      src.includes('여기에 AI에게 받은 결과를 붙여 넣으세요'),
      'missing plain result placeholder',
    );
  });

  it('GPT prompt wording is gone', () => {
    assert.doesNotMatch(src, /GPT에게 받은 다음 프롬프트/);
  });

  it('date field uses native date input defaulting to today', () => {
    assert.match(src, /type="date"|type='date'/);
    assert.ok(src.includes('todayLocal()'), 'date should default to today');
    assert.ok(src.includes('useState(todayLocal())'), 'date state should default to today');
  });

  it('agent chips list only runtimes in board/model usage', () => {
    assert.ok(src.includes('visibleRecordAgents'), 'missing visibleRecordAgents filter');
    assert.ok(src.includes('normalizeModelUsage'), 'missing board model usage normalization');
    assert.ok(src.includes('controlRoom:board'), 'missing board fetch for configured runtimes');
    assert.ok(src.includes('visibleAgents.map'), 'agent chips should render filtered visibleAgents');
  });

  it('does not call a saved record a 런', () => {
    assert.ok(src.includes('아직 저장된 기록이 없어요'), 'missing empty-state sentence');
    assert.ok(src.includes('새 기록'), 'missing 새 기록');
    assert.equal(src.includes('아직 저장된 런이 없습니다'), false);
    assert.equal(src.includes('>새 런<'), false);
  });

  it('tells the founder the export and folder choice without a raw path', () => {
    assert.ok(src.includes("notify('ok', '내보냈어요 ✓', res.filePath)"));
    assert.ok(src.includes("notify('ok', '저장 폴더를 정했어요 ✓', s.dataRoot)"));
    assert.equal(src.includes('내보내기 완료:'), false);
    assert.equal(src.includes('데이터 폴더 설정됨:'), false);
    assert.ok(src.includes('<summary>원문 보기</summary>'));
  });

  it('names the record actions in plain Korean', () => {
    assert.ok(src.includes('>폴더 열기</button>'));
    assert.ok(src.includes('>.md로 내보내기</button>'));
    assert.equal(src.includes('📂 폴더'), false);
  });

  it('asks before deleting, with the safe button first', () => {
    assert.ok(src.includes('이 기록을 지울까요? 지우면 되돌릴 수 없어요.'));
    assert.ok(src.includes('이 날짜의 기록을 모두 지울까요? 지우면 되돌릴 수 없어요.'));
    assert.ok(src.includes('이 AI의 기록을 모두 지울까요? 지우면 되돌릴 수 없어요.'));
    assert.ok(src.includes('이 프로젝트를 지울까요? 지우면 되돌릴 수 없어요.'));
    assert.ok(src.includes('남겨 두기'));
    assert.ok(src.includes('safeFirst'));
  });

  it('shows a one-time 3-step guide on an empty record screen', () => {
    const types = fs.readFileSync(path.join(here, '..', 'src', 'shared', 'types.ts'), 'utf8');
    const m = types.match(/export function recordGuideVisible[\s\S]*?\n\}/);
    assert.ok(m, 'recordGuideVisible missing');
    const js = m[0]
      .replace(/^export\s+/, '')
      .replace(/:\s*boolean/g, '')
      .replace(/:\s*string/g, '')
      .replace(/:\s*number/g, '');
    const fn = new Function(`${js}; return recordGuideVisible;`)();
    assert.equal(fn(false, '', 0), true);
    assert.equal(fn(true, '', 0), false);
    assert.equal(fn(false, 'JuTell', 0), false);
    assert.equal(fn(false, '', 1), false);
    assert.ok(src.includes('무엇을 하는 곳인지: 작업 기록이에요.'));
    assert.ok(src.includes('필요한 것 하나: 왼쪽에서 프로젝트를 고르세요.'));
    assert.ok(src.includes('그다음: 말과 결과를 붙여 넣으면 날짜별로 쌓여요.'));
    assert.ok(src.includes('>알겠어요</button>'));
  });

  it('answers record actions with a short result line', () => {
    assert.ok(src.includes("notify('ok', '말을 저장했어요 ✓')"));
    assert.ok(src.includes("notify('ok', '결과를 저장했어요 ✓')"));
    assert.ok(src.includes("notify('ok', '이 기록을 지웠어요 ✓')"));
    assert.ok(src.includes("notify('ok', '기록을 옮겼어요 ✓')"));
    assert.ok(src.includes('저장하지 않은 내용이 있어요. 다른 기록을 열면 그 내용이 사라져요.'));
    assert.ok(src.includes('이미 적어 둔 말이 있어요. 덮어쓰면 이전 내용이 사라져요.'));
    assert.equal(src.includes('프롬프트 저장됨'), false);
    assert.equal(src.includes('prompt.md가 이미 존재합니다'), false);
  });

  it('keeps save/export behaviour', () => {
    assert.ok(src.includes('모두 저장'), 'missing 모두 저장');
    assert.ok(src.includes('.md로 내보내기'), 'missing .md로 내보내기');
    assert.ok(src.includes('prompt:save'), 'missing prompt:save');
    assert.ok(src.includes('result:save'), 'missing result:save');
    assert.ok(src.includes('run:export'), 'missing run:export');
  });

  it('visibleRecordAgents filters to configured board runtimes only', () => {
    const all = ['Claude Code', 'Kiro', 'Devin', 'CommandCode'];
    // board says only Claude Code is configured → unconfigured chips hidden
    assert.deepEqual(
      visibleRecordAgents(all, { 'Claude Code': { runs: 2 } }, []),
      ['Claude Code'],
    );
  });

  it('visibleRecordAgents includes history runtimes', () => {
    const all = ['Claude Code', 'Kiro', 'Devin'];
    assert.deepEqual(
      visibleRecordAgents(all, null, ['Kiro']),
      ['Kiro'],
    );
  });

  it('visibleRecordAgents keeps full list on first run (board and history empty)', () => {
    const all = ['Claude Code', 'Kiro', 'Devin'];
    assert.deepEqual(visibleRecordAgents(all, null, []), all);
    assert.deepEqual(visibleRecordAgents(all, {}, []), all);
  });

  it('visibleRecordAgents returns empty (not allAgents) on non-overlap', () => {
    const all = ['Claude Code', 'Kiro'];
    // configured runtime does not exist in the chip list → must not fall back to allAgents
    assert.deepEqual(
      visibleRecordAgents(all, { UnknownRuntime: { runs: 1 } }, []),
      [],
    );
  });

  it('visibleRecordAgents keeps active agent on non-overlap without restoring allAgents', () => {
    const all = ['Claude Code', 'Kiro'];
    assert.deepEqual(
      visibleRecordAgents(all, { UnknownRuntime: { runs: 1 } }, [], 'Kiro'),
      ['Kiro'],
    );
  });

  it('visibleRecordAgents never falls back to allAgents when filtered', () => {
    assert.doesNotMatch(src, /visible\.length > 0 \? visible :/);
  });
});
