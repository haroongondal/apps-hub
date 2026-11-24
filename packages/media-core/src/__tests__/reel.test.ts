import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { planCompose } from '../compose.ts';
import { MAX_CLIPS, projectProblem } from '../project.ts';
import { MAX_REEL_PHOTOS, parseReelQuery, pickReelPhotos, reelProject, windowText } from '../reel.ts';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
const win = (a: [number, number, number], b: [number, number, number]) => ({ fromMs: at(...a), toMs: at(...b) });
// Wednesday 2026-11-25, mid-afternoon
const WED = new Date(2026, 10, 25, 15, 30);
const SAT = new Date(2026, 10, 28, 9);
const SUN = new Date(2026, 10, 29, 22);

test('date words become a window and the rest is the search', () => {
  assert.deepEqual(parseReelQuery('last weekend', WED), { words: '', window: win([2026, 11, 21], [2026, 11, 23]) });
  assert.deepEqual(parseReelQuery('Beach photos from last weekend', WED), { words: 'beach', window: win([2026, 11, 21], [2026, 11, 23]) });
  assert.deepEqual(parseReelQuery('the beach trip', WED), { words: 'beach trip', window: null });
  assert.deepEqual(parseReelQuery('  ', WED), { words: '', window: null });
});

test('weekends: on a weekday last weekend is the one just gone; at the weekend this one is under way', () => {
  assert.deepEqual(parseReelQuery('this weekend', WED).window, win([2026, 11, 28], [2026, 11, 30]));
  assert.deepEqual(parseReelQuery('this weekend', SAT).window, win([2026, 11, 28], [2026, 11, 30]));
  assert.deepEqual(parseReelQuery('this weekend', SUN).window, win([2026, 11, 28], [2026, 11, 30]));
  assert.deepEqual(parseReelQuery('last weekend', SAT).window, win([2026, 11, 21], [2026, 11, 23]));
  assert.deepEqual(parseReelQuery('last weekend', SUN).window, win([2026, 11, 21], [2026, 11, 23]));
});

test('days, weeks from Monday, months, years and last N days', () => {
  assert.deepEqual(parseReelQuery('today', WED).window, win([2026, 11, 25], [2026, 11, 26]));
  assert.deepEqual(parseReelQuery('cake yesterday', WED), { words: 'cake', window: win([2026, 11, 24], [2026, 11, 25]) });
  assert.deepEqual(parseReelQuery('this week', WED).window, win([2026, 11, 23], [2026, 11, 30]));
  assert.deepEqual(parseReelQuery('last week', SUN).window, win([2026, 11, 16], [2026, 11, 23]));
  assert.deepEqual(parseReelQuery('last month', WED).window, win([2026, 10, 1], [2026, 11, 1]));
  assert.deepEqual(parseReelQuery('last month', new Date(2027, 0, 5)).window, win([2026, 12, 1], [2027, 1, 1]));
  assert.deepEqual(parseReelQuery('this year', WED).window, win([2026, 1, 1], [2027, 1, 1]));
  assert.deepEqual(parseReelQuery('past 7 days', WED).window, win([2026, 11, 19], [2026, 11, 26]));
  assert.equal(parseReelQuery('last 0 days', WED).window, null);
  assert.equal(parseReelQuery('last 400 days', WED).window, null);
});

test('month names: without a year, the latest one that has begun', () => {
  assert.deepEqual(parseReelQuery('March', WED).window, win([2026, 3, 1], [2026, 4, 1]));
  assert.deepEqual(parseReelQuery('snow in december', WED), { words: 'snow', window: win([2025, 12, 1], [2026, 1, 1]) });
  assert.deepEqual(parseReelQuery('aug 2024', WED).window, win([2024, 8, 1], [2024, 9, 1]));
  assert.equal(parseReelQuery('marina', WED).window, null);
});

test('typed dates and ranges, in either order; impossible dates are not a window', () => {
  assert.deepEqual(parseReelQuery('2026-11-01 to 2026-11-15', WED), { words: '', window: win([2026, 11, 1], [2026, 11, 16]) });
  assert.deepEqual(parseReelQuery('hike 2026-11-15 - 2026-11-01', WED), { words: 'hike', window: win([2026, 11, 1], [2026, 11, 16]) });
  assert.deepEqual(parseReelQuery('2026-02-14', WED).window, win([2026, 2, 14], [2026, 2, 15]));
  assert.equal(parseReelQuery('2026-02-30', WED).window, null);
});

test('windowText reads as plain dates', () => {
  assert.equal(windowText(win([2026, 11, 21], [2026, 11, 23])), '21 Nov 2026 to 22 Nov 2026');
  assert.equal(windowText(win([2026, 2, 14], [2026, 2, 15])), '14 Feb 2026');
});

const photo = (n: number, takenAt: number) => ({ uri: `content://media/external/images/media/${n}`, takenAt });

test('pickReelPhotos: oldest first, repeats dropped', () => {
  const got = pickReelPhotos([photo(1, 30), photo(2, 10), photo(1, 30), photo(3, 20)], null);
  assert.deepEqual(got.photos.map(p => p.takenAt), [10, 20, 30]);
  assert.equal(got.more, 0);
});

test('pickReelPhotos: a search keeps its best matches, then runs them oldest first', () => {
  const found = Array.from({ length: 50 }, (_, i) => photo(i, 1000 - i));
  const ranked = found.map(p => p.uri);
  const got = pickReelPhotos(found, ranked);
  assert.equal(got.photos.length, MAX_REEL_PHOTOS);
  assert.equal(got.more, 10);
  assert.deepEqual(new Set(got.photos.map(p => p.uri)), new Set(ranked.slice(0, MAX_REEL_PHOTOS)));
  assert.deepEqual(got.photos.map(p => p.takenAt), [...got.photos.map(p => p.takenAt)].sort((a, b) => a - b));
  assert.deepEqual(pickReelPhotos([photo(9, 1)], ['content://other']).photos, []);
});

test('pickReelPhotos: without words a long window is spread from first to last', () => {
  const found = Array.from({ length: 200 }, (_, i) => photo(i, i));
  const got = pickReelPhotos(found, null);
  assert.equal(got.photos.length, MAX_REEL_PHOTOS);
  assert.equal(got.more, 160);
  assert.equal(got.photos[0].takenAt, 0);
  assert.equal(got.photos[1].takenAt, 5);
  assert.equal(got.photos[MAX_REEL_PHOTOS - 1].takenAt, 195);
});

test('reelProject: each photo is a silent still in a portrait frame, the song starts with the first and stops at the end', () => {
  const uris = ['content://media/external/images/media/1', 'content://media/external/images/media/2'];
  const p = reelProject(uris, 3, 'Reel', { uri: 'file:///song.mp3', name: 'Song', durationS: 60 });
  const planned = planCompose(p);
  assert.ok(planned.ok);
  assert.deepEqual(planned.plan.clips, [
    { uri: uris[0], name: 'Photo 1', inS: 0, outS: 3, hasAudio: false, volume: 1, still: true },
    { uri: uris[1], name: 'Photo 2', inS: 0, outS: 3, hasAudio: false, volume: 1, still: true },
  ]);
  assert.deepEqual(planned.plan.music, [{ uri: 'file:///song.mp3', name: 'Song', inS: 0, outS: 6, startS: 0, volume: 1 }]);
  assert.deepEqual([planned.plan.width, planned.plan.height, planned.plan.fps], [720, 1280, 30]);
  const silent = planCompose(reelProject(uris, 2, 'Reel'));
  assert.ok(silent.ok);
  assert.deepEqual(silent.plan.music, []);
});

test('a reel may hold more photos than a video holds clips, up to its own cap', () => {
  const uris = (n: number) => Array.from({ length: n }, (_, i) => `content://media/external/images/media/${i}`);
  assert.ok(MAX_REEL_PHOTOS > MAX_CLIPS);
  assert.equal(projectProblem(reelProject(uris(MAX_REEL_PHOTOS), 2, 'Reel')), undefined);
  assert.equal(projectProblem(reelProject(uris(MAX_REEL_PHOTOS + 1), 2, 'Reel')), `A video can have up to ${MAX_REEL_PHOTOS} photos.`);
});

test('the reel example shared with the Kotlin tests is what planCompose makes of a reel', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../fixtures/plan-examples.json', import.meta.url), 'utf8')).plans.composeReel;
  const uris = ['content://media/external/images/media/7', 'content://media/external/images/media/9'];
  const got = planCompose(reelProject(uris, 3, 'Reel', { uri: 'content://media/s', name: 's.m4a', durationS: 30 }));
  assert.ok(got.ok);
  assert.deepEqual(got.plan, fixture);
});
