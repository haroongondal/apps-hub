import assert from 'node:assert/strict';
import test from 'node:test';
import type { Kind, SuggestionRow } from '@apps-hub/autopilot-contract';
import type { AutopilotSettings } from '../../modules/inflow-core/src/index.ts';
import { formFromSettings, groupByState, kindLabel, settingsForSave, toggleChat, waitingSummary, type SettingsForm } from '../autopilot.ts';

const row = (id: number, state: SuggestionRow['state'], created_at: number, expires_at: number, kind: Kind = 'reply'): SuggestionRow => ({
  id, kind, title: `t${id}`, item_id: id, due_at: null, state, created_at, expires_at,
});

const base: AutopilotSettings = {
  kinds: ['reply', 'bill'], multiple: 3, minMinor: 500_000, hugeMinor: 5_000_000,
  pickedChats: ['com.whatsapp|num:1'], lookIn: ['com.google.android.apps.maps'], bankApp: 'Meezan', alarmBefore: true,
};
const form = (over: Partial<SettingsForm> = {}): SettingsForm => ({ ...formFromSettings(base), ...over });
const failure = (f: SettingsForm) => {
  const r = settingsForSave(f);
  assert.equal(r.ok, false);
  return r.ok ? '' : r.error;
};

test('waitingSummary: none, one, many', () => {
  assert.deepEqual(waitingSummary([]), { count: 0, headline: '' });
  assert.deepEqual(waitingSummary([row(1, 'waiting', 1, 2)]), { count: 1, headline: '1 thing waiting' });
  assert.deepEqual(waitingSummary([1, 2, 3].map((i) => row(i, 'waiting', i, 9))), { count: 3, headline: '3 things waiting' });
});

test('waitingSummary counts only waiting rows', () => {
  assert.equal(waitingSummary([row(1, 'waiting', 1, 2), row(2, 'done', 1, 2), row(3, 'skipped', 1, 2)]).count, 1);
});

test('groupByState: waiting newest created first, history newest expires first, input untouched', () => {
  const rows = [
    row(1, 'waiting', 10, 100), row(2, 'waiting', 30, 100), row(3, 'waiting', 20, 100),
    row(4, 'done', 1, 50), row(5, 'expired', 1, 90), row(6, 'skipped', 1, 70), row(7, 'started', 1, 60),
  ];
  const copy = structuredClone(rows);
  const g = groupByState(rows);
  assert.deepEqual(g.waiting.map((r) => r.id), [2, 3, 1]);
  assert.deepEqual(g.history.map((r) => r.id), [5, 6, 7, 4]);
  assert.deepEqual(rows, copy);
  assert.deepEqual(groupByState([]), { waiting: [], history: [] });
});

test('kindLabel for each kind', () => {
  assert.equal(kindLabel('reply'), 'Reply');
  assert.equal(kindLabel('bill'), 'Bill');
  assert.equal(kindLabel('event'), 'Event');
  assert.equal(kindLabel('money'), 'Check a payment');
});

test('settingsForSave round-trips a good form, rupees become minor units', () => {
  const r = settingsForSave(form());
  assert.deepEqual(r, { ok: true, settings: base });
  const r2 = settingsForSave(form({ minRupees: '1000', hugeRupees: '60000.5' }));
  assert.equal(r2.ok && r2.settings.minMinor, 100_000);
  assert.equal(r2.ok && r2.settings.hugeMinor, 6_000_050);
});

test('settingsForSave drops blank and duplicate picks and trims', () => {
  const r = settingsForSave(form({ pickedChats: [' a|1 ', '', 'a|1', '   ', 'b|2'] }));
  assert.deepEqual(r.ok && r.settings.pickedChats, ['a|1', 'b|2']);
});

test('settingsForSave keeps kinds as given', () => {
  const r = settingsForSave(form({ kinds: [] }));
  assert.deepEqual(r.ok && r.settings.kinds, []);
});

test('settingsForSave rejects bad multiple', () => {
  for (const m of ['', 'abc', '0', '1001', '2.5', 'NaN', 'Infinity']) assert.match(failure(form({ multiple: m })), /whole number from 1 to 1000/, m);
  assert.equal(settingsForSave(form({ multiple: '1000' })).ok, true);
});

test('settingsForSave rejects blank, negative and non-finite amounts', () => {
  for (const v of ['', ' ', 'abc', '-1', 'Infinity', 'NaN']) {
    assert.match(failure(form({ minRupees: v })), /minimum amount/, v);
    assert.match(failure(form({ hugeRupees: v })), /large amount/, v);
  }
  assert.equal(settingsForSave(form({ minRupees: '0' })).ok, true);
});

test('settingsForSave look-in apps: lines, dedupe, package-like only', () => {
  const ok = settingsForSave(form({ lookIn: 'com.a.b\n\n  com.a.b \ncom.c_d.e' }));
  assert.deepEqual(ok.ok && ok.settings.lookIn, ['com.a.b', 'com.c_d.e']);
  assert.match(failure(form({ lookIn: 'com.a.b\nnot a package' })), /not a package/);
  assert.match(failure(form({ lookIn: 'single' })), /single/);
  const none = settingsForSave(form({ lookIn: '' }));
  assert.deepEqual(none.ok && none.settings.lookIn, []);
});

test('settingsForSave bank app: blank means none', () => {
  const r = settingsForSave(form({ bankApp: '   ' }));
  assert.equal(r.ok && r.settings.bankApp, null);
  const t = settingsForSave(form({ bankApp: ' Meezan ' }));
  assert.equal(t.ok && t.settings.bankApp, 'Meezan');
});

test('formFromSettings shows whole rupees and one package per line', () => {
  const f = formFromSettings({ ...base, lookIn: ['a.b', 'c.d'], bankApp: null });
  assert.equal(f.minRupees, '5000');
  assert.equal(f.hugeRupees, '50000');
  assert.equal(f.multiple, '3');
  assert.equal(f.lookIn, 'a.b\nc.d');
  assert.equal(f.bankApp, '');
});

test('toggleChat adds, removes, and never duplicates the id as given', () => {
  assert.deepEqual(toggleChat(['a|1'], 'b|2', true), ['a|1', 'b|2']);
  assert.deepEqual(toggleChat(['a|1', 'b|2'], 'a|1', true), ['a|1', 'b|2']);
  assert.deepEqual(toggleChat(['a|1', 'b|2'], 'a|1', false), ['b|2']);
  assert.deepEqual(toggleChat([], 'a|1', false), []);
});
