import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXPERIMENT_PRESETS, flagOverrides, parseFlagOverrides, patchFlags, patchSerialized } from '../experiments.ts';

test('parseFlagOverrides: names, types, comments and blanks', () => {
  const r = parseFlagOverrides('a=true\nb=false\nc=12\nd=hello\n\n# note\n  e = true  ');
  assert.deepEqual(r.flags, { a: true, b: false, c: 12, d: 'hello', e: true });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(parseFlagOverrides('x=1.5\ny=-2\nz=0x10\nw=Infinity').flags, { x: 1.5, y: -2, z: '0x10', w: 'Infinity' });
});

test('parseFlagOverrides: errors carry the line number', () => {
  assert.deepEqual(parseFlagOverrides('novalue').errors, [{ line: 1, reason: 'Write it as name=value.' }]);
  assert.deepEqual(parseFlagOverrides('ok=1\nbad name!=1').errors, [{ line: 2, reason: 'Flag names use letters, digits and underscores.' }]);
  assert.deepEqual(parseFlagOverrides('=1\na=x&b=true').errors.map((e) => e.line), [1, 2]);
  assert.deepEqual(parseFlagOverrides('a=x&b=true').flags, {});
});

test('parseFlagOverrides: an empty value is the empty string, as many real flags are; =, + and % in a value are refused', () => {
  assert.deepEqual(parseFlagOverrides('a=\nb = ').flags, { a: '', b: '' });
  assert.deepEqual(parseFlagOverrides('a=\nb = ').errors, []);
  assert.equal(patchSerialized('x=1', parseFlagOverrides('a=').flags), 'x=1&a=');
  const odd = parseFlagOverrides('a=b=c\nd=1+2\ne=50%');
  assert.deepEqual(odd.flags, {});
  assert.deepEqual(odd.errors, [1, 2, 3].map((line) => ({ line, reason: 'Values cannot contain &, =, + or %.' })));
});

test('parseFlagOverrides: __proto__ is an own property, not a prototype change', () => {
  const { flags } = parseFlagOverrides('__proto__=true');
  assert.equal(Object.getPrototypeOf(flags), Object.prototype);
  assert.deepEqual(Object.keys(flags), ['__proto__']);
});

test('patchSerialized: replaces, appends, and handles the empty string', () => {
  assert.equal(patchSerialized('a=true&b=1&c=x', { b: 2, d: false }), 'a=true&b=2&c=x&d=false');
  assert.equal(patchSerialized('', { a: true }), 'a=true');
  assert.equal(patchSerialized('a=1&a=2&b', { a: 3 }), 'a=3&a=3&b');
  assert.equal(patchSerialized('a=1', {}), 'a=1');
});

test('patchFlags: true only when something changed', () => {
  const f: Record<string, unknown> = { a: true, b: 1 };
  assert.equal(patchFlags(f, { a: false }), true);
  assert.deepEqual(f, { a: false, b: 1 });
  assert.equal(patchFlags({ a: false }, { a: false }), false);
  assert.equal(patchFlags({}, { n: 1 }), true);
});

test('flagOverrides: known presets, then the text, which wins', () => {
  const first = EXPERIMENT_PRESETS[0]!;
  assert.deepEqual(flagOverrides({ presets: [first.id, 'unknown'], overrides: 'x=1' }), { ...first.flags, x: 1 });
  assert.deepEqual(flagOverrides({ presets: [first.id], overrides: `${Object.keys(first.flags)[0]}=true` }), { [Object.keys(first.flags)[0]!]: true });
  assert.deepEqual(flagOverrides({ presets: [], overrides: 'x=1\nbad' }), { x: 1 });
});

test('presets: valid ids, and every flag name is in the inspected player flags', () => {
  const list = JSON.parse(readFileSync(new URL('./fixtures/yt/experiment-flags.json', import.meta.url), 'utf8')) as { player: Record<string, unknown> };
  for (const p of EXPERIMENT_PRESETS) {
    assert.match(p.id, /^[a-z0-9-]{1,40}$/);
    for (const name of Object.keys(p.flags)) assert.ok(name in list.player, `${p.id}: ${name}`);
  }
  assert.equal(new Set(EXPERIMENT_PRESETS.map((p) => p.id)).size, EXPERIMENT_PRESETS.length);
});
