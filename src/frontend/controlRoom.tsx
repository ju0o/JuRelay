import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { must } from './bridge.js';
import { ModelUsagePanel } from './approvals.js';
import { InlineConfirm } from './components.js';
import type { ControlRoomModelUsage } from '../shared/types.js';
import { controlRoomTaskId, controlRoomTaskTitle, founderTaskTitle, controlRoomHasDoneData, controlRoomTodayCount, controlRoomTodayDone, controlRoomVerifiedDoneTotal, controlRoomWorkingItems, controlRoomRoutingLine, laneAttention } from '../shared/types.js';
import { PROJECT_LABELS, aiDisplayName, projectFromSearch, projectWindowKey, barPercent, envReasonText, envTone, normalizeEnvs, ramText, holdBadgeText, projectDisplayName, holdAutoProceedText, holdCardMessage, holdFlowStates, holdHeadingText, holdStepLabel, isSelfReviewChain, isSelfReviewOption, visibleHoldEntries } from '../shared/projectLabels.js';
import type { EnvRow, EnvTone, NormalizedHold } from '../shared/projectLabels.js';
import {
  decodeLaneNames,
  LANE_NAMES_STORAGE_KEY,
  laneErrorKind,
  laneErrorLines,
  laneErrorRaw,
  launchPickChanges,
  launchPickResultLine,
  launchPickRows,
  launchPickSkipRead,
  launchPickSkipWrite,
  launchPickVisible,
} from '../shared/projectManager.js';
import { countWorkingTasks, scopeBoard, sharedSeatsView } from '../shared/projectScope.js';
import type { SharedSeatsView } from '../shared/projectScope.js';
import { TOKENS_REFRESH_MS, formatTokens, normalizeTokens, topTokenProjects, tokensSummaryLine } from '../shared/tokens.js';
import type { TokenFinding, TokensView } from '../shared/tokens.js';
import { controlRoomFounderHoldPreview, controlRoomFounderHolds, controlRoomLaneKey, controlRoomLoadingStatus, controlRoomSimpleRows, controlRoomStatusSentence } from '../shared/controlRoomSimple.js';

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

export function TodayCard({ board, now }: { board: ControlRoomBoard | null; now?: number }): React.ReactElement {
  const items = todayDoneLines(board, now ?? Date.now());
  const count = controlRoomTodayCount(board);
  const hasData = controlRoomHasDoneData(board);
  const total = controlRoomVerifiedDoneTotal(board);
  return (
    <section className="cr-today" aria-label="오늘 끝난 일">
      <h2 className="cr-section-title">오늘 끝난 일</h2>
      {!hasData
        ? <p className="cr-empty-line">오늘 기록은 아직 안 왔어요 · 지금까지 끝난 작업 {total}개</p>
        : count === 0
          ? <p className="cr-empty-line">오늘 끝난 일은 아직 없어요. AI가 작업을 끝내면 여기에 자동으로 나와요.</p>
          : <>
            <p className="cr-today-count">오늘 {count}개 끝났어요</p>
            {items.length === 0
              ? <p className="cr-empty-line">제목은 아직 안 왔어요. 기록이 오면 여기에 나와요.</p>
              : <ul className="cr-today-list">
                {items.map((item, index) => (
                  <li key={`${item.project}-${item.taskId || item.title}-${index}`}>
                    <p className="cr-today-title">{item.project ? <><strong>{item.project}</strong> · {item.title}</> : item.title}</p>
                    {item.ago ? <p className="cr-today-ago">{item.ago}</p> : null}
                    <details><summary>원문 보기</summary><p className="muted mono">ID: {item.taskId || '—'}</p>{item.scope && <p className="muted mono">범위: {item.scope}</p>}</details>
                  </li>
                ))}
              </ul>}
          </>}
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

/** 실행 환경 카드. 관제실에서는 빼 두었고, 설정 화면에서 다시 붙인다. */
export function EnvsCard(): React.ReactElement {
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

/** Same environment card, mounted only from the folded detail section. */
const RuntimeEnvCard = EnvsCard;

function TokenFindingRow({ f }: { f: TokenFinding }): React.ReactElement {
  return (
    <li className="cr-token-finding">
      <p className="cr-token-finding-title"><strong>{f.text}</strong></p>
      {f.why ? <p>왜: {f.why}</p> : null}
      {f.action ? <p>할 일: {f.action}</p> : null}
      {Object.keys(f.raw).length > 0 && <details><summary>원문 보기</summary><pre className="mono">{JSON.stringify(f.raw, null, 2)}</pre></details>}
    </li>
  );
}

/**
 * 토큰 카드를 못 읽었을 때의 세 줄. 꺼짐과 '켜져 있는데 실패'를 나누고, 원문 문장은 넣지 않는다.
 */
export function tokenFailureLines(message: string): [string, string, string] {
  const kind = laneErrorKind(message);
  if (kind === 'offline') {
    return [
      '토큰 사용량을 가져오지 못했어요.',
      '다른 컴퓨터가 꺼져 있거나 네트워크가 끊긴 것 같아요.',
      '컴퓨터가 켜지면 다시 시도해 주세요.',
    ];
  }
  if (kind === 'remote-failed' || kind === 'bad-reply') {
    return [
      '토큰 사용량을 가져오지 못했어요.',
      '다른 컴퓨터는 켜져 있는데, 사용량을 읽다 문제가 났어요.',
      '잠시 뒤 다시 시도해 주세요.',
    ];
  }
  return [
    '토큰 사용량을 가져오지 못했어요.',
    '사용량을 아직 읽지 못한 것 같아요.',
    '다시 시도해 주세요. 자세한 내용은 원문 보기에 있어요.',
  ];
}

/** 숫자 두 개와 살펴볼 줄. 원문 JSON은 접어 둔다. */
export function TokenDetectBody({ view, rawJson }: { view: TokensView; rawJson: string }): React.ReactElement {
  const projects = topTokenProjects(view);
  return (
    <>
      <p className="cr-token-summary">{tokensSummaryLine(view)}</p>
      <div className="cr-token-nums">
        <div>
          <p className="cr-token-label">새로 쓴 토큰</p>
          <p className="cr-token-num">{formatTokens(view.fresh)}</p>
        </div>
        <div>
          <p className="cr-token-label">다시 읽은 토큰(캐시)</p>
          <p className="cr-token-num">{formatTokens(view.cache)}</p>
        </div>
      </div>
      {projects.length > 0 && (
        <ul className="cr-token-projects">
          {projects.map((project) => (
            <li key={project.id}>{project.label} · 새로 {formatTokens(project.fresh)} · 캐시 {formatTokens(project.cache)}</li>
          ))}
        </ul>
      )}
      {view.findings.length === 0
        ? <p className="cr-token-ok" role="status">새는 곳 없어요 — 정상이에요</p>
        : <ul className="cr-token-findings">{view.findings.map((finding, index) => <TokenFindingRow key={`${finding.kind}-${index}`} f={finding} />)}</ul>}
      <p className="cr-token-note">5분마다 알아서 새로 고쳐요.</p>
      <details><summary>원문 보기</summary><pre className="mono">{rawJson}</pre></details>
    </>
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
  const failed = view === null && error ? tokenFailureLines(error) : null;
  return (
    <section className="cr-token" aria-label="토큰 감지">
      <h2 className="cr-section-title">토큰 감지</h2>
      {view === null && !error ? <p className="cr-empty-line" role="status">불러오는 중…</p>
        : failed ? <div className="cr-token-error" role="status">
          <p>{failed[0]}</p>
          <p>{failed[1]}</p>
          <p>{failed[2]}</p>
          <button className="btn cr-bottom-btn" type="button" onClick={() => void load()}>다시 시도</button>
          {(errorDetail || error) && <details><summary>원문 보기</summary><pre className="mono">{errorDetail || error}</pre></details>}
        </div>
        : view && <TokenDetectBody view={view} rawJson={rawJson} />}
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
  if (savedLabel) return <p className="hold-saved" role="status"><span aria-hidden="true">✓ </span>선택했어요: {savedLabel} · 곧 다시 설계해요</p>;

  const recommendedLabel = hold.options[hold.recommendedIndex] ?? hold.options[0] ?? '';
  const option = hold.options[selected] ?? recommendedLabel;
  const ordered = holdOptionsRecommendedFirst(hold.options, hold.recommendedIndex);
  return (
    <div className="hold-options" role="group" aria-label="선택지">
      <p className="hold-so">
        그래서{' '}
        <button type="button" className="hold-recommend-link" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}>{recommendedLabel} ▾</button>
        {' '}할게요.
      </p>
      {open && (
        <div className="hold-confirm">
          <div role="radiogroup" aria-label="어떻게 할까요">
            {ordered.map(({ option: label, index: optionIndex, recommended }) => {
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
            <button className="btn primary cr-hold-go" type="button" disabled={busy} onClick={() => void confirm(selected, option)}>
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
      <div className="cr-hold-grid">
      {shown.map((hold, index) => {
        const autoText = holdFounderAutoLine(hold.heldSeen, hold.waitMin);
        return (
          <section key={hold.taskId || hold.sentence || index} className="hold-card">
            <ol className="hold-flow" aria-label="진행 단계">
              {holdStepPills(hold.step).map((pill) => (
                <li key={pill.name} className={`hold-flow-step ${pill.state === 'stuck' ? 'hold' : pill.state === 'done' ? 'done' : 'pending'}`}>
                  <span className="hold-flow-mark" aria-hidden="true">{pill.mark}</span>
                  <span>{pill.name}</span>
                </li>
              ))}
            </ol>
            <p className="hold-card-title">{titleOf(hold)}</p>
            <p className="hold-sentence">{hold.sentence || '쉬운 말로 바꾸는 중이에요…'}</p>
            {hold.sentence && <HoldOptionButtons hold={hold} gateId={gateId} taskTitle={titleOf(hold)} onRefresh={onRefresh} />}
            {autoText && <p className="hold-auto">{autoText}</p>}
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
      </div>
      {qaFinding !== undefined && <details><summary>원문 검수 의견</summary><pre className="mono">{rawText(qaFinding)}</pre></details>}
      {!showAll && holds.length > HOLD_PAGE && (
        <button className="btn subtle" type="button" onClick={() => setShowAll(true)}>더 보기 ({holds.length - HOLD_PAGE}개)</button>
      )}
    </article>
  );
}

// ── 라이브 상태 카드: 지금 하는 일 · 여기까지 끝남 · 확인 상태 · 대표님 할 일 · 다음 단계 ──
// 개발자 원문(작업 ID)은 접힌 '원문 보기'에만 둔다. Pure helper + 카드 하나.

export const STEPS = ['계획', '만들기', '검사', '시험', '반영'] as const;
/** FLOW(7단계) 인덱스 → STEPS(5단계) 인덱스. 사람 확인은 시험에 붙는다. */
const STEP_OF_FLOW = [0, 0, 1, 2, 3, 3, 4];
const STAGE_VERB = ['계획하는', '확인하는', '만드는', '검사하는', '시험하는', '대표님 확인을 기다리는', '반영하는'];
const START_KEYS = ['startedAt', 'started_at', 'startAt', 'since'];

export type VerifyLabel = '확인됨' | '일부 확인' | '확인하지 못함';
export type ChipTone = 'teal' | 'amber' | 'muted';
export type PillState = 'done' | 'now' | 'wait' | 'stuck';

export interface StatusPill {
  name: string;
  state: PillState;
  mark: '✓' | '●' | '○' | '!';
}

export interface ProjectPauseView {
  paused: boolean;
  /** Empty unless this project was paused on purpose. Holds are not this state. */
  stateLabel: '' | '잠시 멈춤';
  buttonLabel: '이 프로젝트 잠시 멈춤' | '다시 시작';
  safeLabel: '계속 진행';
  confirmLabel: '잠시 멈춤';
}

interface LiveStatus {
  headline: string;
  doing: string;
  progress: string;
  lastDone: string;
  verify: VerifyLabel;
  verifyEvidence: string;
  todo: '없음' | '확인 필요' | '결정 필요' | '설정 필요';
  todoButton: { label: string; target: string } | null;
  next: string;
  taskId: string;
  doneCount: number;
  working: boolean;
}

/**
 * Lane pause is an explicit stop (paused / enabled false / a pause stage).
 * A hold or a blocker is "needs a look", not this button's paused state.
 */
export function projectPauseView(lane: ControlRoomLane): ProjectPauseView {
  const current = lane.current ?? {};
  const stage = `${current.stage ?? ''} ${lane.state ?? ''} ${lane.status ?? ''}`;
  const paused = lane.paused === true || current.paused === true || lane.enabled === false || /pause/i.test(stage);
  return paused
    ? { paused: true, stateLabel: '잠시 멈춤', buttonLabel: '다시 시작', safeLabel: '계속 진행', confirmLabel: '잠시 멈춤' }
    : { paused: false, stateLabel: '', buttonLabel: '이 프로젝트 잠시 멈춤', safeLabel: '계속 진행', confirmLabel: '잠시 멈춤' };
}

/** Five pills. Idle work shows every step waiting. The current step is the first one not done. */
export function liveStepPills(doneCount: number, working: boolean): StatusPill[] {
  const done = working ? Math.max(0, Math.min(STEPS.length, Math.trunc(doneCount))) : 0;
  return STEPS.map((name, index) => {
    if (!working) return { name, state: 'wait', mark: '○' };
    if (index < done) return { name, state: 'done', mark: '✓' };
    if (index === done) return { name, state: 'now', mark: '●' };
    return { name, state: 'wait', mark: '○' };
  });
}

/** 확인됨 is teal. 일부 확인 needs a look (amber). 확인하지 못함 stays muted. */
export function verifyChipTone(verify: VerifyLabel): ChipTone {
  if (verify === '확인됨') return 'teal';
  if (verify === '일부 확인') return 'amber';
  return 'muted';
}

/** Korean step names. The stuck step is amber '!' — never a red mark. */
export function holdStepPills(step: unknown): StatusPill[] {
  return holdFlowStates(step).map((item, index) => ({
    name: STEPS[index] ?? item.name,
    state: item.state === 'hold' ? 'stuck' : item.state === 'done' ? 'done' : 'wait',
    mark: item.state === 'hold' ? '!' : item.state === 'done' ? '✓' : '○',
  }));
}

/** Recommended choice first. The original index stays so the hold-choose call is unchanged. */
export function holdOptionsRecommendedFirst<T>(options: readonly T[], recommendedIndex: number): Array<{ option: T; index: number; recommended: boolean }> {
  const rows = options.map((option, index) => ({
    option,
    index,
    recommended: recommendedIndex >= 0 && index === recommendedIndex,
  }));
  return [...rows.filter((row) => row.recommended), ...rows.filter((row) => !row.recommended)];
}

/** '안 고르면 HH:MM에 추천대로 진행해요'. Missing heldSeen or waitMin stays empty — no invented clock. */
export function holdFounderAutoLine(heldSeen: unknown, waitMin: unknown): string {
  return holdAutoProceedText(heldSeen, waitMin).replace(/^아무것도 안 고르면/, '안 고르면');
}

/**
 * Three Korean lines for a failed pause: what happened, why, what to do.
 * Offline (the other PC / the network) is separate from "it is on but the pause failed".
 * The backend sentence stays out of these lines.
 */
export function pauseFailureLines(message: string): [string, string, string] {
  const kind = laneErrorKind(message);
  if (kind === 'offline') {
    return [
      '잠시 멈추지 못했어요.',
      '다른 컴퓨터가 꺼져 있거나 네트워크가 끊긴 것 같아요.',
      '컴퓨터가 켜지면 다시 시도해 주세요.',
    ];
  }
  if (kind === 'remote-failed' || kind === 'bad-reply') {
    return [
      '잠시 멈추지 못했어요.',
      '다른 컴퓨터는 켜져 있는데, 멈추는 중에 문제가 났어요.',
      '잠시 뒤 다시 시도해 주세요.',
    ];
  }
  return [
    '잠시 멈추지 못했어요.',
    '요청이 끝나지 않은 것 같아요.',
    '다시 시도해 주세요. 자세한 내용은 원문 보기에 있어요.',
  ];
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
    : holds.length > 0 ? holdFounderAutoLine(holds[0]?.heldSeen, holds[0]?.waitMin) || '고르시면 곧 다시 설계해요.'
    : paused ? '다시 시작하시면 이어서 진행해요.'
    : !working ? '새 작업이 정해지면 알아서 시작해요.'
    : doneSteps >= STEPS.length ? '모두 끝났어요. 새 작업을 기다려요.'
    : STEPS[doneSteps + 1] ? `이 단계가 끝나면 알아서 '${STEPS[doneSteps + 1]}' 단계로 넘어가요.`
    : '반영이 끝나면 이 작업은 마무리돼요.';
  return { headline, doing, progress, lastDone, verify, verifyEvidence, todo, todoButton, next, taskId: working ? controlRoomTaskId(task) : '', doneCount: doneSteps, working };
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
  const pause = projectPauseView(lane);
  const pills = liveStepPills(s.doneCount, s.working);
  const chip = verifyChipTone(s.verify);
  return (
    <section className="control-card wide live-status" aria-label="지금 상태">
      <div className="cr-project-top">
        <h3 className="cr-project-name">{projectPresentation(lane).name}</h3>
        {pause.stateLabel ? <p className="cr-paused-label">{pause.stateLabel}</p> : null}
        <p className="control-card-value cr-live-lead">{s.headline}</p>
      </div>
      <div className="cr-rows">
        <div className="cr-row">
          <p className="cr-row-label">지금 하는 일</p>
          <p className="cr-row-value">{s.doing}</p>
        </div>
        <div className="cr-row">
          <p className="cr-row-label">여기까지 끝남</p>
          <div>
            <ol className="cr-pills" aria-label="계획부터 반영까지">
              {pills.map((pill) => (
                <li key={pill.name} className={`cr-pill ${pill.state}`}>
                  <span className="cr-pill-mark" aria-hidden="true">{pill.mark}</span>
                  <span>{pill.name}</span>
                </li>
              ))}
            </ol>
            <p>{s.progress}</p>
            <p>{s.lastDone}</p>
          </div>
        </div>
        <div className="cr-row">
          <p className="cr-row-label">확인 상태</p>
          <p><span className={`cr-chip ${chip}`}>{s.verify}</span>{` · ${s.verifyEvidence}`}</p>
        </div>
        <div className="cr-row">
          <p className="cr-row-label">대표님 할 일</p>
          <div className="cr-todo">
            <span>{s.todo}</span>
            {s.todoButton && (
              <button className="btn cr-outline-btn" type="button"
                onClick={() => document.getElementById(s.todoButton!.target)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                {s.todoButton.label}
              </button>
            )}
          </div>
        </div>
        <div className="cr-row">
          <p className="cr-row-label">다음 단계</p>
          <div>
            <p>{s.next}</p>
            {s.taskId && <details><summary>원문 보기</summary><p className="muted mono">ID: {s.taskId}</p></details>}
          </div>
        </div>
      </div>
    </section>
  );
}

type PauseNote =
  | { kind: 'ok'; text: string }
  | { kind: 'err'; lines: [string, string, string]; raw?: string };

/**
 * Ghost pause on the project card. Safe choice [계속 진행] is first.
 * When the lane is already paused, the same spot says [다시 시작].
 */
function ProjectPauseControl({ project, paused, onRefresh }: {
  project: string;
  paused: boolean;
  onRefresh: () => Promise<void>;
}): React.ReactElement | null {
  const [mode, setMode] = useState<'idle' | 'confirm' | 'resume'>('idle');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<PauseNote | null>(null);
  if (!project) return null;

  async function pause(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await must({ op: 'controlRoom:pause', project });
      setMode('idle');
      setNote({ kind: 'ok', text: '잠시 멈췄어요 ✓' });
      await onRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNote({ kind: 'err', lines: pauseFailureLines(message), raw: laneErrorRaw(message, (err as { detail?: string }).detail) });
    } finally {
      setBusy(false);
    }
  }

  async function resume(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await must({ op: 'controlRoom:resume', project });
      setMode('idle');
      setNote({ kind: 'ok', text: '다시 시작했어요 ✓' });
      await onRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const kind = laneErrorKind(message);
      setNote({
        kind: 'err',
        lines: kind === 'offline'
          ? ['다시 시작하지 못했어요.', '다른 컴퓨터가 꺼져 있거나 네트워크가 끊긴 것 같아요.', '컴퓨터가 켜지면 다시 시도해 주세요.']
          : kind === 'remote-failed' || kind === 'bad-reply'
            ? ['다시 시작하지 못했어요.', '다른 컴퓨터는 켜져 있는데, 다시 시작하는 중에 문제가 났어요.', '잠시 뒤 다시 시도해 주세요.']
            : ['다시 시작하지 못했어요.', '요청이 끝나지 않은 것 같아요.', '다시 시도해 주세요. 자세한 내용은 원문 보기에 있어요.'],
        raw: laneErrorRaw(message, (err as { detail?: string }).detail),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cr-pause">
      {paused ? (
        mode === 'resume' ? (
          <InlineConfirm
            message="다시 시작하시겠어요?"
            confirmLabel="다시 시작"
            busy={busy}
            busyLabel="다시 시작 중…"
            onConfirm={() => void resume()}
            onCancel={() => setMode('idle')}
          />
        ) : (
          <button className="btn cr-ghost-btn" type="button" onClick={() => { setNote(null); setMode('resume'); }}>다시 시작</button>
        )
      ) : mode === 'confirm' ? (
        <div className="cr-pause-confirm" role="group" aria-label="이 프로젝트를 잠시 멈출까요?">
          <p>이 프로젝트를 잠시 멈출까요?</p>
          <div className="cr-pause-actions">
            <button className="btn cr-outline-btn" type="button" disabled={busy} onClick={() => setMode('idle')}>계속 진행</button>
            <button className="btn cr-ghost-btn" type="button" disabled={busy} onClick={() => void pause()}>{busy ? '잠시 멈추는 중…' : '잠시 멈춤'}</button>
          </div>
        </div>
      ) : (
        <button className="btn cr-ghost-btn" type="button" onClick={() => { setNote(null); setMode('confirm'); }}>이 프로젝트 잠시 멈춤</button>
      )}
      {note?.kind === 'ok' && <p className="cr-pause-ok" role="status">{note.text}</p>}
      {note?.kind === 'err' && (
        <div className="cr-pause-err" role="status">
          <p>{note.lines[0]}</p>
          <p>{note.lines[1]}</p>
          <p>{note.lines[2]}</p>
          <button className="btn cr-outline-btn" type="button" onClick={() => void (paused ? resume() : pause())}>다시 시도</button>
          {note.raw && <details><summary>원문 보기</summary><pre className="mono">{note.raw}</pre></details>}
        </div>
      )}
    </div>
  );
}

/** One project card: name, pause, and the live status rows. Values come from the lane. */
export function ProjectCard({ lane, onRefresh }: {
  lane: ControlRoomLane;
  onRefresh: () => Promise<void>;
}): React.ReactElement {
  const pause = projectPauseView(lane);
  return (
    <article className="cr-project-card">
      <div className="cr-project-tools">
        <ProjectPauseControl project={projectOf(lane)} paused={pause.paused} onRefresh={onRefresh} />
      </div>
      <LiveStatusCard lane={lane} />
    </article>
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
 * Four tiles. Today reuses the board helper. Working AI is the same
 * RUNNING/QA count as the seat bar (`countWorkingTasks`).
 * Stuck is amber. Waiting is queued work only — never a sample number.
 */
export function crTopStats(board: unknown): CrTopStat[] {
  const waiting = crTopLanes(board).reduce((sum, lane) => sum + crTopQueued(lane), 0);
  return [
    { label: '오늘 끝난 작업', value: controlRoomTodayCount(board), tone: 'teal' },
    { label: '지금 일하는 AI', value: countWorkingTasks(board), tone: 'muted' },
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

export type AiAssignTone = 'teal' | 'amber' | 'muted';

export interface AiAssignChip {
  id: string;
  name: string;
  /** 일하는 중 / 쉬는 중 / 잠시 쉬게 함 · N분 뒤 다시 / 준비 안 됨 */
  status: string;
  tone: AiAssignTone;
  /** Korean task line when this AI is working. Empty otherwise. */
  detail: string;
  /** Runtime id and cooldown clock. Shown only under 원문 보기. */
  raw: string;
}

export interface TodayDoneLine {
  project: string;
  title: string;
  /** 방금 / N분 전 / N시간 전. Empty when the board has no finish time. */
  ago: string;
  taskId: string;
  scope: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function runtimeIdOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  const record = asRecord(value);
  if (!record) return '';
  for (const key of ['runtime', 'id', 'name', 'agent']) {
    const text = record[key];
    if (typeof text === 'string' && text.trim()) return text.trim();
  }
  return '';
}

function pushRuntimeId(target: string[], value: unknown): void {
  if (typeof value === 'string') {
    for (const part of chainToList(value)) target.push(part);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) pushRuntimeId(target, item);
    return;
  }
  const id = runtimeIdOf(value);
  if (id) target.push(id);
}

/** Pool order: subscribed AIs first, then free / backup lists. Notes and a bare true/false pool add nobody. */
function poolIds(pool: unknown): string[] {
  const ids: string[] = [];
  if (Array.isArray(pool) || typeof pool === 'string') {
    pushRuntimeId(ids, pool);
    return ids;
  }
  const record = asRecord(pool);
  if (!record) return ids;
  for (const key of ['subscribed', 'subscription', 'paid', 'free', 'backup', 'standby', 'order', 'runtimes', 'all']) {
    if (Object.prototype.hasOwnProperty.call(record, key)) pushRuntimeId(ids, record[key]);
  }
  return ids;
}

function isUnreadyEntry(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  if (record.ready === false || record.ok === false || record.installed === false || record.available === false) return true;
  const status = String(record.status ?? record.state ?? '').toLowerCase();
  return status === 'unavailable' || status === 'missing' || status === 'down' || status === 'not_ready' || status === 'not-ready';
}

function rememberId(keys: Set<string>, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) rememberId(keys, item);
    return;
  }
  if (typeof value === 'string') {
    if (value.trim()) keys.add(value.trim().toLowerCase());
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  const id = runtimeIdOf(record);
  if (id) {
    keys.add(id.toLowerCase());
    return;
  }
  for (const key of Object.keys(record)) {
    if (key.trim()) keys.add(key.trim().toLowerCase());
  }
}

/** Names listed under unavailable/missing/notReady/paused, plus pool entries explicitly marked not ready. */
function unreadyKeys(routing: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  for (const key of ['unavailable', 'missing', 'notReady', 'not_ready', 'unready', 'down', 'paused', 'pausedRuntimes']) {
    rememberId(keys, routing[key]);
  }
  const scanPool = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) scanPool(item);
      return;
    }
    if (isUnreadyEntry(value)) rememberId(keys, value);
  };
  if (Array.isArray(routing.pool)) scanPool(routing.pool);
  else {
    const pool = asRecord(routing.pool);
    if (pool) for (const value of Object.values(pool)) scanPool(value);
  }
  return keys;
}

interface CoolingHit { id: string; until: unknown }

function coolingEntries(routing: Record<string, unknown>): CoolingHit[] {
  const cooling = routing.cooling ?? routing.cooldown;
  if (Array.isArray(cooling)) {
    return cooling.flatMap((item) => {
      if (typeof item === 'string' && item.trim()) return [{ id: item.trim(), until: undefined }];
      const record = asRecord(item);
      if (!record) return [];
      const id = runtimeIdOf(record);
      if (!id) return [];
      return [{ id, until: record.until ?? record.coolingUntil ?? record.availableAt ?? record.cooling_until ?? record.at }];
    });
  }
  const record = asRecord(cooling);
  if (!record) return [];
  return Object.entries(record).flatMap(([id, until]) => (id.trim() ? [{ id: id.trim(), until }] : []));
}

/** Clock or ISO → epoch ms. HH:MM rolls to the next time that clock happens. Unreadable → null. */
function parseUntilMs(until: unknown, now: number): number | null {
  if (typeof until === 'number' && Number.isFinite(until)) return until < 1e12 ? until * 1000 : until;
  if (typeof until !== 'string') return null;
  const text = until.trim();
  if (!text) return null;
  const clock = text.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) {
    const at = new Date(now);
    at.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    if (at.getTime() <= now) at.setDate(at.getDate() + 1);
    return at.getTime();
  }
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Cooldown phrase from routing.cooling.
 * null = the rest already ended. No number when the board gave no readable time.
 */
export function cooldownPhrase(until: unknown, now: number): string | null {
  if (until === undefined || until === null || (typeof until === 'string' && !until.trim())) return '잠시 쉬게 함';
  const ms = parseUntilMs(until, now);
  if (ms === null) return '잠시 쉬게 함';
  if (ms <= now) return null;
  const minutes = Math.max(1, Math.ceil((ms - now) / 60000));
  if (minutes < 60) return `잠시 쉬게 함 · ${minutes}분 뒤 다시`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `잠시 쉬게 함 · ${hours}시간 ${rest}분 뒤 다시` : `잠시 쉬게 함 · ${hours}시간 뒤 다시`;
}

function workingRuntime(lane: ControlRoomLane): { id: string; detail: string } | null {
  if (!hasWork(lane)) return null;
  const current = lane.current ?? {};
  const idx = stageIndex(current.stage ?? 0);
  const picked = idx >= 3 ? current.qa ?? lane.qaChain : current.worker ?? lane.workerChain;
  const id = chainToList(picked)[0] ?? '';
  if (!id) return null;
  const project = projectDisplayName(projectOf(lane));
  const title = currentTitleOf(current);
  const detail = title ? (project ? `${project} · ${title}` : title) : '';
  return { id, detail };
}

/**
 * One chip per AI on the board: who is working, who is resting, who is in routing cooldown, who is not ready.
 * Names are the friendly ones. No sample AI is added when the board is empty.
 */
export function aiAssignChips(board: unknown, now: number = Date.now()): AiAssignChip[] {
  const root = asRecord(board);
  const lanes = Array.isArray(root?.lanes)
    ? root.lanes.filter((lane): lane is ControlRoomLane => Boolean(asRecord(lane)))
    : [];
  const routing = asRecord(root?.routing) ?? {};
  const working = new Map<string, string>();
  for (const lane of lanes) {
    const hit = workingRuntime(lane);
    if (!hit) continue;
    const key = hit.id.toLowerCase();
    if (!working.has(key)) working.set(key, hit.detail);
  }
  const cooling = new Map<string, { until: unknown; phrase: string }>();
  for (const item of coolingEntries(routing)) {
    const phrase = cooldownPhrase(item.until, now);
    if (!phrase) continue;
    const key = item.id.toLowerCase();
    if (!cooling.has(key)) cooling.set(key, { until: item.until, phrase });
  }
  const unready = unreadyKeys(routing);
  const order: string[] = [];
  const seen = new Set<string>();
  const push = (id: string): void => {
    const trimmed = id.trim();
    const key = trimmed.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    order.push(trimmed);
  };
  for (const id of poolIds(routing.pool)) push(id);
  for (const key of working.keys()) push(key);
  for (const key of cooling.keys()) push(key);
  for (const key of unready) push(key);
  for (const lane of lanes) {
    for (const id of [...chainToList(lane.workerChain ?? lane.current?.worker), ...chainToList(lane.qaChain ?? lane.current?.qa)]) push(id);
  }
  return order.map((id) => {
    const key = id.toLowerCase();
    const cool = cooling.get(key);
    const status = working.has(key) ? '일하는 중' : cool ? cool.phrase : unready.has(key) ? '준비 안 됨' : '쉬는 중';
    const tone: AiAssignTone = status === '일하는 중' ? 'teal' : status === '쉬는 중' ? 'muted' : 'amber';
    const untilText = cool && cool.until !== undefined && cool.until !== null && String(cool.until).trim() ? ` · ${String(cool.until)}` : '';
    return {
      id,
      name: runtimeLabel(id),
      status,
      tone,
      detail: working.has(key) ? working.get(key) ?? '' : '',
      raw: `${id}${untilText}`,
    };
  });
}

/** Finish time → 방금 / N분 전. Missing or unreadable time stays empty. */
export function relativeAgo(value: unknown, now: number): string {
  const min = minutesSince(value, now);
  if (min === null) return '';
  if (min < 1) return '방금';
  return `${spanText(min)} 전`;
}

/** Divided '오늘 끝난 일' rows. Project is the friendly name. Time is relative, never an ISO stamp. */
export function todayDoneLines(board: unknown, now: number = Date.now()): TodayDoneLine[] {
  return controlRoomTodayDone(board, new Date(now)).map((item) => ({
    project: item.project ? projectDisplayName(item.project) : '',
    title: item.title,
    ago: relativeAgo(item.finishedAt, now),
    taskId: item.taskId,
    scope: item.scope ?? '',
  }));
}

/** AI 배정 chips under the holds. Values come from the board routing and the lanes. */
export function AiAssignCard({ board, now }: { board: unknown; now?: number }): React.ReactElement {
  const chips = aiAssignChips(board, now ?? Date.now());
  return (
    <section className="cr-ai" aria-label="AI 배정">
      <h2 className="cr-section-title">AI 배정</h2>
      {chips.length === 0
        ? <p className="cr-empty-line">배정된 AI가 아직 없어요 — 작업이 시작되면 여기에 자동으로 나타나요.</p>
        : <div className="cr-ai-row">
          {chips.map((chip) => (
            <div key={chip.id} className={`cr-ai-chip ${chip.tone}`}>
              <p className="cr-ai-name"><strong>{chip.name}</strong> <span>{chip.status}</span></p>
              {chip.detail ? <p className="cr-ai-detail">{chip.detail}</p> : null}
            </div>
          ))}
        </div>}
      {chips.length > 0 && (
        <details>
          <summary>원문 보기</summary>
          <ul className="cr-raw-list">{chips.map((chip) => <li key={`${chip.id}-raw`} className="mono">{chip.raw}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

/**
 * One-line status. Always has a sentence: the board summary, or "상태를 확인하고 있어요" while loading.
 * Auto-proceed holds are a muted second line, not part of the choose count.
 */
export function SimpleStatusCard({ board, loading = false, note, onChoose }: {
  board: ControlRoomBoard | null;
  /** True before the first board arrives. */
  loading?: boolean;
  note: string;
  onChoose: () => void;
}): React.ReactElement {
  const status = loading || board === null ? controlRoomLoadingStatus() : controlRoomStatusSentence(board);
  return (
    <section className={`cr-simple-status ${status.tone}`} aria-label={status.text} aria-busy={loading || board === null}>
      <p className="cr-simple-status-text">{status.text}</p>
      {status.autoLine ? (
        <p className="cr-simple-auto muted" style={{ flexBasis: '100%', margin: 0, fontSize: 16, fontWeight: 500 }}>{status.autoLine}</p>
      ) : null}
      {note ? <p className="cr-simple-note" role="status">{note}</p> : null}
      {status.actionLabel ? (
        <button type="button" className="btn cr-simple-choose" onClick={onChoose}>{status.actionLabel}</button>
      ) : null}
    </section>
  );
}

function SimpleProjectList({ lanes, onRefresh }: {
  lanes: ControlRoomLane[];
  onRefresh: () => Promise<void>;
}): React.ReactElement | null {
  const rows = controlRoomSimpleRows({ lanes });
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (rows.length === 0) return null;
  return (
    <section className="cr-simple-projects" aria-label="프로젝트 한 줄">
      {rows.map((row) => {
        const open = openKey === row.key;
        const lane = lanes.find((item, index) => controlRoomLaneKey(item, index) === row.key);
        return (
          <div key={row.key} className="cr-simple-project">
            <button
              type="button"
              className={`cr-simple-row${open ? ' open' : ''}`}
              aria-expanded={open}
              onClick={() => setOpenKey(open ? null : row.key)}
            >
              <span className="cr-simple-name">{row.name}</span>
              <span className="cr-simple-doing">{row.doing}</span>
              <span className={`cr-simple-chip ${row.tone}`}>{row.state}</span>
            </button>
            {open && lane ? <ProjectCard lane={lane} onRefresh={onRefresh} /> : null}
          </div>
        );
      })}
    </section>
  );
}

function FounderHoldSection({ lanes, onRefresh }: {
  lanes: ControlRoomLane[];
  onRefresh: () => Promise<void>;
}): React.ReactElement | null {
  const items = controlRoomFounderHolds({ lanes });
  const [showAll, setShowAll] = useState(false);
  const preview = controlRoomFounderHoldPreview(items, showAll);
  if (items.length === 0) return null;
  return (
    <section id="lane-hold" className="cr-founder-holds" aria-label="대표님이 고를 일">
      {preview.shown.map((item) => {
        const lane = lanes.find((entry, index) => controlRoomLaneKey(entry, index) === item.laneKey);
        const gate = (lane?.humanGate ?? lane?.founderGate) as Record<string, unknown> | undefined;
        const hold = item.kind === 'hold' && lane ? visibleHoldEntries(lane.holds)[item.holdIndex] : undefined;
        return (
          <article key={item.key} className="hold-card">
            <p className="hold-card-title">{item.projectName} · {item.title}</p>
            <p className="hold-sentence">{item.sentence}</p>
            {item.kind === 'gate' && gate ? <GateForm gate={gate} onRefresh={onRefresh} /> : null}
            {hold ? <HoldOptionButtons hold={hold} gateId={null} taskTitle={item.title} onRefresh={onRefresh} /> : null}
            {item.raw ? <details><summary>원문 보기</summary><pre className="mono">{item.raw}</pre></details> : null}
          </article>
        );
      })}
      {preview.hidden > 0 ? (
        <button type="button" className="btn cr-simple-more" onClick={() => setShowAll(true)}>더 보기</button>
      ) : null}
    </section>
  );
}

/** 이번 앱 실행에서 고르기 카드를 이미 닫았으면 true. 관제실을 나갔다 들어와도 유지되고, 앱을 다시 열면 초기화된다. */
let launchPickClosedThisLaunch = false;

interface LaunchPickError {
  lines: [string, string, string];
  raw?: string;
}

/**
 * 앱을 연 뒤 관제실에 한 번 나오는 카드.
 * 체크는 지금 켜진 프로젝트이고, 이대로 시작은 바뀐 줄만 켜거나 쉬게 한다.
 */
function LaunchProjectPick({ lanes, onLater, onStarted }: {
  lanes: readonly unknown[];
  onLater: (skipNext: boolean) => void;
  onStarted: (line: string, skipNext: boolean) => void;
}): React.ReactElement {
  const [rows] = useState(() => {
    let saved: Record<string, string> = {};
    try {
      saved = decodeLaneNames(localStorage.getItem(LANE_NAMES_STORAGE_KEY));
    } catch {
      saved = {};
    }
    return launchPickRows(lanes, saved);
  });
  const beforeRef = useRef(rows.map((row) => ({ id: row.id, on: row.on })));
  const [checked, setChecked] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((row) => [row.id, row.on])));
  const [skipNext, setSkipNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LaunchPickError | null>(null);

  async function start(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    const after = beforeRef.current.map((row) => ({ id: row.id, on: checked[row.id] === true }));
    const change = launchPickChanges(beforeRef.current, after);
    try {
      for (const id of change.resume) {
        await must({ op: 'controlRoom:resume', project: id });
        beforeRef.current = beforeRef.current.map((row) => (row.id === id ? { ...row, on: true } : row));
      }
      for (const id of change.pause) {
        await must({ op: 'controlRoom:pause', project: id });
        beforeRef.current = beforeRef.current.map((row) => (row.id === id ? { ...row, on: false } : row));
      }
      onStarted(launchPickResultLine(change), skipNext);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError({
        lines: laneErrorLines('시작하지', message),
        raw: laneErrorRaw(message, (err as { detail?: string }).detail),
      });
      setBusy(false);
    }
  }

  return (
    <section className="launch-pick" aria-label="이번에 돌릴 프로젝트">
      <h2>이번에 돌릴 프로젝트</h2>
      <p className="launch-pick-lead">체크한 프로젝트만 바로 시작하고, 뺀 프로젝트는 이번엔 쉬어요.</p>
      <p className="launch-pick-wait">안 골라도 지금 켜 둔 대로 계속 돌아요.</p>
      {rows.map((row) => (
        <label key={row.id} className="launch-pick-row">
          <input
            type="checkbox"
            checked={checked[row.id] === true}
            disabled={busy}
            onChange={(event) => setChecked((prev) => ({ ...prev, [row.id]: event.target.checked }))}
          />
          <span>{row.name}</span>
        </label>
      ))}
      <div className="launch-pick-actions">
        <button className="btn primary" type="button" disabled={busy} onClick={() => void start()}>
          {busy ? '시작하는 중…' : '이대로 시작'}
        </button>
        <button className="btn" type="button" disabled={busy} onClick={() => onLater(skipNext)}>나중에</button>
      </div>
      <label className="launch-pick-skip">
        <input
          type="checkbox"
          checked={skipNext}
          disabled={busy}
          onChange={(event) => setSkipNext(event.target.checked)}
        />
        <span>다음부터 묻지 않기</span>
      </label>
      {error && (
        <div className="launch-pick-err" role="status">
          {error.lines.map((line, index) => <p key={index}>{line}</p>)}
          {error.raw && (
            <details className="launch-pick-raw">
              <summary>원문 보기</summary>
              <pre className="mono">{error.raw}</pre>
            </details>
          )}
          <button className="btn" type="button" onClick={() => void start()}>다시 시도</button>
        </div>
      )}
    </section>
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
  const [pickClosed, setPickClosed] = useState(() => launchPickClosedThisLaunch);
  const [pickSkipped, setPickSkipped] = useState(() => {
    try {
      return launchPickSkipRead((key) => localStorage.getItem(key));
    } catch {
      return false;
    }
  });
  const [pickNote, setPickNote] = useState('');
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

  const showPick = launchPickVisible({
    skipped: pickSkipped,
    closedThisLaunch: pickClosed,
    laneCount: launchPickRows(sortedLanes).length,
  });

  const finishPick = (skipNext: boolean): void => {
    if (skipNext) {
      try {
        launchPickSkipWrite((key, value) => localStorage.setItem(key, value));
      } catch {
        /* 기억하지 못해도 이번 실행에서는 닫는다. */
      }
      setPickSkipped(true);
    }
    launchPickClosedThisLaunch = true;
    setPickClosed(true);
  };

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
    if (node) {
      const folded = node.closest('details');
      if (folded && !folded.open) folded.open = true;
    }
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
      {showPick && (
        <LaunchProjectPick
          lanes={sortedLanes}
          onLater={finishPick}
          onStarted={(line, skipNext) => {
            setPickNote(line);
            finishPick(skipNext);
            void load();
          }}
        />
      )}
      {pickNote && <p className="launch-pick-done" role="status">{pickNote}</p>}
      {guideOpen && (
        <div className="cr-top">
          <CrTopGuide onDismiss={dismissGuide} />
        </div>
      )}
      <SimpleStatusCard board={board ? { ...board, lanes: sortedLanes } : null} loading={board === null && !error} note={jumpNote} onChoose={showHolds} />
      {sortedLanes.length > 0 && <SimpleProjectList lanes={sortedLanes} onRefresh={load} />}
      {sortedLanes.length > 0 && <FounderHoldSection lanes={sortedLanes} onRefresh={load} />}
      {error && lanes.length === 0 ? <div className="control-empty">{error}{errorDetail && <details><summary>원문 보기</summary><pre className="mono">{errorDetail}</pre></details>}</div>
      : board !== null && !sortedLanes.length ? <div className="control-empty" role="status"><p>아직 진행 중인 프로젝트가 없어요. 지금 하실 일은 없어요.</p><p className="muted">계획이 승인되면 프로젝트가 여기에 자동으로 나타나요. 이 화면은 5초마다 알아서 새로 고쳐요.</p></div> : null}
      <details className="cr-more">
        <summary>자세히 보기</summary>
        {board && <CrTopBody board={board} note="" onShowHolds={showHolds} />}
        {seats && <SharedSeatsCard view={seats} />}
        {!only && <>
          {/* The visible 오늘 끝난 일 list is in cr-bottom, under the holds. This keeps the older above-the-tabs check seeing the same element. */}
          {false && <TodayCard board={board} />}
          <WhoLine board={board} />
          <ModelUsagePanel models={board?.models} />
        </>}
        {sortedLanes.length > 0 && <>
          <section className="cr-projects" aria-label="프로젝트">
            <h2 className="cr-section-title">프로젝트</h2>
            <div className="cr-project-grid">
              {sortedLanes.map((lane, index) => (
                <ProjectCard key={laneSelectKey(lane, index)} lane={lane} onRefresh={load} />
              ))}
            </div>
          </section>
          <div className="control-tabs" role="tablist" aria-label="프로젝트 목록">{sortedLanes.map((lane, index) => { const presentation = projectPresentation(lane); const key = laneSelectKey(lane, index); const isActive = key === activeKey; const attn = laneAttention(lane); return <button className={`control-tab${isActive ? ' active' : ''}`} key={lane.id ?? lane.project ?? index} onClick={() => setSelectedId(key)} role="tab" aria-selected={isActive} aria-label={`${presentation.name}: ${presentation.goal}`}><span>{presentation.name}</span>{attn === 'decision' && <span className="attn-badge decision">결정 필요</span>}{attn === 'hold' && <span className="attn-badge hold">{holdBadgeText(visibleHoldEntries(lane.holds).length)}</span>}<small style={{ display: 'block', marginTop: 4 }}>{presentation.goal}</small></button>; })}</div>
          {activeLane && <LaneView lane={activeLane} onRefresh={load} canOpenWindow={!only} />}
        </>}
        {!only && (
          <div className="cr-bottom">
            <AiAssignCard board={board} />
            <TokensCard />
            <TodayCard board={board} />
            <RuntimeEnvCard />
          </div>
        )}
      </details>
    </main>
  );
}
