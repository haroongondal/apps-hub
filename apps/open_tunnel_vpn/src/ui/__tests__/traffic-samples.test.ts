/**
 * Ring-buffer + sparkline tests (node --test) — pure TypeScript, no React
 * imports, so these run exactly what the screens run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RING_CAPACITY,
  TrafficRingBuffer,
  sparklineBars,
  type TrafficTick,
} from '../traffic-samples.ts';

function sample(bytesIn: number, bytesOut = 0): TrafficTick {
  return { bytesIn, bytesOut, connectedDurationSec: 0 };
}

test('push keeps the newest sample first and bounds the ring', () => {
  const ring = new TrafficRingBuffer();
  for (let index = 0; index < RING_CAPACITY + 5; index += 1) {
    ring.push({ bytesIn: index, bytesOut: 0, connectedDurationSec: index });
  }
  const all = ring.all();
  assert.equal(all.length, RING_CAPACITY);
  assert.equal(all[0]!.bytesIn, RING_CAPACITY + 4);
  assert.equal(all[all.length - 1]!.bytesIn, 5);
});

test('recentAverage averages the newest samples', () => {
  const ring = new TrafficRingBuffer();
  ring.push({ bytesIn: 100, bytesOut: 0, connectedDurationSec: 1 });
  ring.push({ bytesIn: 200, bytesOut: 0, connectedDurationSec: 2 });
  ring.push({ bytesIn: 300, bytesOut: 50, connectedDurationSec: 3 });
  const average = ring.recentAverage();
  assert.equal(average!.bytesIn, 200);
  assert.equal(average!.bytesOut, 50 / 3);
});

test('recentAverage resolves null on an empty ring', () => {
  const ring = new TrafficRingBuffer();
  assert.equal(ring.recentAverage(), null);
});

test('clear empties the ring (state-change invalidation)', () => {
  const ring = new TrafficRingBuffer();
  ring.push({ bytesIn: 10, bytesOut: 0, connectedDurationSec: 1 });
  ring.clear();
  assert.deepEqual(ring.all(), []);
  assert.equal(ring.recentAverage(), null);
});

test('sparklineBars bucket chronologically and normalize to the peak', () => {
  const ring = new TrafficRingBuffer();
  ring.push(sample(0));
  ring.push(sample(0));
  ring.push(sample(80));
  ring.push(sample(20));
  const bars = sparklineBars(ring.all(), 2);
  assert.equal(bars.length, 2);
  // Oldest bucket (samples 0+0 -> avg 0) first, newest (80+20 -> avg 50) last.
  assert.equal(bars[0]!.idle, true);
  assert.equal(bars[0]!.height, 0);
  assert.equal(bars[1]!.idle, false);
  assert.equal(bars[1]!.height, 1);
});

test('sparklineBars marks idle buckets instead of inventing traffic', () => {
  const bars = sparklineBars([sample(0), sample(0), sample(0), sample(0)], 3);
  assert.equal(bars.length, 3);
  for (const bar of bars) {
    assert.equal(bar.idle, true);
    assert.equal(bar.height, 0);
  }
});

test('sparklineBars anchors a lone sample at the newest end, idle before it', () => {
  const bars = sparklineBars([sample(100)], 4);
  assert.equal(bars.length, 4);
  assert.equal(bars[0]!.idle, true);
  assert.equal(bars[3]!.idle, false);
  assert.equal(bars[3]!.height, 1);
});
