import React, { useEffect, useMemo, useState } from 'react';
import { must } from './bridge.js';
import { PROJECT_LABELS, foldedManifestGoal, planLaneDisplayName, planVisibleGoal } from '../shared/projectLabels.js';
import { controlRoomTaskId, founderTaskTitle, isPlanStudioTaskDone, isPlanStudioTaskHold, sortPlanStudioTasks } from '../shared/types.js';
import { InlineConfirm } from './components.js';

const FLOW = ['계획', '확인', '작업', '검수', '시험', '사람 확인', '반영'] as const;

interface BoardLane {
  id?: string;
  project?: string;
  name?: string;
  current?: { stage?: number | string; taskId?: string; worker?: unknown; qa?: unknown; [key: string]: unknown };
  workerChain?: unknown;
  qaChain?: unknown;
  holds?: Array<{ taskId?: string; reason?: string } | string>;
  humanGate?: Record<string, unknown>;
  founderGate?: Record<string, unknown>;
  blocker?: string;
  [key: string]: unknown;
}

interface StudioTask {
  id: string;
  title: string;
  scope: string;
  registered: boolean;
  stage: number | string;
  agents: string;
  blocker: string;
  expectedRisk: string;
  completedAt: string;
}

interface StudioGate {
  gateId: string;
  title: string;
  options: string[];
  recommendedIndex: number;
  autoAt: string;
}

interface StudioDraft {
  goal: string;
  tasks: StudioTask[];
  runPolicy: 'continue' | 'stop';
  approved: boolean;
}

const EMPTY_DRAFT: StudioDraft = { goal: '', tasks: [], runPolicy: 'continue', approved: false };

export function resetPlanStudioPendingState(): { pendingApprove: false; pendingDeleteId: null; pendingPolicy: null } {
  return { pendingApprove: false, pendingDeleteId: null, pendingPolicy: null };
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function label(value: unknown, fallback = '—'): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function projectPresentation(project: string, lane?: BoardLane): { name: string; goal: string } {
  return {
    name: planLaneDisplayName(project, lane?.name, PROJECT_LABELS),
    goal: planVisibleGoal(project, PROJECT_LABELS),
  };
}

function rawText(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function isNegatedDoneValue(value: string): boolean {
  const stripped = value.replace(/[\s_\-]+/g, '');
  return stripped.includes('UNDONE')
    || stripped.includes('NOTDONE')
    || stripped.includes('INCOMPLETE')
    || stripped.includes('NOTCOMPLETE')
    || stripped.includes('NONDONE')
    || stripped.includes('NONCOMPLETE')
    || stripped.includes('UNCOMPLETE')
    || stripped.includes('NOTINTEGRATED')
    || stripped.includes('NOTVERIFIED');
}

function stageIndex(stage: number | string): number {
  if (typeof stage === 'number' && Number.isFinite(stage)) return Math.max(0, Math.min(FLOW.length - 1, stage));
  const value = String(stage).toUpperCase();
  if (!isNegatedDoneValue(value) && (value.includes('INTEGR') || value.includes('통합') || value.includes('반영') || value.includes('DONE') || value.includes('COMPLETE'))) return 6;
  if (value.includes('HUMAN') || value.includes('FOUNDER') || value.includes('사람 확인')) return 5;
  if (value.includes('GATE') || value.includes('시험')) return 4;
  if (value.includes('QA') || value.includes('검수')) return 3;
  if (value.includes('WORKER') || value.includes('BUILDER') || value.includes('작업')) return 2;
  if (value.includes('VERIF') || value.includes('VALID') || value.includes('검증') || value.includes('확인')) return 1;
  return 0;
}

/** 끝난 시각을 '3분 전' 또는 '오후 2:10'으로. 화면에는 ISO 시각을 올리지 않는다. */
function formatDoneDate(value: unknown, now = Date.now()): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const parsed = Date.parse(value.trim());
  if (Number.isNaN(parsed)) return '';
  const diff = now - parsed;
  if (diff >= 0 && diff < 60_000) return '방금';
  if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff >= 0 && diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  const when = new Date(parsed);
  const clockNow = new Date(now);
  const hour = when.getHours();
  const minute = String(when.getMinutes()).padStart(2, '0');
  const clock = `${hour < 12 ? '오전' : '오후'} ${hour % 12 || 12}:${minute}`;
  const monthDay = `${when.getMonth() + 1}월 ${when.getDate()}일`;
  return when.getFullYear() === clockNow.getFullYear()
    ? `${monthDay} ${clock}`
    : `${when.getFullYear()}년 ${monthDay} ${clock}`;
}

function doneLabel(task: StudioTask): string {
  const date = formatDoneDate(task.completedAt);
  return date ? `완료 · ${date}` : '완료';
}

function agentsText(record: Record<string, unknown>): string {
  const direct = record.agents ?? record.owner ?? record.assignee;
  if (typeof direct === 'string' && direct.trim()) return direct;
  if (Array.isArray(direct)) return direct.map(v => str(v)).filter(Boolean).join(', ');
  const parts = [record.worker, record.qa].map(v => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      const r = v as Record<string, unknown>;
      return str(r.name ?? r.id ?? r.state ?? r.status);
    }
    return '';
  }).filter(Boolean);
  return parts.join(' → ');
}

function unwrapDraft(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const root = raw as Record<string, unknown>;
  for (const key of ['draft', 'roadmap', 'plan', 'data']) {
    const inner = root[key];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner as Record<string, unknown>;
  }
  return root;
}

function toTask(item: unknown, index: number): StudioTask {
  const fallbackId = `task-${index + 1}`;
  if (typeof item === 'string') {
    return { id: fallbackId, title: item, scope: item, registered: false, stage: 0, agents: '', blocker: '', expectedRisk: '', completedAt: '' };
  }
  if (!item || typeof item !== 'object') {
    return { id: fallbackId, title: fallbackId, scope: fallbackId, registered: false, stage: 0, agents: '', blocker: '', expectedRisk: '', completedAt: '' };
  }
  const r = item as Record<string, unknown>;
  const taskId = str(r.taskId ?? r.task_id);
  const id = taskId || str(r.id ?? r.key, fallbackId);
  const title = str(r.title ?? r.name ?? r.label ?? r.taskId ?? r.id, id);
  const scope = str(r.scope ?? r.description, title);
  const stage = (r.stage ?? r.status ?? r.state ?? r.step ?? r.phase ?? 0) as number | string;
  const blocker = str(r.blocker ?? r.blockedReason ?? r.holdReason);
  const expectedRisk = str(r.expectedRisk ?? r.risk ?? r.expected_risk ?? r.danger);
  const completedAt = str(
    r.completedAt ?? r.completed_at ?? r.doneAt ?? r.done_at ?? r.finishedAt ?? r.finished_at
    ?? r.closedAt ?? r.closed_at ?? r.verifiedAt ?? r.updatedAt ?? r.updated_at ?? r.date,
  );
  return { id, title, scope, registered: Boolean(taskId), stage, agents: agentsText(r), blocker, expectedRisk, completedAt };
}

export function toRoadmapPayload(draft: StudioDraft): { goal: string; policy: 'continue' | 'stop'; tasks: Array<{ taskId: string; title: string; scope: string }> } {
  return {
    goal: draft.goal,
    policy: draft.runPolicy,
    tasks: draft.tasks.filter(task => !task.registered).slice(0, 12).map(task => ({
      taskId: task.id,
      title: task.title,
      scope: task.scope || task.title,
    })),
  };
}

function normalizeDraft(raw: unknown): StudioDraft {
  const root = unwrapDraft(raw);
  const goal = str(root.goal ?? root.title ?? root.objective ?? root.summary ?? root.description);
  const rawTasks = root.tasks ?? root.lanes ?? root.steps ?? root.items ?? root.chain;
  const tasks = Array.isArray(rawTasks) ? rawTasks.map((t, i) => toTask(t, i)) : [];
  const policyRaw = str(root.runPolicy ?? root.run_policy ?? root.policy ?? root.mode).toLowerCase();
  const runPolicy: 'continue' | 'stop' = /stop|pause|manual|hold|step/.test(policyRaw) ? 'stop' : 'continue';
  const approval = root.approved ?? root.planApproved ?? root.plan_approved ?? root.approval;
  const approved = approval === true
    || (typeof approval === 'object' && approval !== null && Boolean((approval as Record<string, unknown>).approved))
    || /approved|승인/.test(str(root.phase ?? root.status ?? approval).toLowerCase());
  return { goal, tasks, runPolicy, approved };
}

function normalizeGates(raw: unknown): StudioGate[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object'
    ? ((raw as Record<string, unknown>).gates as unknown)
    : [];
  if (!Array.isArray(list)) return [];
  const out: StudioGate[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const gateId = str(r.gateId ?? r.id ?? r.gate_id);
    if (!gateId) continue;
    const title = str(r.ask ?? r.title ?? r.question ?? r.summary, gateId);
    const rawOptions = r.options ?? r.choices ?? r.candidates;
    const options = Array.isArray(rawOptions)
      ? rawOptions.map(o => typeof o === 'string' ? o : label((o as Record<string, unknown>)?.label ?? (o as Record<string, unknown>)?.title, '')).filter(Boolean)
      : [];
    const choices = options.length ? options : ['승인', '반려'];
    out.push({
      gateId,
      title,
      options: choices,
      recommendedIndex: recommendedOptionIndex(choices, r.recommendedIndex ?? r.recommended),
      autoAt: str(r.autoAt ?? r.deadline ?? r.answerBy),
    });
  }
  return out;
}

function gateFromLane(lane: BoardLane | undefined): StudioGate | null {
  if (!lane) return null;
  const gate = lane.humanGate ?? lane.founderGate;
  if (!gate || typeof gate !== 'object') return null;
  const gateId = str(gate.gateId ?? gate.id);
  if (!gateId) return null;
  const title = str(gate.ask ?? gate.title ?? gate.question, '사람 확인이 필요해요.');
  const rawOptions = gate.options ?? gate.choices;
  const options = Array.isArray(rawOptions) ? rawOptions.map(o => label(o)).filter(o => o !== '—') : [];
  const choices = options.length ? options : ['승인', '반려'];
  return {
    gateId,
    title,
    options: choices,
    recommendedIndex: recommendedOptionIndex(choices, gate.recommendedIndex ?? gate.recommended),
    autoAt: str(gate.autoAt ?? gate.deadline ?? gate.answerBy),
  };
}

export type PlanChipTone = 'teal' | 'amber' | 'muted';

export interface PlanTaskChip {
  label: '끝남' | '진행 중' | '확인 필요' | '대기';
  tone: PlanChipTone;
}

/**
 * 작업 한 줄의 상태 칩. 끝남·진행은 청록, 확인이 필요하면 호박색, 대기는 흐린색.
 * 막힌 상태를 빨강으로 올리지 않는다.
 */
export function planTaskStateChip(task: { stage?: number | string; blocker?: string } | null | undefined): PlanTaskChip {
  if (isPlanStudioTaskDone(task)) return { label: '끝남', tone: 'teal' };
  if (isPlanStudioTaskHold(task)) return { label: '확인 필요', tone: 'amber' };
  if (stageIndex((task?.stage ?? 0) as number | string) === 0) return { label: '대기', tone: 'muted' };
  return { label: '진행 중', tone: 'teal' };
}

export interface PlanAnswerChoice {
  option: string;
  index: number;
  recommended: boolean;
}

/** 사람 확인 답. 추천을 맨 앞에 두고, 범위를 벗어나면 첫 답을 추천으로 본다. */
export function planAnswersRecommendedFirst(options: readonly string[], recommendedIndex = 0): PlanAnswerChoice[] {
  const rows = options.map((option, index) => ({
    option,
    index,
    recommended: index === recommendedIndex && recommendedIndex >= 0 && recommendedIndex < options.length,
  }));
  if (!rows.some(row => row.recommended) && rows[0]) rows[0] = { ...rows[0], recommended: true };
  const recommended = rows.find(row => row.recommended);
  if (!recommended) return rows;
  return [recommended, ...rows.filter(row => row.index !== recommended.index)];
}

/** 보내기 버튼 문구. 성공하면 그 자리에서 '보냈어요 ✓'. */
export function planSendButtonLabel(sent: boolean, busy = false): string {
  if (busy) return '보내는 중...';
  return sent ? '보냈어요 ✓' : '보내기';
}

export interface PlanRequestTask {
  id: string;
  title: string;
}

function requestTaskList(value: readonly unknown[] | null | undefined): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Tasks whose ids appear in `after` but not in `before`.
 * 요청 전후에 같은 id가 있으면 새 작업이 아니다. 화면 제목은 한국어로 바꿔 둔다.
 */
export function newTasksAfterRequest(
  before: readonly unknown[] | null | undefined,
  after: readonly unknown[] | null | undefined,
): PlanRequestTask[] {
  const known = new Set<string>();
  for (const task of requestTaskList(before)) {
    const id = controlRoomTaskId(task);
    if (id) known.add(id);
  }
  const created: PlanRequestTask[] = [];
  const seen = new Set<string>();
  for (const task of requestTaskList(after)) {
    const id = controlRoomTaskId(task);
    if (!id || known.has(id) || seen.has(id)) continue;
    seen.add(id);
    created.push({ id, title: founderTaskTitle(task) });
  }
  return created;
}

/**
 * Result under the plan request box: Korean titles on the surface, ids folded.
 * 새로 생긴 작업이 없으면 기다리는 이유를 한 줄로 보여 준다.
 */
export function PlanRequestResult({ tasks }: { tasks: readonly PlanRequestTask[] }): React.ReactElement {
  if (tasks.length === 0) {
    return (
      <p className="muted plan-request-result" role="status">
        새로 생긴 작업은 없어요 — PM 답을 기다리는 중이에요
      </p>
    );
  }
  return (
    <div className="plan-request-result" role="status">
      <p className="plan-inline-ok">
        PM이 만든 작업 <strong style={{ fontSize: 28, lineHeight: 1.2 }}>{tasks.length}</strong>개
      </p>
      <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
        {tasks.map(task => (
          <li key={task.id} className="plan-task-title">{task.title}</li>
        ))}
      </ul>
      <details>
        <summary style={{ display: 'flex', alignItems: 'center', minHeight: 44, fontSize: 16, cursor: 'pointer' }}>원문 보기</summary>
        {tasks.map(task => (
          <p key={task.id} className="muted mono">{task.id}</p>
        ))}
      </details>
    </div>
  );
}

/** 안 고르면 언제 추천대로 가는지. 시각이 없거나 이미 지났으면 빈 문자열. */
export function planGateAutoLine(autoAt: string, now = Date.now()): string {
  if (!autoAt.trim()) return '';
  const at = Date.parse(autoAt);
  if (!Number.isFinite(at) || at <= now) return '';
  const when = new Date(at);
  const hour = String(when.getHours()).padStart(2, '0');
  const minute = String(when.getMinutes()).padStart(2, '0');
  return `안 고르면 ${hour}:${minute}에 추천대로 진행해요`;
}

function recommendedOptionIndex(options: readonly string[], raw: unknown): number {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < options.length) return raw;
  const marked = options.findIndex(option => option.includes('추천'));
  return marked >= 0 ? marked : 0;
}

type PlanFailure = { what: string; why: string; raw: string; retry: () => void };

// 오류 세 줄: 무슨 일(what) · 왜(why, 추측) · 할 일(다시 시도 버튼). 원문은 접어 둔다.
function planFailure(what: string, e: unknown, retry: () => void): PlanFailure {
  const raw = e instanceof Error ? e.message : String(e);
  const offline = /fetch|network|timeout|timed out|ECONN|ENOTFOUND|EHOSTUNREACH|offline|socket|연결/i.test(raw);
  return {
    what,
    why: offline
      ? '이유: 다른 PC가 꺼져 있거나 네트워크가 끊긴 것 같아요. 연결을 확인한 뒤 눌러 주세요.'
      : '이유: 연결은 되어 있는데 처리하다가 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.',
    raw,
    retry,
  };
}

export function PlanStudio({ onClose, initialProject }: { onClose: () => void; initialProject?: string }): React.ReactElement {
  const [lanes, setLanes] = useState<BoardLane[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState(initialProject ?? 'agent-relay');
  const [draft, setDraft] = useState<StudioDraft>(EMPTY_DRAFT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chat, setChat] = useState('');
  const [requestText, setRequestText] = useState('');
  const [requestSent, setRequestSent] = useState(false);
  const [requestResult, setRequestResult] = useState<PlanRequestTask[] | null>(null);
  const [gateSent, setGateSent] = useState('');
  const [gates, setGates] = useState<StudioGate[]>([]);
  const [gatePick, setGatePick] = useState<Record<string, number>>({});
  const [failure, setFailure] = useState<PlanFailure | null>(null);
  const [boardFailure, setBoardFailure] = useState<PlanFailure | null>(null);
  const [boardAttempt, setBoardAttempt] = useState(0);
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'chat' | 'request' | 'save' | 'approve' | 'gate' | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingApprove, setPendingApprove] = useState(false);
  const [pendingPolicy, setPendingPolicy] = useState<'continue' | 'stop' | null>(null);
  const [lastDeleted, setLastDeleted] = useState<{ task: StudioTask; index: number } | null>(null);
  const [draftLoadError, setDraftLoadError] = useState(false);
  const [draftLoadAttempt, setDraftLoadAttempt] = useState(0);

  useEffect(() => {
    const reset = resetPlanStudioPendingState();
    setPendingApprove(reset.pendingApprove);
    setPendingDeleteId(reset.pendingDeleteId);
    setPendingPolicy(reset.pendingPolicy);
    setRequestSent(false);
    setRequestResult(null);
    setGateSent('');
  }, [project]);

  // Board polling — task progress rows are fed by controlRoom:board.
  useEffect(() => {
    let alive = true;
    const refresh = (): void => {
      void must<{ lanes?: BoardLane[] }>({ op: 'controlRoom:board' }).then(next => {
        if (!alive) return;
        setBoardFailure(null);
        const nextLanes = Array.isArray(next?.lanes) ? next.lanes : [];
        setLanes(nextLanes);
        const names = [...new Set(nextLanes.map(l => str(l.project ?? l.id)).filter(Boolean))];
        setProjects(names);
        setProject(prev => {
          if (prev && names.includes(prev)) return prev;
          if (initialProject && names.includes(initialProject)) return initialProject;
          return names[0] ?? prev;
        });
      }).catch(e => { if (alive) setBoardFailure(planFailure('프로젝트 목록을 불러오지 못했어요', e, () => setBoardAttempt(value => value + 1))); });
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [initialProject, boardAttempt]);

  // Draft + gates load per project.
  useEffect(() => {
    if (!project) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    setFailure(null);
    setDraftLoadError(false);
    void must<unknown>({ op: 'planStudio:get', project }).then(raw => {
      if (!alive) return;
      const next = normalizeDraft(raw);
      setDraft(next);
      setSelectedId(prev => (prev && next.tasks.some(t => t.id === prev) ? prev : next.tasks[0]?.id ?? null));
    }).catch(e => {
      if (alive) { setDraft(EMPTY_DRAFT); setDraftLoadError(true); setFailure(planFailure('이 계획을 읽지 못했어요', e, () => setDraftLoadAttempt(value => value + 1))); }
    }).finally(() => { if (alive) setLoading(false); });
    void must<unknown>({ op: 'gates:list' }).then(raw => {
      if (alive) setGates(normalizeGates(raw));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [project, draftLoadAttempt]);

  const boardStageByTask = useMemo(() => {
    const map = new Map<string, number | string>();
    for (const lane of lanes) {
      const stage = lane.current?.stage ?? 0;
      const keys = [str(lane.current?.taskId), str(lane.id)].filter(Boolean);
      for (const key of keys) if (!map.has(key)) map.set(key, stage as number | string);
    }
    return map;
  }, [lanes]);

  // Draft tasks merged with live board stages; board-only tasks fill gaps.
  // Founder view: 진행중/대기 먼저, HOLD 다음, 끝난 작업 마지막.
  const tasks = useMemo<StudioTask[]>(() => {
    if (draftLoadError) return [];
    const merged = draft.tasks.map(t => ({ ...t, stage: boardStageByTask.get(t.id) ?? boardStageByTask.get(t.title) ?? t.stage }));
    if (merged.length > 0) return sortPlanStudioTasks(merged);
    const seen = new Set<string>();
    const derived: StudioTask[] = [];
    for (const lane of lanes) {
      if (project && str(lane.project ?? lane.id) !== project && lanes.some(l => str(l.project ?? l.id) === project)) continue;
      const id = str(lane.current?.taskId ?? lane.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      derived.push({
        id,
        title: founderTaskTitle(lane.current ?? lane),
        scope: id,
        registered: true,
        stage: (lane.current?.stage ?? 0) as number | string,
        agents: agentsText({ worker: lane.workerChain ?? lane.current?.worker, qa: lane.qaChain ?? lane.current?.qa }),
        blocker: str(lane.blocker),
        expectedRisk: '',
        completedAt: '',
      });
    }
    return sortPlanStudioTasks(derived);
  }, [draft.tasks, boardStageByTask, lanes, project, draftLoadError]);

  const finishedCount = useMemo(() => tasks.filter(isPlanStudioTaskDone).length, [tasks]);
  const remainingCount = tasks.length - finishedCount;
  const visibleTasks = useMemo(
    () => (showDone ? tasks : tasks.filter(t => !isPlanStudioTaskDone(t))),
    [tasks, showDone],
  );

  const selected = tasks.find(t => t.id === selectedId) ?? tasks[0] ?? null;
  const projectLane = lanes.find(l => str(l.project ?? l.id) === project);
  const presentation = projectPresentation(project, projectLane);
  const goalText = presentation.goal;
  const manifestGoal = foldedManifestGoal(
    goalText,
    draft.goal,
    projectLane?.goal,
    projectLane?.summary,
    projectLane?.current?.goal,
    projectLane?.current?.summary,
  );
  const activeLane = useMemo(
    () => lanes.find(l => str(l.current?.taskId ?? l.id) === (selected?.id ?? '') || str(l.current?.taskId ?? l.id) === (selected?.title ?? '')),
    [lanes, selected],
  );
  const laneGate = gateFromLane(activeLane ?? lanes.find(l => str(l.project ?? l.id) === project));
  const visibleGates = gates.length ? gates : laneGate ? [laneGate] : [];

  useEffect(() => {
    setSelectedId(prev => {
      const unfinished = tasks.find(task => !isPlanStudioTaskDone(task));
      return prev && tasks.some(task => task.id === prev && !isPlanStudioTaskDone(task))
        ? prev
        : unfinished?.id ?? tasks[0]?.id ?? null;
    });
  }, [tasks]);

  function flashInfo(text: string): void {
    setInfo(text);
    setFailure(null);
  }

  function flashError(e: unknown, what: string, retry: () => void): void {
    setFailure(planFailure(what, e, retry));
  }

  async function persist(next: StudioDraft, what: 'chat' | 'request' | 'save' | 'approve' | 'gate'): Promise<void> {
    setBusy(what);
    try {
      const payload = JSON.stringify(toRoadmapPayload(next));
      await must({ op: 'planStudio:save', project, draft: payload });
      setDraft(next);
      flashInfo('초안 저장됨');
    } catch (e) { flashError(e, '초안을 저장하지 못했어요', () => void persist(next, what)); } finally { setBusy(null); }
  }

  function isNotStarted(task: StudioTask): boolean {
    return stageIndex(boardStageByTask.get(task.id) ?? boardStageByTask.get(task.title) ?? task.stage) === 0;
  }

  async function sendChat(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await submitChat(chat.trim());
  }

  async function submitChat(message: string): Promise<void> {
    if (!message || busy) return;
    setBusy('chat');
    try {
      const reply = await must<unknown>({ op: 'planStudio:chat', project, message });
      const candidate = normalizeDraft(reply);
      if (candidate.tasks.length || candidate.goal) {
        setDraft(candidate);
        setSelectedId(prev => (prev && candidate.tasks.some(t => t.id === prev) ? prev : candidate.tasks[0]?.id ?? null));
        flashInfo('PM 초안이 갱신되었습니다');
      } else {
        const fresh = await must<unknown>({ op: 'planStudio:get', project });
        const next = normalizeDraft(fresh);
        setDraft(next);
        flashInfo('PM 답변 반영 후 초안을 다시 읽었습니다');
      }
      setChat('');
    } catch (err) { flashError(err, 'PM에게 보낸 말이 반영되지 않았어요', () => void submitChat(message)); } finally { setBusy(null); }
  }

  async function submitRequest(message: string): Promise<void> {
    if (!message || busy) return;
    const before = tasks;
    setBusy('request');
    setRequestSent(false);
    setRequestResult(null);
    try {
      await must({ op: 'planStudio:request', project, text: message });
      const fresh = await must<unknown>({ op: 'planStudio:get', project });
      const next = normalizeDraft(fresh);
      const created = newTasksAfterRequest(before, next.tasks);
      setDraft(next);
      setSelectedId(prev => (prev && next.tasks.some(t => t.id === prev) ? prev : next.tasks[0]?.id ?? null));
      setRequestText('');
      setRequestSent(true);
      setRequestResult(created);
      flashInfo('보냈어요 ✓');
    } catch (err) {
      flashError(err, 'PM에게 보낸 말이 반영되지 않았어요', () => void submitRequest(message));
    } finally { setBusy(null); }
  }

  async function approve(): Promise<void> {
    setBusy('approve');
    try {
      await must({ op: 'planStudio:approve', project });
      setDraft(prev => ({ ...prev, approved: true }));
      flashInfo('계획 승인 → 자동 진행 요청됨');
    } catch (e) { flashError(e, '계획을 승인하지 못했어요', () => void approve()); } finally { setBusy(null); setPendingApprove(false); }
  }

  async function answerGate(gateId: string, optionIndex = gatePick[gateId] ?? 0): Promise<void> {
    setBusy('gate');
    setGatePick(prev => ({ ...prev, [gateId]: optionIndex }));
    try {
      await must({ op: 'gates:answer', gateId, optionIndex });
      setGateSent(gateId);
      flashInfo('보냈어요 ✓');
    } catch (e) { flashError(e, '응답을 보내지 못했어요', () => void answerGate(gateId, optionIndex)); } finally { setBusy(null); }
  }

  function requestDelete(task: StudioTask): void {
    setLastDeleted(null);
    setPendingDeleteId(task.id);
  }

  function confirmDelete(task: StudioTask): void {
    const index = draft.tasks.findIndex(t => t.id === task.id);
    const target = draft.tasks[index] ?? task;
    const at = index >= 0 ? index : draft.tasks.length;
    const next = { ...draft, tasks: draft.tasks.filter(t => t.id !== task.id) };
    setPendingDeleteId(null);
    setSelectedId(next.tasks[Math.min(at, next.tasks.length - 1)]?.id ?? null);
    setLastDeleted({ task: target, index: at });
    void persist(next, 'save').then(() => flashInfo(`‘${target.title}’ 삭제됨`));
  }

  function undoDelete(): void {
    if (!lastDeleted) return;
    const restored = [...draft.tasks];
    restored.splice(Math.min(lastDeleted.index, restored.length), 0, lastDeleted.task);
    const next = { ...draft, tasks: restored };
    setLastDeleted(null);
    setSelectedId(lastDeleted.task.id);
    void persist(next, 'save').then(() => flashInfo(`‘${lastDeleted.task.title}’ 되돌림`));
  }

  const shownFailure = failure ?? boardFailure;

  return (
    <main className="control-room plan-studio">
      <div className="control-room-head">
        <div>
          <h1>계획</h1>
          <p className="muted">목표와 작업 순서를 보고, PM에게 바꿔 달라고 말할 수 있어요.</p>
        </div>
        <button className="btn" onClick={onClose}>닫기</button>
      </div>
      {shownFailure && <div className="flash warn" role="alert" style={{ flexDirection: 'column', alignItems: 'flex-start', background: 'color-mix(in srgb, var(--warn) 12%, transparent)', borderColor: 'var(--warn)' }}>
        <p><strong>{shownFailure.what}</strong></p>
        <p>{shownFailure.why}</p>
        <p>
          <button className="mini" onClick={() => { const retry = shownFailure.retry; setFailure(null); setBoardFailure(null); retry(); }}>다시 시도</button>
        </p>
        <details><summary>원문 보기</summary><p className="muted mono">{shownFailure.raw}</p></details>
      </div>}
      {info && <div className="flash ok">{info}</div>}
      <div className="plan-studio-grid">
        <section className="control-card plan-projects" aria-label="프로젝트 목록">
          {projects.length === 0
            ? <p className="muted">아직 프로젝트가 없어요. 보드에 프로젝트가 생기면 여기에 나타나요.</p>
            : <div className="plan-project-list" role="listbox" aria-label="프로젝트">
              {projects.map(name => {
                const lane = lanes.find(l => str(l.project ?? l.id) === name);
                const item = projectPresentation(name, lane);
                return (
                <button
                  key={name}
                  role="option"
                  aria-selected={name === project}
                  className={`plan-project${name === project ? ' active' : ''}`}
                  onClick={() => setProject(name)}
                >{item.name}</button>
                );
              })}
            </div>}
        </section>

        <section className="plan-center" aria-label="목표와 작업 순서">
          <article className="control-card" aria-label="목표">
            <h3>목표</h3>
            {loading
              ? <p className="muted">불러오는 중...</p>
              : <>
                <p className="plan-goal">{goalText}</p>
                <p className="muted">선택한 프로젝트: {presentation.name}</p>
                <details>
                  <summary>원문 보기</summary>
                  {manifestGoal ? <p className="muted mono">{manifestGoal}</p> : null}
                  <pre className="mono">{rawText(projectLane ?? draft)}</pre>
                </details>
              </>}
          </article>

          <article className="control-card" aria-label="작업 순서">
            <h3>작업 순서 ({tasks.length}개)</h3>
            {tasks.length === 0
              ? <p className="muted">아직 작업 순서가 없어요. PM에게 바꿔 달라고 말하면 여기에 생겨요.</p>
              : <>
                {remainingCount === 0 && <p className="muted" role="status">모두 끝났어요 — 남은 작업이 없습니다.</p>}
                <ol className="plan-tasks">
                {visibleTasks.map(task => {
                  const current = stageIndex(task.stage);
                  const done = isPlanStudioTaskDone(task);
                  const chip = planTaskStateChip(task);
                  const number = tasks.findIndex(item => item.id === task.id) + 1;
                  const editable = isNotStarted(task) && !done && !task.registered;
                  return (
                    <li key={task.id} className={`plan-task${selected?.id === task.id ? ' selected' : ''}`}>
                      <div className="plan-seq-row">
                        <button className="plan-task-head" onClick={() => setSelectedId(task.id)} title="상세 보기">
                          <span className="plan-seq-num" aria-hidden="true">{number}</span>
                          <span className="plan-task-title">{founderTaskTitle(task)}</span>
                        </button>
                        <span className={`cr-chip ${chip.tone}`}>{chip.label}</span>
                      </div>
                      {done ? <p className="muted plan-seq-done">{doneLabel(task)}</p> : null}
                      <details className="plan-steps-fold">
                        <summary>단계 보기</summary>
                      <div className="control-flow plan-steps" aria-label={`${task.title} 진행 단계`}>
                        {FLOW.map((name, index) => {
                          const state = done ? 'done' : task.blocker && index === current ? 'blocked' : index < current ? 'done' : index === current ? 'active' : 'pending';
                          return (
                            <div className={`control-step ${state}`} key={name} title={name}>
                              <span className="control-step-dot">{state === 'done' ? '✓' : state === 'blocked' ? '!' : state === 'active' ? '●' : '○'}</span>
                              <span>{name}</span>
                            </div>
                          );
                        })}
                      </div>
                      </details>
                      <details><summary>원문 보기</summary><p className="muted mono">ID: {task.id}</p><p className="muted mono">범위: {task.scope || '—'}</p></details>
                      {editable && (
                        <div className="plan-task-edit">
                          <input
                            aria-label={`${task.title} 제목 편집`}
                            value={task.title}
                            onChange={e => setDraft(prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === task.id ? { ...t, title: e.target.value } : t) }))}
                          />
                          <button
                            className="mini"
                            disabled={busy === 'save'}
                            onClick={() => void persist({ ...draft, tasks: draft.tasks.map(t => t.id === task.id ? { ...t, title: task.title } : t) }, 'save')}
                          >제목 저장</button>
                          <button
                            className="mini"
                            title="시작 전 작업 삭제"
                            disabled={busy === 'save'}
                            onClick={() => requestDelete(task)}
                          >삭제</button>
                        </div>
                      )}
                      {pendingDeleteId === task.id && (
                        <InlineConfirm
                          message={`‘${task.title}’ 삭제하시겠어요?`}
                          confirmLabel="삭제"
                          busy={busy === 'save'}
                          busyLabel="삭제 중…"
                          onConfirm={() => confirmDelete(task)}
                          onCancel={() => setPendingDeleteId(null)}
                        />
                      )}
                    </li>
                  );
                })}
                </ol>
                {lastDeleted && (
                  <div className="plan-undo" role="status">
                    <span>‘{lastDeleted.task.title}’ 삭제됨</span>
                    <button className="mini" onClick={undoDelete} disabled={busy === 'save'}>
                      되돌리기
                    </button>
                  </div>
                )}
                {finishedCount > 0 && (
                  <button
                    className="mini"
                    aria-expanded={showDone}
                    onClick={() => setShowDone(prev => !prev)}
                  >
                    {showDone ? '끝난 작업 닫기' : `끝난 작업 ${finishedCount}개 보기`}
                  </button>
                )}
              </>}
          </article>

          <article className="control-card" aria-label="PM에게 바꿔 달라고 말하기">
            <h3>PM에게 바꿔 달라고 말하기</h3>
            <form
              className="plan-request-form"
              aria-label="PM에게 요청"
              onSubmit={e => { e.preventDefault(); void submitRequest(requestText.trim()); }}
            >
              <input
                aria-label="PM에게 계획 수정 요청"
                value={requestText}
                onChange={e => { setRequestText(e.target.value); setRequestSent(false); setRequestResult(null); }}
                placeholder="예: 3번 작업을 먼저 검수해 줘"
              />
              <button className="btn primary plan-send" type="submit" disabled={!requestText.trim() || busy === 'request'}>
                {planSendButtonLabel(requestSent, busy === 'request')}
              </button>
            </form>
            {requestSent && <p className="plan-inline-ok" role="status">보냈어요 ✓</p>}
            {requestResult !== null && <PlanRequestResult tasks={requestResult} />}
            <p className="muted">PM이 답하면 작업 순서가 새로 그려져요.</p>
          </article>

          <article className="control-card plan-human" aria-label="사람 확인">
            <h3>사람 확인</h3>
            {visibleGates.length === 0
              ? <p className="muted">지금 답할 것이 없어요.</p>
              : visibleGates.map(gate => {
                const answers = planAnswersRecommendedFirst(gate.options, gate.recommendedIndex);
                const picked = gatePick[gate.gateId] ?? gate.recommendedIndex;
                const autoLine = planGateAutoLine(gate.autoAt);
                return (
                  <div key={gate.gateId} className="plan-gate">
                    <p className="plan-gate-ask">{gate.title}</p>
                    <details><summary>원문 보기</summary><p className="muted mono" style={{ fontSize: 11 }}>{gate.gateId}</p></details>
                    <div className="plan-answers" role="group" aria-label="사람 확인 답">
                      {answers.map(answer => (
                        <button
                          key={`${gate.gateId}-${answer.index}`}
                          type="button"
                          className={`btn plan-answer${answer.recommended ? ' recommended' : ''}${picked === answer.index ? ' on' : ''}`}
                          disabled={busy === 'gate'}
                          onClick={() => void answerGate(gate.gateId, answer.index)}
                        >
                          {answer.option}{answer.recommended ? ' · 추천' : ''}
                        </button>
                      ))}
                    </div>
                    {autoLine && <p className="muted plan-auto">{autoLine}</p>}
                    {gateSent === gate.gateId && <p className="plan-inline-ok" role="status">보냈어요 ✓</p>}
                  </div>
                );
              })}
          </article>

          <details className="plan-advanced">
            <summary>고급 (개발용)</summary>
          <article className="control-card" aria-label="진행 방식">
            <h3>진행 방식</h3>
            <label className="plan-radio">
              <input
                type="radio"
                name="run-policy"
                value="continue"
                checked={pendingPolicy ? pendingPolicy === 'continue' : draft.runPolicy === 'continue'}
                onChange={() => { setLastDeleted(null); setPendingPolicy('continue'); }}
              />
              계속 진행 — 각 작업 완료 후 자동 계속
            </label>
            <label className="plan-radio">
              <input
                type="radio"
                name="run-policy"
                value="stop"
                checked={pendingPolicy ? pendingPolicy === 'stop' : draft.runPolicy === 'stop'}
                onChange={() => { setLastDeleted(null); setPendingPolicy('stop'); }}
              />
              각 작업 후 중단 — 확인 후 다음 진행
            </label>
            {pendingPolicy && pendingPolicy !== draft.runPolicy && (
              <InlineConfirm
                message={pendingPolicy === 'continue' ? '계속 진행으로 바꾸시겠어요?' : '각 작업 후 중단으로 바꾸시겠어요?'}
                confirmLabel="바꾸기"
                busy={busy === 'save'}
                busyLabel="저장 중…"
                onConfirm={() => { const next = pendingPolicy; setPendingPolicy(null); void persist({ ...draft, runPolicy: next }, 'save'); }}
                onCancel={() => setPendingPolicy(null)}
              />
            )}
            <div className="modalbtns" style={{ justifyContent: 'flex-start' }}>
              {draft.approved && remainingCount === 0
                ? <p className="muted" role="status">승인됨 · 모두 끝났어요</p>
                : <button className="btn primary" disabled={busy === 'approve'} onClick={() => setPendingApprove(true)}>
                  {busy === 'approve' ? '승인 중...' : '계획 승인 → 자동 진행'}
                </button>}
            </div>
            {pendingApprove && (
              <InlineConfirm
                message="계획을 승인하고 자동 진행하시겠어요?"
                confirmLabel="승인"
                busy={busy === 'approve'}
                busyLabel="승인 중…"
                onConfirm={() => void approve()}
                onCancel={() => setPendingApprove(false)}
              />
            )}
          </article>
          <article className="control-card" aria-label="PM에게 요청">
            <h3>PM에게 요청</h3>
            <form onSubmit={e => void sendChat(e)} className="plan-chat-form">
              <textarea
                aria-label="PM에게 계획 수정 요청"
                value={chat}
                onChange={e => setChat(e.target.value)}
                placeholder="예: 3번 작업을 먼저 검수해 줘"
                rows={3}
              />
              <button className="btn primary" type="submit" disabled={!chat.trim() || busy === 'chat'}>
                {busy === 'chat' ? '전송 중...' : 'PM에게 요청'}
              </button>
            </form>
            <p className="muted">PM이 답하면 작업 순서가 새로 그려져요.</p>
          </article>

          <article className="control-card" aria-label="선택한 작업 상세">
            <h3>선택한 작업</h3>
            {!selected
              ? <p className="muted">왼쪽에서 작업을 골라 주세요.</p>
              : <>
                <p className="control-card-value" style={{ fontSize: 14 }}>{founderTaskTitle(selected)}</p>
                <details><summary>원문 보기</summary><p className="muted mono">ID: {selected.id}</p><p className="muted mono">범위: {selected.scope || '—'}</p></details>
                {isPlanStudioTaskDone(selected)
                  ? <p>{doneLabel(selected)}</p>
                  : <p>현재 단계: <strong>{FLOW[stageIndex(selected.stage)]}</strong> ({stageIndex(selected.stage) + 1}/7)</p>}
                {selected.agents.trim() ? <p>담당 AI: <strong>{selected.agents}</strong></p> : null}
                {selected.blocker.trim() ? <p>막힌 이유: <strong>{selected.blocker}</strong></p> : null}
                {selected.expectedRisk.trim() ? <p>예상 리스크: <strong>{selected.expectedRisk}</strong></p> : null}
              </>}
          </article>
          </details>
        </section>
      </div>
    </main>
  );
}
