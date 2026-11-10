import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_GRANT, addBytes, makeBucket, makeMeter, rate, setRate, take } from '../dl-bucket.ts';
import type { Bucket } from '../dl-bucket.ts';

// The caller loop from the plan, against a fake clock: sleeping advances it.
function drain(b: Bucket, clock: { now: number }, bytes: number) {
  let remaining = bytes;
  while (remaining > 0) {
    const g = take(b, remaining, clock.now);
    remaining -= g.grant;
    if (g.waitMs > 0) clock.now += g.waitMs;
  }
}

test('bucket worked example, step by step', () => {
  assert.equal(MIN_GRANT, 1024);
  const b = makeBucket(100_000, 0);
  assert.equal(b.burst, 65_536);
  assert.equal(b.tokens, 65_536);
  assert.deepEqual(take(b, 100_000, 0), { grant: 65_536, waitMs: 0 });
  assert.deepEqual(take(b, 100_000, 0), { grant: 0, waitMs: 11 });
  assert.deepEqual(take(b, 100_000, 100), { grant: 10_000, waitMs: 0 });
  assert.deepEqual(take(b, 500, 100), { grant: 0, waitMs: 5 });
  // after 10 s idle the bucket holds the burst again, not more
  take(b, 1, 10_100);
  assert.equal(b.tokens, 65_535);
  assert.deepEqual(take(b, 1_000_000, 10_100), { grant: 65_535, waitMs: 0 });
});

test('burst sizes and every no-limit rate value', () => {
  assert.equal(makeBucket(1_000_000, 0).burst, 250_000);
  assert.equal(makeBucket(10_000, 0).burst, 65_536);
  assert.equal(makeBucket(Infinity, 0).burst, Infinity);
  for (const r of [Infinity, 0, -5, NaN]) {
    const b = makeBucket(r, 0);
    assert.equal(b.rate, Infinity);
    assert.deepEqual(take(b, 12_345, 7), { grant: 12_345, waitMs: 0 });
  }
  assert.deepEqual(take(makeBucket(100_000, 0), 0, 0), { grant: 0, waitMs: 0 });
  assert.deepEqual(take(makeBucket(100_000, 0), -4, 0), { grant: 0, waitMs: 0 });
  assert.deepEqual(take(makeBucket(Infinity, 0), 0, 0), { grant: 0, waitMs: 0 });
});

test('setRate refills at the old rate, caps tokens, turns the limit off, no NaN after Infinity', () => {
  const b = makeBucket(100_000, 0);
  take(b, 65_536, 0); // drained
  setRate(b, 50_000, 200);
  assert.equal(b.rate, 50_000);
  assert.equal(b.burst, 65_536);
  assert.equal(b.tokens, 20_000);

  setRate(b, Infinity, 300);
  assert.equal(b.rate, Infinity);
  assert.deepEqual(take(b, 1_000_000, 300), { grant: 1_000_000, waitMs: 0 });

  const c = makeBucket(Infinity, 5);
  setRate(c, 1_000_000, 5);
  assert.equal(c.tokens, 250_000);
  assert.equal(c.burst, 250_000);
  assert.deepEqual(take(c, 100_000, 5), { grant: 100_000, waitMs: 0 });
  assert.ok(!Number.isNaN(c.tokens) && !Number.isNaN(c.at));

  const d = makeBucket(1_000_000, 0); // full at 250,000
  setRate(d, 10_000, 0);
  assert.equal(d.tokens, 65_536);
  // a now earlier than at adds nothing and does not throw
  const before = d.tokens;
  take(d, 0, -50);
  assert.equal(d.tokens, before);
});

test('simulated drain of 1,000,000 bytes at 100,000 per second', () => {
  const clock = { now: 0 };
  const b = makeBucket(100_000, 0);
  for (let i = 0; i < 20; i++) drain(b, clock, 50_000);
  assert.ok(clock.now >= 9_300 && clock.now <= 9_700, `clock ${clock.now}`);
});

test('two consumers sharing one bucket', () => {
  const one = { now: 0 };
  const b1 = makeBucket(100_000, 0);
  for (let i = 0; i < 20; i++) drain(b1, one, 50_000);

  const two = { now: 0 };
  const b2 = makeBucket(100_000, 0);
  for (let i = 0; i < 10; i++) {
    drain(b2, two, 50_000); // consumer A
    drain(b2, two, 50_000); // consumer B
  }
  assert.ok(Math.abs(two.now - one.now) <= 20, `${two.now} vs ${one.now}`);
});

test('meter worked example, empty meter, span clamp, custom window, time going backwards', () => {
  const m = makeMeter(0);
  assert.equal(m.windowMs, 5000);
  assert.equal(rate(m, 0), 0);
  addBytes(m, 1_000_000, 500);
  addBytes(m, 1_000_000, 1500);
  assert.equal(rate(m, 2000), 1_000_000);
  assert.equal(rate(m, 7000), 0);

  const early = makeMeter(0);
  addBytes(early, 800_000, 100);
  assert.equal(rate(early, 400), 800_000);

  const short = makeMeter(0, 2000);
  addBytes(short, 1_000_000, 100);
  addBytes(short, 1_000_000, 3000);
  assert.equal(short.samples.length, 1);
  assert.equal(rate(short, 3000), 500_000);

  const back = makeMeter(1000);
  addBytes(back, 10, 2000);
  assert.doesNotThrow(() => rate(back, 500));
});
