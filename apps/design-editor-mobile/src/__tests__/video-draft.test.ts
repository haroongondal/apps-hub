import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addClip, addMusic, emptyProject, splitAt, type AudioSource, type Source } from '@apps-hub/media-core';
import { droppedNote, dropUnreadable, queued, restoreDraft } from '../video/draft.ts';

const src = (n: string): Source => ({ uri: `content://${n}`, name: `${n}.mp4`, durationS: 5, width: 1280, height: 720, fps: 30, hasAudio: true });
const draft = (...names: string[]) => JSON.stringify(names.reduce((p, n, i) => addClip(p, src(n), `c${i}`), emptyProject()));

test('restoreDraft: clips whose file cannot be opened any more are removed and counted', async () => {
  const got = await restoreDraft(draft('a', 'gone', 'b'), async uri => uri !== 'content://gone');
  assert.deepEqual(got.project.clips.map(c => c.id), ['c0', 'c2']);
  assert.equal(got.dropped, 1);
});

test('restoreDraft: each file is checked once, and a check that fails counts as gone', async () => {
  const asked: string[] = [];
  const got = await restoreDraft(draft('a', 'a', 'b'), async uri => { asked.push(uri); if (uri === 'content://b') throw new Error('no access'); return true; });
  assert.deepEqual(asked, ['content://a', 'content://b']);
  assert.deepEqual([got.project.clips.length, got.dropped], [2, 1]);
});

test('restoreDraft: a missing or malformed draft gives an empty project', async () => {
  for (const text of [undefined, 'nope', '{"clips":[{"id":1}]}']) {
    assert.deepEqual(await restoreDraft(text, async () => true), { project: emptyProject(), dropped: 0 });
  }
});

test('dropUnreadable: Save checks every clip first, so a deleted file never starts a job', async () => {
  const p = JSON.parse(draft('a', 'gone'));
  const got = await dropUnreadable(p, async uri => uri !== 'content://gone');
  assert.deepEqual([got.project.clips.map(c => c.id), got.dropped], [['c0'], 1]);
  assert.equal(droppedNote(1), '1 file could not be opened and was taken out of the video.');
  assert.equal(droppedNote(3), '3 files could not be opened and were taken out of the video.');
});

test('queued: saves run one at a time in the order asked, and a failed one does not stop the next', async () => {
  const log: string[] = [];
  const open: Record<string, () => void> = {};
  const tick = () => new Promise(r => setTimeout(r, 0));
  const save = queued(async (s: string) => {
    log.push(`start ${s}`);
    await new Promise<void>(r => { open[s] = r; });
    if (s === 'b') throw new Error('disk full');
    log.push(`end ${s}`);
  });
  const a = save('a'), b = save('b'), c = save('c');
  await tick();
  assert.deepEqual(log, ['start a']);
  open.a(); await a; await tick();
  open.b(); await assert.rejects(b); await tick();
  open.c(); await c;
  assert.deepEqual(log, ['start a', 'end a', 'start b', 'start c', 'end c']);
});

const song = (n: string): AudioSource => ({ uri: `content://${n}`, name: `${n}.m4a`, durationS: 3 });
const withMusic = (clips: string[], music: string[]) => {
  let p = JSON.parse(draft(...clips));
  music.forEach((n, i) => { p = addMusic(p, song(n), `m${i}`, i * 3); });
  return p;
};

test('dropUnreadable: music whose file cannot be opened is removed too, counted with the clips', async () => {
  const got = await dropUnreadable(withMusic(['a', 'gone'], ['s', 'lost']), async uri => !['content://gone', 'content://lost'].includes(uri));
  assert.deepEqual(got.project.clips.map(c => c.id), ['c0']);
  assert.deepEqual(got.project.music.map(m => m.id), ['m0']);
  assert.equal(got.dropped, 2);
});

test('restoreDraft: music whose file is gone is removed and the clips stay', async () => {
  const got = await restoreDraft(JSON.stringify(withMusic(['a', 'b'], ['lost'])), async uri => uri !== 'content://lost');
  assert.deepEqual(got.project.clips.map(c => c.id), ['c0', 'c1']);
  assert.deepEqual(got.project.music, []);
  assert.equal(got.dropped, 1);
});

test('dropUnreadable: the count is of files, so a cut clip whose file is gone counts once', async () => {
  const p = splitAt(splitAt(JSON.parse(draft('gone', 'a')), 1, 'x'), 3, 'y');
  const got = await dropUnreadable(p, async uri => uri !== 'content://gone');
  assert.deepEqual(got.project.clips.map(c => c.id), ['c1']);
  assert.equal(got.dropped, 1);
});
