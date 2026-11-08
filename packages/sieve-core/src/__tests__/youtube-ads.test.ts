import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AD_KEYS, stripAds, validateSettings, watchChannel, youtubeAdsOn, ytChannel } from '../index.ts';

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

test('a wrapper with no videoDetails of its own is judged by its playerResponse: an allowed channel keeps the wrapper ad fields too', () => {
  const wrapped = { adSlots: [1], playerResponse: fixture() };
  assert.equal(stripAds(wrapped, new Set([CHANNEL])), false);
  assert.deepEqual(wrapped.adSlots, [1]);
  assert.ok('adPlacements' in wrapped.playerResponse);
  assert.equal(stripAds(wrapped, new Set()), true);
  assert.equal('adSlots' in wrapped, false);
});

test('a short array is read element by element, with the same rules; a longer one and nested arrays are left alone', () => {
  const page = [{ page: 'watch' }, { playerResponse: fixture() }];
  assert.equal(stripAds(page, new Set()), true);
  assert.equal('adPlacements' in page[1].playerResponse, false);
  assert.deepEqual(page[0], { page: 'watch' });
  const allowed = [{ page: 'watch' }, { playerResponse: fixture() }];
  assert.equal(stripAds(allowed, new Set([CHANNEL])), false);
  assert.ok('adPlacements' in allowed[1].playerResponse);
  const five = [1, 'x', null, [{ adSlots: [1] }], { adSlots: [1] }];
  assert.equal(stripAds(five, new Set()), true);
  assert.deepEqual(five, [1, 'x', null, [{ adSlots: [1] }], {}]);
  const six = [{}, {}, {}, {}, {}, { adSlots: [1] }];
  assert.equal(stripAds(six, new Set()), false);
  assert.deepEqual(six[5], { adSlots: [1] });
});

const RICK = { id: CHANNEL, name: 'Rick Astley', videoId: 'dQw4w9WgXcQ' };

test('ytChannel accepts a channel id, a name (trimmed, at most 100 characters) and a video id', () => {
  assert.deepEqual(ytChannel({ ...RICK, name: '  Rick Astley ' }), RICK);
  assert.deepEqual(ytChannel({ ...RICK, name: 'x'.repeat(500) }), { ...RICK, name: 'x'.repeat(100) });
  assert.deepEqual(ytChannel({ id: 'UC_-abcdefghijklmnopqrst', name: 'A', videoId: '_-a1B2c3D4e', extra: 1 }), { id: 'UC_-abcdefghijklmnopqrst', name: 'A', videoId: '_-a1B2c3D4e' });
});

test('ytChannel refuses anything that is not a channel id with a name and a video id', () => {
  for (const input of [
    null,
    'UCuAXFkgsw1L7xaCfnd5JJOw',
    [CHANNEL, 'x'],
    { id: CHANNEL, videoId: RICK.videoId },
    { ...RICK, name: '   ' },
    { ...RICK, name: 7 },
    { ...RICK, id: 'UC1' },
    { ...RICK, id: `${CHANNEL}x` },
    { ...RICK, id: 'XXuAXFkgsw1L7xaCfnd5JJOw' },
    { ...RICK, id: 'UCuAXFkgsw1L7xaCfnd5JJ.w' },
    { ...RICK, id: ` ${CHANNEL}` },
    { id: CHANNEL, name: 'No video' },
    { ...RICK, videoId: 'dQw4w9WgXc' },
    { ...RICK, videoId: 'dQw4w9WgXcQQ' },
    { ...RICK, videoId: 'dQw4w9WgXc.' },
    { ...RICK, videoId: 11 },
  ]) {
    assert.equal(ytChannel(input), null, JSON.stringify(input));
  }
});

test("watchChannel names the channel of the watch page's own video, never another response seen on the page", () => {
  const preview = { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Preview' };
  const seen = new Map([
    ['dQw4w9WgXcQ', { id: CHANNEL, name: 'Rick Astley' }],
    ['aaaaaaaaaaa', preview],
  ]);
  assert.deepEqual(watchChannel('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', seen), { id: CHANNEL, name: 'Rick Astley' });
  assert.deepEqual(watchChannel('https://www.youtube.com/watch?list=x&v=aaaaaaaaaaa', seen), preview);
  assert.equal(watchChannel('https://www.youtube.com/watch?v=bbbbbbbbbbb', seen), null);
  assert.equal(watchChannel('https://www.youtube.com/watch', seen), null);
  assert.equal(watchChannel('https://www.youtube.com/shorts/dQw4w9WgXcQ', seen), null);
  assert.equal(watchChannel('https://www.youtube.com/?v=dQw4w9WgXcQ', seen), null);
});

test('youtubeAdsOn: on by default, off when Sieve is off, paused, the Ads list is off, or the page is allowlisted', () => {
  const s = (blocking: object, enabled = true) => validateSettings({ enabled, blocking });
  const watch = 'https://www.youtube.com/watch?v=x';
  assert.equal(youtubeAdsOn(s({}), watch), true);
  assert.equal(youtubeAdsOn(s({}, false), watch), false);
  assert.equal(youtubeAdsOn(s({ paused: true }), watch), false);
  assert.equal(youtubeAdsOn(s({ lists: { ads: false } }), watch), false);
  assert.equal(youtubeAdsOn(s({ allowlist: [{ kind: 'site', host: 'youtube.com' }] }), watch), false);
  assert.equal(youtubeAdsOn(s({ allowlist: [{ kind: 'page', url: watch }] }), watch), false);
  assert.equal(youtubeAdsOn(s({ allowlist: [{ kind: 'page', url: watch }] }), 'https://www.youtube.com/watch?v=y'), true);
});

test('youtubeAdsOn for an embed: a site entry for a page around it turns it off; a page entry never does, as ancestors are only origins', () => {
  const s = (allowlist: object[]) => validateSettings({ blocking: { allowlist } });
  const embed = 'https://www.youtube-nocookie.com/embed/x';
  assert.equal(youtubeAdsOn(s([{ kind: 'site', host: 'example.com' }]), embed, ['https://example.com']), false);
  assert.equal(youtubeAdsOn(s([{ kind: 'site', host: 'example.com' }]), embed, ['https://other.com', 'https://www.example.com']), false);
  assert.equal(youtubeAdsOn(s([{ kind: 'site', host: 'other.com' }]), embed, ['https://example.com']), true);
  assert.equal(youtubeAdsOn(s([{ kind: 'page', url: 'https://example.com/' }]), embed, ['https://example.com']), true);
  assert.equal(youtubeAdsOn(s([{ kind: 'page', url: embed }]), embed, ['https://example.com']), false);
});
