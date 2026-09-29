import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, '..', 'src', 'frontend', 'style.css'), 'utf8');

describe('style guard — topbar/scrollbar polish', () => {
  it('declares dark color-scheme', () => {
    assert.ok(css.includes('color-scheme: dark'), 'missing "color-scheme: dark"');
  });

  it('has a dark ::-webkit-scrollbar-thumb rule', () => {
    assert.match(css, /\.app\[data-theme="?dark"?\][^\{]*::-webkit-scrollbar-thumb/);
  });

  it('keeps Korean words intact (keep-all)', () => {
    assert.ok(css.includes('keep-all'), 'missing "keep-all"');
  });

  it('hides .topbar-shortcuts under max-width:1200px', () => {
    const re = /@media\s*\(\s*max-width\s*:\s*1200px\s*\)[\s\S]*?\.topbar-shortcuts/;
    assert.match(css, re, 'missing .topbar-shortcuts media rule');
  });

  it('project tabs and field labels are large enough to read and tap', () => {
    assert.match(css, /\.proj-tab \{[\s\S]*?font-size: 16px;[\s\S]*?min-height: 44px;/);
    assert.match(css, /\.proj-tab-add \{[\s\S]*?min-height: 44px;/);
    assert.match(css, /\.field \.flabel \{ font-size: 16px;/);
    assert.doesNotMatch(css, /\.field \.flabel \{[^}]*uppercase/);
  });

  it('keeps body and secondary text at 14px or larger', () => {
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    assert.ok(sizes.length > 0, 'expected font-size rules');
    assert.ok(sizes.every((n) => n >= 14), `font-size below 14px: ${sizes.filter((n) => n < 14).join(',')}`);
  });
});
