import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, STARTER_THEMES } from 'halo-engine/src/settings.ts';
import { addSlot, commitSlots, newTheme, nextThemeId, removeTheme, slotErrors } from '../aodForm.ts';

const slot = (start: string, themeId = 'night') => ({ start, themeId });

test('commitSlots sorts valid slots by start time', () => {
  assert.deepEqual(commitSlots([slot('18:00', 'pulse'), slot('07:00')]), [slot('07:00'), slot('18:00', 'pulse')]);
  assert.deepEqual(commitSlots([]), []);
});

test('commitSlots refuses a bad or repeated time and more than four slots', () => {
  assert.equal(commitSlots([slot('7:00')]), null);
  assert.equal(commitSlots([slot('07:00'), slot('07:00', 'pulse')]), null);
  assert.equal(commitSlots(['01:00', '02:00', '03:00', '04:00', '05:00'].map((t) => slot(t))), null);
  assert.equal(commitSlots(['01:00', '02:00', '03:00', '04:00'].map((t) => slot(t)))?.length, 4);
});

test('slotErrors names each bad row and marks every row of a repeated time', () => {
  const e = slotErrors([slot('07:00'), slot('25:00'), slot('07:00', 'pulse'), slot('09:00')]);
  assert.equal(e[0], 'Another slot starts at this time.');
  assert.equal(e[1], 'Use 24-hour time, like 07:00.');
  assert.equal(e[2], 'Another slot starts at this time.');
  assert.equal(e[3], null);
});

test('addSlot picks a free hour, keeps order of entry and stops at four', () => {
  assert.deepEqual(addSlot([], 'night'), [slot('00:00')]);
  assert.deepEqual(addSlot([slot('00:00')], 'pulse'), [slot('00:00'), slot('01:00', 'pulse')]);
  const four = ['00:00', '01:00', '02:00', '03:00'].map((t) => slot(t));
  assert.equal(addSlot(four, 'night'), null);
});

test('nextThemeId gives the lowest free theme-n and stops at 20 themes', () => {
  assert.equal(nextThemeId(STARTER_THEMES), 'theme-1');
  const ids = (...n: number[]) => n.map((i) => ({ ...STARTER_THEMES[0], id: `theme-${i}` }));
  assert.equal(nextThemeId(ids(1, 2, 4)), 'theme-3');
  const twenty = Array.from({ length: 20 }, (_, i) => ({ ...STARTER_THEMES[0], id: `t${i}` }));
  assert.equal(nextThemeId(twenty), null);
});

test('newTheme copies a theme under a new id and name, without its photo', () => {
  const base = { ...STARTER_THEMES[2], photo: true };
  const t = newTheme(STARTER_THEMES, base);
  assert.ok(t);
  assert.equal(t.id, 'theme-1');
  assert.equal(t.name, 'Theme 1');
  assert.equal(t.face, base.face);
  assert.equal(t.photo, false);
  assert.notEqual(t.faceOptions, base.faceOptions);
  assert.notEqual(t.colours.palette, base.colours.palette);
});

test('removeTheme falls back to the first remaining theme and drops its slots', () => {
  const aod = { ...DEFAULT_SETTINGS.aod, themeId: 'pulse', slots: [slot('07:00', 'pulse'), slot('20:00', 'glass')] };
  const r = removeTheme(STARTER_THEMES, aod, 'pulse');
  assert.ok(r);
  assert.deepEqual(r.themes.map((t) => t.id), ['night', 'glass', 'mono']);
  assert.equal(r.aod.themeId, 'night');
  assert.deepEqual(r.aod.slots, [slot('20:00', 'glass')]);
});

test('removeTheme keeps the chosen theme when another one goes, and never removes the last or an unknown one', () => {
  const aod = { ...DEFAULT_SETTINGS.aod, themeId: 'glass' };
  assert.equal(removeTheme(STARTER_THEMES, aod, 'mono')?.aod.themeId, 'glass');
  assert.equal(removeTheme([STARTER_THEMES[0]], aod, 'night'), null);
  assert.equal(removeTheme(STARTER_THEMES, aod, 'nope'), null);
});
