/**
 * Headless capture mode for the automated Tester (`--capture=<png path>`).
 * Pure helper — unit-tested via dist/server/shared/capture.js.
 */
import * as path from 'path';

const CAPTURE_PREFIX = '--capture=';

/** Result sidecar written next to the PNG as `<path>.json`. */
export interface CaptureReport {
  view: string;
  ok: boolean;
  title: string;
  text: string;
  error: string;
}

/**
 * Returns the PNG path for `--capture=<path>`, or '' when the flag is missing
 * or invalid (must be absolute, end with .png). Invalid values are ignored so
 * the app starts normally. The last `--capture=` argument wins.
 */
export function parseCapturePath(argv: readonly string[]): string {
  let raw = '';
  for (const a of argv) if (a.startsWith(CAPTURE_PREFIX)) raw = a.slice(CAPTURE_PREFIX.length);
  return !raw.includes('\0') && path.isAbsolute(raw) && /\.png$/i.test(raw) ? raw : '';
}
