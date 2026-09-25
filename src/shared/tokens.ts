import { projectDisplayName } from './projectLabels.js';

// ── 관제실 '토큰 감지' 카드 (night tokens --json) ───────────────────────────
export const TOKENS_REFRESH_MS = 5 * 60_000; // 감지기가 로그를 읽으므로 5분보다 자주 부르지 않는다.
export const TOKENS_MAX_PROJECTS = 6;
const ANOMALY_KINDS = ['spike', 'heavy-task', 'burst'];

export type TokenSeverity = 'warn' | 'info';

export interface TokenFinding {
  kind: string;
  severity: TokenSeverity;
  /** 굵은 글씨 한 줄 */
  text: string;
  why: string;
  action: string;
  /** 원문 보기용 (폴더·세션·taskId·runtime id 등 나머지 필드) */
  raw: Record<string, unknown>;
}

export interface TokenProject {
  id: string;
  label: string;
  fresh: number;
  cache: number;
}

export interface TokensView {
  summary: string;
  fresh: number | null;
  cache: number | null;
  projects: TokenProject[];
  findings: TokenFinding[];
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const pick = (r: Record<string, unknown>, keys: string[]): number | null => {
  for (const k of keys) { const n = num(r[k]); if (n !== null) return n; }
  return null;
};

/** 1234567890 → '12억 3,456만', 52000 → '5만 2천', 830 → '830'. 억/만 단위, 반올림 없이 내림. Pure. */
export function formatTokens(n: number | null): string {
  if (n === null || !Number.isFinite(n) || n < 0) return '확인 중';
  const v = Math.floor(n);
  const eok = Math.floor(v / 1e8);
  const man = Math.floor((v % 1e8) / 1e4);
  if (eok > 0) return man > 0 ? `${eok.toLocaleString('en-US')}억 ${man.toLocaleString('en-US')}만` : `${eok.toLocaleString('en-US')}억`;
  if (man > 0) {
    const cheon = Math.floor((v % 1e4) / 1e3);
    return cheon > 0 ? `${man.toLocaleString('en-US')}만 ${cheon}천` : `${man.toLocaleString('en-US')}만`;
  }
  return v.toLocaleString('en-US');
}

/** spike·heavy-task·burst는 이상징후, 나머지는 새는 곳(leak). Pure. */
export function isAnomaly(kind: string): boolean {
  return ANOMALY_KINDS.includes(kind.toLowerCase());
}

const KIND_TEXT: Record<string, string> = {
  spike: '토큰이 갑자기 늘었어요',
  'heavy-task': '토큰을 많이 쓰는 작업이 있어요',
  burst: '짧은 시간에 토큰을 몰아 썼어요',
};

function normalizeFinding(entry: unknown, fallbackKind: string): TokenFinding | null {
  const r = obj(entry);
  if (typeof entry === 'string' && entry.trim()) return { kind: fallbackKind, severity: 'warn', text: entry.trim(), why: '', action: '', raw: {} };
  if (!Object.keys(r).length) return null;
  const kind = str(r.kind) || str(r.type) || fallbackKind;
  const sev = str(r.severity ?? r.level).toLowerCase();
  const { kind: _k, type: _t, severity: _s, level: _l, text: _x, title: _ti, message: _m, summary: _su, why: _w, reason: _r, action: _a, todo: _to, ...rest } = r;
  return {
    kind,
    severity: sev === 'info' || sev === 'low' ? 'info' : 'warn',
    text: str(r.text) || str(r.title) || str(r.message) || str(r.summary) || KIND_TEXT[kind.toLowerCase()] || '확인이 필요한 토큰 사용이 있어요',
    why: str(r.why) || str(r.reason),
    action: str(r.action) || str(r.todo),
    raw: rest,
  };
}

/** `night tokens --json` 응답을 화면용으로 정리한다(모양이 조금 달라도 견딤). 이상징후 먼저, 새는 곳 나중. Pure. */
export function normalizeTokens(payload: unknown): TokensView {
  const root = obj(payload);
  const totals = obj(root.totals ?? root.total);
  const fresh = pick(totals, ['fresh', 'new', 'fresh_tokens']) ?? pick(root, ['fresh', 'fresh_tokens']);
  const cache = pick(totals, ['cache', 'cached', 'cache_tokens']) ?? pick(root, ['cache', 'cache_tokens', 'cached']);

  const projSrc = root.projects ?? root.by_project ?? root.perProject;
  const projList: Array<[string, unknown]> = Array.isArray(projSrc)
    ? projSrc.map(p => ['', p] as [string, unknown])
    : Object.entries(obj(projSrc));
  const projects: TokenProject[] = [];
  for (const [key, entry] of projList) {
    const r = obj(entry);
    const id = str(r.project ?? r.id ?? r.name) || key;
    if (!id) continue;
    projects.push({ id, label: projectDisplayName(id), fresh: pick(r, ['fresh', 'new', 'fresh_tokens']) ?? 0, cache: pick(r, ['cache', 'cached', 'cache_tokens']) ?? 0 });
  }
  projects.sort((a, b) => b.fresh - a.fresh || b.cache - a.cache);

  const listOf = (v: unknown, kind: string): TokenFinding[] =>
    (Array.isArray(v) ? v : []).map(e => normalizeFinding(e, kind)).filter((f): f is TokenFinding => f !== null);
  const all = [...listOf(root.findings, 'leak'), ...listOf(root.anomalies, 'spike'), ...listOf(root.leaks, 'leak')];
  const findings = [...all.filter(f => isAnomaly(f.kind)), ...all.filter(f => !isAnomaly(f.kind))];

  return { summary: str(root.summary), fresh, cache, projects, findings };
}

/** 카드 맨 윗줄. 서버 요약이 있으면 그대로, 없으면 결과로 만든다. Pure. */
export function tokensSummaryLine(view: TokensView): string {
  if (view.summary) return view.summary;
  return view.findings.length ? `살펴볼 토큰 사용이 ${view.findings.length}건 있어요.` : '토큰이 새는 곳 없이 잘 쓰이고 있어요.';
}

/** 프로젝트 목록: 많이 쓴 순 상위 6개. Pure. */
export const topTokenProjects = (view: TokensView, max = TOKENS_MAX_PROJECTS): TokenProject[] => view.projects.slice(0, max);
