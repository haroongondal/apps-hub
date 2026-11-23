import assert from 'node:assert/strict';
import { test } from 'node:test';

import { captureTitle } from '../nexus/labels.ts';
import { formatElapsed, meetingState, parseSession, sessionText } from '../nexus/meeting-session.ts';

const ID = 'mi0abc12def34567';

test('a session survives the round trip through its file', () => {
  const s = { startedAt: 1_763_900_000_000, itemId: null };
  assert.deepEqual(parseSession(sessionText(s)), s);
  assert.deepEqual(parseSession(sessionText({ ...s, itemId: ID })), { ...s, itemId: ID });
});

test('a damaged or foreign session file reads as no session', () => {
  for (const text of ['', '{', 'null', '[]', '{"v":2,"startedAt":1,"itemId":null}', '{"v":1,"startedAt":"1","itemId":null}', '{"v":1,"startedAt":1e400,"itemId":null}', '{"v":1,"startedAt":1,"itemId":"../x"}', '{"v":1,"startedAt":1}']) {
    assert.equal(parseSession(text), null, text);
  }
});

test('a running recording wins over anything on disk', () => {
  assert.equal(meetingState({ recording: true, session: null, audioBytes: 0, itemSaved: false }), 'recording');
  assert.equal(meetingState({ recording: true, session: { startedAt: 1, itemId: ID }, audioBytes: 9, itemSaved: true }), 'recording');
});

test('a stopped or killed recording with sound in it is offered for saving', () => {
  assert.equal(meetingState({ recording: false, session: { startedAt: 1, itemId: null }, audioBytes: 4096, itemSaved: false }), 'unsaved');
  assert.equal(meetingState({ recording: false, session: { startedAt: 1, itemId: ID }, audioBytes: 4096, itemSaved: false }), 'unsaved'); // a save that failed half way
  assert.equal(meetingState({ recording: false, session: null, audioBytes: 4096, itemSaved: false }), 'unsaved'); // damaged session file: keep the sound
});

test('a meeting already in the library, or with no sound, is only cleaned up', () => {
  assert.equal(meetingState({ recording: false, session: { startedAt: 1, itemId: ID }, audioBytes: 4096, itemSaved: true }), 'saved');
  assert.equal(meetingState({ recording: false, session: { startedAt: 1, itemId: null }, audioBytes: 0, itemSaved: false }), 'empty');
  assert.equal(meetingState({ recording: false, session: null, audioBytes: 0, itemSaved: false }), 'none');
});

test('elapsed time reads as minutes and seconds, then hours', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(999), '0:00');
  assert.equal(formatElapsed(65_000), '1:05');
  assert.equal(formatElapsed(59 * 60_000 + 59_999), '59:59');
  assert.equal(formatElapsed(3_723_000), '1:02:03');
  assert.equal(formatElapsed(10 * 3_600_000), '10:00:00');
  assert.equal(formatElapsed(-5), '0:00');
  assert.equal(formatElapsed(Number.NaN), '0:00');
});

test('a meeting is titled by when it started', () => {
  assert.equal(captureTitle('meeting', new Date(2026, 10, 23, 14, 7)), 'Meeting, 23 Nov 14:07');
});
