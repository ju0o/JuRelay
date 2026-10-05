/**
 * P1.8A — canonical Project identity (projectId + projectName).
 *
 * WHY this exists
 * ---------------
 * `project` on a Task/Goal is the *storage scope*: `dataRoot/<project>/_relay/...`.
 * The production MCP App runs with `--project ws`, so every real product Task
 * (JuIntake, JuCar, Insurance CRM, Agent Relay itself) was filed under one
 * generic bucket named after the workstation. A bucket is not an identity: the
 * Founder could not answer "which project is this, and what is running in it?".
 *
 * So identity is split in two, deliberately:
 *
 *   project      (unchanged)  storage scope / folder. Never migrated.
 *   projectId                 logical, machine-safe identity of the product.
 *   projectName               logical, human-readable display name.
 *
 * A new Task carries its own identity; the scope only decides where bytes land.
 * A historical Task has no identity, and this module refuses to invent one: it
 * is reported as LEGACY so the Founder sees that the record predates identity,
 * rather than being told `ws` is a project.
 *
 * RESOLUTION (deterministic, no hidden defaults)
 * ---------------------------------------------
 *   1. EXPLICIT          caller passed projectId / projectName → that identity.
 *   2. REGISTRY          dataRoot/_relay/projects.json declares the scope →
 *                        that identity (a deployment can rename without a code change).
 *   3. SCOPE_DEFAULT     the built-in table below maps a known generic bucket
 *                        (`ws` → agent-relay / Agent Relay). This is what removes
 *                        the "new Task is automatically ws" structure: the bucket
 *                        name is never minted as the identity.
 *   4. SCOPE_LEGACY      an ordinary, non-generic scope with no declaration. The
 *                        scope name is used as the identity and flagged legacy, so
 *                        existing single-project deployments keep working exactly
 *                        as before without a rewrite.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** How an identity was arrived at. Surfaced verbatim to the PM/dashboard. */
export type ProjectIdentitySource =
  /** Caller supplied projectId / projectName. */
  | 'EXPLICIT'
  /** dataRoot/_relay/projects.json declared this scope. */
  | 'REGISTRY'
  /** A built-in mapping for a known generic bucket (never mints the bucket name). */
  | 'SCOPE_DEFAULT'
  /** The storage scope itself, because nothing declared an identity. */
  | 'SCOPE_LEGACY'
  /** Read-time derivation for a historical record that predates identity. */
  | 'RECORD_LEGACY';

export interface ProjectIdentity {
  /** Machine-safe stable identifier, e.g. `juintake`. */
  projectId: string;
  /** Human-readable display name, e.g. `JuIntake`. */
  projectName: string;
  /** Storage scope this identity was resolved against (the folder name). */
  scope: string;
  source: ProjectIdentitySource;
  /**
   * True when nobody declared this identity and it was inherited from a storage
   * bucket — a historical record, or a scope that was never named. False for an
   * EXPLICIT / REGISTRY / SCOPE_DEFAULT identity, which is a chosen name.
   */
  legacy: boolean;
  /** True when the storage scope itself is a machine layout name, not a product. */
  genericBucket: boolean;
}

/** Shape accepted from callers and from the registry file. */
export interface ProjectIdentityInput {
  projectId?: unknown;
  projectName?: unknown;
}

interface ProjectIdentitySeed {
  projectId: string;
  projectName: string;
}

/**
 * Machine-safe identity grammar: lowercase alphanumerics separated by single
 * dashes. Chosen so an id is stable in a folder name, a JSON key, an MCP tool
 * argument and a widget DOM id without escaping.
 */
const PROJECT_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PROJECT_ID_LEN = 64;
const MAX_PROJECT_NAME_LEN = 120;

/**
 * Bucket names that describe a *machine layout*, never a product. A Task filed
 * under one of these must not inherit the bucket name as its identity.
 */
export const GENERIC_SCOPE_IDS: ReadonlySet<string> = new Set([
  'ws',
  'workspace',
  'default',
  'main',
  'misc',
  'temp',
]);

/**
 * Built-in identity for a known generic bucket. `ws` is the workstation bucket
 * Agent Relay shipped with; it means "the Agent Relay product", not "a project
 * called ws". Adding a real product means passing its projectId explicitly — the
 * table can never grow a real product by accident, because it only exists to
 * name the buckets that are not products.
 */
const SCOPE_DEFAULT_IDENTITIES: Readonly<Record<string, ProjectIdentitySeed>> = {
  ws: { projectId: 'agent-relay', projectName: 'Agent Relay' },
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Normalize any caller-supplied project id into the machine-safe grammar.
 *
 * `JuIntake` / `Ju Car` / `Insurance CRM` → `juintake` / `ju-car` /
 * `insurance-crm`. Throws on an empty input: an unnamed project is a decision
 * the PM must make, not something to guess.
 */
export function normalizeProjectId(raw: unknown, field = 'projectId'): string {
  if (!isNonEmptyString(raw)) {
    throw new Error(`${field}이(가) 필요합니다.`);
  }
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) {
    throw new Error(`${field}에 machine-safe 값이 없습니다: ${String(raw)}`);
  }
  const clipped = slug.slice(0, MAX_PROJECT_ID_LEN).replace(/-+$/g, '');
  if (!clipped) {
    throw new Error(`${field}가 너무 깁니다: ${String(raw)}`);
  }
  if (!PROJECT_ID_RE.test(clipped)) {
    throw new Error(`${field} 형식이 올바르지 않습니다: ${String(raw)} (기대: 소문자·숫자·하이픈)`);
  }
  return clipped;
}

function normalizeProjectName(raw: unknown, field = 'projectName'): string {
  if (!isNonEmptyString(raw)) {
    throw new Error(`${field}이(가) 필요합니다.`);
  }
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length > MAX_PROJECT_NAME_LEN) {
    throw new Error(`${field}가 너무 깁니다 (최대 ${MAX_PROJECT_NAME_LEN}자): ${name}`);
  }
  return name;
}

/**
 * `agent-relay` → `Agent Relay`. Only used when a caller gave an id and no name:
 * a derived name must never silently replace a real one.
 */
export function deriveProjectName(projectId: string): string {
  return projectId
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || projectId;
}

/** Goal tag that pins a container Goal to exactly one project. */
export function projectIdentityTag(projectId: string): string {
  return `project:${normalizeProjectId(projectId)}`;
}

/** True when this Goal is the technical container owned by `projectId`. */
export function isProjectContainer(goal: { tags?: string[] }, projectId: string): boolean {
  const tag = projectIdentityTag(projectId);
  return Array.isArray(goal.tags) && goal.tags.includes(tag);
}

// ── Registry ────────────────────────────────────────────────────────────────

export interface ProjectRegistry {
  /** scope bucket → declared identity for that scope. */
  scopeDefaults: Record<string, ProjectIdentitySeed>;
  /** projectId → display name (for scopes that already carry the product name). */
  names: Record<string, string>;
}

/** dataRoot/_relay/projects.json — optional, deployment-owned, never required. */
export function projectRegistryPath(dataRoot: string): string {
  return path.join(path.resolve(dataRoot), '_relay', 'projects.json');
}

function readSeed(raw: unknown): ProjectIdentitySeed | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const projectId = rec.projectId;
  if (!isNonEmptyString(projectId)) return null;
  try {
    return {
      projectId: normalizeProjectId(projectId),
      projectName: isNonEmptyString(rec.projectName)
        ? normalizeProjectName(rec.projectName)
        : deriveProjectName(normalizeProjectId(projectId)),
    };
  } catch {
    return null;
  }
}

/**
 * Load the optional project registry. A missing / malformed file yields an empty
 * registry: identity resolution must never fail because a config file is absent
 * or hand-edited into nonsense.
 */
export function loadProjectRegistry(dataRoot: string): ProjectRegistry {
  const empty: ProjectRegistry = { scopeDefaults: {}, names: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(projectRegistryPath(dataRoot), 'utf8'));
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
  const rec = parsed as Record<string, unknown>;
  const out: ProjectRegistry = { scopeDefaults: {}, names: {} };
  const defaults = rec.scopeDefaults ?? rec.defaults;
  if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
    for (const [scope, seed] of Object.entries(defaults as Record<string, unknown>)) {
      const normalized = readSeed(seed);
      if (normalized) out.scopeDefaults[String(scope).trim()] = normalized;
    }
  }
  const projects = rec.projects;
  if (projects && typeof projects === 'object' && !Array.isArray(projects)) {
    for (const [id, value] of Object.entries(projects as Record<string, unknown>)) {
      try {
        const key = normalizeProjectId(id);
        const name = typeof value === 'string'
          ? value
          : isNonEmptyString((value as Record<string, unknown> | null)?.projectName)
            ? ((value as Record<string, unknown>).projectName as string)
            : null;
        if (name) out.names[key] = normalizeProjectName(name);
      } catch {
        /* a malformed registry entry is ignored, never fatal */
      }
    }
  }
  return out;
}

// ── Resolution ──────────────────────────────────────────────────────────────

/**
 * Canonical intake-time resolution. Deterministic and side-effect free.
 *
 * `resolveProjectIdentity({ scope: 'ws' })` → agent-relay / Agent Relay.
 * `resolveProjectIdentity({ scope: 'ws', projectId: 'JuIntake' })` → juintake / JuIntake.
 */
export function resolveProjectIdentity(input: {
  scope: string;
  projectId?: unknown;
  projectName?: unknown;
  /** Registry to consult. Pass loadProjectRegistry(dataRoot) at the call site. */
  registry?: ProjectRegistry;
}): ProjectIdentity {
  const scope = isNonEmptyString(input.scope) ? input.scope.trim() : '';
  const registry = input.registry ?? { scopeDefaults: {}, names: {} };

  // 1. EXPLICIT — the caller named the project.
  if (isNonEmptyString(input.projectId) || isNonEmptyString(input.projectName)) {
    const projectId = normalizeProjectId(
      isNonEmptyString(input.projectId) ? input.projectId : input.projectName,
      'projectId',
    );
    const projectName = isNonEmptyString(input.projectName)
      ? normalizeProjectName(input.projectName)
      : (registry.names[projectId] ?? deriveProjectName(projectId));
    return {
      projectId,
      projectName,
      scope,
      source: 'EXPLICIT',
      legacy: false,
      genericBucket: GENERIC_SCOPE_IDS.has(scope.toLowerCase()),
    };
  }

  // 2. REGISTRY — the deployment declared what this scope means.
  const declared = registry.scopeDefaults[scope];
  if (declared) {
    const projectName = registry.names[declared.projectId] ?? declared.projectName;
    return {
      projectId: declared.projectId,
      projectName,
      scope,
      source: 'REGISTRY',
      legacy: false,
      genericBucket: GENERIC_SCOPE_IDS.has(scope.toLowerCase()),
    };
  }

  // 3. SCOPE_DEFAULT — a known generic bucket means the product, not the bucket.
  const builtin = SCOPE_DEFAULT_IDENTITIES[scope];
  if (builtin) {
    return {
      projectId: builtin.projectId,
      projectName: registry.names[builtin.projectId] ?? builtin.projectName,
      scope,
      source: 'SCOPE_DEFAULT',
      legacy: false,
      genericBucket: true,
    };
  }

  // 4. SCOPE_LEGACY — nothing declared an identity, so the scope names it and is
  //    flagged: single-project deployments keep their behaviour, and the flag
  //    tells the Founder this identity was inherited, not chosen.
  const projectId = normalizeProjectId(scope, 'project');
  return {
    projectId,
    projectName: registry.names[projectId] ?? deriveProjectName(projectId),
    scope,
    source: 'SCOPE_LEGACY',
    legacy: true,
    genericBucket: GENERIC_SCOPE_IDS.has(projectId),
  };
}

/**
 * Read-time derivation for a stored Task/Goal. A record that predates identity
 * has none, so it is reported as the legacy scope it was actually filed under —
 * never as a product identity, and never as an invented guess.
 */
export function describeRecordProjectIdentity(
  record: { project?: string; projectId?: string; projectName?: string },
  scope: string,
  registry?: ProjectRegistry,
): ProjectIdentity {
  if (isNonEmptyString(record.projectId)) {
    let projectId: string;
    try {
      projectId = normalizeProjectId(record.projectId);
    } catch {
      projectId = record.projectId.trim();
    }
    const projectName = isNonEmptyString(record.projectName)
      ? record.projectName.trim()
      : (registry?.names[projectId] ?? deriveProjectName(projectId));
    return {
      projectId,
      projectName,
      scope,
      source: 'EXPLICIT',
      legacy: false,
      // The record names a product, so the bucket it happens to live in is
      // irrelevant to its identity — JuCar is not a machine layout name.
      genericBucket: false,
    };
  }
  const recordScope = isNonEmptyString(record.project) ? record.project.trim() : scope;
  return {
    projectId: recordScope,
    // Verbatim bucket name, NOT title-cased into a product-looking "Ws": these
    // records belong to no declared project, and the name must not imply one.
    projectName: recordScope,
    scope,
    source: 'RECORD_LEGACY',
    legacy: true,
    genericBucket: GENERIC_SCOPE_IDS.has(recordScope.toLowerCase()),
  };
}

/** The identity a new Task/Goal would get in this scope — for tool descriptions and UI. */
export function defaultIdentityForScope(
  dataRoot: string,
  scope: string,
): ProjectIdentity {
  return resolveProjectIdentity({ scope, registry: loadProjectRegistry(dataRoot) });
}