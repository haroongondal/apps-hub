import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outputSize, planCompose } from '../compose.ts';
import { readFileSync } from 'node:fs';
import { addClip, addMusic, emptyProject, setClipVolume, setMusicVolume, type AudioSource, type Music, type Project, type Source } from '../project.ts';

const src = (name: string, durationS: number, width: number, height: number, fps = 30, hasAudio = true): Source =>
  ({ uri: `content://${name}`, name, durationS, width, height, fps, hasAudio });
const proj = (...sources: Source[]): Project => sources.reduce((p, s, i) => addClip(p, s, `c${i}`), emptyProject());

test('outputSize: the first clip sets the shape; short side at most 1080, even sides', () => {
  assert.deepEqual(outputSize(proj(src('a', 5, 1280, 720))), { width: 1280, height: 720 });
  assert.deepEqual(outputSize(proj(src('a', 5, 3840, 2160))), { width: 1920, height: 1080 });
  assert.deepEqual(outputSize(proj(src('a', 5, 720, 1280), src('b', 5, 1920, 1080))), { width: 720, height: 1280 });
  assert.deepEqual(outputSize(proj(src('a', 5, 1081, 721))), { width: 1080, height: 720 });
  assert.deepEqual(outputSize(emptyProject()), { width: 0, height: 0 });
});

test('planCompose: every clip travels in the plan, with the size, rate and planned size', () => {
  const got = planCompose(proj(src('a', 10, 1280, 720), src('b', 4, 1280, 720, 30, false)));
  assert.deepEqual(got, {
    ok: true,
    plan: {
      tool: 'compose',
      clips: [
        { uri: 'content://a', name: 'a', inS: 0, outS: 10, hasAudio: true, volume: 1 },
        { uri: 'content://b', name: 'b', inS: 0, outS: 4, hasAudio: false, volume: 1 },
      ],
      music: [],
      width: 1280, height: 720, fps: 30, videoBps: 2_764_800, plannedBytes: 5_174_400, ext: 'mp4',
    },
  });
});

test('planCompose: the rate is the fastest clip, at most 30, a whole number', () => {
  const fps = (...rates: number[]) => {
    const r = planCompose(proj(...rates.map((f, i) => src(`s${i}`, 2, 1280, 720, f))));
    return r.ok ? r.plan.fps : undefined;
  };
  assert.equal(fps(24, 60), 30);
  assert.equal(fps(24), 24);
  assert.equal(fps(23.976), 24);
  assert.equal(fps(29.97, 25), 30);
});

test('planCompose: a project with a problem is refused with its plain words', () => {
  assert.deepEqual(planCompose(emptyProject()), { ok: false, reason: 'invalid', detail: 'Add a clip first.' });
});

const song: AudioSource = { uri: 'content://s', name: 's.m4a', durationS: 30 };
const p14 = () => proj(src('a', 10, 1280, 720), src('b', 4, 1280, 720, 30, false));
const piece = (startS: number, inS: number, outS: number): Music => ({ id: `m${startS}`, source: song, inS, outS, startS, volume: 1 });
const planned = (p: Project) => { const r = planCompose(p); assert.ok(r.ok); return r.plan; };

test('planCompose: music travels in the plan with its place, its part of the file and its volume', () => {
  const plan = planned(setMusicVolume(addMusic(p14(), song, 'm1', 3), 'm1', 0.5));
  assert.deepEqual(plan.music, [{ uri: 'content://s', name: 's.m4a', inS: 0, outS: 11, startS: 3, volume: 0.5 }]);
});

test('planCompose: music running past the video is cut at its end; music starting at or after the end is left out', () => {
  assert.deepEqual(planned({ ...p14(), music: [piece(10, 10, 20)] }).music.map(m => [m.startS, m.inS, m.outS]), [[10, 10, 14]]);
  assert.deepEqual(planned({ ...p14(), music: [piece(14, 0, 1), piece(16, 0, 1)] }).music, []);
});

test('planCompose: clips carry their volume; music does not change the planned size', () => {
  const p = setClipVolume(p14(), 'c0', 0);
  assert.deepEqual(planned(p).clips.map(c => c.volume), [0, 1]);
  assert.equal(planned(addMusic(p, song, 'm1', 0)).plannedBytes, planned(p).plannedBytes);
});

test('the compose example shared with the Kotlin tests is what planCompose makes', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../fixtures/plan-examples.json', import.meta.url), 'utf8')).plans.compose;
  const media = (name: string, durationS: number, hasAudio: boolean): Source =>
    ({ uri: `content://media/${name}`, name: `${name}.mp4`, durationS, width: 1920, height: 1080, fps: 30, hasAudio });
  let p = setClipVolume(addClip(addClip(emptyProject(), media('a', 10, true), 'a'), media('b', 4, false), 'b'), 'a', 1.5);
  p = setMusicVolume(addMusic(p, { uri: 'content://media/s', name: 's.m4a', durationS: 30 }, 'm1', 3), 'm1', 0.5);
  assert.deepEqual(planned(p), fixture);
});
