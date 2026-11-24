import test from 'node:test';
import assert from 'node:assert/strict';
import { afterHubReply, isRealReply, onStart } from '../editor/old-keys.ts';

const phone = (marker = false) => {
  const state = { marker, deleted: 0 };
  const deps = {
    markerExists: async () => state.marker,
    writeMarker: async () => void (state.marker = true),
    deleteKeyFiles: async () => void state.deleted++,
  };
  return { state, deps };
};

test('the hub answering available() alone never deletes the saved keys: no marker, nothing deleted on start', async () => {
  const { state, deps } = phone();
  assert.equal(await onStart(deps), false);
  assert.equal(state.deleted, 0);
});

test('a failed or empty chat leaves the keys and the marker alone (the route never calls afterHubReply)', async () => {
  const { state, deps } = phone();
  assert.equal(isRealReply({ text: null, toolCalls: [] }), false);
  assert.equal(isRealReply({ text: '  ', toolCalls: [] }), false);
  assert.equal(await onStart(deps), false);
  assert.deepEqual(state, { marker: false, deleted: 0 });
});

test('the first real reply writes the marker and deletes the saved keys', async () => {
  const { state, deps } = phone();
  assert.equal(isRealReply({ text: 'hi', toolCalls: [] }), true);
  assert.equal(isRealReply({ text: null, toolCalls: [{}] }), true);
  await afterHubReply(deps);
  assert.deepEqual(state, { marker: true, deleted: 1 });
});

test('a later start finishes the deletion when the marker exists', async () => {
  const { state, deps } = phone(true);
  assert.equal(await onStart(deps), true);
  assert.equal(state.deleted, 1);
});

test('when the marker cannot be written the keys stay', async () => {
  const { state, deps } = phone();
  await assert.rejects(afterHubReply({ ...deps, writeMarker: async () => { throw new Error('disk'); } }));
  assert.equal(state.deleted, 0);
});
