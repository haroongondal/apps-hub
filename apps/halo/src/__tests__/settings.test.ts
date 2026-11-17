import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, normalize } from '../settings.ts';

const cases: { name: string; input: unknown; expected: unknown }[] = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../modules/halo-engine/fixtures/settings.cases.json'), 'utf8'),
);

for (const c of cases) {
  test(`settings: ${c.name}`, () => {
    assert.deepEqual(normalize(c.input), c.expected);
  });
}

test('settings: fixture has at least 60 cases', () => assert.ok(cases.length >= 60));

test('settings: non-object input gives the defaults without throwing', () => {
  for (const x of [null, undefined, 5, 'x', [], true]) assert.deepEqual(normalize(x), DEFAULT_SETTINGS);
});

test('settings: normalize is idempotent and does not alias the defaults', () => {
  const s = normalize({});
  assert.deepEqual(normalize(s), s);
  s.colors.palette.push('#000000');
  assert.equal(DEFAULT_SETTINGS.colors.palette.length, 2);
  s.themes[0].faceOptions.seconds = true;
  s.themes.pop();
  assert.equal(DEFAULT_SETTINGS.themes.length, 4);
  assert.equal(DEFAULT_SETTINGS.themes[0].faceOptions.seconds, false);
});

test('settings: NaN and Infinity fall back to the defaults instead of clamping or passing through', () => {
  const s = normalize({ params: { thickness: NaN, speed: Infinity, glow: -Infinity }, themes: [{ id: 'x', dim: NaN, brightness: Infinity }] });
  assert.equal(s.params.thickness, DEFAULT_SETTINGS.params.thickness);
  assert.equal(s.params.speed, DEFAULT_SETTINGS.params.speed);
  assert.equal(s.params.glow, DEFAULT_SETTINGS.params.glow);
  assert.equal(s.themes[0].dim, 0.5);
  assert.equal(s.themes[0].brightness, 0.02);
});
