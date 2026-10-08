/**
 * Workspace config v2 — dynamic, GUI-ready lane registry.
 *
 * v1 stored bare runtime labels ("codex-luna") and a global QA fallback
 * runtime. v2 separates, per role binding:
 *
 *   Runtime      = Codex / OpenCode / Claude / Grok / Cline / Cursor /
 *                  CommandCode / ChatGPT ... (the engine/adapter)
 *   Model/Profile= Luna / ChatGPT Web / team plan / provider-selected model
 *                  ... (free-form profile label, never conflated with runtime)
 *   RoleProfile  = { sessionPolicy, permissionProfile } (lane-local policy)
 *
 * Per project lane: identity, root, PM/Builder/QA bindings, QA fallback
 * binding, optional per-lane concurrency overrides (global defaults apply).
 *
 * Pane numbers are NEVER stored here (validator rejects %N). Live
 * pane_id+pid+cwd+health are resolved at runtime by probe.ts and bound
 * ephemerally in runner state only.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  defaultWorkspaceManifest,
  validateWorkspaceManifest,
  workspaceManifestPath,
  type WorkspaceManifest,
} from './manifest.js';

export const WORKSPACE_CONFIG_SCHEMA = 'workspace.v2' as const;

/** Known runtime engines (documentation + GUI options; validation only
 *  requires a non-empty label so future runtimes stay configurable). */
export const KNOWN_RUNTIMES = [
  'chatgpt',
  'codex',
  'opencode',
  'claude',
  'grok',
  'cline',
  'cursor',
  'commandcode',
] as const;

export interface RoleProfile {
  sessionPolicy: 'persistent' | 'per-task';
  permissionProfile: 'read-only' | 'write-workspace' | 'shell';
}

export interface RoleBinding {
  /** Engine/adapter label, e.g. "codex". Never a pane number. */
  runtime: string;
  /** Model/profile label, e.g. "luna". Free-form; "default" when unset. */
  model: string;
  /**
   * Optional explicit WorkerRegistry id (e.g. "builder-claude-pro").
   * When set, dispatch resolve prefers this over runtime/model scoring.
   * Omitted bindings keep legacy runtime-only resolution.
   */
  workerId?: string;
  roleProfile: RoleProfile;
}

export interface QaFallbackBinding {
  runtime: string;
  model: string;
}

export interface LaneConcurrencyOverride {
  maxBuilders?: number;
  maxQa?: number;
}

export interface LaneConfigV2 {
  id: string;
  label: string;
  root: string;
  goal: string;
  pm: RoleBinding;
  /**
   * Primary builder binding. Always required for backward compatibility with
   * runners that read `lane.builder` directly.
   */
  builder: RoleBinding;
  /**
   * P1.8C-02 — optional ordered builder list. When present and non-empty,
   * `builders[0]` MUST equal `builder` (same runtime/model/roleProfile).
   * Readers that understand multi-builder use this array; older readers keep
   * using `builder`.
   */
  builders?: RoleBinding[];
  qa: RoleBinding;
  /**
   * P1.8C-02 — optional ordered QA list. Same contract as `builders` /
   * `builder`: when present, `qas[0]` MUST equal `qa`.
   */
  qas?: RoleBinding[];
  qaFallback: QaFallbackBinding;
  /**
   * Ordered QA fallback runtimes, tried in order on QA_UNAVAILABLE
   * (429/quota/auth/provider). Defaults to [qaFallback.runtime].
   * Same Task + same Result are preserved across every hop; the Builder
   * is never re-run by fallback.
   */
  fallbackChain?: string[];
  /**
   * Founder-owned holds (HUMAN_GATE list): case-insensitive substrings
   * matched against a proposed task's goal+scope. A match parks the lane
   * (HUMAN_GATE) instead of dispatching — e.g. unapproved implementation,
   * P3 work before its gate opens, Founder-only visual/device gates.
   */
  holds?: string[];
  concurrency?: LaneConcurrencyOverride;
}

export interface WorkspaceConfigV2 {
  schemaVersion: typeof WORKSPACE_CONFIG_SCHEMA;
  concurrency: { maxActiveBuilders: number; maxActiveQa: number };
  lanes: LaneConfigV2[];
}

export function workspaceConfigPath(hostRoot: string): string {
  return path.join(path.resolve(hostRoot), '.agent-relay', 'workspace-config.json');
}

function fail(msg: string): never {
  throw new Error(`Invalid workspace config (v2): ${msg}`);
}

function noPaneNumber(value: string): boolean {
  return !/%\d+\b/.test(value);
}

function checkBinding(where: string, b: unknown): asserts b is RoleBinding {
  if (!b || typeof b !== 'object') fail(`${where} must be an object`);
  const r = b as Record<string, unknown>;
  if (typeof r.runtime !== 'string' || !r.runtime.trim()) fail(`${where}.runtime required`);
  if (!noPaneNumber(r.runtime)) fail(`${where}.runtime must not be a pane number`);
  if (typeof r.model !== 'string' || !r.model.trim()) fail(`${where}.model required`);
  if (!noPaneNumber(r.model as string)) fail(`${where}.model must not be a pane number`);
  if (r.workerId !== undefined) {
    if (typeof r.workerId !== 'string' || !r.workerId.trim()) {
      fail(`${where}.workerId must be a non-empty string when set`);
    }
    if (!noPaneNumber(r.workerId)) fail(`${where}.workerId must not be a pane number`);
  }
  const p = r.roleProfile as Record<string, unknown> | undefined;
  if (!p || (p.sessionPolicy !== 'persistent' && p.sessionPolicy !== 'per-task')) {
    fail(`${where}.roleProfile.sessionPolicy must be persistent|per-task`);
  }
  if (!p || !['read-only', 'write-workspace', 'shell'].includes(p.permissionProfile as string)) {
    fail(`${where}.roleProfile.permissionProfile must be read-only|write-workspace|shell`);
  }
}

export function validateWorkspaceConfigV2(raw: unknown): asserts raw is WorkspaceConfigV2 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('must be an object');
  const m = raw as Record<string, unknown>;
  if (m.schemaVersion !== WORKSPACE_CONFIG_SCHEMA) fail('schemaVersion must be workspace.v2');
  const c = m.concurrency as Record<string, unknown> | undefined;
  if (!c || typeof c.maxActiveBuilders !== 'number' || c.maxActiveBuilders < 1) fail('concurrency.maxActiveBuilders must be >= 1');
  if (typeof c.maxActiveQa !== 'number' || c.maxActiveQa < 1) fail('concurrency.maxActiveQa must be >= 1');
  if (!Array.isArray(m.lanes) || m.lanes.length === 0) fail('lanes must be a non-empty array');
  const seen = new Set<string>();
  (m.lanes as unknown[]).forEach((lane, i) => {
    if (!lane || typeof lane !== 'object') fail(`lanes[${i}] must be an object`);
    const l = lane as Record<string, unknown>;
    if (typeof l.id !== 'string' || !l.id.trim()) fail(`lanes[${i}].id required`);
    if (seen.has(l.id)) fail(`lanes[${i}].id duplicate: ${l.id}`);
    seen.add(l.id);
    if (typeof l.label !== 'string' || !l.label.trim()) fail(`lanes[${i}].label required`);
    if (typeof l.root !== 'string' || !path.isAbsolute(l.root)) fail(`lanes[${i}].root must be absolute`);
    if (!noPaneNumber(l.root) || !noPaneNumber(l.label as string) || !noPaneNumber(l.id)) {
      fail(`lanes[${i}] must not hardcode tmux pane numbers`);
    }
    if (typeof l.goal !== 'string' || !l.goal.trim()) fail(`lanes[${i}].goal required`);
    checkBinding(`lanes[${i}].pm`, l.pm);
    checkBinding(`lanes[${i}].builder`, l.builder);
    checkBinding(`lanes[${i}].qa`, l.qa);
    const sameBinding = (a: RoleBinding, b: RoleBinding): boolean =>
      a.runtime === b.runtime
      && a.model === b.model
      && (a.workerId ?? undefined) === (b.workerId ?? undefined)
      && a.roleProfile.sessionPolicy === b.roleProfile.sessionPolicy
      && a.roleProfile.permissionProfile === b.roleProfile.permissionProfile;
    if (l.builders !== undefined) {
      if (!Array.isArray(l.builders) || l.builders.length === 0) {
        fail(`lanes[${i}].builders must be a non-empty RoleBinding[] when set`);
      }
      (l.builders as unknown[]).forEach((b, j) => checkBinding(`lanes[${i}].builders[${j}]`, b));
      if (!sameBinding(l.builder as RoleBinding, (l.builders as RoleBinding[])[0])) {
        fail(`lanes[${i}].builders[0] must match lanes[${i}].builder`);
      }
    }
    if (l.qas !== undefined) {
      if (!Array.isArray(l.qas) || l.qas.length === 0) {
        fail(`lanes[${i}].qas must be a non-empty RoleBinding[] when set`);
      }
      (l.qas as unknown[]).forEach((b, j) => checkBinding(`lanes[${i}].qas[${j}]`, b));
      if (!sameBinding(l.qa as RoleBinding, (l.qas as RoleBinding[])[0])) {
        fail(`lanes[${i}].qas[0] must match lanes[${i}].qa`);
      }
    }
    const fb = l.qaFallback as Record<string, unknown> | undefined;
    if (!fb || typeof fb.runtime !== 'string' || !fb.runtime.trim()) fail(`lanes[${i}].qaFallback.runtime required`);
    if (typeof fb.model !== 'string' || !fb.model.trim()) fail(`lanes[${i}].qaFallback.model required`);
    if (!noPaneNumber(fb.runtime) || !noPaneNumber(fb.model)) fail(`lanes[${i}].qaFallback must not be pane numbers`);
    const chain = l.fallbackChain as unknown;
    if (chain !== undefined) {
      if (!Array.isArray(chain) || chain.length === 0 || chain.some((r) => typeof r !== 'string' || !r.trim() || !noPaneNumber(r))) {
        fail(`lanes[${i}].fallbackChain must be a non-empty string[] without pane numbers`);
      }
    }
    const holds = (l as Record<string, unknown>).holds as unknown;
    if (holds !== undefined) {
      if (!Array.isArray(holds) || holds.some((h) => typeof h !== 'string' || !h.trim())) {
        fail(`lanes[${i}].holds must be a string[]`);
      }
    }
    const ov = l.concurrency as Record<string, unknown> | undefined;
    if (ov !== undefined) {
      if (ov.maxBuilders !== undefined && (typeof ov.maxBuilders !== 'number' || ov.maxBuilders < 1)) {
        fail(`lanes[${i}].concurrency.maxBuilders must be >= 1`);
      }
      if (ov.maxQa !== undefined && (typeof ov.maxQa !== 'number' || ov.maxQa < 1)) {
        fail(`lanes[${i}].concurrency.maxQa must be >= 1`);
      }
    }
  });
}

/** v1 combined labels that name both engine and profile. Explicit table —
 *  anything else passes through as { runtime: label, model: 'default' }. */
const COMBINED_LABELS: Record<string, { runtime: string; model: string }> = {
  'codex-luna': { runtime: 'codex', model: 'luna' },
  'claude-team': { runtime: 'claude', model: 'team' },
};

export function splitRuntimeLabel(label: string): { runtime: string; model: string } {
  const hit = COMBINED_LABELS[label.trim().toLowerCase()];
  if (hit) return { ...hit };
  return { runtime: label.trim(), model: 'default' };
}

function toBinding(label: string, roleProfile: RoleProfile): RoleBinding {
  const { runtime, model } = splitRuntimeLabel(label);
  return { runtime, model, roleProfile };
}

/** Point-in-time fixture defaults (§3 of the authorized Task). Live pane
 *  numbers are deliberately absent; health is resolved at runtime. */
export function defaultWorkspaceConfigV2(): WorkspaceConfigV2 {
  const v1: WorkspaceManifest = defaultWorkspaceManifest();
  return {
    schemaVersion: WORKSPACE_CONFIG_SCHEMA,
    concurrency: { maxActiveBuilders: v1.maxActiveBuilders, maxActiveQa: v1.maxActiveQa },
    lanes: v1.lanes.map((lane) => ({
      id: lane.id,
      label: lane.label,
      root: lane.root,
      goal: lane.goal,
      pm: toBinding(lane.roles.pm, { sessionPolicy: 'persistent', permissionProfile: 'read-only' }),
      builder: toBinding(lane.roles.builder, { sessionPolicy: 'per-task', permissionProfile: 'write-workspace' }),
      qa: toBinding(lane.roles.qa, { sessionPolicy: 'per-task', permissionProfile: 'read-only' }),
      qaFallback: lane.id === 'actl'
        ? { runtime: 'cursor', model: 'default' }
        : { runtime: v1.qaFallbackRuntime, model: 'default' },
    })),
  };
}

export function migrateV1ToV2(v1: WorkspaceManifest): WorkspaceConfigV2 {
  validateWorkspaceManifest(v1);
  const migrated: WorkspaceConfigV2 = {
    schemaVersion: WORKSPACE_CONFIG_SCHEMA,
    concurrency: { maxActiveBuilders: v1.maxActiveBuilders, maxActiveQa: v1.maxActiveQa },
    lanes: v1.lanes.map((lane) => ({
      id: lane.id,
      label: lane.label,
      root: lane.root,
      goal: lane.goal,
      pm: toBinding(lane.roles.pm, { sessionPolicy: 'persistent', permissionProfile: 'read-only' }),
      builder: toBinding(lane.roles.builder, { sessionPolicy: 'per-task', permissionProfile: 'write-workspace' }),
      qa: toBinding(lane.roles.qa, { sessionPolicy: 'per-task', permissionProfile: 'read-only' }),
      qaFallback: { runtime: v1.qaFallbackRuntime, model: 'default' },
    })),
  };
  validateWorkspaceConfigV2(migrated);
  return migrated;
}

export function readWorkspaceConfigV2(hostRoot: string): WorkspaceConfigV2 | null {
  const file = workspaceConfigPath(hostRoot);
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    validateWorkspaceConfigV2(raw);
    return raw as WorkspaceConfigV2;
  } catch {
    return null;
  }
}

export function writeWorkspaceConfigV2(hostRoot: string, config: WorkspaceConfigV2): WorkspaceConfigV2 {
  validateWorkspaceConfigV2(config);
  const file = workspaceConfigPath(hostRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return config;
}

/**
 * Load the effective config: v2 when present, otherwise migrate v1
 * (roots/goals/labels preserved) and persist the v2 result.
 */
export function loadEffectiveConfig(hostRoot: string): { config: WorkspaceConfigV2; migrated: boolean; created: boolean } {
  const v2 = readWorkspaceConfigV2(hostRoot);
  if (v2) return { config: v2, migrated: false, created: false };
  const v1raw: unknown = (() => {
    try {
      return JSON.parse(fs.readFileSync(workspaceManifestPath(hostRoot), 'utf8'));
    } catch {
      return null;
    }
  })();
  if (v1raw) {
    const migrated = migrateV1ToV2(v1raw as WorkspaceManifest);
    writeWorkspaceConfigV2(hostRoot, migrated);
    return { config: migrated, migrated: true, created: false };
  }
  const created = defaultWorkspaceConfigV2();
  writeWorkspaceConfigV2(hostRoot, created);
  return { config: created, migrated: false, created: true };
}
