/**
 * Asset file verification for QA (Image Asset Harness, T4).
 *
 * Pure checks a QA evaluator can run read-only:
 * - file exists under the workspace (no traversal)
 * - non-empty
 * - magic bytes match the extension (.png → PNG signature)
 * - optional minimum dimensions (PNG IHDR parsed locally, no deps)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AssetCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface AssetVerifyOptions {
  minWidth?: number;
  minHeight?: number;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngSize(abs: string): { width: number; height: number } | null {
  try {
    const fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(33);
    const n = fs.readSync(fd, buf, 0, 33, 0);
    fs.closeSync(fd);
    if (n < 33) return null;
    if (!buf.subarray(0, 8).equals(PNG_MAGIC)) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

export function verifyAssetFile(
  workspaceRoot: string,
  outputPath: string,
  opts: AssetVerifyOptions = {},
): AssetCheck[] {
  const checks: AssetCheck[] = [];
  if (path.isAbsolute(outputPath)) {
    return [{ name: 'path-inside-workspace', ok: false, detail: 'absolute path refused' }];
  }
  const abs = path.resolve(workspaceRoot, outputPath);
  const rootWithSep = workspaceRoot.endsWith(path.sep) ? workspaceRoot : workspaceRoot + path.sep;
  if (abs !== workspaceRoot && !abs.startsWith(rootWithSep)) {
    return [{ name: 'path-inside-workspace', ok: false, detail: 'traversal refused' }];
  }
  checks.push({ name: 'path-inside-workspace', ok: true });
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return [...checks, { name: 'exists', ok: false, detail: 'missing file' }];
  }
  checks.push({ name: 'exists', ok: true });
  checks.push(stat.size > 0
    ? { name: 'non-empty', ok: true, detail: `${stat.size} bytes` }
    : { name: 'non-empty', ok: false, detail: '0 bytes' });
  if (path.extname(abs).toLowerCase() === '.png') {
    const size = readPngSize(abs);
    checks.push(size
      ? { name: 'png-valid', ok: true, detail: `${size.width}x${size.height}` }
      : { name: 'png-valid', ok: false, detail: 'bad magic or truncated' });
    if (size && opts.minWidth !== undefined) {
      checks.push(size.width >= opts.minWidth
        ? { name: 'min-width', ok: true }
        : { name: 'min-width', ok: false, detail: `${size.width} < ${opts.minWidth}` });
    }
    if (size && opts.minHeight !== undefined) {
      checks.push(size.height >= opts.minHeight
        ? { name: 'min-height', ok: true }
        : { name: 'min-height', ok: false, detail: `${size.height} < ${opts.minHeight}` });
    }
  }
  return checks;
}

export function allAssetChecksPass(checks: AssetCheck[]): boolean {
  return checks.length > 0 && checks.every((c) => c.ok);
}
