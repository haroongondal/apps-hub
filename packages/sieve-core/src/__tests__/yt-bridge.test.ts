import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_YOUTUBE, validateYouTube } from '../youtube-settings.ts';
import { EVENTS, mainSettings, readMainCommand, readMainSettings, readMainState, ytPage } from '../yt-bridge.ts';

const kind = (url: string) => ytPage(url).kind;

test('ytPage: watch pages, with the video id and the playlist', () => {
  assert.deepEqual(ytPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { kind: 'watch', videoId: 'dQw4w9WgXcQ', list: null });
  assert.deepEqual(ytPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx'), { kind: 'watch', videoId: 'dQw4w9WgXcQ', list: 'PLx' });
  assert.deepEqual(ytPage('https://www.youtube.com/watch?v=bad'), { kind: 'watch', videoId: null, list: null });
  assert.equal(kind('https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ'), 'watch');
});

test('ytPage: browse, shorts, embed and chat pages', () => {
  for (const url of ['https://www.youtube.com/', 'https://www.youtube.com/@name/videos', 'https://www.youtube.com/results?search_query=x', 'https://www.youtube.com/playlist?list=PLx']) {
    assert.equal(kind(url), 'browse', url);
  }
  assert.deepEqual(ytPage('https://www.youtube.com/shorts/dQw4w9WgXcQ'), { kind: 'shorts', videoId: 'dQw4w9WgXcQ', list: null });
  assert.deepEqual(ytPage('https://www.youtube.com/embed/dQw4w9WgXcQ'), { kind: 'embed', videoId: 'dQw4w9WgXcQ', list: null });
  assert.deepEqual(ytPage('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?list=x'), { kind: 'embed', videoId: 'dQw4w9WgXcQ', list: 'x' });
  assert.equal(kind('https://www.youtube.com/live_chat?v=x'), 'chat');
  assert.equal(kind('https://www.youtube.com/live_chat_replay?x=1'), 'chat');
});

test('ytPage: other hosts and nonsense are other', () => {
  for (const url of ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'https://example.com/', 'nonsense', 'https://www.youtube-nocookie.com/', 'ftp://www.youtube.com/watch?v=dQw4w9WgXcQ']) {
    assert.equal(kind(url), 'other', url);
  }
});

test('main settings: round trip, on is the given switch, bad input is null', () => {
  const m = mainSettings(DEFAULT_YOUTUBE, true);
  assert.deepEqual(readMainSettings(m), m);
  assert.deepEqual(Object.keys(m).sort(), ['experiments', 'on', 'quality', 'speed', 'volume']);
  assert.deepEqual(Object.keys(m.volume).sort(), ['level', 'setDefault', 'step']);
  const y = validateYouTube({ on: false, speed: { default: 1.5 } });
  assert.equal(mainSettings(y, y.on).on, false);
  assert.equal(readMainSettings(mainSettings(y, y.on))?.speed.default, 1.5);
  assert.equal(readMainSettings('x'), null);
  assert.equal(readMainSettings({ on: 'yes' }), null);
  assert.equal(readMainSettings(null), null);
});

test('main state: clamps and caps page data, fills defaults', () => {
  const s = readMainState({ rate: 99, qualities: ['hd1080', 'bogus', 'auto'], title: 'x'.repeat(1000), volume: 150 });
  assert.ok(s);
  assert.equal(s.rate, 16);
  assert.deepEqual(s.qualities, ['hd1080']);
  assert.equal(s.title.length, 300);
  assert.equal(s.volume, 100);
  assert.deepEqual(readMainState({}), { videoId: null, title: '', rate: 1, quality: 'auto', qualities: [], volume: 100, muted: false, live: false, playlist: null });
  assert.equal(readMainState(null), null);
  assert.equal(readMainState('x'), null);
  assert.deepEqual(readMainState({ playlist: { index: 2, length: 5, reversed: true } })?.playlist, { index: 2, length: 5, reversed: true });
  assert.equal(readMainState({ playlist: { index: 'a' } })?.playlist, null);
  assert.equal(readMainState({ videoId: '<script>' })?.videoId, null);
  assert.equal(readMainState({ quality: 'hd720', volume: -3, rate: Number.NaN })?.quality, 'hd720');
  assert.equal(readMainState({ volume: -3 })?.volume, 0);
  assert.equal(readMainState({ rate: Number.NaN })?.rate, 1);
});

test('main commands: an action id and an optional value', () => {
  assert.deepEqual(readMainCommand({ action: 'speed-step', value: 1 }), { action: 'speed-step', value: 1 });
  assert.deepEqual(readMainCommand({ action: 'loop' }), { action: 'loop' });
  assert.equal(readMainCommand({ action: 7 }), null);
  assert.equal(readMainCommand({ action: 'x'.repeat(65) }), null);
  assert.equal(readMainCommand(null), null);
  assert.deepEqual(readMainCommand({ action: 'loop', value: { a: 1 } }), { action: 'loop' });
});

test('event names', () => {
  assert.deepEqual(EVENTS, { hello: 'sieve-yt-hello', settings: 'sieve-yt-settings', do: 'sieve-yt-do', state: 'sieve-yt-state' });
});
