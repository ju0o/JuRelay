/**
 * P1.8C-01 — minimal PM UI state under dataRoot.
 *
 * The only durable selection store for C01. It holds `selectedProjectId` and
 * never Goal/Task/role/worker/identity data. ProjectIdentity, RoleConfig, and
 * WorkspaceConfigV2 remain the sources of truth for everything else.
 *
 * Path: `<dataRoot>/_relay/ui-state.json`
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeJsonAtomic } from './goal-task.js';
import { normalizeProjectId } from './project-identity.js';

export const UI_STATE_SCHEMA_VERSION = 1 as const;

export interface UiStateV1 {
  schemaVersion: typeof UI_STATE_SCHEMA_VERSION;
  /** Canonical projectId the PM is currently looking at, or null when unset. */
  selectedProjectId: string | null;
  updatedAt: string;
}

export function uiStatePath(dataRoot: string): string {
  return path.join(path.resolve(dataRoot), '_relay', 'ui-state.json');
}

function emptyUiState(now = new Date().toISOString()): UiStateV1 {
  return {
    schemaVersion: UI_STATE_SCHEMA_VERSION,
    selectedProjectId: null,
    updatedAt: now,
  };
}

/**
 * Load UI state. Missing / malformed / wrong-version files yield an empty state
 * so a hand-edited file can never break dashboard reads.
 */
export function loadUiState(dataRoot: string): UiStateV1 {
  const empty = emptyUiState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(uiStatePath(dataRoot), 'utf8'));
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
  const rec = parsed as Record<string, unknown>;
  if (rec.schemaVersion !== UI_STATE_SCHEMA_VERSION) return empty;
  let selectedProjectId: string | null = null;
  if (typeof rec.selectedProjectId === 'string' && rec.selectedProjectId.trim()) {
    try {
      selectedProjectId = normalizeProjectId(rec.selectedProjectId);
    } catch {
      selectedProjectId = null;
    }
  } else if (rec.selectedProjectId === null) {
    selectedProjectId = null;
  }
  const updatedAt =
    typeof rec.updatedAt === 'string' && rec.updatedAt.trim()
      ? rec.updatedAt.trim()
      : empty.updatedAt;
  return { schemaVersion: UI_STATE_SCHEMA_VERSION, selectedProjectId, updatedAt };
}

/** Persist only selection. Atomic write. Does not touch Goals/Tasks/roles/workers. */
export function saveSelectedProjectId(
  dataRoot: string,
  selectedProjectId: string | null,
): UiStateV1 {
  const next: UiStateV1 = {
    schemaVersion: UI_STATE_SCHEMA_VERSION,
    selectedProjectId:
      selectedProjectId === null || selectedProjectId === ''
        ? null
        : normalizeProjectId(selectedProjectId),
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(uiStatePath(dataRoot), next);
  return next;
}
