/**
 * Asset generation backend interface (Image Asset Harness, T3).
 *
 * Provider-agnostic: backends implement `generateAsset`, Relay selects by id.
 * The default/only built-in backend is the deterministic stub (`asset-stub`),
 * used by tests and until a real provider (T7) is approved. No chat-mcp,
 * no model calls, no network — the stub writes a placeholder file so the
 * full REQUESTED→DELIVERED→QA loop is exercisable end to end.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AssetRecord } from './asset-request.js';

export interface AssetGenerateInput {
  record: AssetRecord;
  /** Absolute workspace root; outputPath resolves under it. */
  workspaceRoot: string;
}

export interface AssetGenerateResult {
  /** Absolute written path. */
  path: string;
  width?: number;
  height?: number;
  source: string;
}

export interface AssetBackend {
  readonly id: string;
  generate(input: AssetGenerateInput): Promise<AssetGenerateResult>;
}

const backends = new Map<string, AssetBackend>();

export function registerAssetBackend(backend: AssetBackend): void {
  if (backends.has(backend.id)) {
    throw new Error(`asset backend already registered: ${backend.id}`);
  }
  backends.set(backend.id, backend);
}

export function getAssetBackend(id: string): AssetBackend | null {
  return backends.get(id) ?? null;
}

export function listAssetBackends(): string[] {
  return [...backends.keys()];
}

/** Test-only reset. */
export function clearAssetBackends(): void {
  backends.clear();
}
