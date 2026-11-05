import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addClip, clipStarts, deleteClip, emptyProject, locate, MAX_CLIPS, moveClip, parseDraft, projectProblem, sourceFrom,
  splitAt, totalS, trimClip, type Project, type Source,
} from '../project.ts';
import type { MediaInfo } from '../types.ts';

const A: Source = { uri: 'content://a', name: 'a.mp4', durationS: 10, width: 1280, height: 720, fps: 30, hasAudio: true };
const B: Source = { uri: 'content://b', name: 'b.mp4', durationS: 4.04, width: 720, height: 1280, fps: 30, hasAudio: false };
const two = (): Project => addClip(addClip(emptyProject(), A, 'a'), B, 'b');
const edges = (p: Project) => p.clips.map(c => [c.id, c.source.uri, c.inS, c.outS]);

test('emptyProject: called My video, no clips', () => {
  assert.deepEqual(emptyProject(), { name: 'My video', clips: [] });
});

test('addClip: appends the whole source, the end floored to a tenth', () => {
  const p = two();
  assert.deepEqual(edges(p), [['a', 'content://a', 0, 10], ['b', 'content://b', 0, 4]]);
  assert.equal(totalS(p), 14);
  assert.deepEqual(clipStarts(p), [0, 10]);
});

test('addClip: the same source twice gives two clips; an id already in use changes nothing', () => {
  const p = addClip(addClip(emptyProject(), A, 'a'), A, 'a2');
  assert.deepEqual(p.clips.map(c => c.id), ['a', 'a2']);
  assert.equal(addClip(p, B, 'a'), p);
});

test('locate: finds the clip and the time inside it; the very end is the last clip end', () => {
  const p = two();
  assert.deepEqual(locate(p, 12), { index: 1, offsetS: 2 });
  assert.deepEqual(locate(p, 14), { index: 1, offsetS: 4 });
  assert.deepEqual(locate(p, 0), { index: 0, offsetS: 0 });
  assert.equal(locate(p, 14.5), undefined);
  assert.equal(locate(p, -1), undefined);
  assert.equal(locate(emptyProject(), 0), undefined);
});

test('splitAt: cuts one clip in two, the length stays the same', () => {
  const p = splitAt(two(), 3.5, 'x');
  assert.deepEqual(edges(p), [['a', 'content://a', 0, 3.5], ['x', 'content://a', 3.5, 10], ['b', 'content://b', 0, 4]]);
  assert.equal(totalS(p), 14);
});

test('splitAt: within a tenth of an edge, on a join, at the ends or with a used id changes nothing', () => {
  const p = two();
  for (const t of [0, 0.05, 9.95, 10, 10.05, 14, 20]) assert.equal(splitAt(p, t, 'x'), p, `at ${t}`);
  assert.equal(splitAt(p, 3.5, 'b'), p);
});

test('splitAt: the two pieces of one clip edit apart', () => {
  const p = trimClip(splitAt(two(), 3.5, 'x'), 'x', 'start', 5);
  assert.deepEqual(edges(p).slice(0, 2), [['a', 'content://a', 0, 3.5], ['x', 'content://a', 5, 10]]);
});

test('trimClip: moves an edge in source time, clamped a tenth from the other edge and to the source', () => {
  const p = trimClip(two(), 'a', 'start', 2);
  assert.deepEqual(edges(p)[0], ['a', 'content://a', 2, 10]);
  assert.equal(totalS(p), 12);
  assert.deepEqual(edges(trimClip(p, 'a', 'end', 1))[0], ['a', 'content://a', 2, 2.1]);
  assert.deepEqual(edges(trimClip(two(), 'a', 'start', 50))[0], ['a', 'content://a', 9.9, 10]);
  assert.deepEqual(edges(trimClip(two(), 'b', 'end', 9))[1], ['b', 'content://b', 0, 4]);
});

test('moveClip: swaps with the neighbour; at either end it changes nothing', () => {
  const p = two();
  assert.deepEqual(moveClip(p, 'b', -1).clips.map(c => c.id), ['b', 'a']);
  assert.equal(moveClip(p, 'a', -1), p);
  assert.equal(moveClip(p, 'b', 1), p);
  assert.equal(moveClip(p, 'nope', 1), p);
});

test('deleteClip: removes the clip', () => {
  const p = deleteClip(deleteClip(two(), 'b'), 'a');
  assert.equal(p.clips.length, 0);
  assert.equal(totalS(p), 0);
});

test('projectProblem: empty, too many clips, too long, or fine', () => {
  assert.equal(projectProblem(emptyProject()), 'Add a clip first.');
  let many = emptyProject();
  for (let i = 0; i <= MAX_CLIPS; i++) many = addClip(many, B, `c${i}`);
  assert.equal(projectProblem(many), 'A video can have up to 20 clips.');
  assert.equal(projectProblem(addClip(emptyProject(), { ...A, durationS: 601 }, 'l')), 'A video can be up to 10 minutes long.');
  assert.equal(projectProblem(addClip(emptyProject(), { ...A, durationS: 600 }, 'l')), undefined);
  assert.equal(projectProblem(two()), undefined);
});

const info = (tracks: MediaInfo['tracks'], durationS = 12.37): MediaInfo =>
  ({ id: 'content://v', name: 'v.mp4', bytes: 1, durationS, container: 'mp4', tracks });

test('sourceFrom: display size after turning, length floored to a tenth, sound noted', () => {
  const s = sourceFrom(info([
    { index: 0, kind: 'video', codec: 'h264', width: 1920, height: 1080, fps: 60, rotation: 90 },
    { index: 1, kind: 'audio', codec: 'aac' },
  ]));
  assert.deepEqual(s, { uri: 'content://v', name: 'v.mp4', durationS: 12.3, width: 1080, height: 1920, fps: 60, hasAudio: true });
  assert.equal(sourceFrom(info([{ index: 0, kind: 'video', codec: 'h264', width: 640, height: 480 }], 4.3))?.durationS, 4.3);
});

test('sourceFrom: no picture, or shorter than a tenth, gives nothing', () => {
  assert.equal(sourceFrom(info([{ index: 0, kind: 'audio', codec: 'aac' }])), undefined);
  assert.equal(sourceFrom(info([{ index: 0, kind: 'video', codec: 'h264', width: 640, height: 480 }], 0.05)), undefined);
});

test('parseDraft: round-trips a project', () => {
  const p = splitAt(two(), 3.5, 'x');
  assert.deepEqual(parseDraft(JSON.stringify(p)), p);
});

test('parseDraft: anything malformed gives nothing', () => {
  const good = JSON.parse(JSON.stringify(two()));
  const bad = (f: (d: any) => void) => { const d = structuredClone(good); f(d); return JSON.stringify(d); };
  for (const text of [
    'nope', 'null', '[]', '{"clips":[{"id":1}]}',
    bad(d => { d.clips[0].inS = 'x'; }),
    bad(d => { d.clips[0].outS = -1; }),
    bad(d => { d.clips[0].outS = 1e999; }),
    bad(d => { d.clips[1].id = 'a'; }),
    bad(d => { d.clips[0].source.uri = 7; }),
    bad(d => { d.clips[0].source.hasAudio = 'yes'; }),
    bad(d => { delete d.name; }),
  ]) assert.equal(parseDraft(text), undefined, text);
});
