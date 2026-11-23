import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortsToWatch } from '../tidy.ts';

test('shortsToWatch turns a Shorts address into the watch address', () => {
  assert.equal(shortsToWatch('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(shortsToWatch('https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(shortsToWatch('https://www.youtube.com/shorts/dQw4w9WgXcQ/?x=1#t'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('shortsToWatch gives null for anything else', () => {
  for (const url of [
    'https://www.youtube.com/shorts/',
    'https://www.youtube.com/shorts/short',
    'https://www.youtube.com/shorts/dQw4w9WgXcQextra',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    '/shorts/dQw4w9WgXcQ',
    'https://m.youtube.com/shorts/dQw4w9WgXcQ',
    'https://example.com/shorts/dQw4w9WgXcQ',
    'http://www.youtube.com/shorts/dQw4w9WgXcQ',
    'not a url',
  ]) assert.equal(shortsToWatch(url), null, url);
});
