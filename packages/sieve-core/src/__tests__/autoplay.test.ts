import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopThisPlay, type PlayContext } from '../autoplay.ts';

const base: PlayContext = { mode: 'always', playlists: true, loadedHidden: false, firstVideo: true, inPlaylist: false, firstPlay: true, sincePlayerInput: Infinity };
const stops = (patch: Partial<PlayContext> = {}): boolean => stopThisPlay({ ...base, ...patch });

test('stopThisPlay: the base context stops the play', () => {
  assert.equal(stops(), true);
});

test('stopThisPlay: a later play, or one right after the owner pressed play, is never stopped', () => {
  assert.equal(stops({ firstPlay: false }), false);
  assert.equal(stops({ sincePlayerInput: 500 }), false);
  assert.equal(stops({ sincePlayerInput: 999 }), false);
  assert.equal(stops({ sincePlayerInput: 1000 }), true);
});

test('stopThisPlay: allow never stops', () => {
  assert.equal(stops({ mode: 'allow' }), false);
  assert.equal(stops({ mode: 'allow', loadedHidden: true }), false);
});

test('stopThisPlay: always lets a playlist play only when playlists is on', () => {
  assert.equal(stops({ inPlaylist: true }), false);
  assert.equal(stops({ inPlaylist: true, playlists: false }), true);
  assert.equal(stops({ playlists: false }), true);
});

test('stopThisPlay: background stops only the first video of a tab that loaded hidden', () => {
  assert.equal(stops({ mode: 'background' }), false);
  assert.equal(stops({ mode: 'background', loadedHidden: true }), true);
  assert.equal(stops({ mode: 'background', loadedHidden: true, firstVideo: false }), false);
  assert.equal(stops({ mode: 'background', loadedHidden: true, inPlaylist: true }), true, 'the playlists switch belongs to "always"');
});
