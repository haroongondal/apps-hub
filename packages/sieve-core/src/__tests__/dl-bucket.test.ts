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

// Two consumers alternate single take() calls on the same bucket, each with its own wake-up time;
// when both wait, the clock jumps to the earlier wake-up. `own` gives each its own bucket instead.
function interleave(own: boolean) {
  const shared = makeBucket(100_000, 0);
  const cs = [0, 1].map(() => ({ b: own ? makeBucket(100_000, 0) : shared, remaining: 500_000, wakeAt: 0 }));
  let now = 0;
  let granted = 0;
  while (cs.some((c) => c.remaining > 0)) {
    const live = cs.filter((c) => c.remaining > 0);
    const ready = live.filter((c) => c.wakeAt <= now);
    if (!ready.length) {
      now = Math.min(...live.map((c) => c.wakeAt));
      continue;
    }
    for (const c of ready) {
      const g = take(c.b, c.remaining, now);
      c.remaining -= g.grant;
      granted += g.grant;
      c.wakeAt = now + g.waitMs;
      if (!own) assert.ok(granted <= 65_536 + (100_000 * now) / 1000, `granted ${granted} at ${now}`);
    }
  }
  return now;
}

test('two consumers sharing one bucket', () => {
  const end = interleave(false);
  assert.ok(end >= 9_300 && end <= 9_700, `clock ${end}`);
  // with a bucket each the same loop would finish near 4,345 ms, so the shared limit is what is tested
  const apart = interleave(true);
  assert.ok(apart < 4_700, `clock ${apart}`);
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
  assert.equal(rate(back, 500), 10);

  // the window edge: a sample exactly windowMs old still counts, one older does not
  const edge = makeMeter(0);
  addBytes(edge, 1000, 0);
  assert.ok(rate(edge, 5000) > 0);
  assert.equal(rate(edge, 5001), 0);
});

test('take grants whole bytes when the refill is fractional', () => {
  const b = makeBucket(333, 0);
  take(b, 1_000_000, 0); // drain the burst
  const g = take(b, 5_000, 3_500); // 1165.5 tokens
  assert.equal(g.grant, 1_165);
  assert.ok(Number.isInteger(g.grant));
});
