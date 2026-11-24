import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AiHubError, type ErrorKind } from 'ai-hub-client/src/contract.ts';

import { hubAi, type Hub } from '../nexus/hub-ai.ts';
import { hubGate } from '../nexus/hub-state.ts';
import { OLD_KEY_NAMES, oldKeyCleanup } from '../nexus/old-keys.ts';

const usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
const chatReply = (text: string) => ({ text, toolCalls: [], usage, model: 'm' });

// The wiring of ai.ts with the phone's storage faked: a marker flag, the removed key names and a hub that answers as told.
function phone(hubOver: Partial<Hub> = {}, marker = false) {
  const removed: string[] = [];
  const store = { marker };
  const cleanup = oldKeyCleanup({
    remove: async (name) => void removed.push(name),
    marked: async () => store.marker,
    mark: async () => void (store.marker = true),
  });
  const hub: Hub = {
    chat: async () => chatReply('an answer'),
    vision: async () => chatReply('image'),
    embed: async (req) => ({ vectors: req.texts.map(() => new Float32Array(512).fill(1)), dims: 512, model: 'gemini-embedding-001' }),
    transcribe: async () => ({ text: '', segments: [] }),
    ...hubOver,
  };
  const ai = hubAi({ hub, onWorked: () => void cleanup.worked().catch(() => {}) });
  // available() answering ok: the gate says ready. It must not touch the keys.
  const gate = hubGate({ check: async () => 'ready' });
  const settle = () => new Promise((r) => setImmediate(r));
  return { ai, gate, cleanup, removed, store, settle };
}

const fail = (kind: ErrorKind) => () => {
  throw new AiHubError(kind, 'hub said no');
};

test('available answering ok, with no successful call, leaves the keys and writes no marker', async () => {
  const p = phone();
  assert.equal(await p.gate.state(), 'ready');
  await p.cleanup.start();
  await p.settle();
  assert.deepEqual(p.removed, []);
  assert.equal(p.store.marker, false);
});

test('a failed hub call leaves the keys, whatever the failure', async () => {
  const kinds: ErrorKind[] = ['hub-missing', 'not-allowed', 'no-key', 'version', 'busy', 'timeout', 'provider-error', 'too-large', 'invalid', 'cancelled'];
  for (const kind of kinds) {
    const p = phone({ chat: fail(kind), embed: fail(kind) });
    await assert.rejects(p.ai.answer('q', ['a']));
    await assert.rejects(p.ai.embed(['a']));
    await p.settle();
    assert.deepEqual(p.removed, [], kind);
    assert.equal(p.store.marker, false, kind);
  }
});

test('an empty reply or an embed of the wrong size is not a success', async () => {
  const p = phone({ chat: async () => chatReply('  '), embed: async (req) => ({ vectors: req.texts.map(() => new Float32Array(768)), dims: 768, model: 'gemini-embedding-001' }) });
  assert.equal(await p.ai.answer('q', ['a']), '  ');
  await assert.rejects(p.ai.embed(['a']));
  await p.settle();
  assert.deepEqual(p.removed, []);
  assert.equal(p.store.marker, false);
});

test('the first successful chat marks the phone and deletes all four old keys, once', async () => {
  const p = phone();
  await p.ai.answer('q', ['a']);
  await p.settle();
  assert.deepEqual(p.removed, [...OLD_KEY_NAMES]);
  assert.equal(p.store.marker, true);
  await p.ai.answer('q', ['a']);
  await p.settle();
  assert.equal(p.removed.length, 4);
});

test('the first successful embed does the same', async () => {
  const p = phone();
  await p.ai.embed(['a']);
  await p.settle();
  assert.deepEqual(p.removed, [...OLD_KEY_NAMES]);
});

test('with the marker from an earlier run, the next start finishes the deletion', async () => {
  const p = phone({}, true);
  await p.cleanup.start();
  assert.deepEqual(p.removed, [...OLD_KEY_NAMES]);
});

test('a removal that fails is tried again on the next success', async () => {
  const removed: string[] = [];
  let failing = true;
  const cleanup = oldKeyCleanup({
    remove: async (name) => {
      if (failing && name === 'groq-api-keys') throw new Error('storage busy');
      removed.push(name);
    },
    marked: async () => true,
    mark: async () => {},
  });
  await assert.rejects(cleanup.worked(), /storage busy/);
  failing = false;
  await cleanup.worked();
  await cleanup.worked();
  assert.deepEqual(removed.slice(-4), [...OLD_KEY_NAMES]);
  assert.equal(removed.length, 1 + 4);
});
