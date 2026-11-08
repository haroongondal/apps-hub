import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMatch, countsKey, type BuildMeta } from '../index.ts';

const feature = (ruleset: string | null, allowIds: number[] = []) => ({ ruleset, ruleCount: 10, hasGenericCss: false, genericExcept: [], allowIds });
// Rule ids restart at 1 in every list, so id 7 is an allow rule in `ads` and a block rule in `trackers`.
const meta: BuildMeta = {
  builtAt: '2026-11-06T00:00:00.000Z',
  maxPriority: 10,
  features: {
    ads: feature('ads', [7, 8]),
    trackers: feature('trackers'),
    distraction: feature('distraction'),
    cookies: feature('cookies'),
    antiadblock: feature('antiadblock'),
    ai: feature(null),
  },
  scriptlets: [],
};
const none = new Set<number>();

test('a list rule is an ad, except in the trackers list', () => {
  assert.equal(classifyMatch('ads', 1, meta, none), 'ad');
  assert.equal(classifyMatch('cookies', 3, meta, none), 'ad');
  assert.equal(classifyMatch('trackers', 1, meta, none), 'tracker');
});

test('an allow rule of a list is not counted, but the same id in another list is', () => {
  assert.equal(classifyMatch('ads', 7, meta, none), null);
  assert.equal(classifyMatch('trackers', 7, meta, none), 'tracker');
});

test('a dynamic rule is not counted when it is an allow rule, and is an ad otherwise (a My filters block rule)', () => {
  assert.equal(classifyMatch('_dynamic', 1_000_000, meta, new Set([1_000_000])), null);
  assert.equal(classifyMatch('_dynamic', 3, meta, new Set([1_000_000])), 'ad');
  // A dynamic id that equals a list's allow id is still judged by the dynamic set.
  assert.equal(classifyMatch('_dynamic', 7, meta, none), 'ad');
});

test('an unknown ruleset counts as an ad', () => {
  assert.equal(classifyMatch('someday', 1, meta, none), 'ad');
});

test('countsKey names the per-tab session entry', () => {
  assert.equal(countsKey(42), 'counts:42');
});
