import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addClip, emptyProject, type Source } from '@apps-hub/media-core';
import { restoreDraft } from '../video/draft.ts';

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
