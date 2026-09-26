import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { must } from './bridge.js';
import { ModelUsagePanel } from './approvals.js';
import { InlineConfirm } from './components.js';
import type { ControlRoomModelUsage } from '../shared/types.js';
import { controlRoomTaskId, controlRoomTaskTitle, founderTaskTitle, controlRoomHasDoneData, controlRoomTodayCount, controlRoomTodayDone, controlRoomVerifiedDoneTotal, controlRoomWorkingItems, controlRoomRoutingLine, laneAttention } from '../shared/types.js';
import { PROJECT_LABELS, aiDisplayName, projectFromSearch, projectWindowKey, barPercent, envReasonText, envTone, normalizeEnvs, ramText, holdBadgeText, projectDisplayName, holdAutoProceedText, holdCardMessage, holdFlowStates, holdHeadingText, holdStepLabel, isSelfReviewChain, isSelfReviewOption, visibleHoldEntries } from '../shared/projectLabels.js';
import type { EnvRow, EnvTone, NormalizedHold } from '../shared/projectLabels.js';
import { scopeBoard, sharedSeatsView } from '../shared/projectScope.js';
import type { SharedSeatsView } from '../shared/projectScope.js';
import { TOKENS_REFRESH_MS, formatTokens, normalizeTokens, topTokenProjects, tokensSummaryLine } from '../shared/tokens.js';
import type { TokenFinding, TokensView } from '../shared/tokens.js';

export interface ControlRoomHoldExplain {
  sentence?: unknown;
  choice?: unknown;
  recommended?: unknown;
  [key: string]: unknown;
}

export interface ControlRoomHold {
  taskId?: string;
  reason?: string;
  step?: string | number;
  explain?: string | ControlRoomHoldExplain;
  choice?: string | number;
  options?: unknown;
  [key: string]: unknown;
}

export interface ControlRoomLane {
  id?: string;
  project?: string;
  current?: { stage?: number | string; taskId?: string; worker?: unknown; qa?: unknown; [key: string]: unknown };
  workerChain?: unknown;
  qaChain?: unknown;
  holds?: Array<ControlRoomHold | string>;
  humanGate?: Record<string, unknown>;
  founderGate?: Record<string, unknown>;
  blocker?: string;
  [key: string]: unknown;
}

interface ControlRoomBoard {
  lanes?: ControlRoomLane[];
  models?: Record<string, ControlRoomModelUsage>;
  todayDone?: unknown;
  routing?: unknown;
  /** Shared seat limit. Absent means the card stays hidden. */
  capacity?: unknown;
}
type FlowState = 'done' | 'active' | 'blocked' | 'pending';
type ActionStatus = { state: 'pending' | 'done' | 'error'; text: string } | null;

const FLOW = ['계획', '확인', '작업', '검수', '시험', '사람 확인', '반영'];

/** 9 runtime ids offered by the night orchestrator (first = preferred, rest = 예비). */
const RUNTIMES: readonly string[] = [
  'codex',
  'opencode',
  'opencode-free',
  'cline',
  'grok',
  'cursor',
  'claude',
  'claude-team',
  'claude-pro',
];

/** Approval categories that must never be offered a save-as-rule shortcut. */
const NEVER_AUTO_CATEGORIES: ReadonlySet<string> = new Set([
  'secret',
  'auth',
  'payment',
  'delete',
  'destructive',
]);

function label(value: unknown, fallback = '—'): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function stageIndex(stage: number | string): number {
  if (typeof stage === 'number' && Number.isFinite(stage)) return Math.max(0, Math.min(FLOW.length - 1, stage));
  const value = String(stage).toUpperCase();
  if (value.includes('INTEGR') || value.includes('통합') || value.includes('반영') || value === 'DONE' || value === 'COMPLETE') return 6;
  if (value.includes('HUMAN') || value.includes('FOUNDER') || value.includes('사람 확인')) return 5;
  if (value.includes('GATE') || value.includes('시험')) return 4;
  if (value.includes('QA') || value.includes('검수')) return 3;
  if (value.includes('WORKER') || value.includes('BUILDER') || value.includes('작업')) return 2;
  if (value.includes('VERIF') || value.includes('VALID') || value.includes('검증') || value.includes('확인')) return 1;
  return 0;
}

function flowState(stage: number | string, index: number): FlowState {
  const value = String(stage).toUpperCase();
  if (value.includes('BLOCK') || value.includes('HOLD')) return index < stageIndex(stage) ? 'done' : index === stageIndex(stage) ? 'blocked' : 'pending';
  if (value === 'DONE' || value === 'COMPLETE' || value === 'V1_COMPLETE' || value === 'INTEGRATED') return 'done';
  const current = stageIndex(stage);
  return index < current ? 'done' : index === current ? 'active' : 'pending';
}

function detail(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return label(record.reason ?? record.ask ?? record.verdict ?? record.state ?? record.status);
  }
  return '—';
}

function projectOf(lane: ControlRoomLane): string {
  const raw = lane.project ?? lane.id;
  return typeof raw === 'string' ? raw : '';
}

function projectPresentation(lane: ControlRoomLane): { id: string; name: string; goal: string } {
  const id = projectOf(lane);
  const known = PROJECT_LABELS[id.toLowerCase()];
  const current = lane.current ?? {};
  return {
    id,
    name: known?.name ?? label(lane.project ?? lane.id, '알 수 없는 프로젝트'),
    goal: label(lane.goal ?? lane.summary ?? current.goal ?? current.summary, known?.goal ?? '현재 작업 목표를 확인하세요.'),
  };
}

function rawText(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function qaFindingOf(lane: ControlRoomLane): unknown {
  const current = lane.current ?? {};
  const qa = current.qa;
  if (lane.qaFinding ?? lane.qaFindings ?? current.qaFinding ?? current.qaFindings) return lane.qaFinding ?? lane.qaFindings ?? current.qaFinding ?? current.qaFindings;
  if (qa && typeof qa === 'object') return (qa as Record<string, unknown>).finding ?? (qa as Record<string, unknown>).findings;
  return undefined;
}

function holdSummary(lane: ControlRoomLane, reason: string): string | null {
  return holdCardMessage(lane.blocker, reason);
}

/** Normalize a worker/QA chain value (string | string[] | {chain|name|...}) to an ordered id list. */
function chainToList(value: unknown): string[] {
  const clean = (items: unknown[]): string[] =>
    items.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (Array.isArray(value)) return clean(value);
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,|\s>→]+/).map(part => part.trim()).filter(part => part.length > 0);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const chain = record.chain ?? record.runtimes ?? record.order;
    if (Array.isArray(chain)) return clean(chain);
    const single = record.name ?? record.id ?? record.runtime;
    if (typeof single === 'string' && single.trim()) return [single.trim()];
  }
  return [];
}

function isPaused(lane: ControlRoomLane): boolean {
  const current = lane.current ?? {};
  if (lane.paused === true || current.paused === true) return true;
  if (/paus|hold|stop|block/i.test(String(current.stage ?? ''))) return true;
  if (typeof lane.blocker === 'string' && lane.blocker.trim()) return true;
  // choice가 'skip'인 보류는 보여주지 않으므로 멈춤 판단에서도 제외한다.
  return visibleHoldEntries(lane.holds).length > 0;
}

// ── R5/R6 "오늘 끝난 일 / 지금 일하는 AI" ───────────────────────────────────
// 현재 작업은 한국어 title을 보여주고 ID는 원문 보기로만 둔다.
// current가 비어 있는 레인은 쉬는 중 — 모든 단계 pending.

const currentTitleOf = founderTaskTitle;

const currentIdOf = controlRoomTaskId;

function hasWork(lane: ControlRoomLane): boolean {
  const current = lane.current ?? {};
  return controlRoomTaskTitle(current) !== '' || currentIdOf(current) !== '';
}

interface TodayItem { lane: string; taskId: string; title: string; scope?: string }

function todayItemsOf(board: ControlRoomBoard | null): TodayItem[] {
  return controlRoomTodayDone(board).map(item => ({ lane: item.project, taskId: item.taskId, title: item.title, scope: item.scope }));
}

function TodayCard({ board }: { board: ControlRoomBoard | null }): React.ReactElement {
  const items = todayItemsOf(board).slice(0, 3);
  const count = controlRoomTodayCount(board);
  const hasData = controlRoomHasDoneData(board);
  const total = controlRoomVerifiedDoneTotal(board);
  return (
    <section className="control-card today-card" aria-label="오늘 끝난 일">
      <h2>오늘 끝난 일</h2>
      {!hasData
        ? <p className="muted">오늘 기록은 아직 안 왔어요 · 지금까지 끝난 작업 {total}개</p>
        : count === 0
          ? <p className="muted">오늘 끝난 일은 아직 없어요.</p>
          : <><p className="control-card-value">오늘 {count}개 끝났어요</p><ul className="today-list">
            {items.map((item, index) => (
              <li key={`${item.lane}-${item.taskId || item.title}-${index}`}>
                <span><strong>{item.lane ? `${projectDisplayName(item.lane)} · ` : ''}{item.title}</strong></span>
                <details><summary>원문 보기</summary><p className="muted mono">ID: {item.taskId || '—'}</p>{item.scope && <p className="muted mono">범위: {item.scope}</p>}</details>
              </li>
            ))}
          </ul></>}
    </section>
  );
}

const ENV_REFRESH_MS = 30_000;
const ENV_COLOR: Record<EnvTone, string> = { ok: 'var(--accent)', warn: 'var(--warn)', danger: 'var(--danger)' };

function EnvBar({ label, percent, tone }: { label: string; percent: number; tone: EnvTone }): React.ReactElement {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
      style={{ height: 10, borderRadius: 5, background: 'var(--bg3)', border: '1px solid var(--border)', overflow: 'hidden' }}>
      <div style={{ width: `${percent}%`, height: '100%', background: ENV_COLOR[tone] }} />
    </div>
  );
}

function EnvRowView({ row }: { row: EnvRow }): React.ReactElement {
  const cpuTone = envTone({ ok: true, cpuPct: row.cpuPct, ramFreeGb: null });
  const ramTone = envTone({ ok: true, cpuPct: null, ramFreeGb: row.ramFreeGb });
  return (
    <li style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
      <p className="control-card-value" style={{ margin: 0 }}>{row.label}</p>
      {!row.ok ? <>
        <p className="muted" style={{ color: ENV_COLOR.warn }}>{envReasonText(row)}</p>
        {row.rawReason && <details><summary>원문 보기</summary><pre className="mono">{row.rawReason}</pre></details>}
      </> : <>
        <p className="muted" style={{ margin: '6px 0 2px' }}>CPU {row.cpuPct === null ? '확인 중' : `${Math.round(row.cpuPct)}% 사용 중`}</p>
        <EnvBar label={`${row.label} CPU`} percent={barPercent(row.cpuPct)} tone={cpuTone} />
        <p className="muted" style={{ margin: '6px 0 2px' }}>{ramText(row)}</p>
        <EnvBar label={`${row.label} 메모리`} percent={barPercent(row.ramFreeGb, row.ramTotalGb ?? 0)} tone={ramTone} />
        <p className="muted" style={{ margin: '6px 0 0' }}>{row.ais.length ? `쓸 수 있는 AI: ${row.ais.join(' · ')}` : '찾은 AI 프로그램이 없어요.'}</p>
      </>}
    </li>
  );
}

function EnvsCard(): React.ReactElement {
  const [rows, setRows] = useState<EnvRow[] | null>(null);
  const [error, setError] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const load = useCallback(async (): Promise<void> => {
    try {
      setRows(normalizeEnvs(await must<unknown>({ op: 'controlRoom:envs' })));
      setError('');
      setErrorDetail('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setErrorDetail((e as { detail?: string })?.detail ?? '');
    }
  }, []);
  useEffect(() => {
    let alive = true;
    const refresh = (): void => { if (alive) void load(); };
    refresh();
    const timer = window.setInterval(refresh, ENV_REFRESH_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [load]);
  return (
    <section className="control-card" aria-label="실행 환경">
      <p className="control-card-value">실행 환경</p>
      <p className="muted">AI가 일하는 컴퓨터들의 여유예요. 30초마다 알아서 새로 고쳐요.</p>
      {rows === null && !error ? <p className="muted" role="status">불러오는 중…</p>
        : error && rows === null ? <div role="status">
          <p style={{ color: ENV_COLOR.warn }}>{error}</p>
          <p className="muted">잠시 후 자동으로 다시 시도해요.</p>
          <button className="btn" style={{ minHeight: 44 }} onClick={() => void load()}>다시 시도</button>
          {errorDetail && <details><summary>원문 보기</summary><pre className="mono">{errorDetail}</pre></details>}
        </div>
        : !rows?.length ? <p className="muted" role="status">아직 알려진 실행 환경이 없어요 — 작업 PC가 응답하면 여기에 자동으로 나타나요.</p>
        : <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{rows.map(row => <EnvRowView key={row.id} row={row} />)}</ul>}
    </section>
  );
}

function TokenFindingRow({ f }: { f: TokenFinding }): React.ReactElement {
  const warn = f.severity === 'warn';
  return (
    <li style={{ padding: '10px 12px', margin: '8px 0', borderRadius: 8, border: `1px solid ${warn ? 'var(--warn)' : 'var(--border)'}`, background: warn ? 'var(--bg3)' : 'transparent' }}>
      <p className={warn ? undefined : 'muted'} style={{ margin: 0, fontWeight: 700, color: warn ? ENV_COLOR.warn : undefined }}>{f.text}</p>
      {f.why && <p className="muted" style={{ margin: '4px 0 0' }}>왜: {f.why}</p>}
      {f.action && <p className="muted" style={{ margin: '4px 0 0' }}>할 일: {f.action}</p>}
      {Object.keys(f.raw).length > 0 && <details><summary>원문 보기</summary><pre className="mono">{JSON.stringify(f.raw, null, 2)}</pre></details>}
    </li>
  );
}

function TokensCard(): React.ReactElement {
  const [view, setView] = useState<TokensView | null>(null);
  const [rawJson, setRawJson] = useState('');
  const [error, setError] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const load = useCallback(async (): Promise<void> => {
    try {
      const payload = await must<unknown>({ op: 'controlRoom:tokens' });
      setView(normalizeTokens(payload));
      setRawJson(JSON.stringify(payload, null, 2));
      setError('');
      setErrorDetail('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setErrorDetail((e as { detail?: string })?.detail ?? '');
    }
  }, []);
  useEffect(() => {
    let alive = true;
    const refresh = (): void => { if (alive) void load(); };
    refresh();
    const timer = window.setInterval(refresh, TOKENS_REFRESH_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [load]);
  const projects = view ? topTokenProjects(view) : [];
  return (
    <section className="control-card" aria-label="토큰 감지">
      <p className="control-card-value">토큰 감지</p>
      {view === null && !error ? <p className="muted" role="status">불러오는 중…</p>
        : view === null ? <div role="status">
          <p style={{ color: ENV_COLOR.warn }}>토큰 사용량을 가져오지 못했어요.</p>
          <p className="muted">{error}</p>
          <button className="btn" style={{ minHeight: 44 }} onClick={() => void load()}>다시 시도</button>
          {errorDetail && <details><summary>원문 보기</summary><pre className="mono">{errorDetail}</pre></details>}
        </div>
        : <>
          <p>{tokensSummaryLine(view)}</p>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div><p className="muted" style={{ margin: 0 }}>새로 쓴 토큰</p><p className="control-card-value" style={{ margin: 0, fontSize: 28 }}>{formatTokens(view.fresh)}</p></div>
            <div><p className="muted" style={{ margin: 0 }}>다시 읽은 토큰(캐시)</p><p className="control-card-value" style={{ margin: 0, fontSize: 28 }}>{formatTokens(view.cache)}</p></div>
          </div>
          {projects.length > 0 && <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
            {projects.map(p => <li key={p.id} className="muted" style={{ padding: '4px 0' }}>{p.label} · 새로 {formatTokens(p.fresh)} · 캐시 {formatTokens(p.cache)}</li>)}
          </ul>}
          {view.findings.length === 0
            ? <p role="status" style={{ color: 'var(--accent)', fontWeight: 700 }}>새는 곳 없어요 — 정상이에요</p>
            : <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>{view.findings.map((f, i) => <TokenFindingRow key={i} f={f} />)}</ul>}
          <p className="muted">5분마다 알아서 새로 고쳐요.</p>
          <details><summary>원문 보기</summary><pre className="mono">{rawJson}</pre></details>
        </>}
    </section>
  );
}

function WhoLine({ board }: { board: ControlRoomBoard | null }): React.ReactElement {
  const items = controlRoomWorkingItems(board?.lanes ?? []);
  const rows = controlRoomRoutingLine(board?.routing);
  return (
    <section className="control-card who-line" aria-label="지금 일하는 AI">
      <p className="control-card-value who-text">지금 일하는 AI</p>
      {items.length === 0 && rows.length === 0 ? <p className="muted">쉬는 중</p> : <>
        {items.map((item, index) => <div key={`${item.text}-${index}`} className="muted"><p>{item.text}</p>{item.taskId && <details className="who-raw"><summary>원문 보기</summary><span className="mono">ID: {item.taskId}</span></details>}</div>)}
        {rows.map(row => <p key={row} className="muted">{row}</p>)}
      </>}
    </section>
  );
}

interface ParsedGate {
  gateId: string;
  title: string;
  options: string[];
  category: string;
  summary: string;
  canSaveRule: boolean;
}

function sanitizeCategory(raw: unknown): string {
  const lowered = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return /^[a-z-]{2,30}$/.test(lowered) ? lowered : 'gate-approval';
}

function parseGate(gate: Record<string, unknown>): ParsedGate | null {
  const rawId = gate.gateId ?? gate.id;
  if (typeof rawId !== 'string' || !rawId) return null;
  const title = label(gate.ask ?? gate.title ?? gate.question ?? gate.summary, rawId);
  const rawOptions = gate.options ?? gate.choices ?? gate.candidates;
  const options = Array.isArray(rawOptions)
    ? rawOptions
      .map(option => {
        if (typeof option === 'string') return option;
        if (option && typeof option === 'object') {
          const record = option as Record<string, unknown>;
          return label(record.label ?? record.title, '');
        }
        return '';
      })
      .filter(option => option !== '')
    : [];
  const list = options.length > 0 ? options : ['승인', '반려'];
  const category = sanitizeCategory(gate.category ?? gate.kind ?? 'gate-approval');
  const summary = title.slice(0, 200) || rawId;
  return { gateId: rawId, title, options: list, category, summary, canSaveRule: !NEVER_AUTO_CATEGORIES.has(category) };
}

function statusText(status: ActionStatus): string {
  if (!status) return '';
  const prefix = status.state === 'pending' ? '…' : status.state === 'done' ? '✓ ' : '! ';
  return `${prefix}${status.text}`;
}

/** opencode-free는 화면에서 '무료 모델(예비)'로 보여준다. */
const runtimeLabel = (runtime: string): string => (runtime === 'opencode-free' ? '무료 모델(예비)' : aiDisplayName(runtime));

function ChainEditor({ project, role, initial, workerChain, onRefresh }: {
  project: string;
  role: 'worker' | 'qa';
  initial: string[];
  workerChain?: string[];
  onRefresh: () => Promise<void>;
}): React.ReactElement {
  const [picked, setPicked] = useState<string[]>(initial);
  const [status, setStatus] = useState<ActionStatus>(null);
  const [busy, setBusy] = useState(false);
  const selfReview = role === 'qa' ? isSelfReviewChain(workerChain ?? [], picked) : false;

  function toggle(runtime: string): void {
    setPicked(prev => {
      if (prev.includes(runtime)) return prev.filter(item => item !== runtime);
      if (prev.length >= 4) return prev;
      return [...prev, runtime];
    });
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (busy || picked.length < 1) return;
    if (role === 'qa' && isSelfReviewChain(workerChain ?? [], picked)) return;
    setBusy(true);
    setStatus({ state: 'pending', text: '저장 중…' });
    try {
      await must({ op: 'controlRoom:laneSet', project, role, runtimes: picked });
      setStatus({ state: 'done', text: `저장됨 (${role === 'worker' ? '만드는 AI' : '검수하는 AI'}: ${picked.map(runtimeLabel).join(' → ')})` });
      await onRefresh();
    } catch (err) {
      setStatus({ state: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="chain-editor" onSubmit={e => void submit(e)} aria-label={`${role === 'worker' ? '만드는 AI 순서 저장' : '검수하는 AI 순서 저장'}`}>
      <h4>{role === 'worker' ? '만드는 AI 바꾸기' : '검수하는 AI 바꾸기'}</h4>
      <p className="muted">순서대로 선택 — 첫 번째가 우선, 나머지는 예비 (최대 4개)</p>
      <div className="chain-picks" role="group" aria-label={`${role === 'worker' ? '만드는 AI 순서 선택' : '검수하는 AI 순서 선택'}`}>
        {RUNTIMES.map(runtime => {
          const order = picked.indexOf(runtime);
          return (
            <button
              key={runtime}
              type="button"
              className={`chain-pick${order >= 0 ? ' selected' : ''}`}
              aria-pressed={order >= 0}
              onClick={() => toggle(runtime)}
            >
              {order >= 0 && <span className="chain-order">{order + 1}</span>}
              {runtimeLabel(runtime)}
            </button>
          );
        })}
      </div>
      <p className="chain-current">현재 순서: <strong>{picked.length ? picked.map(runtimeLabel).join(' → ') : '—'}</strong></p>
      {selfReview && <p className="muted">만든 AI가 스스로 검수할 수 없어요. 다른 AI를 첫 번째로 골라 주세요.</p>}
      <button className="btn" type="submit" disabled={busy || picked.length < 1 || selfReview}>
        {busy ? '저장 중…' : 'AI 순서 저장'}
      </button>
      {status && <p className={`control-status ${status.state}`} role="status">{statusText(status)}</p>}
    </form>
  );
}

function ResumeControl({ project, onRefresh }: {
  project: string;
  onRefresh: () => Promise<void>;
}): React.ReactElement {
  const [status, setStatus] = useState<ActionStatus>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);

  async function resume(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setStatus({ state: 'pending', text: '다시 시작 중…' });
    try {
      await must({ op: 'controlRoom:resume', project });
      setStatus({ state: 'done', text: '다시 시작됨' });
      setPending(false);
      await onRefresh();
    } catch (err) {
      setStatus({ state: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="resume-control">
      <button className="btn primary" type="button" disabled={busy} onClick={() => setPending(true)}>
        {busy ? '다시 시작 중…' : '다시 시작'}
      </button>
      {pending && (
        <InlineConfirm
          message="다시 시작하시겠어요?"
          confirmLabel="다시 시작"
          busy={busy}
          busyLabel="다시 시작 중…"
          onConfirm={() => void resume()}
          onCancel={() => setPending(false)}
        />
      )}
      {status && <p className={`control-status ${status.state}`} role="status">{statusText(status)}</p>}
    </div>
  );
}

function GateForm({ gate, onRefresh }: {
  gate: Record<string, unknown>;
  onRefresh: () => Promise<void>;
}): React.ReactElement {
  const parsed = parseGate(gate);
  const [pick, setPick] = useState(0);
  const [saveRule, setSaveRule] = useState(false);
  const [status, setStatus] = useState<ActionStatus>(null);
  const [busy, setBusy] = useState(false);

  if (!parsed) {
    return <p>{detail(gate.ask ?? gate.title ?? gate.gateId ?? gate.status ?? '확인 필요')}</p>;
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (busy || !parsed) return;
    setBusy(true);
    setStatus({ state: 'pending', text: '제출 중…' });
    try {
      await must({ op: 'gates:answer', gateId: parsed.gateId, optionIndex: pick });
      let text = `제출됨 (${parsed.options[pick] ?? String(pick)})`;
      if (saveRule && parsed.canSaveRule) {
        await must({ op: 'controlRoom:approvalAdd', category: parsed.category, summary: parsed.summary });
        text += ` · 규칙 저장됨 (${parsed.category})`;
      }
      setStatus({ state: 'done', text });
      await onRefresh();
    } catch (err) {
      setStatus({ state: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={e => void submit(e)}>
      <fieldset className="gate-fieldset">
        <legend>{parsed.title}</legend>
        <details><summary>원문 보기</summary><p className="muted mono gate-id">{parsed.gateId}</p></details>
        {parsed.options.map((option, index) => (
          <label key={`${parsed.gateId}-${index}`} className="plan-radio">
            <input
              type="radio"
              name={`gate-${parsed.gateId}`}
              checked={pick === index}
              onChange={() => setPick(index)}
            />
            {option}
          </label>
        ))}
        {parsed.canSaveRule && (
          <label className="save-rule">
            <input
              type="checkbox"
              checked={saveRule}
              onChange={e => setSaveRule(e.target.checked)}
            />
            승인 + 규칙으로 저장 ({parsed.category})
          </label>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? '제출 중…' : '답변 제출'}
        </button>
        {status && <p className={`control-status ${status.state}`} role="status">{statusText(status)}</p>}
      </fieldset>
    </form>
  );
}

function HoldOptionButtons({ hold, gateId, taskTitle, onRefresh }: {
  hold: Pick<NormalizedHold, 'options' | 'optionIds' | 'optionDetails' | 'recommendedIndex' | 'choiceLabel'> & { taskId?: string };
  gateId: string | null;
  taskTitle: string;
  onRefresh: () => Promise<void>;
}): React.ReactElement {
  const groupName = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(Math.max(0, hold.recommendedIndex));
  const [status, setStatus] = useState<ActionStatus>(null);
  const [busy, setBusy] = useState(false);
  const [doneLabel, setDoneLabel] = useState('');

  async function confirm(optionIndex: number, optionLabel: string): Promise<void> {
    if (busy) return;
    const optionId = hold.optionIds[optionIndex];
    if (isSelfReviewOption(optionLabel)) {
      setOpen(false);
      setStatus({ state: 'done', text: '직접 확인할게요 — 아래 원문 보기에서 증거를 확인하세요.' });
      return;
    }
    setBusy(true);
    setStatus({ state: 'pending', text: `실행 중… (${optionLabel})` });
    try {
      if (gateId) {
        await must({ op: 'gates:answer', gateId, optionIndex });
      } else {
        if (!hold.taskId || !optionId) throw new Error('멈춘 작업 정보가 없어 실행할 수 없습니다.');
        await must({ op: 'controlRoom:holdChoose', taskId: hold.taskId, option: optionId as 'retry' | 'narrow' | 'skip' });
      }
      setStatus(null);
      setOpen(false);
      setDoneLabel(optionLabel);
      await onRefresh();
    } catch (err) {
      setStatus({ state: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const savedLabel = doneLabel || hold.choiceLabel;
  if (savedLabel) return <p className="hold-saved" role="status">선택했어요: {savedLabel} · 곧 다시 설계해요</p>;

  const recommendedLabel = hold.options[hold.recommendedIndex] ?? hold.options[0] ?? '';
  const option = hold.options[selected] ?? recommendedLabel;
  return (
    <div className="hold-options" role="group" aria-label="선택지">
      <p className="hold-so">
        그래서{' '}
        <button type="button" className="hold-recommend-link" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}>{recommendedLabel}</button>
        {' '}할게요.
      </p>
      {open && (
        <div className="hold-confirm">
          <div role="radiogroup" aria-label="어떻게 할까요">
            {hold.options.map((label, optionIndex) => {
              const recommended = optionIndex === hold.recommendedIndex;
              const detail = hold.optionDetails[optionIndex];
              return (
                <label key={`${hold.taskId ?? 'hold'}-${optionIndex}`} className={`hold-option hold-option-row${recommended ? ' recommended' : ''}${selected === optionIndex ? ' selected' : ''}`}>
                  <input type="radio" name={groupName} checked={selected === optionIndex} disabled={busy} onChange={() => setSelected(optionIndex)} />
                  <span className="hold-option-text">
                    <strong>{label}{recommended ? ' (추천)' : ''}</strong>
                    {detail && <small>{detail}</small>}
                  </span>
                </label>
              );
            })}
          </div>
          <p>‘{taskTitle}’을 ‘{option}’로 진행할게요</p>
          <div className="hold-confirm-actions">
            <button className="btn primary" type="button" disabled={busy} onClick={() => void confirm(selected, option)}>
              {busy ? '실행 중…' : '이대로 진행'}
            </button>
            <button className="btn subtle" type="button" disabled={busy} onClick={() => setOpen(false)}>
              취소
            </button>
          </div>
        </div>
      )}
      {status && <p className={`control-status ${status.state}`} role="status">{statusText(status)}</p>}
    </div>
  );
}

const HOLD_PAGE = 3;

function HoldCards({ holds, titleOf, gateId, qaFinding, hasBlocker, onRefresh }: {
  holds: NormalizedHold[];
  titleOf: (hold: NormalizedHold) => string;
  gateId: string | null;
  qaFinding: unknown;
  hasBlocker: boolean;
  onRefresh: () => Promise<void>;
}): React.ReactElement {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? holds : holds.slice(0, HOLD_PAGE);
  // 보류 항목 없이 blocker만 있을 때도 멈춘 작업 1개로 보여준다.
  const count = Math.max(holds.length, hasBlocker ? 1 : 0);
  return (
    <article className="control-card hold-warn wide" id="lane-hold">
      <h3><span aria-hidden="true">⚠ </span>{holdHeadingText(count)}</h3>
      {shown.map((hold, index) => {
        const autoText = holdAutoProceedText(hold.heldSeen, hold.waitMin);
        return (
          <section key={hold.taskId || hold.sentence || index} className="hold-card">
            <p className="hold-card-title">{titleOf(hold)}</p>
            <ol className="hold-flow" aria-label="진행 단계">
              {holdFlowStates(hold.step).map(({ name, state }) => (
                <li key={name} className={`hold-flow-step ${state}`}>
                  <span className="hold-flow-mark" aria-hidden="true">{state === 'done' ? '✓' : state === 'hold' ? '⚠' : '○'}</span>
                  <span>{name}</span>
                </li>
              ))}
            </ol>
            <p className="hold-sentence">{hold.sentence || '쉬운 말로 바꾸는 중이에요…'}</p>
            {hold.sentence && <HoldOptionButtons hold={hold} gateId={gateId} taskTitle={titleOf(hold)} onRefresh={onRefresh} />}
            {hold.sentence && !hold.choice && autoText && <p className="muted hold-auto">{autoText}</p>}
            <details>
              <summary>원문 보기</summary>
              <p className="muted mono">ID: {hold.taskId || '—'}</p>
              <pre className="mono">{hold.reason}</pre>
            </details>
          </section>
        );
      })}
      {holds.length === 0 && (
        <section className="hold-card">
          <p className="hold-sentence">쉬운 말로 바꾸는 중이에요…</p>
        </section>
      )}
      {qaFinding !== undefined && <details><summary>원문 검수 의견</summary><pre className="mono">{rawText(qaFinding)}</pre></details>}
      {!showAll && holds.length > HOLD_PAGE && (
        <button className="btn subtle" type="button" onClick={() => setShowAll(true)}>더 보기 ({holds.length - HOLD_PAGE}개)</button>
      )}
    </article>
  );
}

// ── 라이브 상태 카드: 지금 하는 일 · 여기까지 끝남 · 확인 상태 · 대표님 할 일 · 다음 단계 ──
// 개발자 원문(작업 ID)은 접힌 '원문 보기'에만 둔다. Pure helper + 카드 하나.

const STEPS = ['계획', '만들기', '검사', '시험', '반영'] as const;
/** FLOW(7단계) 인덱스 → STEPS(5단계) 인덱스. 사람 확인은 시험에 붙는다. */
const STEP_OF_FLOW = [0, 0, 1, 2, 3, 3, 4];
const STAGE_VERB = ['계획하는', '확인하는', '만드는', '검사하는', '시험하는', '대표님 확인을 기다리는', '반영하는'];
const START_KEYS = ['startedAt', 'started_at', 'startAt', 'since'];

interface LiveStatus {
  headline: string;
  doing: string;
  progress: string;
  lastDone: string;
  verify: '확인됨' | '일부 확인' | '확인하지 못함';
  verifyEvidence: string;
  todo: '없음' | '확인 필요' | '결정 필요' | '설정 필요';
  todoButton: { label: string; target: string } | null;
  next: string;
  taskId: string;
}

function minutesSince(value: unknown, now: number): number | null {
  const ms = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? Math.max(0, Math.floor((now - ms) / 60000)) : null;
}

function spanText(min: number): string {
  if (min < 60) return `${min}분`;
  if (min < 1440) return min % 60 ? `${Math.floor(min / 60)}시간 ${min % 60}분` : `${min / 60}시간`;
  return `${Math.floor(min / 1440)}일`;
}

/** 받침 있는 이름은 '이', 아니면 '가'. */
function subjectParticle(name: string): string {
  const code = name.charCodeAt(name.length - 1);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0 ? '이' : '가';
}

export function liveStatusOf(lane: ControlRoomLane, now: number = Date.now()): LiveStatus {
  const current = lane.current ?? {};
  const holds = visibleHoldEntries(lane.holds);
  const hasCurrent = hasWork(lane);
  const holdCurrent = !hasCurrent ? holds[0] : undefined;
  const rawHold = holdCurrent && lane.holds?.find(entry => entry && typeof entry === 'object' && controlRoomTaskId(entry) === holdCurrent.taskId);
  const task = hasCurrent ? current : rawHold;
  const working = hasCurrent || Boolean(holdCurrent);
  const stageValue = hasCurrent ? current.stage ?? 0 : holdCurrent?.step ?? 0;
  const idx = stageIndex(stageValue);
  const doneSteps = !working ? 0 : flowState(stageValue, 6) === 'done' ? STEPS.length : STEP_OF_FLOW[idx] ?? 0;
  const paused = isPaused(lane);
  const title = currentTitleOf(task);
  const worker = lane.workerChain ?? current.worker;
  const aiId = chainToList(idx >= 3 ? lane.qaChain ?? current.qa : worker)[0];
  const ai = aiId ? runtimeLabel(aiId) : 'AI';
  const startedAt = START_KEYS.map(key => current[key]).find(value => value !== undefined && value !== '');
  const startedMin = minutesSince(startedAt, now);
  const elapsed = startedMin === null ? '' : startedMin < 1 ? ' · 방금 시작' : ` · ${spanText(startedMin)}째`;

  const doing = !working ? '지금 하는 일이 없어요. 쉬는 중이에요.'
    : paused ? `'${title}' 작업이 멈춰 있어요.`
    : `${ai}${subjectParticle(ai)} '${title}' ${STAGE_VERB[idx] ?? '진행하는'} 중${elapsed}`;
  const progress = !working ? '진행 중인 작업이 없어요.'
    : doneSteps === 0 ? `${STEPS.length}단계 중 아직 시작 단계예요 (${STEPS.join(' → ')})`
    : `${STEPS.length}단계 중 ${doneSteps}단계 끝남 (${STEPS.slice(0, doneSteps).join(' → ')})`;
  const lastItem = controlRoomTodayDone({ lanes: [lane] })[0];
  const agoMin = minutesSince(lastItem?.finishedAt, now);
  const lastDone = lastItem
    ? `마지막으로 끝난 일: '${lastItem.title}'${agoMin === null ? '' : ` · ${agoMin < 1 ? '방금' : `${spanText(agoMin)} 전`}`}`
    : '오늘 끝난 일은 아직 없어요.';

  const verified = controlRoomVerifiedDoneTotal({ lanes: [lane] });
  const [verify, verifyEvidence]: [LiveStatus['verify'], string] =
    doneSteps >= STEPS.length ? ['확인됨', '모든 단계 통과']
    : doneSteps >= 3 ? ['일부 확인', `${STEPS[doneSteps - 1]}까지 통과했어요`]
    : !working && verified > 0 ? ['확인됨', `끝난 작업 ${verified}개 확인됨`]
    : verified > 0 ? ['일부 확인', `지금까지 끝난 작업 ${verified}개는 확인됨`]
    : ['확인하지 못함', '아직 확인한 기록이 없어요'];

  const gate = lane.humanGate ?? lane.founderGate;
  const [todo, todoButton, headline]: [LiveStatus['todo'], LiveStatus['todoButton'], string] =
    gate ? ['결정 필요', { label: '답하러 가기', target: 'lane-gate' }, '결정하실 일이 있어요. 아래 버튼을 눌러 주세요.']
    : holds.length > 0 ? ['결정 필요', { label: '고르러 가기', target: 'lane-hold' }, '멈춘 작업이 있어요. 어떻게 할지 골라 주세요.']
    : paused ? ['확인 필요', { label: '멈춘 이유 보기', target: holdSummary(lane, '') !== null ? 'lane-hold' : 'lane-current' }, '멈춘 작업이 있어요. 이유를 확인해 주세요.']
    : chainToList(worker).length === 0 ? ['설정 필요', { label: '담당 AI 정하기', target: 'lane-ai' }, '설정이 하나 필요해요. 아래 버튼을 눌러 주세요.']
    : ['없음', null, working ? '지금 하실 일은 없어요. 알아서 진행 중이에요.' : '지금 하실 일은 없어요. 쉬는 중이에요.'];

  const next = gate ? '대표님이 답하시면 바로 이어서 진행해요.'
    : holds.length > 0 ? holdAutoProceedText(holds[0]?.heldSeen, holds[0]?.waitMin) || '고르시면 곧 다시 설계해요.'
    : paused ? '다시 시작하시면 이어서 진행해요.'
    : !working ? '새 작업이 정해지면 알아서 시작해요.'
    : doneSteps >= STEPS.length ? '모두 끝났어요. 새 작업을 기다려요.'
    : STEPS[doneSteps + 1] ? `이 단계가 끝나면 알아서 '${STEPS[doneSteps + 1]}' 단계로 넘어가요.`
    : '반영이 끝나면 이 작업은 마무리돼요.';
  return { headline, doing, progress, lastDone, verify, verifyEvidence, todo, todoButton, next, taskId: working ? controlRoomTaskId(task) : '' };
}

/**
 * '이 프로젝트만 새 창으로' 버튼 — 결과는 누른 자리에서 바로 보여준다.
 * 훅 없이 DOM만 써서, 훅 없는 환경(카드 단독 렌더)에서도 그대로 그려진다.
 */
async function openProjectWindow(box: HTMLElement, project: string): Promise<void> {
  const note = box.querySelector<HTMLElement>('[data-note]')!;
  const retry = box.querySelector<HTMLElement>('[data-retry]')!;
  const api = window.relayApi?.openProjectWindow;
  const res = api ? await api(projectWindowKey(project)).catch(() => null) : null;
  const ok = res?.ok === true;
  note.style.color = ok ? 'var(--accent)' : 'var(--warn)';
  note.textContent = ok
    ? (res.value.focused ? '이미 열려 있어서 그 창을 앞으로 가져왔어요 ✓' : '새 창을 열었어요 ✓')
    : ['새 창을 열지 못했어요.',
      res ? '이 프로젝트 이름으로는 창을 만들 수 없었던 것 같아요.' : '이 앱이 창 만들기를 아직 준비하지 못했어요. 컴퓨터는 켜져 있고, 앱만 다시 켜면 돼요.',
      '아래 [다시 시도]를 눌러 주세요.'].join('\n');
  retry.hidden = ok;
}

function OpenProjectWindowButton({ project }: { project: string }): React.ReactElement {
  const run = (el: HTMLElement): void => { void openProjectWindow(el.closest('[data-open-window]') as HTMLElement, project); };
  return (
    <div data-open-window>
      <button className="btn" type="button" style={{ minHeight: 44 }} onClick={e => run(e.currentTarget)}>이 프로젝트만 새 창으로</button>
      <p role="status" data-note style={{ whiteSpace: 'pre-line' }} />
      <button className="btn" type="button" data-retry hidden style={{ minHeight: 44 }} onClick={e => run(e.currentTarget)}>다시 시도</button>
    </div>
  );
}

export function LiveStatusCard({ lane, now }: { lane: ControlRoomLane; now?: number }): React.ReactElement {
  const s = liveStatusOf(lane, now);
  const tone = (ok: boolean): React.CSSProperties => ({ color: ok ? 'var(--accent)' : 'var(--warn)' });
  return (
    <section className="control-card wide live-status" aria-label="지금 상태" style={{ fontSize: 16 }}>
      <p className="control-card-value">{s.headline}</p>
      <p><strong>지금 하는 일</strong><br />{s.doing}</p>
      <p><strong>여기까지 끝남</strong><br />{s.progress}<br />{s.lastDone}</p>
      <p><strong>확인 상태</strong><br /><span style={tone(s.verify === '확인됨')}>{s.verify}</span> · {s.verifyEvidence}</p>
      <p><strong>대표님 할 일</strong><br /><span style={tone(s.todo === '없음')}>{s.todo}</span></p>
      {s.todoButton && (
        <button className="btn primary" type="button" style={{ minHeight: 44 }}
          onClick={() => document.getElementById(s.todoButton!.target)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
          {s.todoButton.label}
        </button>
      )}
      <p><strong>다음 단계</strong><br />{s.next}</p>
      {s.taskId && <details><summary>원문 보기</summary><p className="muted mono">ID: {s.taskId}</p></details>}
    </section>
  );
}

function LaneView({ lane, onRefresh, canOpenWindow = true }: {
  lane: ControlRoomLane;
  canOpenWindow?: boolean;
  onRefresh: () => Promise<void>;
}): React.ReactElement {
  const current = lane.current ?? {};
  const holds = visibleHoldEntries(lane.holds);
  const hasCurrent = hasWork(lane);
  const holdCurrent = !hasCurrent ? holds[0] : undefined;
  const rawHold = holdCurrent && lane.holds?.find(entry => entry && typeof entry === 'object' && controlRoomTaskId(entry) === holdCurrent.taskId);
  const currentTask = hasCurrent ? current : rawHold;
  const stageValue = hasCurrent ? current.stage ?? 0 : holdCurrent?.step ?? 0;
  const working = hasCurrent || Boolean(holdCurrent);
  const taskTitle = currentTitleOf(currentTask);
  const taskId = hasCurrent ? currentIdOf(current) : holdCurrent?.taskId ?? '';
  const stage = working ? (holdCurrent ? `멈춤 · ${holdStepLabel(stageValue) || FLOW[stageIndex(stageValue)] || '계획'}` : (FLOW[stageIndex(stageValue)] ?? '계획')) : '쉬는 중';
  const gate = lane.humanGate ?? lane.founderGate;
  const worker = lane.workerChain ?? current.worker;
  const qa = lane.qaChain ?? current.qa;
  const project = projectOf(lane);
  const presentation = projectPresentation(lane);
  const qaFinding = qaFindingOf(lane);
  const paused = isPaused(lane);
  const chainText = (value: unknown): string => {
    const ids = chainToList(value);
    return ids.length ? ids.map(runtimeLabel).join(' → ') : detail(value);
  };
  const workerText = chainText(worker);
  const qaText = chainText(qa);
  const showWorker = workerText !== '' && workerText !== '—';
  const showQa = qaText !== '' && qaText !== '—';
  const holdTitle = (hold: { taskId?: string; reason?: string }): string => {
    const raw = lane.holds?.find(entry => entry && typeof entry === 'object' &&
      controlRoomTaskId(entry) === hold.taskId);
    return founderTaskTitle(raw ?? hold);
  };
  const showHoldCard = holds.length > 0 || holdSummary(lane, '') !== null;
  const gateRecord = (lane.humanGate ?? lane.founderGate) as Record<string, unknown> | undefined;
  const gateIdForHold = typeof gateRecord?.gateId === 'string' && gateRecord.gateId
    ? gateRecord.gateId
    : typeof gateRecord?.id === 'string' && gateRecord.id ? gateRecord.id : null;
  return (
    <section className="control-lane-view">
      <header className="control-card">
        <h2>{presentation.name}</h2>
        <details>
          <summary>원문 보기</summary>
          <p className="muted mono">{presentation.id || '—'}</p>
          {taskId && <p className="muted mono">ID: {taskId}</p>}
          <pre className="mono">{rawText(lane)}</pre>
        </details>
      </header>
      <LiveStatusCard lane={lane} />
      {canOpenWindow && project && <OpenProjectWindowButton project={project} />}
      <div className="control-flow" aria-label="진행 단계">
        {FLOW.map((name, index) => {
          const state = working && holdCurrent ? flowState(`BLOCK ${stageValue}`, index) : working ? flowState(stageValue, index) : 'pending';
          return <div className={`control-step ${state}`} key={name}><span className="control-step-dot">{state === 'done' ? '✓' : state === 'blocked' ? '!' : state === 'active' ? '●' : '○'}</span><span>{name}</span></div>;
        })}
      </div>
      <div className="control-cards">
        <article className="control-card" id="lane-current">
          <h3>현재 작업</h3>
          <p className="control-card-value">{working ? (taskTitle || '지금 하는 일 없음') : '쉬는 중'}</p>
          <p className="muted">단계: {stage}</p>
          {working && <details><summary>원문 보기</summary><p className="muted mono">ID: {taskId || '—'}</p><pre className="mono">{rawText(currentTask)}</pre></details>}
          {paused && project && holds.length === 0 && <ResumeControl project={project} onRefresh={onRefresh} />}
        </article>
        <article className="control-card wide" id="lane-ai">
          <h3>담당 AI</h3>
          {showWorker && <p>만드는 AI: <strong>{workerText}</strong></p>}
          {showQa && <p>검수하는 AI: <strong>{qaText}</strong></p>}
          {project && (
            <div className="control-actions">
              <ChainEditor key={`${project}-worker`} project={project} role="worker" initial={chainToList(worker)} onRefresh={onRefresh} />
              <ChainEditor key={`${project}-qa`} project={project} role="qa" initial={chainToList(qa)} workerChain={chainToList(worker)} onRefresh={onRefresh} />
            </div>
          )}
        </article>
        {showHoldCard && <HoldCards holds={holds} titleOf={holdTitle} gateId={gateIdForHold} qaFinding={qaFinding} hasBlocker={holds.length === 0} onRefresh={onRefresh} />}
        {gate && <article className="control-card human" id="lane-gate"><h3>사람 확인</h3><GateForm gate={gate} onRefresh={onRefresh} /></article>}
      </div>
    </section>
  );
}

/** 공유 자리 한 줄. capacity가 없으면 호출하지 않는다. */
function SharedSeatsCard({ view }: { view: SharedSeatsView }): React.ReactElement {
  return (
    <section className={`shared-seats${view.memory ? ' is-low' : ''}`} aria-label="전체 AI 자리">
      <p className="shared-seats-line">
        전체 AI 자리 <strong className="shared-seats-count">{view.max}</strong>개 중 <strong className="shared-seats-count">{view.busy}</strong>개 사용 중
      </p>
      <div
        className="shared-seats-bar"
        role="progressbar"
        aria-label={view.line}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.percent}
      >
        <span style={{ width: `${view.percent}%` }} />
      </div>
      {view.waiting && <p className="shared-seats-wait">{view.waiting}</p>}
      {view.memory && <p className="shared-seats-memory">{view.memory}</p>}
      {view.raw && (
        <details className="shared-seats-raw">
          <summary>원문 보기</summary>
          <pre className="mono">{view.raw}</pre>
        </details>
      )}
    </section>
  );
}

/** Stable key for lane selection — lane id first, never a bare index. */
function laneSelectKey(lane: ControlRoomLane, index: number): string {
  if (typeof lane.id === 'string' && lane.id) return lane.id;
  if (typeof lane.project === 'string' && lane.project) return lane.project;
  return `__index-${index}`;
}

/** Sort rank for attention badges: decision first, then hold, then the rest. */
function attentionRank(lane: ControlRoomLane): number {
  const attn = laneAttention(lane);
  if (attn === 'decision') return 0;
  if (attn === 'hold') return 1;
  return 2;
}

/** Stable-sort lanes so 'decision' lanes come first, then 'hold', then the rest. */
function sortLanesByAttention(lanes: ControlRoomLane[]): ControlRoomLane[] {
  return lanes
    .map((lane, index) => ({ lane, index }))
    .sort((a, b) => attentionRank(a.lane) - attentionRank(b.lane) || a.index - b.index)
    .map(entry => entry.lane);
}

/** localStorage key. '1' means the Founder already tapped 알겠어요. */
export const CR_TOP_GUIDE_KEY = 'agent-relay.cr-top.guide';

export interface CrTopGuideStep {
  title: string;
  text: string;
}

export interface CrTopStat {
  label: '오늘 끝난 작업' | '지금 일하는 AI' | '멈춘 작업' | '대기';
  value: number;
  tone: 'teal' | 'amber' | 'muted';
}

export interface CrTopBanner {
  tone: 'amber' | 'teal';
  title: string;
  /** Second line. Empty when there is nothing to choose, or no waitMin on the holds. */
  detail: string;
  /** Empty when the banner has no button. */
  actionLabel: string;
}

/**
 * First-run three steps: what this screen is, the one setting, what happens next.
 * Copy is fixed; the numbers on the screen are not.
 */
export function crTopGuideSteps(): CrTopGuideStep[] {
  return [
    { title: '이건 무엇인가요', text: 'AI들이 계획부터 반영까지 대신 굴러가요.' },
    { title: '필요한 설정 한 가지: 작업 PC 연결', text: '켜져 있는 컴퓨터 하나만 고르면 돼요.' },
    { title: '다음에 일어나는 일', text: '멈추면 추천 선택지를 먼저 보여드려요.' },
  ];
}

/**
 * True after 알겠어요 was remembered. A missing or broken store means the guide still shows.
 */
export function crTopGuideDismissed(read: ((key: string) => string | null) | null | undefined): boolean {
  try {
    return read?.(CR_TOP_GUIDE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember 알겠어요 on this computer. A store that refuses the write is ignored. */
export function crTopRememberGuide(write: ((key: string, value: string) => void) | null | undefined): void {
  try {
    write?.(CR_TOP_GUIDE_KEY, '1');
  } catch {
    /* 이번 화면에서는 닫기만 한다. */
  }
}

function crTopLanes(board: unknown): Record<string, unknown>[] {
  if (!board || typeof board !== 'object' || Array.isArray(board)) return [];
  const lanes = (board as { lanes?: unknown }).lanes;
  if (!Array.isArray(lanes)) return [];
  return lanes.filter((lane): lane is Record<string, unknown> => Boolean(lane) && typeof lane === 'object' && !Array.isArray(lane));
}

/** Visible holds, plus a blocker-only lane as one stuck item. Skip-choice holds stay hidden. */
function crTopStuck(board: unknown): { count: number; waitMin: number | null } {
  let count = 0;
  let waitMin: number | null = null;
  for (const lane of crTopLanes(board)) {
    const holds = visibleHoldEntries(lane.holds);
    if (holds.length > 0) {
      count += holds.length;
      for (const hold of holds) {
        if (hold.waitMin !== null && (waitMin === null || hold.waitMin < waitMin)) waitMin = hold.waitMin;
      }
      continue;
    }
    if (typeof lane.blocker === 'string' && lane.blocker.trim()) count += 1;
  }
  return { count, waitMin };
}

/** Queued work already on the lane. counts.QUEUED wins; otherwise queued tasks; otherwise the lane itself. */
function crTopQueued(lane: Record<string, unknown>): number {
  const counts = lane.counts;
  if (counts && typeof counts === 'object' && !Array.isArray(counts)) {
    const queued = (counts as Record<string, unknown>).QUEUED;
    if (typeof queued === 'number' && Number.isFinite(queued) && queued > 0) return Math.floor(queued);
  }
  if (Array.isArray(lane.tasks)) {
    const queuedTasks = lane.tasks.filter((task) => {
      if (task === 'QUEUED') return true;
      if (!task || typeof task !== 'object' || Array.isArray(task)) return false;
      const record = task as Record<string, unknown>;
      return record.state === 'QUEUED' || record.status === 'QUEUED';
    }).length;
    if (queuedTasks > 0) return queuedTasks;
  }
  const current = lane.current && typeof lane.current === 'object' && !Array.isArray(lane.current)
    ? lane.current as Record<string, unknown>
    : null;
  if (lane.state === 'QUEUED' || lane.status === 'QUEUED') return 1;
  if (current && (current.state === 'QUEUED' || current.status === 'QUEUED' || current.stage === 'QUEUED')) return 1;
  return 0;
}

function crTopWaitLine(waitMin: number | null): string {
  if (waitMin === null || !Number.isFinite(waitMin) || waitMin <= 0) return '';
  const minutes = Math.max(1, Math.round(waitMin));
  return `${minutes}분 안에 고르지 않으면 추천대로 진행해요`;
}

/**
 * One banner from the board. Holds use the soonest waitMin.
 * No holds means the teal "nothing to do" line, with no invented minutes.
 */
export function crTopBanner(board: unknown): CrTopBanner {
  const stuck = crTopStuck(board);
  if (stuck.count > 0) {
    return {
      tone: 'amber',
      title: `멈춘 작업 ${stuck.count}건`,
      detail: crTopWaitLine(stuck.waitMin),
      actionLabel: '멈춘 작업 보기',
    };
  }
  return {
    tone: 'teal',
    title: '지금 하실 일은 없어요. 알아서 진행 중이에요.',
    detail: '',
    actionLabel: '',
  };
}

/**
 * Four tiles. Today and working AI reuse the board helpers.
 * Stuck is amber. Waiting is queued work only — never a sample number.
 */
export function crTopStats(board: unknown): CrTopStat[] {
  const waiting = crTopLanes(board).reduce((sum, lane) => sum + crTopQueued(lane), 0);
  return [
    { label: '오늘 끝난 작업', value: controlRoomTodayCount(board), tone: 'teal' },
    { label: '지금 일하는 AI', value: controlRoomWorkingItems(board).length, tone: 'muted' },
    { label: '멈춘 작업', value: crTopStuck(board).count, tone: 'amber' },
    { label: '대기', value: waiting, tone: 'muted' },
  ];
}

function CrTopGuide({ onDismiss }: { onDismiss: () => void }): React.ReactElement {
  return (
    <section className="cr-top-guide" aria-label="처음 안내">
      <ol className="cr-top-guide-steps">
        {crTopGuideSteps().map((step, index) => (
          <li key={step.title}>
            <p className="cr-top-guide-title"><span className="cr-top-step">{index + 1}</span>{step.title}</p>
            <p className="cr-top-guide-text">{step.text}</p>
          </li>
        ))}
      </ol>
      <div className="cr-top-guide-actions">
        <button type="button" className="btn cr-top-btn cr-top-btn-teal" onClick={onDismiss}>알겠어요</button>
      </div>
    </section>
  );
}

function CrTopBody({ board, note, onShowHolds }: {
  board: ControlRoomBoard;
  note: string;
  onShowHolds: () => void;
}): React.ReactElement {
  const banner = crTopBanner(board);
  const stats = crTopStats(board);
  return (
    <>
      <section className={`cr-top-banner ${banner.tone}`} aria-label={banner.title}>
        <div className="cr-top-banner-copy">
          <p className="cr-top-banner-title">{banner.title}</p>
          {banner.detail ? <p className="cr-top-banner-detail">{banner.detail}</p> : null}
          {note ? <p className="cr-top-jump" role="status">{note}</p> : null}
        </div>
        {banner.actionLabel ? (
          <button type="button" className="btn cr-top-btn cr-top-btn-amber" onClick={onShowHolds}>{banner.actionLabel}</button>
        ) : null}
      </section>
      <section className="cr-top-stats" aria-label="오늘 현황">
        {stats.map((stat) => (
          <article key={stat.label} className={`cr-top-stat ${stat.tone}`}>
            <p className="cr-top-stat-label">{stat.label}</p>
            <p className="cr-top-num">{stat.value}</p>
          </article>
        ))}
      </section>
    </>
  );
}

export function ControlRoom({ onClose }: { onClose: () => void }): React.ReactElement {
  const [board, setBoard] = useState<ControlRoomBoard | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const [guideOpen, setGuideOpen] = useState(() => {
    try {
      return !crTopGuideDismissed((key) => localStorage.getItem(key));
    } catch {
      return true;
    }
  });
  const [jumpNote, setJumpNote] = useState('');
  const [jumpTick, setJumpTick] = useState(0);
  const pendingJump = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await must<ControlRoomBoard>({ op: 'controlRoom:board' });
      const normalized = {
        lanes: Array.isArray(next?.lanes) ? next.lanes : [],
        models: next?.models && typeof next.models === 'object' ? next.models : undefined,
        routing: (next as Record<string, unknown>)?.routing,
        todayDone: (next as Record<string, unknown>)?.todayDone
          ?? (next as Record<string, unknown>)?.today_done
          ?? (next as Record<string, unknown>)?.doneToday
          ?? (next as Record<string, unknown>)?.completedToday
          ?? (next as Record<string, unknown>)?.done,
        capacity: (next as Record<string, unknown> | null)?.capacity,
      };
      setBoard(scopeBoard(normalized, projectFromSearch(window.location.search)));
      setError('');
      setErrorDetail('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setErrorDetail((e as { detail?: string })?.detail ?? '');
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = (): void => {
      if (alive) void load();
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [load]);

  // 새 창(?project=<id>)이면 그 프로젝트 하나만 보여준다.
  const only = projectFromSearch(window.location.search).toLowerCase();
  const lanes = (board?.lanes ?? []).filter(lane => !only || projectWindowKey(projectOf(lane)) === only);
  const sortedLanes = sortLanesByAttention(lanes);
  const decisionCount = sortedLanes.filter(lane => laneAttention(lane) === 'decision').length;
  const activeLane = sortedLanes.find((lane, index) => laneSelectKey(lane, index) === selectedId) ?? sortedLanes[0];
  const activeKey = activeLane ? laneSelectKey(activeLane, sortedLanes.indexOf(activeLane)) : null;
  const seats = sharedSeatsView(board, only);

  const dismissGuide = (): void => {
    try {
      crTopRememberGuide((key, value) => localStorage.setItem(key, value));
    } catch {
      /* 기억하지 못해도 이번 화면에서는 닫는다. */
    }
    setGuideOpen(false);
  };

  const showHolds = (): void => {
    const target = sortedLanes.find((lane) => visibleHoldEntries(lane.holds).length > 0 || (typeof lane.blocker === 'string' && lane.blocker.trim().length > 0));
    if (target) setSelectedId(laneSelectKey(target, sortedLanes.indexOf(target)));
    pendingJump.current = true;
    setJumpTick((tick) => tick + 1);
  };

  useEffect(() => {
    if (!pendingJump.current) return;
    const node = document.getElementById('lane-hold');
    if (!node) {
      setJumpNote('멈춘 작업을 화면에서 찾지 못했어요 · 다시 시도');
      pendingJump.current = false;
      return;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    setJumpNote('멈춘 작업으로 이동했어요 ✓');
    pendingJump.current = false;
  }, [jumpTick, activeKey]);

  return (
    <main className="control-room">
      <div className="control-room-head"><div>{only ? <h1>{projectDisplayName(only)}</h1> : <h1>관제실</h1>}{decisionCount > 0 && <p className="control-decision-count">결정 대기 {decisionCount}건</p>}<p className="muted">5초마다 자동으로 새로 고쳐요.</p></div><button className="btn" onClick={only ? () => window.close() : onClose}>닫기</button></div>
      {(guideOpen || board) && (
        <div className="cr-top">
          {guideOpen && <CrTopGuide onDismiss={dismissGuide} />}
          {board && <CrTopBody board={board} note={jumpNote} onShowHolds={showHolds} />}
        </div>
      )}
      {seats && <SharedSeatsCard view={seats} />}
      {!only && <><EnvsCard /><TokensCard /><TodayCard board={board} /><WhoLine board={board} /><ModelUsagePanel models={board?.models} /></>}
      {board === null && !error ? <div className="control-empty">작업 PC에서 불러오는 중…</div>
      : error && lanes.length === 0 ? <div className="control-empty">{error}{errorDetail && <details><summary>원문 보기</summary><pre className="mono">{errorDetail}</pre></details>}</div>
      : !sortedLanes.length ? <div className="control-empty" role="status"><p>아직 진행 중인 프로젝트가 없어요. 지금 하실 일은 없어요.</p><p className="muted">계획이 승인되면 프로젝트가 여기에 자동으로 나타나요. 이 화면은 5초마다 알아서 새로 고쳐요.</p></div> : <>
        <div className="control-tabs" role="tablist" aria-label="프로젝트 목록">{sortedLanes.map((lane, index) => { const presentation = projectPresentation(lane); const key = laneSelectKey(lane, index); const isActive = key === activeKey; const attn = laneAttention(lane); return <button className={`control-tab${isActive ? ' active' : ''}`} key={lane.id ?? lane.project ?? index} onClick={() => setSelectedId(key)} role="tab" aria-selected={isActive} aria-label={`${presentation.name}: ${presentation.goal}`}><span>{presentation.name}</span>{attn === 'decision' && <span className="attn-badge decision">결정 필요</span>}{attn === 'hold' && <span className="attn-badge hold">{holdBadgeText(visibleHoldEntries(lane.holds).length)}</span>}<small style={{ display: 'block', marginTop: 4 }}>{presentation.goal}</small></button>; })}</div>
        {activeLane && <LaneView lane={activeLane} onRefresh={load} canOpenWindow={!only} />}
      </>}
    </main>
  );
}
