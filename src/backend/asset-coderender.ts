/**
 * Code-render asset backend (Image Asset Harness, T8).
 *
 * Agent-Relay generates structural images ITSELF — no external model:
 * worker-supplied inline SVG → headless Chrome screenshot → PNG file.
 * Covers diagram / og_image / thumbnail / icon (not AI-art photography).
 *
 * Backend id: 'code-render'. Deterministic, free, fully testable.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AssetBackend } from './asset-backend.js';
import { presetFor } from './asset-presets.js';

export const CODE_RENDER_BACKEND_ID = 'code-render';
export const RENDER_TIMEOUT_MS = 60_000;

function chromeBinary(): string {
  const override = (process.env['CHROME_BIN'] || '').trim();
  if (override) return override;
  for (const candidate of [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error('headless Chrome/Chromium not found (set CHROME_BIN).');
}

function wrapSvg(svg: string, width: number, height: number): string {
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    `<style>html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden}svg{display:block}</style>`,
    '</head><body>', svg, '</body></html>',
  ].join('');
}

export function renderSvgToPng(
  svg: string,
  outAbs: string,
  width: number,
  height: number,
  timeoutMs = RENDER_TIMEOUT_MS,
): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-render-'));
  try {
    const html = path.join(dir, 'in.html');
    fs.writeFileSync(html, wrapSvg(svg, width, height), 'utf8');
    const res = spawnSync(
      chromeBinary(),
      [
        '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        `--window-size=${width},${height}`,
        `--screenshot=${outAbs}`,
        html,
      ],
      { timeout: timeoutMs, stdio: 'pipe' },
    );
    if (res.status !== 0 || !fs.existsSync(outAbs)) {
      throw new Error(`chrome screenshot failed: ${res.stderr?.toString().slice(0, 300) || `exit ${res.status}`}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const codeRenderBackend: AssetBackend = {
  id: CODE_RENDER_BACKEND_ID,
  async generate({ record, workspaceRoot }) {
    if (!record.svg) {
      throw new Error('code-render backend needs inline svg on the request.');
    }
    const rel = record.outputPath;
    const abs = path.resolve(workspaceRoot, rel);
    const rootWithSep = workspaceRoot.endsWith(path.sep) ? workspaceRoot : workspaceRoot + path.sep;
    if (abs !== workspaceRoot && !abs.startsWith(rootWithSep)) {
      throw new Error('output_path가 workspace를 벗어납니다.');
    }
    const preset = presetFor(record.assetKind);
    const width = preset ? preset.width : 1200;
    const height = preset ? preset.height : 630;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    renderSvgToPng(record.svg, abs, width, height);
    return { path: abs, width, height, source: CODE_RENDER_BACKEND_ID };
  },
};
