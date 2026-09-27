/**
 * Asset presets + naming convention (Image Asset Harness, T5).
 *
 * Three built-in presets. Naming: kebab-case under public/assets/.
 * Cache: the kernel's deterministic assetId already dedupes identical
 * (task, run, kind, path, prompt) requests — see asset-request.ts.
 */
export interface AssetPreset {
  kind: 'hero_image' | 'og_image' | 'thumbnail';
  aspectRatio: string;
  width: number;
  height: number;
  dir: string;
}

export const ASSET_PRESETS: Record<AssetPreset['kind'], AssetPreset> = {
  hero_image: { kind: 'hero_image', aspectRatio: '16:9', width: 1600, height: 900, dir: 'public/assets' },
  og_image: { kind: 'og_image', aspectRatio: '1200:630', width: 1200, height: 630, dir: 'public/assets' },
  thumbnail: { kind: 'thumbnail', aspectRatio: '16:9', width: 640, height: 360, dir: 'public/assets' },
};

export function presetFor(kind: string): AssetPreset | null {
  const p = (ASSET_PRESETS as Record<string, AssetPreset>)[kind];
  return p ?? null;
}

export function suggestOutputPath(kind: string, slug: string): string {
  const preset = presetFor(kind);
  const dir = preset ? preset.dir : 'public/assets';
  const safe = slug
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'asset';
  return `${dir}/${safe}.png`;
}
