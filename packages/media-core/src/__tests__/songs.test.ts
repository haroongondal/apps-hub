import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseSongPage, songSearchUrl } from '../songs.ts';

const sample = () => JSON.parse(readFileSync(new URL('../../fixtures/freesound/search-page.json', import.meta.url), 'utf8')) as unknown;

test('songs: the search asks for CC0 songs with the token, the fields and the page, all percent-encoded', () => {
  const url = songSearchUrl(' calm piano ', 'tok en', 2);
  assert.ok(url.startsWith('https://freesound.org/apiv2/search/?'));
  const params = new URLSearchParams(url.split('?')[1]);
  assert.equal(params.get('query'), 'calm piano');
  assert.equal(params.get('token'), 'tok en');
  assert.equal(params.get('filter'), 'license:"Creative Commons 0" duration:[15 TO 600]');
  assert.equal(params.get('fields'), 'id,name,duration,license,previews');
  assert.equal(params.get('page'), '2');
  assert.ok(!url.includes(' '));
});

test('songs: an empty search lists the most downloaded songs', () => {
  const params = new URLSearchParams(songSearchUrl('  ', 'tok', 1).split('?')[1]);
  assert.equal(params.get('query'), 'music');
  assert.equal(params.get('sort'), 'downloads_desc');
  assert.equal(new URLSearchParams(songSearchUrl('calm', 'tok', 1).split('?')[1]).get('sort'), null);
});

test('songs: a page keeps only CC0 sounds with an https MP3 preview, and says whether more pages follow', () => {
  const page = parseSongPage(sample());
  assert.deepEqual(page.hits, [{ id: 101, name: 'Calm loop', durationS: 92.4, previewUrl: 'https://cdn.freesound.org/previews/101/101_1-hq.mp3' }]);
  assert.equal(page.hasMore, true);
});

test('songs: a malformed or empty response gives no songs and no more pages', () => {
  assert.deepEqual(parseSongPage(null), { hits: [], hasMore: false });
  assert.deepEqual(parseSongPage({ results: 'nope' }), { hits: [], hasMore: false });
  assert.deepEqual(parseSongPage({ results: [{ id: 'x', name: 1 }], next: null }), { hits: [], hasMore: false });
});
