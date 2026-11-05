import assert from 'node:assert/strict';
import { test } from 'node:test';
import { singleFlight } from '../timeline/latest.ts';

function gate<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('singleFlight: one request runs at a time, only the newest waiting one is kept, and a stale answer is dropped', async () => {
  const gates = { a: gate<string>(), c: gate<string>() } as Record<string, ReturnType<typeof gate<string>>>;
  const ran: string[] = [];
  const got: string[] = [];
  const call = singleFlight((arg: string) => { ran.push(arg); return gates[arg].promise; }, v => got.push(v));
  call('a'); call('b'); call('c');
  assert.deepEqual(ran, ['a']);
  gates.a.resolve('A');
  await tick();
  assert.deepEqual(ran, ['a', 'c']);
  assert.deepEqual(got, []);
  gates.c.resolve('C');
  await tick();
  assert.deepEqual(got, ['C']);
});

test('singleFlight: with nothing newer waiting the answer is delivered, with the argument it was asked for', async () => {
  const g = gate<string>();
  const got: [string, number][] = [];
  singleFlight((_: number) => g.promise, (v, arg) => got.push([v, arg]))(7);
  g.resolve('ok');
  await tick();
  assert.deepEqual(got, [['ok', 7]]);
});

test('singleFlight: a failure is reported only when nothing newer waits, and the next request still runs', async () => {
  const a = gate<string>();
  const b = gate<string>();
  const got: string[] = [];
  const failed: unknown[] = [];
  const call = singleFlight((arg: string) => (arg === 'a' ? a.promise : b.promise), v => got.push(v), e => failed.push(e));
  call('a'); call('b');
  a.reject(new Error('a failed'));
  await tick();
  assert.deepEqual(failed, []);
  b.reject(new Error('b failed'));
  await tick();
  assert.equal(failed.length, 1);
  assert.match(String(failed[0]), /b failed/);
  assert.deepEqual(got, []);
});
