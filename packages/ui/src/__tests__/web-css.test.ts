import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCss, cssPath } from '../../scripts/build-css.ts';

test('web/tokens.css is up to date with tokens.ts (run `pnpm --filter @apps-hub/ui build:css`)', () => {
  assert.equal(fs.readFileSync(cssPath, 'utf8'), buildCss());
});

test('every brand gets light, system-dark and forced-dark blocks', () => {
  const css = buildCss();
  for (const b of ['netlens', 'opentunnel', 'store', 'pdf', 'design']) {
    assert.ok(css.includes(`[data-brand='${b}'][data-theme='dark']`), b);
    assert.ok(css.includes(`[data-brand='${b}']:not([data-theme='light'])`), b);
  }
});
