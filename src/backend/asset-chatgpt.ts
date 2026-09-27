/**
 * ChatGPT image backend for the Image Asset Harness (T7).
 *
 * No API keys, no chat-mcp dependency. Flow:
 *   1. Worker files ASSET_REQUEST (routed to backend id 'chatgpt').
 *   2. ChatGPT sees it (widget/delivery), generates the image natively,
 *      and calls relay_pm_deliver_asset with { assetId, imageUrl }.
 *   3. Relay itself downloads the bytes, validates, and writes the file.
 *
 * The generate() entry fails closed: pixels only enter through relay_pm_deliver_asset.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AssetBackend } from './asset-backend.js';

export const CHATGPT_BACKEND_ID = 'chatgpt';

/** Hosts images may be fetched from (ChatGPT delivery URLs). */
export const CHATGPT_IMAGE_HOSTS = [
  'oaistatic.com',
  'oaiusercontent.com',
] as const;

/** Operator/test escape hatch: extra allowed hosts (comma-separated, env only). */
function extraAllowedHosts(): string[] {
  return (process.env['AGENT_RELAY_ASSET_HOSTS'] || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

function hostAllowed(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const all = [...(CHATGPT_IMAGE_HOSTS as readonly string[]), ...extraAllowedHosts()];
  return all.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function detectImageKind(bytes: Buffer, outputPath: string): 'png' | 'jpg' {
  const ext = path.extname(outputPath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    if (!bytes.subarray(0, 3).equals(JPG_MAGIC)) {
      throw new Error('bytes are not a JPEG image.');
    }
    return 'jpg';
  }
  if (!bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error('bytes are not a PNG image.');
  }
  return 'png';
}

export async function fetchImageToWorkspace(
  imageUrl: string,
  workspaceRoot: string,
  outputPath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ abs: string; bytes: number }> {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error('imageUrl이 올바르지 않습니다.');
  }
  if (url.protocol !== 'https:') {
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
    if (!loopback) throw new Error('imageUrl은 https만 허용됩니다.');
  }
  if (!hostAllowed(url)) throw new Error(`허용되지 않은 이미지 호스트: ${url.hostname}`);
  if (path.isAbsolute(outputPath)) throw new Error('output_path는 workspace 상대경로여야 합니다.');
  const abs = path.resolve(workspaceRoot, outputPath);
  const rootWithSep = workspaceRoot.endsWith(path.sep) ? workspaceRoot : workspaceRoot + path.sep;
  if (abs !== workspaceRoot && !abs.startsWith(rootWithSep)) {
    throw new Error('output_path가 workspace를 벗어납니다.');
  }
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`이미지 다운로드 실패: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error('빈 이미지입니다.');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('이미지가 10MB를 초과합니다.');
  detectImageKind(buf, outputPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return { abs, bytes: buf.length };
}

export const chatGptBackend: AssetBackend = {
  id: CHATGPT_BACKEND_ID,
  async generate() {
    throw new Error(
      'chatgpt backend generates externally: ChatGPT delivers pixels via relay_pm_deliver_asset.',
    );
  },
};
