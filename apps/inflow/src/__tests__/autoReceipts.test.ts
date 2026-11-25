import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Txn } from 'inflow-core';
import { AUTO, autoChoice, runAutoReceipts, type AutoPorts, type Photo } from '../autoReceipts.ts';

const NOW = 10 * 24 * 60 * 60 * 1000;
const txn = (over: Partial<Txn> = {}): Txn => ({
  id: 1, direction: 'out', amount: 500000, currency: 'PKR', account: 'Alfalah 2310', counterparty: 'Some Person', txId: 'FT26307AAAAAAAAA',
  at: NOW - 60 * 60_000, own: false, paired: false, itemIds: [7], category: null, categorySet: false, label: null, byAi: false, ...over,
});

test('the amount alone is not enough; the amount with a payment word is', () => {
  const t = txn({ counterparty: null, txId: null });
  const photos = [{ uri: 'a', takenAt: t.at + 1000, text: 'Balance 5,000.00' }];
  assert.equal(autoChoice(photos, t), null);
  assert.equal(autoChoice([{ uri: 'b', takenAt: t.at + 1000, text: 'Transfer successful Rs 5,000' }], t), 'b');
});

test('a different amount never matches, whatever else the photo says', () => {
  assert.equal(autoChoice([{ uri: 'a', takenAt: NOW, text: 'Transfer successful to Some Person Rs 4,000' }], txn()), null);
});

test('the Tx ID counts as evidence even with spaces and dashes in it', () => {
  const t = txn({ counterparty: null });
  assert.equal(autoChoice([{ uri: 'a', takenAt: NOW, text: 'Amount 5,000 ID FT-26307 AAAAAAAAA' }], t), 'a');
});

test('the stronger match wins, then the one nearest the payment', () => {
  const t = txn();
  const read = [
    { uri: 'far', takenAt: t.at + 9000, text: 'Rs 5,000 successful' },
    { uri: 'near', takenAt: t.at + 1000, text: 'Rs 5,000 successful' },
    { uri: 'strong', takenAt: t.at + 5000, text: 'Rs 5,000 successful to Some Person FT26307AAAAAAAAA' },
  ];
  assert.equal(autoChoice(read, t), 'strong');
  assert.equal(autoChoice(read.slice(0, 2), t), 'near');
});

function ports(over: Partial<Omit<AutoPorts, "photos">> & { txns: Txn[]; photos: Photo[]; text: Record<string, string> }) {
  const { txns, photos, text, ...override } = over;
  const attached: Array<[number, string]> = [];
  const reads: string[] = [];
  const p: AutoPorts = {
    now: () => NOW,
    recentOut: () => txns,
    hasReceipt: () => false,
    photos: (from, to) => photos.filter((x) => x.takenAt >= from && x.takenAt <= to),
    read: async (uri) => {
      reads.push(uri);
      return text[uri] ?? '';
    },
    attach: (id, uri) => void attached.push([id, uri]),
    ...override,
  };
  return { p, attached, reads };
}

test('a matching screenshot is attached to the first source of the payment', async () => {
  const t = txn();
  const { p, attached } = ports({ txns: [t], photos: [{ uri: 'shot', takenAt: t.at + 60_000 }], text: { shot: 'Sent Rs 5,000 to Some Person' } });
  assert.equal(await runAutoReceipts(p, new Map(), () => true), 1);
  assert.deepEqual(attached, [[7, 'shot']]);
});

test('payments that have a receipt, are older than three days, or came in are not searched', async () => {
  const photos = [{ uri: 'shot', takenAt: NOW - 1000 }];
  const text = { shot: 'Sent Rs 5,000 to Some Person' };
  const old = txn({ at: NOW - 4 * 24 * 60 * 60 * 1000 });
  const { p, reads } = ports({ txns: [txn({ direction: 'in' }), old], photos, text });
  assert.equal(await runAutoReceipts(p, new Map(), () => true), 0);
  assert.equal(reads.length, 0);
  const done = ports({ txns: [txn()], photos, text, hasReceipt: () => true });
  assert.equal(await runAutoReceipts(done.p, new Map(), () => true), 0);
  assert.equal(done.reads.length, 0);
});

test('a photo is read once however many runs or payments look at it', async () => {
  const a = txn({ id: 1, itemIds: [7], amount: 500000 });
  const b = txn({ id: 2, itemIds: [8], amount: 120000, at: a.at + 60_000 });
  const { p, reads } = ports({ txns: [b, a], photos: [{ uri: 'shot', takenAt: a.at + 120_000 }], text: { shot: 'Sent Rs 5,000 to Some Person' } });
  const cache = new Map<string, string>();
  await runAutoReceipts(p, cache, () => true);
  await runAutoReceipts(p, cache, () => true);
  assert.deepEqual(reads, ['shot']);
});

test('one run reads only so many photos and the next run carries on', async () => {
  const t = txn();
  const photos = Array.from({ length: AUTO.readsPerRun + 3 }, (_, i) => ({ uri: `p${i}`, takenAt: t.at + 1000 * (i + 1) }));
  const text = { [photos[0].uri]: 'Sent Rs 5,000 to Some Person' };   // the oldest photo, read last
  const { p, reads, attached } = ports({ txns: [t], photos, text });
  const cache = new Map<string, string>();
  assert.equal(await runAutoReceipts(p, cache, () => true), 0);
  assert.equal(reads.length, AUTO.readsPerRun);
  assert.equal(await runAutoReceipts(p, cache, () => true), 1);
  assert.deepEqual(attached, [[7, 'p0']]);
});

test('an unreadable photo is skipped and an attach that throws does not stop the run', async () => {
  const t = txn();
  const { p } = ports({
    txns: [t], photos: [{ uri: 'bad', takenAt: t.at + 1000 }, { uri: 'shot', takenAt: t.at + 2000 }], text: { shot: 'Sent Rs 5,000 to Some Person' },
    read: async (u) => { if (u === 'bad') throw new Error('x'); return 'Sent Rs 5,000 to Some Person'; },
    attach: () => { throw new Error('already saved'); },
  });
  assert.equal(await runAutoReceipts(p, new Map(), () => true), 0);
});
