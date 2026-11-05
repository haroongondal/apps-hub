import assert from 'node:assert/strict';
import { test } from 'node:test';
import { barsFor, clampZoom, followTarget, lastFrameS, moveEdge, rulerStepS, thumbCount, thumbTimes, zoomLimits } from '../timeline.ts';

test('moveEdge: the start stops a tenth before the end, and snaps to tenths', () => {
  assert.deepEqual(moveEdge({ startS: 0, endS: 10 }, 'start', 12, 10), { startS: 9.9, endS: 10 });
  assert.deepEqual(moveEdge({ startS: 4, endS: 10 }, 'start', -3, 10), { startS: 0, endS: 10 });
  assert.deepEqual(moveEdge({ startS: 0, endS: 10 }, 'start', 2.34, 10), { startS: 2.3, endS: 10 });
});

test('moveEdge: the end stops a tenth after the start and at the end of the media', () => {
  assert.deepEqual(moveEdge({ startS: 2, endS: 8 }, 'end', 99, 10), { startS: 2, endS: 10 });
  assert.deepEqual(moveEdge({ startS: 2, endS: 8 }, 'end', 1, 10), { startS: 2, endS: 2.1 });
});

test('moveEdge: a media length that is not a real number changes nothing', () => {
  const r = { startS: 1, endS: 2 };
  for (const d of [0, NaN, -5, Infinity]) assert.equal(moveEdge(r, 'end', 5, d), r);
});

test('zoomLimits: the whole media fits at the lowest zoom, and a zero-width view does not divide by zero', () => {
  assert.deepEqual(zoomLimits(3, 360), { min: 120, max: 240 });
  assert.equal(zoomLimits(7200, 360).min, 0.05);
  assert.deepEqual(zoomLimits(10, 0), { min: 1, max: 240 });
  assert.deepEqual(zoomLimits(0, 360), { min: 1, max: 240 });
});

test('clampZoom: stays between the limits', () => {
  assert.equal(clampZoom(1000, 60, 360), 240);
  assert.equal(clampZoom(0.01, 60, 360), 6);
  assert.equal(clampZoom(10, 60, 360), 10);
});

test('rulerStepS: labels stay at least 56 px apart, and a huge media does not run out of steps', () => {
  assert.equal(rulerStepS(100), 1);
  assert.equal(rulerStepS(2), 30);
  assert.equal(rulerStepS(0.01), 600);
});

test('rulerStepS: a two-hour video zoomed all the way in still gets at most 150 labels', () => {
  assert.equal(rulerStepS(240, 56, 7200), 60);
  assert.equal(rulerStepS(240, 56, 60), 0.5);
});

test('thumbCount: one tile per 48 px, between 6 and 60, even for a two-hour video or a broken length', () => {
  assert.equal(thumbCount(600, 1.2), 15);
  assert.equal(thumbCount(7200, 240), 60);
  assert.equal(thumbCount(2, 1), 6);
  assert.equal(thumbCount(0, 50), 6);
  assert.equal(thumbCount(NaN, 50), 6);
});

test('lastFrameS: the last tenth strictly inside the media, so Save a picture never asks for the very end', () => {
  assert.equal(lastFrameS(13), 12.9);
  assert.equal(lastFrameS(12.96), 12.9);
  assert.equal(lastFrameS(12.91), 12.9);
  assert.equal(lastFrameS(0.05), 0);
  assert.equal(lastFrameS(0), 0);
  assert.equal(lastFrameS(NaN), 0);
});

test('thumbTimes: the middle of each equal slice', () => {
  assert.deepEqual(thumbTimes(10, 4), [1.25, 3.75, 6.25, 8.75]);
  assert.deepEqual(thumbTimes(10, 0), []);
  assert.deepEqual(thumbTimes(0, 3), []);
});

test('barsFor: the loudest peak of each slice, repeated when there are fewer peaks than bars, empty with no sound', () => {
  assert.deepEqual(barsFor([0.1, 0.9, 0.2, 0.4], 2), [0.9, 0.4]);
  assert.deepEqual(barsFor([0.5, 0.2], 4), [0.5, 0.5, 0.2, 0.2]);
  assert.deepEqual(barsFor([], 5), []);
  assert.deepEqual(barsFor([1], 0), []);
});

test('followTarget: the strip follows the player in tenths, but never while a finger drags it', () => {
  assert.equal(followTarget(3.46, 0, false), 3.5);
  assert.equal(followTarget(3.46, 3.5, false), undefined);
  assert.equal(followTarget(3.46, 0, true), undefined);
  assert.equal(followTarget(undefined, 0, false), undefined);
});
