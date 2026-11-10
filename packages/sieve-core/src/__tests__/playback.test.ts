import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSpeed, nextSpeed, nextVolume, snapSpeed, wheelSteps, type WheelState } from '../playback.ts';

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const ANY = { step: 0.25, anySpeed: true, rates: [] as number[] };
const LISTED = { step: 0.25, anySpeed: false, rates: RATES };

test('nextSpeed with any speed: the next multiple of the step, clamped to 0.1 and 16', () => {
  assert.equal(nextSpeed(1, 1, ANY), 1.25);
  assert.equal(nextSpeed(1.1, 1, ANY), 1.25);
  assert.equal(nextSpeed(1.1, -1, ANY), 1);
  assert.equal(nextSpeed(16, 1, ANY), 16);
  assert.equal(nextSpeed(0.1, -1, ANY), 0.1);
  assert.equal(nextSpeed(0.3, 1, { ...ANY, step: 0.1 }), 0.4);
  assert.equal(nextSpeed(0.4, -1, { ...ANY, step: 0.1 }), 0.3);
  assert.equal(nextSpeed(15.9, 1, ANY), 16);
});

test("nextSpeed without any speed: YouTube's own rates, and an empty list behaves as any speed", () => {
  assert.equal(nextSpeed(2, 1, LISTED), 2);
  assert.equal(nextSpeed(1, 1, LISTED), 1.25);
  assert.equal(nextSpeed(1.1, 1, LISTED), 1.25);
  assert.equal(nextSpeed(1.1, -1, LISTED), 1);
  assert.equal(nextSpeed(0.25, -1, LISTED), 0.25);
  assert.equal(nextSpeed(3, 1, LISTED), 3, 'Faster above the top rate never lowers the speed');
  assert.equal(nextSpeed(0.1, -1, LISTED), 0.1, 'Slower below the lowest rate never raises it');
  assert.equal(nextSpeed(3, -1, LISTED), 2);
  assert.equal(nextSpeed(1.1, 1, { ...LISTED, rates: [] }), 1.25);
});

test('snapSpeed: the nearest rate, a tie goes to the lower one', () => {
  assert.equal(snapSpeed(1.6, RATES), 1.5);
  assert.equal(snapSpeed(1.625, RATES), 1.5);
  assert.equal(snapSpeed(5, RATES), 2);
  assert.equal(snapSpeed(1.3, []), 1.3);
});

test('formatSpeed: at most two decimals, and the multiplication sign', () => {
  assert.equal(formatSpeed(1), '1×');
  assert.equal(formatSpeed(1.25), '1.25×');
  assert.equal(formatSpeed(1.5), '1.5×');
  assert.equal(formatSpeed(0.1), '0.1×');
  assert.equal(formatSpeed(16), '16×');
  assert.equal(formatSpeed(1.2000000001), '1.2×');
});

test('nextVolume: a step of the setting, held to 0 to 100', () => {
  assert.equal(nextVolume(50, 1, 5), 55);
  assert.equal(nextVolume(98, 1, 5), 100);
  assert.equal(nextVolume(3, -1, 5), 0);
});

test('wheelSteps: 50 pixels make a step, up is faster, and idle time or a turn starts over', () => {
  const fresh = (): WheelState => ({ acc: 0, at: 0 });
  assert.equal(wheelSteps(fresh(), -100, 0, 1000, false), 1);
  assert.equal(wheelSteps(fresh(), 100, 0, 1000, false), -1);
  assert.equal(wheelSteps(fresh(), -100, 0, 1000, true), -1);
  const s = fresh();
  assert.deepEqual([0, 16, 32, 48, 64].map((dt) => wheelSteps(s, 12, 0, 1000 + dt, false)), [0, 0, 0, 0, -1]);
  assert.equal(wheelSteps(fresh(), -3, 1, 1000, false), 1, 'three lines are 120 px');
  assert.equal(wheelSteps(fresh(), -1, 2, 1000, false), 1, 'a page is 800 px');
  const slow = fresh();
  assert.deepEqual([wheelSteps(slow, 40, 0, 1000, false), wheelSteps(slow, 40, 0, 1400, false)], [0, 0]);
  const turn = fresh();
  assert.deepEqual([wheelSteps(turn, 40, 0, 1000, false), wheelSteps(turn, -40, 0, 1016, false)], [0, 0]);
  const big = fresh();
  assert.equal(wheelSteps(big, -500, 0, 1000, false), 1, 'one step per event');
  assert.equal(big.acc, 0);
  assert.equal(wheelSteps(fresh(), 0, 0, 1000, false), 0);
});
