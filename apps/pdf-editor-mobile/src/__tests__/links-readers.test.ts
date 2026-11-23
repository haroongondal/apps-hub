import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleanRow } from '@apps-hub/knowledge-core';

import { clipboardSource, deputySource, inflowSource, readDebits, readShare, runText, sourceProviders, startLink, type Native } from '../links/readers.ts';

type Answer = unknown | (() => unknown);

function fake(answers: Record<string, Answer>, calls: unknown[][] = []): Native {
  const reply = async (key: string) => {
    const a = answers[key];
    return typeof a === 'function' ? (a as () => unknown)() : a;
  };
  return {
    readShare: (async (id: string, sinceId?: number) => {
      calls.push(sinceId === undefined ? [id] : [id, sinceId]);
      return reply(id);
    }) as unknown as NonNullable<Native>['readShare'],
    startLink: (async (action: string, extras: unknown) => {
      calls.push([action, extras]);
      return reply(action);
    }) as unknown as NonNullable<Native>['startLink'],
  };
}

const ok = (rows: unknown[]) => ({ status: 'ok', rows });

test('no native module (iOS) reads as missing and links as unavailable, without calling anything', async () => {
  assert.deepEqual(await readShare(null, 'deputy.runs'), { status: 'missing', rows: [] });
  assert.equal(await inflowSource(null).status(), 'missing');
  assert.equal(await deputySource(null).snapshot(), null);
  assert.deepEqual(await startLink(null, 'com.haroon.inflow.action.ADD_TODO', { title: 't' }), { status: 'unavailable' });
  assert.deepEqual(await readDebits(null), { status: 'missing', rows: [] });
});

test('a rejection, an unknown status or rows that are not a list read as failed, never as an exception', async () => {
  assert.deepEqual(await readShare(fake({ 'deputy.runs': () => { throw new Error('bridge'); } }), 'deputy.runs'), { status: 'failed', rows: [] });
  assert.deepEqual(await readShare(fake({ 'deputy.runs': { status: 'great', rows: [] } }), 'deputy.runs'), { status: 'failed', rows: [] });
  assert.deepEqual(await readShare(fake({ 'deputy.runs': { status: 'ok', rows: 'x' } }), 'deputy.runs'), { status: 'failed', rows: [] });
  assert.deepEqual(await readShare(fake({ 'deputy.runs': null }), 'deputy.runs'), { status: 'failed', rows: [] });
  assert.deepEqual(await readShare(fake({ 'deputy.runs': ok([{ id: 1 }, 7, null, [1]]) }), 'deputy.runs'), ok([{ id: 1 }]));
  assert.deepEqual(await readShare(fake({ 'deputy.runs': { status: 'refused', rows: [{ id: 1 }] } }), 'deputy.runs'), { status: 'refused', rows: [] });
});

test('status: missing provider is missing, refused is off, anything else lets the sync run', async () => {
  for (const [status, want] of [['missing', 'missing'], ['refused', 'off'], ['ok', 'ready'], ['failed', 'ready']] as const) {
    const n = fake({ 'inflow.ask_ids': { status, rows: [] }, 'deputy.runs': { status, rows: [] }, 'clipboard.pinned': { status, rows: [] } });
    assert.equal(await inflowSource(n).status(), want, status);
    assert.equal(await deputySource(n).status(), want, status);
    assert.equal(await clipboardSource(n).status(), want, status);
  }
});

test('Inflow items map sender to from, drop the app label, respect the limit and pass sinceId', async () => {
  const calls: unknown[][] = [];
  const n = fake({ 'inflow.ask_items': ok([
    { id: 5, app: 'sms', sender: 'Ali', text: 'Dinner at 8?', at: 10 },
    { id: 6, app: 'email', sender: null, text: 'Invoice', at: 11 },
    { id: 7, app: 'sms', sender: 'Sara', text: 'Third', at: 12 },
  ]) }, calls);
  const page = await inflowSource(n).items(4, 2);
  assert.deepEqual(page, [{ id: 5, text: 'Dinner at 8?', at: 10, from: 'Ali' }, { id: 6, text: 'Invoice', at: 11, from: null }]);
  assert.deepEqual(calls, [['inflow.ask_items', 4]]);
  assert.deepEqual(page?.map(cleanRow), [{ id: 5, text: 'Dinner at 8?', at: 10, from: 'Ali' }, { id: 6, text: 'Invoice', at: 11, from: null }]);
});

test('Inflow items and live ids are null when the read is not ok, so nothing is deleted', async () => {
  for (const status of ['failed', 'refused', 'missing']) {
    const n = fake({ 'inflow.ask_items': { status, rows: [] }, 'inflow.ask_ids': { status, rows: [] } });
    assert.equal(await inflowSource(n).items(0, 50), null, status);
    assert.equal(await inflowSource(n).liveIds(0), null, status);
  }
});

test('Inflow live ids are the id column of ask_ids/<sinceId>', async () => {
  const calls: unknown[][] = [];
  assert.deepEqual(await inflowSource(fake({ 'inflow.ask_ids': ok([{ id: 3 }, { id: 9 }]) }, calls)).liveIds(2), [3, 9]);
  assert.deepEqual(calls, [['inflow.ask_ids', 2]]);
});

test('Deputy runs become the task and its end in plain words, dated by finished_at', async () => {
  const snap = await deputySource(fake({ 'deputy.runs': ok([
    { id: 2864434397, task: 'Tell me my next alarm', state: 'done', finished_at: 1764000000000 },
    { id: 3735928559, task: 'Free up storage', state: 'stopped', finished_at: 1763990000000 },
    { id: 9, task: 'Odd', state: 'toString', finished_at: 1 },
  ]) })).snapshot();
  assert.deepEqual(snap, [
    { id: 2864434397, text: 'Tell me my next alarm\nDeputy finished it.', at: 1764000000000, from: null },
    { id: 3735928559, text: 'Free up storage\nIt was stopped before the end.', at: 1763990000000, from: null },
    { id: 9, text: 'Odd\nIt ended.', at: 1, from: null },
  ]);
  assert.equal(runText(7, 'done'), null);
});

test('Clipboard pins carry text, pinned_at and the app they came from', async () => {
  const snap = await clipboardSource(fake({ 'clipboard.pinned': ok([{ id: 3, text: 'Flat 4B', pinned_at: 20, from_app: 'com.whatsapp' }, { id: 4, text: 'x', pinned_at: 21, from_app: '' }]) })).snapshot();
  assert.deepEqual(snap, [{ id: 3, text: 'Flat 4B', at: 20, from: 'com.whatsapp' }, { id: 4, text: 'x', at: 21, from: '' }]);
  assert.equal(cleanRow(snap?.[1])?.from, null);
  assert.equal(await clipboardSource(fake({ 'clipboard.pinned': { status: 'failed', rows: [] } })).snapshot(), null);
});

test('snapshot readers take no sinceId', async () => {
  const calls: unknown[][] = [];
  const all = sourceProviders(fake({ 'deputy.runs': ok([]), 'clipboard.pinned': ok([]) }, calls));
  await (all.deputy as { snapshot(): Promise<unknown> }).snapshot();
  await (all.clipboard as { snapshot(): Promise<unknown> }).snapshot();
  assert.deepEqual(calls, [['deputy.runs'], ['clipboard.pinned']]);
});

test('debits keep only valid rows and map status the same way', async () => {
  const good = { id: 9, amount_minor: 125000, at: 1764000000000, merchant: 'Daraz', account: 'Meezan card' };
  const r = await readDebits(fake({ 'inflow.debits': ok([good, { ...good, id: 0 }, { ...good, amount_minor: 1.5 }, { ...good, merchant: 4 }, { ...good, at: -1 }, { ...good, extra: 'x', id: 10 }]) }), 3);
  assert.deepEqual(r, { status: 'ready', rows: [good, { ...good, id: 10 }] });
  assert.deepEqual(await readDebits(fake({ 'inflow.debits': { status: 'refused', rows: [] } })), { status: 'off', rows: [] });
  assert.deepEqual(await readDebits(fake({ 'inflow.debits': { status: 'failed', rows: [] } })), { status: 'failed', rows: [] });
});

test('startLink drops undefined and null extras, keeps a valid code and fails closed on odd answers', async () => {
  const calls: unknown[][] = [];
  const add = 'com.haroon.inflow.action.ADD_TODO';
  const n = fake({ [add]: { status: 'done', code: 'added' } }, calls);
  assert.deepEqual(await startLink(n, add, { title: 'Renew', dueAt: undefined, note: 'n' }), { status: 'done', code: 'added' });
  assert.deepEqual(calls, [[add, { title: 'Renew', note: 'n' }]]);
  assert.deepEqual(await startLink(fake({ [add]: { status: 'done', code: 'Added!' } }), add, { title: 't' }), { status: 'done' });
  assert.deepEqual(await startLink(fake({ [add]: { status: 'ok' } }), add, { title: 't' }), { status: 'failed' });
  assert.deepEqual(await startLink(fake({ [add]: () => { throw new Error('x'); } }), add, { title: 't' }), { status: 'failed' });
  assert.deepEqual(await startLink(fake({ [add]: { status: 'unavailable' } }), add, { title: 't' }), { status: 'unavailable' });
});
