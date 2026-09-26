import React, { useState } from 'react';
import { must } from './bridge.js';
import { laneErrorKind } from '../shared/projectManager.js';
import {
  type ApprovalRuleJson,
  approvalStatsLine,
  approvalUsedCount,
  approvalCategoryLabel,
  isModelQuotaHit,
  isSupersededApprovalRule,
  normalizeModelUsage,
} from '../shared/types.js';
import { aiDisplayName } from '../shared/projectLabels.js';

/** 대표님께 항상 묻는 종류. 화면 이름은 지금 쓰는 한국어 라벨을 유지한다. */
export const ALWAYS_ASK_APPROVAL_CATEGORIES = [
  'permissions',
  'physical-e2e',
  'product-decision',
  'visual-decision',
  'merge-push',
] as const;

const APPROVAL_CATEGORY_KEYS = [
  'scope',
  'lanes',
  'agents',
  'git',
  'install',
  'merge-push',
  'permissions',
  'physical-e2e',
  'product-decision',
  'visual-decision',
] as const;

/** 이 종류는 대표님 확인 없이 지우거나 건너뛰지 않는다. */
export function isAlwaysAskApprovalCategory(category: string): boolean {
  return (ALWAYS_ASK_APPROVAL_CATEGORIES as readonly string[]).includes(category);
}

/** 그룹 제목. 항상 묻는 종류만 뒤에 '항상 대표님께'를 붙인다. */
export function approvalGroupHeading(category: string): string {
  const label = approvalCategoryLabel(category);
  return isAlwaysAskApprovalCategory(category) ? `${label} — 항상 대표님께` : label;
}

/** 규칙이 몇 번 자동으로 쓰였는지. 날짜는 원문 보기로 둔다. */
export function approvalApplyCountText(rule: ApprovalRuleJson): string {
  return `자동 적용 ${approvalUsedCount(rule)}회`;
}

/** 규칙 추가의 종류 목록. 보이는 글은 한국어, 저장 값은 기존 종류 키. */
export function approvalCategoryChoices(): Array<{ value: string; label: string }> {
  return APPROVAL_CATEGORY_KEYS.map(value => ({ value, label: approvalGroupHeading(value) }));
}

/** 저장할 수 있는 종류 키인지. 한글 제목은 키가 아니다. */
export function approvalCategoryCanSave(category: unknown): category is string {
  return typeof category === 'string' && /^[a-z-]{2,30}$/.test(category);
}

/** 추가할 문장 검사. 문제 없으면 null. */
export function approvalSentenceProblem(sentence: string): string | null {
  const text = sentence.trim();
  if (!text) return '규칙 문장을 적어 주세요.';
  if (text.length > 200) return '문장이 너무 길어요. 200자 안으로 줄여 주세요.';
  return null;
}

/**
 * 승인 규칙 실패를 세 줄로. 꺼진 PC와, 켜져 있는데 실패한 경우를 다르게 말한다.
 * 원문 문장은 돌려주지 않는다.
 */
export function approvalFailureLines(raw: string, what = '승인 규칙을 불러오지 못했어요.'): [string, string, string] {
  const kind = laneErrorKind(raw);
  if (kind === 'offline') {
    return [what, '다른 컴퓨터가 꺼져 있거나 네트워크가 끊긴 것 같아요.', '컴퓨터를 켠 뒤 다시 시도해 주세요.'];
  }
  if (kind === 'remote-failed' || kind === 'bad-reply') {
    return [what, '다른 컴퓨터는 켜져 있는데, 규칙을 다루다 문제가 났어요.', '잠시 뒤 다시 시도해 주세요.'];
  }
  return [what, '규칙을 아직 다루지 못한 것 같아요.', '다시 시도해 주세요. 자세한 내용은 원문 보기에 있어요.'];
}

// ── CR-08 model quota board + approval learning ─────────────────────────────
// board JSON carries `models: { runtimeId: { runs, quota?, failed? } }`.
// approval rules carry `usedCount` / `lastUsedAt` (both optional).
// Pure helpers live in shared/types.ts (compiled to dist → unit-tested);
// this module re-exports them so existing `./approvals.js` imports keep working.
export {
  approvalCategoryLabel,
  approvalLastUsed,
  approvalStatsLine,
  approvalUsedCount,
  dedupeApprovalRules,
  groupRulesByCategory,
  isModelQuotaHit,
  isSupersededApprovalRule,
  normalizeModelUsage,
  partitionSupersededApprovalRules,
  sortRulesByUsage,
  SUPERSEDED_APPROVAL_MARKER,
} from '../shared/types.js';

const APPROVAL_PLAIN_WORDS: readonly [string, string][] = [
  ['fast-forward 병합', '그대로 합치기'],
  ['SSOT', '기준 문서'],
  ['worktree', '작업용 복사본'],
  ['OmniRoute', '전체 경로'],
  ['push merge', '올리기·합치기'],
  ['E2E', '실제 사용 시험'],
];

const APPROVAL_NO_TEXT_LABEL = '설명이 없는 규칙이에요';

/** Display-only wording; the original approval text remains available below it. */
export function approvalReadableLabel(rule: ApprovalRuleJson): string {
  const record = rule as Record<string, unknown>;
  const raw = rule.summary ?? record.title ?? record.ask ?? record.name;
  const text = typeof raw === 'string' && raw.trim() ? raw : APPROVAL_NO_TEXT_LABEL;
  return APPROVAL_PLAIN_WORDS.reduce((label, [developerWord, plainWord]) => label.replaceAll(developerWord, plainWord), text);
}

function approvalOriginalText(rule: ApprovalRuleJson): string {
  const record = rule as Record<string, unknown>;
  const raw = rule.summary ?? record.title ?? record.ask ?? record.name;
  return typeof raw === 'string' && raw.trim() ? raw : JSON.stringify(rule);
}

export function ApprovalRuleCard({ rule, onSaved }: { rule: ApprovalRuleJson; onSaved?: () => void }): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(approvalReadableLabel(rule));
  const [confirming, setConfirming] = useState(false);
  const [gone, setGone] = useState(false);
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<[string, string, string] | null>(null);
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const category = typeof rule.category === 'string' ? rule.category : '';

  async function saveEdit(text = draft): Promise<void> {
    const problem = approvalSentenceProblem(text);
    if (problem || !approvalCategoryCanSave(category)) {
      setFailure(problem
        ? ['이 규칙을 고치지 못했어요.', problem, '문장을 고친 뒤 다시 저장해 주세요.']
        : ['이 규칙을 고치지 못했어요.', '이 규칙의 종류를 저장 형태로 옮길 수 없어요.', '아래 규칙 추가에서 새 문장으로 적어 주세요.']);
      return;
    }
    setBusy(true);
    try {
      await must({ op: 'controlRoom:approvalAdd', category, summary: text.trim() });
      setNote('고쳤어요 ✓');
      setEditing(false);
      setFailure(null);
      onSaved?.();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setRaw(message);
      setNote('');
      setFailure(approvalFailureLines(message, '이 규칙을 고치지 못했어요.'));
    } finally {
      setBusy(false);
    }
  }

  function askDelete(): void {
    setFailure(null);
    if (isAlwaysAskApprovalCategory(category)) {
      setConfirming(false);
      setNote('이 규칙은 항상 대표님께 묻는 규칙이라 지울 수 없어요.');
      return;
    }
    setConfirming(true);
  }

  if (gone) return <p className="rule-result" role="status">지웠어요 ✓</p>;

  return (
    <article className="control-card rule-row">
      <div className="rule-copy">
        <p className="control-card-value" style={{ whiteSpace: 'pre-wrap' }}>{approvalReadableLabel(rule)}</p>
        <p className="muted approval-stats">{approvalApplyCountText(rule)}</p>
      </div>
      <div className="rule-actions">
        <button
          type="button"
          className="btn rule-edit"
          onClick={() => { setEditing(true); setDraft(approvalReadableLabel(rule)); setNote('열었어요 ✓'); setConfirming(false); }}
        >{editing ? '열었어요 ✓' : '고치기'}</button>
        <button type="button" className="btn rule-delete" onClick={askDelete}>지우기</button>
      </div>
      {editing && (
        <form className="rule-edit-form" onSubmit={e => { e.preventDefault(); void saveEdit(); }}>
          <input aria-label="고칠 규칙 문장" value={draft} onChange={e => setDraft(e.target.value)} />
          <button className="btn primary" type="submit" disabled={busy}>{busy ? '저장 중...' : '이대로 저장'}</button>
        </form>
      )}
      {confirming && (
        <div className="rule-confirm" role="group" aria-label="이 규칙을 지울까요?">
          <p>이 규칙을 지울까요? 이 화면에서만 숨기고, 작업 PC의 원본은 다음 불러오기에 다시 보여요.</p>
          <div className="rule-confirm-actions">
            <button type="button" className="btn primary" onClick={() => setConfirming(false)}>남겨 두기</button>
            <button type="button" className="btn" onClick={() => { setConfirming(false); setGone(true); }}>지우기</button>
          </div>
        </div>
      )}
      {note && <p className="rule-result" role="status">{note}</p>}
      {failure && (
        <div className="lovable-error" role="alert">
          <p>{failure[0]}</p>
          <p>{failure[1]}</p>
          <p>{failure[2]}</p>
          <button type="button" className="btn" onClick={() => void saveEdit()}>다시 시도</button>
          {raw && <details><summary>원문 보기</summary><p className="muted">{raw}</p></details>}
        </div>
      )}
      <details className="approval-original">
        <summary>원문 보기</summary>
        <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{approvalOriginalText(rule)}</p>
        <p className="muted">{approvalStatsLine(rule)}</p>
      </details>
    </article>
  );
}

/** 규칙 추가 카드. 종류는 기존 라벨, 저장은 controlRoom:approvalAdd. */
export function ApprovalAddForm({ onAdded }: { onAdded: () => void }): React.ReactElement {
  const choices = approvalCategoryChoices();
  const [category, setCategory] = useState(choices[0]?.value ?? 'scope');
  const [sentence, setSentence] = useState('');
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<[string, string, string] | null>(null);
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(text = sentence): Promise<void> {
    const problem = approvalSentenceProblem(text);
    if (problem) {
      setNote('');
      setRaw('');
      setFailure(['규칙을 추가하지 못했어요.', problem, '문장을 고친 뒤 다시 추가해 주세요.']);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await must({ op: 'controlRoom:approvalAdd', category, summary: text.trim() });
      setSentence('');
      setNote('추가했어요 ✓');
      onAdded();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setRaw(message);
      setNote('');
      setFailure(approvalFailureLines(message, '규칙을 추가하지 못했어요.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="control-card rule-add" aria-label="규칙 추가">
      <h3>규칙 추가</h3>
      <form className="rule-add-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <select aria-label="규칙 종류" value={category} onChange={e => setCategory(e.target.value)}>
          {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select>
        <input
          aria-label="새 규칙 문장"
          value={sentence}
          placeholder="예: 고객에게 보이는 말은 짧게 고치기"
          onChange={e => { setSentence(e.target.value); setNote(''); }}
        />
        <button className="btn primary" type="submit" disabled={busy}>{busy ? '추가 중...' : '추가'}</button>
      </form>
      {note && <p className="rule-result" role="status">{note}</p>}
      {failure && (
        <div className="lovable-error" role="alert">
          <p>{failure[0]}</p>
          <p>{failure[1]}</p>
          <p>{failure[2]}</p>
          <button type="button" className="btn" onClick={() => void submit()}>다시 시도</button>
          {raw && <details><summary>원문 보기</summary><p className="muted">{raw}</p></details>}
        </div>
      )}
    </section>
  );
}

export function UnusedApprovalRules({ rules }: { rules: readonly ApprovalRuleJson[] }): React.ReactElement | null {
  if (rules.length === 0) return null;
  return (
    <details className="approval-unused" aria-label="아직 안 쓰인 규칙">
      <summary>아직 안 쓰인 규칙 {rules.length}개</summary>
      <div className="control-cards">{rules.map((rule, i) => <ApprovalRuleCard key={i} rule={rule} />)}</div>
    </details>
  );
}

/** '모델 사용량' panel — 접힌 details, 한 줄 요약 뒤에 펼치면 runtimes. */
export function ModelUsagePanel({ models }: { models: unknown }): React.ReactElement | null {
  const rows = normalizeModelUsage(models);
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, row) => sum + row.runs, 0);
  return (
    <details className="model-usage" aria-label="모델 사용량">
      <summary>모델 사용량 (실행 {total}회)</summary>
      <ul className="model-usage-list">
        {rows.map(row => (
          <li
            key={row.runtimeId}
            className={`model-usage-row${isModelQuotaHit(row) ? ' quota-hit' : ''}`}
          >
            <span className="model-usage-id">{aiDisplayName(row.runtimeId)}</span>
            <span className="model-usage-nums">
              실행 {row.runs} · 한도 초과 {row.quota} · 실패 {row.failed}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** '(바뀜)'으로 대체된 규칙 — 접힌 '지난 결정' details, 펼치면 목록. */
export function SupersededApprovals({ rules }: { rules: readonly ApprovalRuleJson[] }): React.ReactElement | null {
  const past = rules.filter(isSupersededApprovalRule);
  if (past.length === 0) return null;
  return (
    <details className="approval-superseded" aria-label="지난 결정">
      <summary>지난 결정 {past.length}개</summary>
      <ul className="approval-superseded-list">
        {past.map((rule, i) => (
          <li key={i} className="approval-superseded-row">
            <span className="control-card-value" style={{ whiteSpace: 'pre-wrap' }}>{approvalReadableLabel(rule)}</span>
            <details className="approval-original">
              <summary>원문 보기</summary>
              <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{approvalOriginalText(rule)}</p>
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}
