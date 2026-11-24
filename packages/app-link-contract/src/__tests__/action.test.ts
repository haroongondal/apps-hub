import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  MAX_ARRAY_ITEMS, MAX_ARRAY_ITEM_CHARS, MAX_EXTRAS, MAX_RESULT_MESSAGE_CHARS, MAX_STRING_CHARS, MAX_TOTAL_CHARS,
  RESULT_KEYS, defineAction, validateExtras, validateResult,
} from '../index.ts';

const act = defineAction({
  app: 'deputy',
  name: 'RUN_TASK',
  screen: true,
  description: 'Test action',
  extras: {
    task: { type: 'string', required: true },
    count: { type: 'long' },
    dry: { type: 'boolean' },
    tags: { type: 'stringArray' },
    short: { type: 'string', max: 5 },
  },
});

test('limits equal fixtures/limits.json', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('../../fixtures/limits.json', import.meta.url), 'utf8'));
  assert.deepEqual(fixture, { MAX_EXTRAS, MAX_STRING_CHARS, MAX_ARRAY_ITEMS, MAX_ARRAY_ITEM_CHARS, MAX_TOTAL_CHARS, MAX_RESULT_MESSAGE_CHARS });
});

test('defineAction names and freezes', () => {
  assert.equal(act.name, 'com.haroon.deputy.action.RUN_TASK');
  assert.equal(act.screen, true);
  assert.ok(Object.isFrozen(act) && Object.isFrozen(act.extras));
});

test('screen must be the literal true', () => {
  // @ts-expect-error screen false is not allowed
  defineAction({ app: 'deputy', name: 'X', screen: false, description: 'd', extras: {} });
  // @ts-expect-error screen is required
  defineAction({ app: 'deputy', name: 'X', description: 'd', extras: {} });
});

test('defineAction refuses bad names, keys, types and limits', () => {
  const ok = { app: 'deputy', name: 'X', screen: true as const, description: 'd' };
  assert.throws(() => defineAction({ ...ok, app: 'Deputy', extras: {} }));
  assert.throws(() => defineAction({ ...ok, name: 'x', extras: {} }));
  for (const key of ['Task', '1a', 'a_b', 'a-b', '']) assert.throws(() => defineAction({ ...ok, extras: { [key]: { type: 'string' } } }), /extra key/, key);
  const nine = Object.fromEntries(Array.from({ length: MAX_EXTRAS + 1 }, (_, i) => [`k${i}`, { type: 'long' as const }]));
  assert.throws(() => defineAction({ ...ok, extras: nine }), /at most/);
  assert.doesNotThrow(() => defineAction({ ...ok, extras: Object.fromEntries(Object.entries(nine).slice(0, MAX_EXTRAS)) }));
  // a per-extra max may only be lower than the global limit
  assert.doesNotThrow(() => defineAction({ ...ok, extras: { a: { type: 'string', max: MAX_STRING_CHARS } } }));
  assert.throws(() => defineAction({ ...ok, extras: { a: { type: 'string', max: MAX_STRING_CHARS + 1 } } }), /max/);
  assert.throws(() => defineAction({ ...ok, extras: { a: { type: 'stringArray', max: MAX_ARRAY_ITEMS + 1 } } }), /max/);
  assert.throws(() => defineAction({ ...ok, extras: { a: { type: 'long', max: 5 } } }), /max/);
  assert.throws(() => defineAction({ ...ok, extras: { a: { type: 'string', max: 0 } } }), /max/);
  assert.throws(() => defineAction({ ...ok, extras: { a: { type: 'blob' as 'string' } } }), /type/);
});

test('validateExtras returns typed extras', () => {
  const r = validateExtras(act, { task: ' keep spaces ', count: 3, tags: ['a'] });
  assert.ok(r.ok);
  if (r.ok) {
    const task: string = r.extras.task;
    const count: number | undefined = r.extras.count;
    assert.equal(task, ' keep spaces ');
    assert.equal(count, 3);
    // @ts-expect-error task is required so it is a string, never undefined
    const bad: undefined = r.extras.task;
    void bad;
    // @ts-expect-error an unknown key is not part of the type
    void r.extras.nope;
  }
});

test('unknown keys, missing keys, wrong types', () => {
  const no = (raw: Record<string, unknown>, re: RegExp) => {
    const r = validateExtras(act, raw);
    assert.equal(r.ok, false, JSON.stringify(raw));
    if (!r.ok) assert.match(r.reason, re);
  };
  no({}, /missing extra task/);
  no({ task: 't', nope: 1 }, /unknown extra nope/);
  no({ task: 't', __proto__x: 1 }, /unknown/);
  no({ task: 't', constructor: 1 }, /unknown/);
  no({ task: 5 }, /text/);
  no({ task: null }, /text/);
  no({ task: 't', count: 1.5 }, /whole/);
  no({ task: 't', count: '1' }, /whole/);
  no({ task: 't', count: 2 ** 53 }, /whole/);
  no({ task: 't', dry: 'true' }, /true or false/);
  no({ task: 't', dry: 1 }, /true or false/);
  no({ task: 't', tags: 'a' }, /list/);
  no({ task: 't', tags: ['a', 1] }, /list/);
  assert.deepEqual(validateExtras(act, { task: 't', count: -5, dry: false, tags: [] }), { ok: true, extras: { task: 't', count: -5, dry: false, tags: [] } });
});

test('an inherited property is not an extra, and Object.prototype names cannot be extras', () => {
  assert.deepEqual(validateExtras(act, Object.create({ task: 'inherited' })), { ok: false, reason: 'missing extra task' });
  assert.equal(validateExtras(act, Object.assign(Object.create({ count: 'inherited' }), { task: 't' })).ok, true);
  const ok = { app: 'deputy', name: 'X', screen: true as const, description: 'd' };
  for (const key of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']) {
    assert.throws(() => defineAction({ ...ok, extras: { [key]: { type: 'string' } } }), /every object has/, key);
  }
  assert.throws(() => defineAction({ ...ok, extras: JSON.parse('{"__proto__":{"type":"string"}}') }), /extra key/);
});

test('never throws on odd input', () => {
  for (const raw of [null, undefined, 'x', 5, [], new Proxy({}, { ownKeys() { throw new Error('boom'); } })]) {
    assert.equal(validateExtras(act, raw as never).ok, false);
  }
  const own = JSON.parse('{"task":"t","__proto__":1}');
  assert.equal(validateExtras(act, own).ok, false);
});

test('NUL is refused in strings and array items', () => {
  assert.equal(validateExtras(act, { task: 'a\0b' }).ok, false);
  assert.equal(validateExtras(act, { task: 't', tags: ['a\0'] }).ok, false);
  assert.equal(validateExtras(act, { task: 'a\nb\u0001' }).ok, true);
});

test('size limits at the boundary and one over', () => {
  assert.equal(validateExtras(act, { task: 'x'.repeat(MAX_STRING_CHARS) }).ok, true);
  assert.equal(validateExtras(act, { task: 'x'.repeat(MAX_STRING_CHARS + 1) }).ok, false);
  assert.equal(validateExtras(act, { task: 't', short: 'x'.repeat(5) }).ok, true);
  assert.equal(validateExtras(act, { task: 't', short: 'x'.repeat(6) }).ok, false);
  const item = 'x'.repeat(MAX_ARRAY_ITEM_CHARS);
  assert.equal(validateExtras(act, { task: 't', tags: Array(MAX_ARRAY_ITEMS).fill('y') }).ok, true);
  assert.equal(validateExtras(act, { task: 't', tags: Array(MAX_ARRAY_ITEMS + 1).fill('y') }).ok, false);
  assert.equal(validateExtras(act, { task: 't', tags: [item] }).ok, true);
  assert.equal(validateExtras(act, { task: 't', tags: [item + 'x'] }).ok, false);
});

test('total characters and extra count', () => {
  const big = defineAction({
    app: 'deputy', name: 'BIG', screen: true, description: 'd',
    extras: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' }, d: { type: 'string' }, e: { type: 'string' } },
  });
  const full = 'x'.repeat(MAX_STRING_CHARS);
  assert.equal(validateExtras(big, { a: full, b: full, c: full, d: full }).ok, true); // exactly MAX_TOTAL_CHARS
  const over = validateExtras(big, { a: full, b: full, c: full, d: full, e: 'x' });
  assert.equal(over.ok, false);
  if (!over.ok) assert.match(over.reason, /characters/);
  const many = defineAction({
    app: 'deputy', name: 'MANY', screen: true, description: 'd',
    extras: Object.fromEntries(Array.from({ length: MAX_EXTRAS }, (_, i) => [`k${i}`, { type: 'long' as const }])),
  });
  assert.equal(validateExtras(many, Object.fromEntries(Array.from({ length: MAX_EXTRAS }, (_, i) => [`k${i}`, i]))).ok, true);
  const nine = Object.fromEntries(Array.from({ length: MAX_EXTRAS + 1 }, (_, i) => [`k${i}`, i]));
  const r = validateExtras(many, nine);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /more than/);
});

test('validateResult', () => {
  assert.deepEqual(RESULT_KEYS, ['status', 'code', 'message']);
  assert.deepEqual(validateResult({ status: 'done' }), { ok: true, result: { status: 'done' } });
  assert.equal(validateResult({ status: 'failed', code: 'no_network', message: 'x'.repeat(MAX_RESULT_MESSAGE_CHARS) }).ok, true);
  assert.equal(validateResult({ status: 'cancelled', code: 'a'.repeat(40) }).ok, true);
  for (const bad of [
    null, 'done', [], {}, { status: 'ok' }, { status: 'done', extra: 1 },
    { status: 'done', code: 'Bad' }, { status: 'done', code: '1a' }, { status: 'done', code: 'a'.repeat(41) }, { status: 'done', code: 5 },
    { status: 'done', message: 'x'.repeat(MAX_RESULT_MESSAGE_CHARS + 1) }, { status: 'done', message: 5 }, { status: 'done', message: 'a\0' },
  ]) assert.equal(validateResult(bad).ok, false, JSON.stringify(bad));
});
