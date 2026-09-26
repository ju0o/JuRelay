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

/** Text the UI shows while it still loads ('설정을 불러오는 중…' etc.). */
const LOADING_TEXT = '불러오는 중';

/**
 * Decides whether a finished capture is usable from the page text read right
 * after capturePage(). Still-loading text → error message (capture not ok);
 * otherwise ''.
 */
export function captureLoadingError(textAfterCapture: string): string {
  return textAfterCapture.includes(LOADING_TEXT)
    ? '화면이 아직 불러오는 중이라 캡처에 로딩 화면만 찍혔습니다.'
    : '';
}
