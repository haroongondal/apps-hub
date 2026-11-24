import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ImageFile } from '../nexus/hub-first.ts';
import { RECEIPT_PROMPT } from '../nexus/receipt-parse.ts';
import { readReceipt, readScanReceipt } from '../nexus/receipt-read.ts';

const NOW = new Date(2026, 10, 24, 10).getTime();
const file: ImageFile = { uri: 'file:///x.jpg', size: 10, base64: async () => '' };

function fake(reply: string) {
  const calls: { read: ImageFile[]; complete: { system: string; user: string; json: boolean }[] } = { read: [], complete: [] };
  return {
    calls,
    port: {
      readImage: async (f: ImageFile) => {
        calls.read.push(f);
        return 'CORNER CAFE\nTotal 12.50\n20/11/2026';
      },
      complete: async (system: string, user: string, json: boolean) => {
        calls.complete.push({ system, user, json });
        return reply;
      },
    },
  };
}

test('the photo is read once, the text goes out in the fixed prompt, and the fields come back parsed', async () => {
  const f = fake('```json\n{"amount":"12.50","date":"2026-11-20","merchant":"Corner Cafe","warrantyEnd":null}\n```');
  const r = await readReceipt(f.port, file, NOW);
  assert.deepEqual(r, { ok: true, receipt: { amountMinor: 1250, date: '2026-11-20', merchant: 'Corner Cafe' } });
  assert.deepEqual(f.calls.read, [file]);
  assert.equal(f.calls.complete.length, 1);
  assert.equal(f.calls.complete[0].system, RECEIPT_PROMPT);
  assert.equal(f.calls.complete[0].json, true);
  assert.ok(f.calls.complete[0].user.includes('CORNER CAFE'));
});

test('a reply that is not a receipt gives a plain refusal', async () => {
  const r = await readReceipt(fake('Sorry, I cannot help with that.').port, file, NOW);
  assert.equal(r.ok, false);
});

test('a kept-out scan is never read or sent, even when the screen opens from a link', async () => {
  const f = fake('{"amount":"12.50","date":"2026-11-20","merchant":"Corner Cafe","warrantyEnd":null}');
  const asked: string[] = [];
  const steps = (keptOut: boolean) => ({
    keptOut: async () => (asked.push('keep out'), keptOut),
    aiReady: async () => (asked.push('ai'), true),
    firstPage: async () => (asked.push('page'), file),
    port: f.port,
    now: NOW,
  });
  assert.deepEqual(await readScanReceipt(steps(true)), { kind: 'kept-out' });
  assert.deepEqual(asked, ['keep out']);
  assert.deepEqual(f.calls, { read: [], complete: [] });
  assert.equal((await readScanReceipt(steps(false))).kind, 'ready');
  assert.deepEqual(f.calls.read, [file]);
  await assert.rejects(readScanReceipt({ ...steps(false), keptOut: async () => Promise.reject(new Error('db locked')) }), /db locked/);
  assert.equal(f.calls.read.length, 1, 'a failed Keep out check sends nothing');
});
