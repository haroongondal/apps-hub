import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AD_KEYS, stripAds, validateSettings, youtubeAdsOn, ytChannel } from '../index.ts';

const TEXT = readFileSync(new URL('./fixtures/yt/player-response.json', import.meta.url), 'utf8');
const fixture = () => JSON.parse(TEXT);
const CHANNEL = 'UCuAXFkgsw1L7xaCfnd5JJOw';

test('AD_KEYS are the four player-response ad fields', () => {
  assert.deepEqual(AD_KEYS, ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams']);
});

test('the fixture is a real player response with ads, from the channel the tests allow', () => {
  const f = fixture();
  assert.equal(f.videoDetails.channelId, CHANNEL);
  assert.ok(Array.isArray(f.adPlacements) && f.adPlacements.length > 0);
});

test('stripAds removes every ad key and reports it', () => {
  const f = fixture();
  assert.equal(stripAds(f, new Set()), true);
  for (const key of AD_KEYS) assert.equal(key in f, false, key);
});

test('stripAds leaves videoDetails and streamingData exactly as they were', () => {
  const f = fixture();
  const before = fixture();
  stripAds(f, new Set());
  assert.deepEqual(f.videoDetails, before.videoDetails);
  assert.deepEqual(f.streamingData, before.streamingData);
});

test('an allowed channel keeps its ads, and stripAds says it removed nothing', () => {
  const f = fixture();
  assert.equal(stripAds(f, new Set([f.videoDetails.channelId])), false);
  assert.deepEqual(f, fixture());
});

test('a response wrapped under playerResponse is stripped, and its own channel decides', () => {
  const wrapped = { playerResponse: fixture(), other: 1 };
  assert.equal(stripAds(wrapped, new Set()), true);
  for (const key of AD_KEYS) assert.equal(key in wrapped.playerResponse, false, key);
  assert.equal(wrapped.other, 1);
  const allowed = { playerResponse: fixture() };
  assert.equal(stripAds(allowed, new Set([CHANNEL])), false);
  assert.ok('adPlacements' in allowed.playerResponse);
});

test('ad keys on both the wrapper and the nested response are removed', () => {
  const both = { adSlots: [1], playerResponse: { playerAds: [2], videoDetails: { channelId: 'UCx' } } };
  assert.equal(stripAds(both, new Set()), true);
  assert.deepEqual(both, { playerResponse: { videoDetails: { channelId: 'UCx' } } });
});

test('stripAds is false and quiet on anything that is not a player response', () => {
  for (const input of [null, undefined, 'x', 42, true, [], ['adPlacements'], {}, { videoDetails: {} }, { playerResponse: 'x' }]) {
    assert.equal(stripAds(input, new Set()), false, JSON.stringify(input));
  }
});

test('stripAds never throws: frozen objects, throwing getters, a response that holds itself, deep nesting', () => {
  const frozen = Object.freeze({ adPlacements: [1] });
  assert.equal(stripAds(frozen, new Set()), false);
  const hostile = Object.defineProperty({}, 'videoDetails', { get() { throw new Error('boom'); } });
  assert.doesNotThrow(() => stripAds(hostile, new Set()));
  const self: Record<string, unknown> = { adSlots: [1] };
  self.playerResponse = self;
  assert.equal(stripAds(self, new Set()), true);
  let deep: Record<string, unknown> = { adPlacements: [1] };
  for (let i = 0; i < 100_000; i++) deep = { playerResponse: deep };
  assert.equal(stripAds(deep, new Set()), false); // only the top level and its playerResponse are read
});

test('ytChannel accepts a channel id and a name, trimmed and capped at 100 characters', () => {
  assert.deepEqual(ytChannel({ id: CHANNEL, name: '  Rick Astley ' }), { id: CHANNEL, name: 'Rick Astley' });
  assert.deepEqual(ytChannel({ id: CHANNEL, name: 'x'.repeat(500) }), { id: CHANNEL, name: 'x'.repeat(100) });
  assert.deepEqual(ytChannel({ id: 'UC_-abcdefghijklmnopqrst', name: 'A', extra: 1 }), { id: 'UC_-abcdefghijklmnopqrst', name: 'A' });
});

test('ytChannel refuses anything that is not a channel id with a name', () => {
  for (const input of [
    null,
    'UCuAXFkgsw1L7xaCfnd5JJOw',
    [CHANNEL, 'x'],
    { id: CHANNEL },
    { id: CHANNEL, name: '   ' },
    { id: CHANNEL, name: 7 },
    { id: 'UC1', name: 'Short' },
    { id: `${CHANNEL}x`, name: 'Long' },
    { id: 'XXuAXFkgsw1L7xaCfnd5JJOw', name: 'Not UC' },
    { id: 'UCuAXFkgsw1L7xaCfnd5JJ.w', name: 'Bad character' },
    { id: ` ${CHANNEL}`, name: 'Space' },
  ]) {
    assert.equal(ytChannel(input), null, JSON.stringify(input));
  }
});

test('youtubeAdsOn: on by default, off when Sieve is off, paused, the Ads list is off, or any given address is allowlisted', () => {
  const s = (blocking: object, enabled = true) => validateSettings({ enabled, blocking });
  const watch = 'https://www.youtube.com/watch?v=x';
  assert.equal(youtubeAdsOn(s({}), [watch]), true);
  assert.equal(youtubeAdsOn(s({}, false), [watch]), false);
  assert.equal(youtubeAdsOn(s({ paused: true }), [watch]), false);
  assert.equal(youtubeAdsOn(s({ lists: { ads: false } }), [watch]), false);
  assert.equal(youtubeAdsOn(s({ allowlist: [{ kind: 'site', host: 'youtube.com' }] }), [watch]), false);
  assert.equal(youtubeAdsOn(s({ allowlist: [{ kind: 'page', url: watch }] }), [watch]), false);
  assert.equal(youtubeAdsOn(s({ allowlist: [{ kind: 'page', url: watch }] }), ['https://www.youtube.com/watch?v=y']), true);
  // An embed on an allowlisted site: the embedding page's origin comes from location.ancestorOrigins.
  const embed = ['https://www.youtube-nocookie.com/embed/x', 'https://example.com'];
  assert.equal(youtubeAdsOn(s({ allowlist: [{ kind: 'site', host: 'example.com' }] }), embed), false);
  assert.equal(youtubeAdsOn(s({ allowlist: [{ kind: 'site', host: 'other.com' }] }), embed), true);
});
