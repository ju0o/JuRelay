/**
 * Deterministic stub asset backend (Image Asset Harness, T3).
 *
 * Writes a placeholder file at the requested output_path (under workspaceRoot)
 * plus a JSON sidecar recording the request hash, so QA and idempotency can
 * be exercised without any model, network, or credentials.
 * Backend id: 'asset-stub'. source: 'asset-stub'.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { AssetBackend, AssetGenerateInput } from './asset-backend.js';

// 1x1 transparent PNG (deterministic bytes).
const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export function stubPayloadFor(prompt: string): { bytes: Buffer; width: number; height: number } {
  void prompt;
  return { bytes: STUB_PNG, width: 1, height: 1 };
}

export const stubBackend: AssetBackend = {
  id: 'asset-stub',
  async generate({ record, workspaceRoot }: AssetGenerateInput) {
    const rel = record.outputPath;
    const abs = path.resolve(workspaceRoot, rel);
    const rootWithSep = workspaceRoot.endsWith(path.sep) ? workspaceRoot : workspaceRoot + path.sep;
    if (abs !== workspaceRoot && !abs.startsWith(rootWithSep)) {
      throw new Error('stub backend refuses output outside workspace.');
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const { bytes, width, height } = stubPayloadFor(record.prompt);
    const ext = path.extname(abs).toLowerCase();
    if (ext === '.png' || ext === '') {
      fs.writeFileSync(abs, bytes);
    } else {
      // Non-PNG kinds still get a deterministic marker file (QA checks magic per extension).
      fs.writeFileSync(abs, bytes);
    }
    const sidecar = {
      assetId: record.assetId,
      promptSha: createHash('sha256').update(record.prompt, 'utf8').digest('hex').slice(0, 16),
      kind: record.assetKind,
      stub: true,
    };
    fs.writeFileSync(abs + '.asset.json', JSON.stringify(sidecar, null, 2) + '\n', 'utf8');
    return { path: abs, width, height, source: 'asset-stub' };
  },
};
