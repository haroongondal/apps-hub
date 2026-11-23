import assert from 'node:assert/strict';
import test from 'node:test';
import { assertRowShape, clampRows, defineShare, isSensitiveName } from '../index.ts';

interface Row { id: number; title: string; due_at: number | null; note: string | null; score: number }
const base = {
  authority: 'com.haroon.inflow.applink',
  path: 'items',
  columns: { id: 'long', title: 'string', due_at: 'long?', note: 'string?', score: 'double' },
  description: 'Test share',
} as const;
const share = defineShare<Row>()(base);

test('keeps the declared columns in order and freezes the result', () => {
  assert.deepEqual(share.columns, ['id', 'title', 'due_at', 'note', 'score']);
  assert.equal(share.types.due_at, 'long?');
  assert.equal(share.maxRows, 200);
  assert.ok(Object.isFrozen(share) && Object.isFrozen(share.columns) && Object.isFrozen(share.types));
});

test('compile-time key and type safety', () => {
  // @ts-expect-error a column is missing
  defineShare<Row>()({ ...base, columns: { id: 'long', title: 'string', due_at: 'long?', note: 'string?' } });
  // @ts-expect-error an extra column
  defineShare<Row>()({ ...base, columns: { ...base.columns, extra: 'long' } });
  // @ts-expect-error a string field declared as long
  defineShare<Row>()({ ...base, columns: { ...base.columns, title: 'long' } });
  // @ts-expect-error a nullable field declared without the ? form
  defineShare<Row>()({ ...base, columns: { ...base.columns, due_at: 'long' } });
  // @ts-expect-error a non-null field declared with the ? form
  defineShare<Row>()({ ...base, columns: { ...base.columns, id: 'long?' } });
  // @ts-expect-error a boolean field has no column type
  defineShare<{ id: number; done: boolean }>()({ ...base, columns: { id: 'long', done: 'int' } });
  // @ts-expect-error an object field has no column type
  defineShare<{ id: number; tags: string[] }>()({ ...base, columns: { id: 'long', tags: 'string' } });
});

test('int and double columns accept numbers', () => {
  const s = defineShare<{ a: number; b: number }>()({ ...base, columns: { a: 'int', b: 'double' } });
  assert.deepEqual(s.types, { a: 'int', b: 'double' });
});

test('refuses a bad authority', () => {
  for (const authority of ['', 'com.haroon.Inflow.applink', 'com.other.x.applink', 'content://com.haroon.inflow.applink']) {
    assert.throws(() => defineShare<Row>()({ ...base, authority }), /authority/, authority);
  }
  assert.doesNotThrow(() => defineShare<Row>()({ ...base, authority: 'com.haroon.inflow.autopilot' }));
});

test('refuses a bad path', () => {
  for (const path of ['', 'A', 'a/', '/a', 'a//b', 'a/b/c/d', '1a', 'a-b', '../x', 'a b']) {
    assert.throws(() => defineShare<Row>()({ ...base, path }), /path/, path);
  }
  assert.doesNotThrow(() => defineShare<Row>()({ ...base, path: 'a_b/c1/d' }));
});

test('refuses sensitive column names and non snake_case names', () => {
  const bad = ['password', 'user_passwd', 'client_secret', 'access_token', 'otp', 'pin', 'pin_code', 'pins', 'seed', 'seed_phrase', 'cvv', 'cvc', 'api_key', 'apikey', 'private_key', 'credential_id', 'session_id', 'cookie_jar', 'mnemonic'];
  for (const name of bad) {
    assert.equal(isSensitiveName(name), true, name);
    assert.throws(() => defineShare<{ [k: string]: number }>()({ ...base, columns: { [name]: 'long' } } as never), /sensitive/, name);
  }
  for (const name of ['pinned', 'spinner', 'speed', 'title', 'item_id', 'due_at', 'keyboard']) assert.equal(isSensitiveName(name), false, name);
  for (const name of ['Title', '1a', 'a-b', 'a b', '']) {
    assert.throws(() => defineShare<{ [k: string]: number }>()({ ...base, columns: { [name]: 'long' } } as never), /snake_case/, name);
  }
});

test('refuses no columns and more than 24 columns', () => {
  assert.throws(() => defineShare<object>()({ ...base, columns: {} }), /columns/);
  const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`c${i}`, 'long']));
  assert.throws(() => defineShare<Record<string, number>>()({ ...base, columns: many } as never), /columns/);
  assert.doesNotThrow(() => defineShare<Record<string, number>>()({ ...base, columns: Object.fromEntries(Object.entries(many).slice(0, 24)) } as never));
});

test('maxRows defaults, bounds', () => {
  assert.equal(defineShare<Row>()({ ...base, maxRows: 500 }).maxRows, 500);
  assert.equal(defineShare<Row>()({ ...base, maxRows: 1 }).maxRows, 1);
  for (const maxRows of [0, -1, 501, 1.5, Number.NaN, Infinity]) assert.throws(() => defineShare<Row>()({ ...base, maxRows }), /maxRows/, String(maxRows));
});

test('uri builds content uris from integer ids only', () => {
  assert.equal(share.uri(), 'content://com.haroon.inflow.applink/items');
  assert.equal(share.uri(7), 'content://com.haroon.inflow.applink/items/7');
  assert.equal(share.uri(0), 'content://com.haroon.inflow.applink/items/0');
  for (const id of [-1, 1.5, Number.NaN, Infinity, 2 ** 53, '1; drop' as unknown as number, '7' as unknown as number]) {
    assert.throws(() => share.uri(id), /ids/, String(id));
  }
});

test('clampRows cuts to maxRows', () => {
  const small = defineShare<Row>()({ ...base, maxRows: 2 });
  const rows = [1, 2, 3].map((id) => ({ id, title: 't', due_at: null, note: null, score: 0.5 }));
  assert.equal(clampRows(small, rows).length, 2);
  assert.equal(clampRows(small, rows.slice(0, 1)).length, 1);
  assert.equal(rows.length, 3);
});

test('assertRowShape accepts a good row and names the problem in a bad one', () => {
  const good = { id: 1, title: 'a', due_at: null, note: 'n', score: 1.5 };
  assert.doesNotThrow(() => assertRowShape(share, good));
  assert.throws(() => assertRowShape(share, { id: 1, title: 'a', due_at: null, note: 'n' }), /missing \[score\]/);
  assert.throws(() => assertRowShape(share, { ...good, extra: 1 }), /extra \[extra\]/);
  assert.throws(() => assertRowShape(share, { ...good, id: '1' }), /column id/);
  assert.throws(() => assertRowShape(share, { ...good, id: null }), /column id/);
  assert.throws(() => assertRowShape(share, { ...good, id: 1.5 }), /column id/);
  assert.throws(() => assertRowShape(share, { ...good, title: 5 }), /column title/);
  assert.throws(() => assertRowShape(share, { ...good, score: Number.NaN }), /column score/);
  assert.throws(() => assertRowShape(share, { ...good, due_at: true }), /column due_at/);
  assert.throws(() => assertRowShape(share, null), /object/);
  assert.throws(() => assertRowShape(share, [good]), /object/);
});

test('int columns stay inside 32 bits', () => {
  const s = defineShare<{ n: number }>()({ ...base, columns: { n: 'int' } });
  assert.doesNotThrow(() => assertRowShape(s, { n: 2147483647 }));
  assert.throws(() => assertRowShape(s, { n: 2147483648 }), /column n/);
});
