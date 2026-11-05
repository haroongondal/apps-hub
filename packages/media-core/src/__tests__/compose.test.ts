import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outputSize, planCompose } from '../compose.ts';
import { addClip, emptyProject, type Project, type Source } from '../project.ts';

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
        { uri: 'content://a', name: 'a', inS: 0, outS: 10, hasAudio: true },
        { uri: 'content://b', name: 'b', inS: 0, outS: 4, hasAudio: false },
      ],
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
