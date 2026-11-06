import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addClip, addMusic, audioSourceFrom, clipSpans, clipStarts, deleteClip, deleteMusic, emptyProject, locate, MAX_CLIPS, MAX_MUSIC,
  moveClip, moveMusic, musicEndS, musicLengthS, musicSpans, parseDraft, projectProblem, setClipVolume, setMusicVolume, sourceFrom, splitAt,
  totalS, trimAt, trimClip, trimMusic, trimMusicAt, VOLUME_STEPS, type AudioSource, type Music, type Project, type Source,
} from '../project.ts';
import type { MediaInfo } from '../types.ts';

const A: Source = { uri: 'content://a', name: 'a.mp4', durationS: 10, width: 1280, height: 720, fps: 30, hasAudio: true };
const B: Source = { uri: 'content://b', name: 'b.mp4', durationS: 4.04, width: 720, height: 1280, fps: 30, hasAudio: false };
const two = (): Project => addClip(addClip(emptyProject(), A, 'a'), B, 'b');
const edges = (p: Project) => p.clips.map(c => [c.id, c.source.uri, c.inS, c.outS]);

test('emptyProject: called My video, no clips', () => {
  assert.deepEqual(emptyProject(), { name: 'My video', clips: [], music: [] });
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

test('clipSpans: each clip as a block on the strip, never thinner than one pixel', () => {
  assert.deepEqual(clipSpans(two(), 20), [{ id: 'a', leftPx: 0, widthPx: 200 }, { id: 'b', leftPx: 200, widthPx: 80 }]);
  assert.deepEqual(clipSpans(emptyProject(), 20), []);
  assert.deepEqual(clipSpans(addClip(emptyProject(), { ...A, durationS: 0.1 }, 't'), 1), [{ id: 't', leftPx: 0, widthPx: 1 }]);
});

test('trimAt: trims the clip under the line; within a tenth of its ends (a join, the very end) it changes nothing', () => {
  const p = two();
  assert.deepEqual(edges(trimAt(p, 12, 'start'))[1], ['b', 'content://b', 2, 4]);
  assert.deepEqual(edges(trimAt(p, 3, 'end'))[0], ['a', 'content://a', 0, 3]);
  for (const [t, edge] of [[10, 'end'], [10, 'start'], [14, 'start'], [14, 'end'], [0.05, 'end'], [9.95, 'start'], [20, 'end']] as const) {
    assert.equal(trimAt(p, t, edge), p, `${edge} at ${t}`);
  }
});

const S: AudioSource = { uri: 'content://s', name: 's.m4a', durationS: 30 };
const S5: AudioSource = { ...S, uri: 'content://s5', durationS: 5 };
const S1: AudioSource = { ...S, uri: 'content://s1', durationS: 1 };
const piece = (id: string, startS: number, inS: number, outS: number, source = S): Music => ({ id, source, inS, outS, startS, volume: 1 });
const withMusic = (...music: Music[]): Project => ({ ...two(), music });
const spans = (p: Project) => p.music.map(m => [m.id, m.startS, m.inS, m.outS]);

test('volume: steps and limits', () => {
  assert.deepEqual(VOLUME_STEPS, [0, 0.5, 1, 1.5]);
  assert.equal(MAX_MUSIC, 5);
});

test('addClip and splitAt: a new clip plays at Normal, a split keeps its parent volume', () => {
  assert.deepEqual(two().clips.map(c => c.volume), [1, 1]);
  const p = splitAt(setClipVolume(two(), 'a', 0.5), 3.5, 'x');
  assert.deepEqual(p.clips.map(c => [c.id, c.volume]), [['a', 0.5], ['x', 0.5], ['b', 1]]);
});

test('setClipVolume and setMusicVolume: up to Loud; above, below or not a number changes nothing', () => {
  assert.equal(setClipVolume(two(), 'a', 1.5).clips[0].volume, 1.5);
  assert.equal(setClipVolume(two(), 'a', 0).clips[0].volume, 0);
  const m = withMusic(piece('m1', 0, 0, 5));
  assert.equal(setMusicVolume(m, 'm1', 0.5).music[0].volume, 0.5);
  for (const v of [2, -1, NaN, Infinity]) {
    const p = two();
    assert.equal(setClipVolume(p, 'a', v), p, `clip ${v}`);
    assert.equal(setMusicVolume(m, 'm1', v), m, `music ${v}`);
  }
});

test('addMusic: starts at the playhead, cut to the room left in the video', () => {
  const p = addMusic(two(), S, 'm1', 3);
  assert.deepEqual(p.music, [{ id: 'm1', source: S, inS: 0, outS: 11, startS: 3, volume: 1 }]);
  assert.equal(musicLengthS(p.music[0]), 11);
  assert.equal(musicEndS(p.music[0]), 14);
  assert.deepEqual(spans(addMusic(two(), S5, 'm1', 0)), [['m1', 0, 0, 5]]);
  for (const at of [14, 13.95, 20, -1, NaN]) { const q = two(); assert.equal(addMusic(q, S, 'm1', at), q, `at ${at}`); }
});

test('addMusic: inside a piece it starts after it; no room, a sixth piece or a used id changes nothing', () => {
  const full = addMusic(two(), S, 'm1', 3);
  assert.equal(addMusic(full, S, 'm2', 5), full);
  const short = addMusic(two(), S5, 'm1', 3);
  assert.deepEqual(spans(addMusic(short, S, 'm2', 5)), [['m1', 3, 0, 5], ['m2', 8, 0, 6]]);
  assert.equal(addMusic(short, S, 'm1', 9), short);
  let five = two();
  for (let i = 0; i < MAX_MUSIC; i++) five = addMusic(five, S1, `m${i}`, i);
  assert.equal(five.music.length, 5);
  assert.equal(addMusic(five, S1, 'm9', 8), five);
});

test('addMusic: never runs into the next piece', () => {
  const later = addMusic(two(), S5, 'm1', 10);
  assert.deepEqual(spans(addMusic(later, S, 'm2', 3)), [['m1', 10, 0, 4], ['m2', 3, 0, 7]]);
});

test('trimMusic: a start trim keeps the sound under the end in place; the end clamps to a tenth and to the song', () => {
  const p = addMusic(two(), S, 'm1', 3);
  const t = trimMusic(p, 'm1', 'start', 4);
  assert.deepEqual(spans(t), [['m1', 7, 4, 11]]);
  assert.equal(musicEndS(t.music[0]), 14);
  assert.deepEqual(spans(trimMusic(t, 'm1', 'end', 2)), [['m1', 7, 4, 4.1]]);
  assert.deepEqual(spans(trimMusic(p, 'm1', 'end', 50)), [['m1', 3, 0, 30]]);
  assert.deepEqual(spans(trimMusic(t, 'm1', 'start', 0)), [['m1', 3, 0, 11]]);
});

test('trimMusic: never reaches into a neighbour or before the video start', () => {
  const p = withMusic(piece('m1', 0, 0, 5), piece('m2', 7, 10, 14));
  assert.deepEqual(spans(trimMusic(p, 'm2', 'start', 0))[1], ['m2', 5, 8, 14]);
  assert.deepEqual(spans(trimMusic(p, 'm1', 'end', 30))[0], ['m1', 0, 0, 7]);
  assert.deepEqual(spans(trimMusic(withMusic(piece('m1', 2, 6, 9)), 'm1', 'start', 0)), [['m1', 0, 4, 9]]);
});

test('moveMusic: moves the start; an overlap or a piece past the video end changes nothing', () => {
  const short = addMusic(two(), S5, 'm1', 3);
  assert.deepEqual(spans(moveMusic(short, 'm1', 0)), [['m1', 0, 0, 5]]);
  const full = addMusic(two(), S, 'm1', 3);
  assert.equal(moveMusic(full, 'm1', 4), full);
  const p = withMusic(piece('m1', 0, 0, 5), piece('m2', 7, 0, 4));
  assert.equal(moveMusic(p, 'm2', 4), p);
  assert.deepEqual(spans(moveMusic(p, 'm1', 2))[0], ['m1', 2, 0, 5]);
  assert.equal(moveMusic(p, 'm1', -1), p);
});

test('deleteMusic: removes the piece', () => {
  assert.deepEqual(deleteMusic(withMusic(piece('m1', 0, 0, 5), piece('m2', 7, 0, 4)), 'm1').music.map(m => m.id), ['m2']);
});

test('audioSourceFrom: a file with sound, its length floored to a tenth; no sound or too short gives nothing', () => {
  const a = { ...info([{ index: 0, kind: 'audio', codec: 'aac' }], 3.04), id: 'content://s', name: 's.m4a' };
  assert.deepEqual(audioSourceFrom(a), { uri: 'content://s', name: 's.m4a', durationS: 3 });
  assert.equal(audioSourceFrom(info([{ index: 0, kind: 'video', codec: 'h264', width: 640, height: 480 }])), undefined);
  assert.equal(audioSourceFrom(info([{ index: 0, kind: 'audio', codec: 'aac' }], 0.05)), undefined);
});

test('projectProblem: overlapping music, or more than five pieces', () => {
  assert.equal(projectProblem(withMusic(piece('m1', 0, 0, 5), piece('m2', 4, 0, 4))), 'Music pieces cannot overlap.');
  const six = withMusic(...[0, 1, 2, 3, 4, 5].map(i => piece(`m${i}`, i * 2, 0, 1)));
  assert.equal(projectProblem(six), 'A video can have up to 5 pieces of music.');
  assert.equal(projectProblem(withMusic(piece('m1', 0, 0, 5), piece('m2', 5, 0, 4))), undefined);
});

test('parseDraft: a stage 2 draft opens at Normal volume with no music; a project with music round-trips', () => {
  const old = { name: 'My video', clips: two().clips.map(({ volume: _v, ...c }) => c) };
  const p = parseDraft(JSON.stringify(old));
  assert.deepEqual(p?.clips.map(c => c.volume), [1, 1]);
  assert.deepEqual(p?.music, []);
  const full = setClipVolume(withMusic(piece('m1', 0, 2, 7), { ...piece('m2', 7, 0, 4, S5), volume: 0.5 }), 'b', 0);
  assert.deepEqual(parseDraft(JSON.stringify(full)), full);
});

test('parseDraft: a bad volume, music past its source, overlapping or malformed music gives nothing', () => {
  const good = JSON.parse(JSON.stringify(withMusic(piece('m1', 0, 0, 5), piece('m2', 7, 0, 4))));
  const bad = (f: (d: any) => void) => { const d = structuredClone(good); f(d); return JSON.stringify(d); };
  for (const text of [
    bad(d => { d.clips[0].volume = -1; }),
    bad(d => { d.clips[0].volume = 1.6; }),
    bad(d => { d.clips[0].volume = 'loud'; }),
    bad(d => { d.music[0].volume = 2; }),
    bad(d => { delete d.music[0].volume; }),
    bad(d => { d.music[0].outS = 31; }),
    bad(d => { d.music[0].inS = -1; }),
    bad(d => { d.music[0].startS = -1; }),
    bad(d => { d.music[1].startS = 4; }),
    bad(d => { d.music[1].id = 'm1'; }),
    bad(d => { d.music[0].source.durationS = 0; }),
    bad(d => { d.music = {}; }),
  ]) assert.equal(parseDraft(text), undefined, text);
});

test('musicSpans: each piece as a block under the clips, cut at the video end, never thinner than one pixel', () => {
  assert.deepEqual(musicSpans(withMusic(piece('m1', 3, 0, 8)), 20), [{ id: 'm1', leftPx: 60, widthPx: 160 }]);
  assert.deepEqual(musicSpans(two(), 20), []);
  assert.deepEqual(musicSpans(withMusic(piece('m1', 0, 0, 0.1)), 1), [{ id: 'm1', leftPx: 0, widthPx: 1 }]);
  assert.deepEqual(musicSpans(withMusic(piece('m1', 10, 0, 10)), 10), [{ id: 'm1', leftPx: 100, widthPx: 40 }]);
  assert.deepEqual(musicSpans(withMusic(piece('m1', 16, 0, 2)), 10), [{ id: 'm1', leftPx: 160, widthPx: 1 }]);
});

test('trimMusicAt: Start here and End here move the chosen piece to the line, also outward; at or past its far end nothing changes', () => {
  const p = withMusic(piece('m1', 3, 2, 8)); // on the video from 3 to 9
  assert.deepEqual(spans(trimMusicAt(p, 'm1', 5, 'start')), [['m1', 5, 4, 8]]);
  assert.deepEqual(spans(trimMusicAt(p, 'm1', 1, 'start')), [['m1', 1, 0, 8]]);
  assert.deepEqual(spans(trimMusicAt(p, 'm1', 7, 'end')), [['m1', 3, 2, 6]]);
  assert.deepEqual(spans(trimMusicAt(p, 'm1', 12, 'end')), [['m1', 3, 2, 11]]);
  for (const [t, edge] of [[9, 'start'], [8.95, 'start'], [13, 'start'], [3, 'end'], [3.05, 'end'], [1, 'end']] as const) {
    assert.equal(trimMusicAt(p, 'm1', t, edge), p, `${edge} at ${t}`);
  }
  assert.equal(trimMusicAt(p, 'nope', 5, 'start'), p);
});
