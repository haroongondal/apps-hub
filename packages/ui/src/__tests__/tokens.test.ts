import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brands, hsl, palette, type BrandKey, type Scheme } from '../tokens.ts';

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('hsl converts known colours', () => {
  assert.equal(hsl(0, 100, 50), '#FF0000');
  assert.equal(hsl(120, 100, 25), '#008000');
  assert.equal(hsl(0, 0, 100), '#FFFFFF');
});

for (const brand of Object.keys(brands) as BrandKey[]) {
  for (const scheme of ['light', 'dark'] as Scheme[]) {
    test(`${brand}/${scheme} meets WCAG AA`, () => {
      const p = palette(brand, scheme);
      for (const bg of [p.bg, p.surface]) {
        assert.ok(contrast(p.text, bg) >= 7, `text on ${bg}`);
        assert.ok(contrast(p.muted, bg) >= 4.5, `muted ${p.muted} on ${bg}: ${contrast(p.muted, bg).toFixed(2)}`);
        for (const k of ['accent', 'ok', 'warn', 'danger'] as const) assert.ok(contrast(p[k], bg) >= 4.5, `${k} ${p[k]} on ${bg}: ${contrast(p[k], bg).toFixed(2)}`);
      }
      assert.ok(contrast(p.onAccent, p.accent) >= 4.5, 'onAccent on accent');
    });
  }
}
