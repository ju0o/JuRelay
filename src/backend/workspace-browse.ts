/**
 * P2-OWNER-R00 — bounded ASUS directory browser for ChatGPT Widget.
 *
 * Read-only. Directories only. One level per call. Allowlisted roots only.
 * No file contents, no home/disk scan, no symlink escape outside roots.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export type WorkspaceBrowseErrorCode =
  | 'NOT_FOUND'
  | 'NOT_DIRECTORY'
  | 'OUTSIDE_ALLOWLIST'
  | 'TOO_MANY_ENTRIES'
  | 'INVALID_ARGUMENT';

export class WorkspaceBrowseError extends Error {
  readonly code: WorkspaceBrowseErrorCode;
  constructor(code: WorkspaceBrowseErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceBrowseError';
    this.code = code;
  }
}

export interface BrowseRootInfo {
  rootId: string;
  label: string;
  path: string;
  exists: boolean;
}

export interface BrowseEntry {
  name: string;
  path: string;
  isDirectory: true;
  /** True when this folder already has .agent-relay/workspace-config.json. */
  hasWorkspaceConfig: boolean;
}

export interface BrowseDirectoriesResult {
  rootId: string | null;
  path: string;
  parentPath: string | null;
  entries: BrowseEntry[];
  truncated: boolean;
  allowlistRoots: string[];
}

/** Default Founder-approved browse roots (existence checked at runtime). */
export const DEFAULT_WORKSPACE_BROWSE_ROOTS: ReadonlyArray<{ rootId: string; label: string; path: string }> = [
  {
    rootId: 'core',
    label: 'Core',
    path: path.join(os.homedir(), 'Desktop', 'Projects', 'Core'),
  },
  {
    rootId: 'team',
    label: 'Team',
    path: path.join(os.homedir(), 'Desktop', 'Projects', 'Team'),
  },
];

const MAX_ENTRIES = 200;

function fail(code: WorkspaceBrowseErrorCode, message: string): never {
  throw new WorkspaceBrowseError(code, message);
}

/** Resolve realpath; returns null when missing. */
export function tryRealpath(abs: string): string | null {
  try {
    return fs.realpathSync(path.resolve(abs));
  } catch {
    return null;
  }
}

export function listBrowseRoots(
  roots: ReadonlyArray<{ rootId: string; label: string; path: string }> = DEFAULT_WORKSPACE_BROWSE_ROOTS,
): BrowseRootInfo[] {
  return roots.map((r) => {
    const resolved = tryRealpath(r.path);
    return {
      rootId: r.rootId,
      label: r.label,
      path: resolved || path.resolve(r.path),
      exists: !!resolved && fs.statSync(resolved).isDirectory(),
    };
  });
}

/** Active allowlist = existing roots only (realpath). */
export function activeAllowlistPaths(
  roots: ReadonlyArray<{ rootId: string; label: string; path: string }> = DEFAULT_WORKSPACE_BROWSE_ROOTS,
): string[] {
  return listBrowseRoots(roots)
    .filter((r) => r.exists)
    .map((r) => r.path);
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const c = candidate.endsWith(path.sep) ? candidate : candidate + path.sep;
  const r = root.endsWith(path.sep) ? root : root + path.sep;
  return candidate === root || c.startsWith(r);
}

/**
 * Ensure absolute path exists, is a directory, and lies under an allowlisted root
 * after realpath (blocks symlink escape / .. traversal).
 */
export function resolveAndValidatePath(
  inputPath: string,
  roots: ReadonlyArray<{ rootId: string; label: string; path: string }> = DEFAULT_WORKSPACE_BROWSE_ROOTS,
): { absolutePath: string; rootId: string | null; allowlistRoots: string[] } {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    fail('INVALID_ARGUMENT', '경로가 비어 있습니다.');
  }
  const raw = inputPath.trim();
  if (!path.isAbsolute(raw)) {
    fail('INVALID_ARGUMENT', `절대 경로만 사용할 수 있습니다: ${raw}`);
  }
  if (raw.includes('\0')) {
    fail('INVALID_ARGUMENT', '경로에 널 문자가 있습니다.');
  }
  const allowlist = activeAllowlistPaths(roots);
  if (!allowlist.length) {
    fail('OUTSIDE_ALLOWLIST', '허용된 탐색 루트가 없습니다. Core/Team 폴더 존재를 확인하세요.');
  }

  // Reject obvious traversal tokens before realpath.
  const parts = raw.split(path.sep);
  if (parts.some((p) => p === '..')) {
    fail('OUTSIDE_ALLOWLIST', `경로 우회(.. )는 허용되지 않습니다: ${raw}`);
  }

  const real = tryRealpath(raw);
  if (!real) {
    fail('NOT_FOUND', `경로가 존재하지 않습니다: ${raw}`);
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(real);
  } catch {
    fail('NOT_FOUND', `경로를 읽을 수 없습니다: ${raw}`);
  }
  if (!st.isDirectory()) {
    fail('NOT_DIRECTORY', `디렉터리가 아닙니다: ${real}`);
  }

  const matching = allowlist.find((root) => isPathInsideRoot(real, root));
  if (!matching) {
    fail('OUTSIDE_ALLOWLIST', `허용된 탐색 영역 밖입니다: ${real}`);
  }
  const rootInfo = listBrowseRoots(roots).find((r) => r.exists && r.path === matching);
  return {
    absolutePath: real,
    rootId: rootInfo?.rootId ?? null,
    allowlistRoots: allowlist,
  };
}

export function browseDirectories(input: {
  absolutePath?: string;
  rootId?: string;
  relativeSegments?: string[];
  roots?: ReadonlyArray<{ rootId: string; label: string; path: string }>;
}): BrowseDirectoriesResult {
  const roots = input.roots ?? DEFAULT_WORKSPACE_BROWSE_ROOTS;
  const allowlist = activeAllowlistPaths(roots);
  let target: string;

  if (typeof input.absolutePath === 'string' && input.absolutePath.trim()) {
    target = resolveAndValidatePath(input.absolutePath, roots).absolutePath;
  } else if (typeof input.rootId === 'string' && input.rootId.trim()) {
    const root = listBrowseRoots(roots).find((r) => r.rootId === input.rootId);
    if (!root || !root.exists) {
      fail('NOT_FOUND', `탐색 루트를 찾을 수 없습니다: ${input.rootId}`);
    }
    const segs = Array.isArray(input.relativeSegments) ? input.relativeSegments : [];
    for (const seg of segs) {
      if (typeof seg !== 'string' || !seg || seg === '.' || seg === '..' || seg.includes('/') || seg.includes('\\') || seg.includes('\0')) {
        fail('INVALID_ARGUMENT', `잘못된 상대 경로 조각: ${String(seg)}`);
      }
    }
    const joined = segs.length ? path.join(root.path, ...segs) : root.path;
    target = resolveAndValidatePath(joined, roots).absolutePath;
  } else {
    fail('INVALID_ARGUMENT', 'absolutePath 또는 rootId가 필요합니다.');
  }

  const validated = resolveAndValidatePath(target, roots);
  let names: string[];
  try {
    names = fs.readdirSync(validated.absolutePath);
  } catch (err) {
    fail('NOT_FOUND', `디렉터리를 읽을 수 없습니다: ${validated.absolutePath} (${err instanceof Error ? err.message : err})`);
  }

  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const entries: BrowseEntry[] = [];
  let truncated = false;
  for (const name of names) {
    if (name === '.' || name === '..') continue;
    // Skip hidden except .agent-relay detection on children via hasWorkspaceConfig.
    if (name.startsWith('.')) continue;
    const child = path.join(validated.absolutePath, name);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(child);
    } catch {
      continue;
    }
    // Do not follow symlink-as-file; only include directories (follow realpath for dirs).
    if (st.isSymbolicLink()) {
      const realChild = tryRealpath(child);
      if (!realChild) continue;
      if (!allowlist.some((root) => isPathInsideRoot(realChild, root))) continue;
      try {
        if (!fs.statSync(realChild).isDirectory()) continue;
      } catch {
        continue;
      }
      if (entries.length >= MAX_ENTRIES) {
        truncated = true;
        break;
      }
      entries.push({
        name,
        path: realChild,
        isDirectory: true,
        hasWorkspaceConfig: fs.existsSync(path.join(realChild, '.agent-relay', 'workspace-config.json')),
      });
      continue;
    }
    if (!st.isDirectory()) continue;
    const realChild = tryRealpath(child) || child;
    if (!allowlist.some((root) => isPathInsideRoot(realChild, root))) continue;
    if (entries.length >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
    entries.push({
      name,
      path: realChild,
      isDirectory: true,
      hasWorkspaceConfig: fs.existsSync(path.join(realChild, '.agent-relay', 'workspace-config.json')),
    });
  }

  if (truncated) {
    // Still return partial list but mark truncated (caller may treat as soft).
  }

  // Parent: null when at an allowlist root.
  let parentPath: string | null = null;
  const parent = path.dirname(validated.absolutePath);
  if (parent !== validated.absolutePath) {
    const parentReal = tryRealpath(parent);
    if (parentReal && allowlist.some((root) => isPathInsideRoot(parentReal, root))) {
      parentPath = parentReal;
    }
  }

  return {
    rootId: validated.rootId,
    path: validated.absolutePath,
    parentPath,
    entries,
    truncated,
    allowlistRoots: allowlist,
  };
}
