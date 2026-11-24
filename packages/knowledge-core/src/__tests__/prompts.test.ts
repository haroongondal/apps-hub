import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EMBED_DIMS, EMBED_TAG, unit } from '../embedding.ts';
import { answerMessages, extractMessages } from '../prompts.ts';

test('unit cuts a longer vector to 512 dimensions and normalises it', () => {
  const v = unit(Array.from({ length: 3072 }, () => 2));
  assert.equal(v.length, EMBED_DIMS);
  assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-5);
  assert.deepEqual([...unit([0, 0])], [0, 0]); // a zero vector stays zero instead of dividing by zero
});

test('the embedding tag names the model and size, so a change re-embeds everything', () => {
  assert.equal(EMBED_TAG, 'gemini-embedding-001@512');
});

test('extract numbers the segments from 0 and answer numbers the sources from 1', () => {
  const [, graph] = extractMessages(['first', 'second']);
  assert.equal(graph.content, '[0] first\n\n[1] second');
  const [, ask] = answerMessages('why?', ['a', 'b']);
  assert.ok(ask.content.includes('[1] a\n[2] b'));
});
