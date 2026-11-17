import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// AGENTS.md: no hand-rolled colours in an app. A colour value in a declaration must come from a --c-* token.
test('the download pages take every colour from the --c-* tokens', () => {
  const dir = new URL('../dl/', import.meta.url);
  const sheets = readdirSync(dir).filter((f) => f.endsWith('.css'));
  assert.ok(sheets.length > 0);
  for (const f of sheets) {
    const css = readFileSync(new URL(f, dir), 'utf8');
    assert.deepEqual(css.match(/:[^;{}]*(?:#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\()/gi), null, f);
  }
});
