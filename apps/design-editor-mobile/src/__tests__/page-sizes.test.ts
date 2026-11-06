import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { PAGE_SIZES, blankDesign } from '../editor/pageSizes.ts';

test('the New design sizes are the editor page\'s Resize presets', () => {
  const app = readFileSync(new URL('../../../../packages/design-editor-engine/app.js', import.meta.url), 'utf8');
  const body = /const PRESETS = \[([\s\S]*?)\n\];/.exec(app)?.[1] ?? '';
  const presets = [...body.matchAll(/\['([^']+)', (\d+), (\d+)\]/g)].map(m => [m[1], Number(m[2]), Number(m[3])]);
  assert.deepEqual(PAGE_SIZES.map(s => [...s]), presets);
});

test('a blank design is what the page restores: a size and one empty white page', () => {
  const d = JSON.parse(blankDesign(1080, 1920));
  assert.deepEqual([d.W, d.H, d.pages.length, d.pages[0].objects.length], [1080, 1920, 1, 0]);
});
