import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GIVE_UP_MS,
  HOST_CAP_TTL_MS,
  HOST_MAX,
  MAX_ATTEMPTS,
  STALL_MS,
  backoffMs,
  capFor,
  hostOf,
  isPartComplete,
  nextToStart,
  onRefused,
  parseRetryAfter,
  partLength,
  planParts,
  remaining,
  resplit,
} from '../dl-plan.ts';

const ranges = (ps: { start: number; end: number | null }[]) => ps.map((p) => [p.start, p.end]);

test('planParts: the worked examples', () => {
  assert.deepEqual(ranges(planParts(10_485_760, 3)), [[0, 3495253], [3495254, 6990506], [6990507, 10485759]]);
  assert.deepEqual(ranges(planParts(10, 3, 1)), [[0, 3], [4, 6], [7, 9]]);
  const five = planParts(5_242_880, 6);
  assert.equal(five.length, 5);
  assert.ok(five.every((p) => partLength(p) === 1_048_576));
  assert.deepEqual(ranges(planParts(1_500_000, 4)), [[0, 1499999]]);
  assert.deepEqual(ranges(planParts(1, 3, 1)), [[0, 0]]);
  assert.deepEqual(planParts(0, 3), []);
  assert.deepEqual(planParts(-5, 3), []);
  assert.deepEqual(planParts(NaN, 3), []);
  assert.ok(planParts(10, 2, 1).every((p) => p.done === 0));
});

test('planParts: contiguous, sums to size, lengths differ by at most 1 (property)', () => {
  for (const size of [1, 5, 1_048_576, 7_654_321, 123_456_789]) {
    for (let n = 1; n <= 6; n++) {
      const ps = planParts(size, n, 1);
      assert.ok(ps.length <= n && ps.length >= 1);
      assert.equal(ps[0].start, 0);
      assert.equal(ps[ps.length - 1].end, size - 1);
      ps.forEach((p, i) => i > 0 && assert.equal(p.start, ps[i - 1].end! + 1));
      const lens = ps.map(partLength);
      assert.equal(lens.reduce((a, b) => a + b, 0), size);
      assert.ok(Math.max(...lens) - Math.min(...lens) <= 1);
    }
  }
});

test('planParts: parts that is NaN, 0 or Infinity gives one part', () => {
  for (const n of [NaN, 0, Infinity]) assert.deepEqual(ranges(planParts(10, n, 1)), [[0, 9]]);
});

test('partLength, remaining and isPartComplete', () => {
  assert.equal(partLength({ start: 4, end: 9, done: 0 }), 6);
  assert.equal(partLength({ start: 0, end: null, done: 0 }), Infinity);
  assert.equal(remaining({ start: 4, end: 9, done: 2 }), 4);
  assert.equal(remaining({ start: 0, end: null, done: 5 }), Infinity);
  assert.equal(isPartComplete({ start: 4, end: 9, done: 6 }), true);
  assert.equal(isPartComplete({ start: 4, end: 9, done: 7 }), true);
  assert.equal(isPartComplete({ start: 4, end: 9, done: 5 }), false);
  assert.equal(isPartComplete({ start: 0, end: null, done: 1e12 }), false);
});

const worked = () => [
  { start: 0, end: 9_999_999, done: 1_000_000 },
  { start: 10_000_000, end: 19_999_999, done: 10_000_000 },
];

test('resplit: worked example', () => {
  const r = resplit(worked(), [0])!;
  assert.equal(r.added, 2);
  assert.deepEqual(r.parts, [
    { start: 0, end: 5_499_999, done: 1_000_000 },
    { start: 10_000_000, end: 19_999_999, done: 10_000_000 },
    { start: 5_500_000, end: 9_999_999, done: 0 },
  ]);
});

test('resplit: boundary cases', () => {
  const mk = (rem: number) => [{ start: 0, end: rem - 1, done: 0 }];
  const a = resplit(mk(2_097_152), [0])!;
  assert.deepEqual(a.parts.map(partLength), [1_048_576, 1_048_576]);
  assert.equal(resplit(mk(2_097_151), [0]), null);
  const c = resplit(mk(2_097_153), [0])!;
  assert.deepEqual(c.parts.map(partLength), [1_048_577, 1_048_576]);
});

test('resplit: tie goes to the lowest index', () => {
  const ps = [
    { start: 0, end: 9_999_999, done: 0 },
    { start: 10_000_000, end: 19_999_999, done: 0 },
  ];
  const r = resplit(ps, [1, 0])!;
  assert.equal(r.parts[0].end, 4_999_999);
  assert.equal(r.parts[1].end, 19_999_999);
});

test('resplit: parts not in active or with unknown end are ignored', () => {
  const ps = [
    { start: 0, end: 3_999_999, done: 0 },
    { start: 4_000_000, end: 29_999_999, done: 0 },
  ];
  const r = resplit(ps, [0])!;
  assert.equal(r.parts[0].end, 1_999_999);
  assert.equal(r.parts[1].end, 29_999_999);
  assert.equal(resplit([{ start: 0, end: null, done: 0 }], [0]), null);
  assert.equal(resplit(ps, []), null);
});

test('resplit: input is not mutated and halves cover the old remainder', () => {
  const ps = worked();
  const before = JSON.stringify(ps);
  const r = resplit(ps, [0])!;
  assert.equal(JSON.stringify(ps), before);
  assert.notEqual(r.parts, ps);
  const [a, , b] = r.parts;
  assert.equal(a.start + a.done, 1_000_000);
  assert.equal(b.start, a.end! + 1);
  assert.equal(b.end, 9_999_999);
  assert.equal(remaining(a) + remaining(b), 9_000_000);
});

test('nextToStart', () => {
  const ps = [
    { start: 0, end: 9, done: 10 },
    { start: 10, end: 19, done: 3 },
    { start: 20, end: 29, done: 0 },
  ];
  assert.equal(nextToStart(ps, [1]), 2);
  assert.equal(nextToStart(ps, [1, 2]), null);
  assert.equal(nextToStart(ps, []), 1);
  assert.equal(nextToStart([{ start: 0, end: 9, done: 10 }], []), null);
  assert.equal(nextToStart([], []), null);
});

test('constants', () => {
  assert.equal(HOST_MAX, 6);
  assert.equal(MAX_ATTEMPTS, 5);
  assert.equal(GIVE_UP_MS, 900_000);
  assert.equal(STALL_MS, 30_000);
});

test('host caps: examples, TTL, no mutation, never raised', () => {
  const h = 'a.example';
  const c1 = onRefused({}, h, 6, 0);
  assert.equal(c1[h].cap, 3);
  assert.equal(c1[h].until, HOST_CAP_TTL_MS);
  assert.equal(onRefused(c1, h, 3, 1)[h].cap, 1);
  assert.equal(onRefused({}, h, 1, 0)[h].cap, 1);
  assert.equal(onRefused({}, h, 2, 0)[h].cap, 1);
  assert.equal(onRefused({}, h, 5, 0)[h].cap, 2);
  assert.equal(onRefused({}, h, 0, 0)[h].cap, 1);
  // refresh of until
  assert.equal(onRefused(c1, h, 3, 100)[h].until, 100 + HOST_CAP_TTL_MS);
  // no mutation
  const input = { [h]: { cap: 2, until: HOST_CAP_TTL_MS } };
  const snap = JSON.stringify(input);
  const out = onRefused(input, h, 6, 5);
  assert.equal(JSON.stringify(input), snap);
  assert.notEqual(out, input);
  // never raised while unexpired
  assert.equal(out[h].cap, 2);
  // expired cap does not limit
  assert.equal(onRefused({ [h]: { cap: 2, until: 10 } }, h, 6, 10)[h].cap, 3);
  // other hosts kept
  assert.equal(onRefused({ b: { cap: 4, until: 9e9 } }, h, 6, 0).b.cap, 4);
  // capFor
  const two = onRefused({}, h, 4, 0);
  assert.equal(two[h].cap, 2);
  assert.equal(capFor(two, h, 6, HOST_CAP_TTL_MS - 1), 2);
  assert.equal(capFor(two, h, 6, HOST_CAP_TTL_MS), 6);
  assert.equal(capFor(two, h, 1, 0), 1);
  assert.equal(capFor(two, 'other', 6, 0), 6);
  assert.equal(capFor({}, h, 6, 0), 6);
});

test('hostOf', () => {
  assert.equal(hostOf('https://CDN.Example.com:8443/a'), 'cdn.example.com');
  assert.equal(hostOf('nonsense'), '');
});

test('backoffMs', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => backoffMs(n)), [2000, 4000, 8000, 16000, 30000, 30000]);
  assert.equal(backoffMs(1, 5000), 5000);
  assert.equal(backoffMs(1, 120000), 60000);
  assert.equal(backoffMs(1, null), 2000);
  assert.equal(backoffMs(0), 2000);
  assert.equal(backoffMs(-3), 2000);
  assert.equal(backoffMs(100), 30000);
});

test('parseRetryAfter', () => {
  assert.equal(parseRetryAfter('7', 0), 7000);
  assert.equal(parseRetryAfter('0', 0), 0);
  const now = Date.parse('Wed, 21 Oct 2026 07:27:50 GMT');
  assert.equal(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', now), 10000);
  assert.equal(parseRetryAfter('Wed, 21 Oct 2026 07:27:00 GMT', now), 0);
  for (const v of ['-3', 'abc', '', null]) assert.equal(parseRetryAfter(v, 0), null);
});
