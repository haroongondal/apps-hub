import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CleanupGroup, CleanupKind, CleanupPhoto, RemovedPhoto } from 'design-media';
import {
  blurAt, blurFraction, deleteLabel, doneText, hiddenText, initialTicks, kindName, kindRows, lastScanText, mergeTicks,
  photosText, removedText, restoredText, selection, sizeText, tickAll, wholeSetTicked,
} from '../photos/cleanup.ts';

const photo = (uri: string, o: Partial<CleanupPhoto> = {}): CleanupPhoto => ({ uri, name: uri, bytes: 1_000_000, takenAt: 0, ticked: false, best: false, ...o });
const group = (kind: CleanupKind, key: string, photos: CleanupPhoto[], bytes = 0): CleanupGroup => ({ kind, key, photos, bytes });
const copies = (key: string): CleanupGroup =>
  group('copies', key, [photo(`${key}-a`, { best: true }), photo(`${key}-b`, { ticked: true })], 1_000_000);
const NOW = 1_000_000_000_000;
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

test('kindNamesAndRows', () => {
  assert.equal(kindName('dark'), 'Too dark or too bright');
  assert.equal(kindName('lookalikes'), 'Look-alikes');
  const rows = kindRows([
    group('blurry', 'b', [photo('1'), photo('2'), photo('3')], 1_200_000_000),
    copies('c1'),
    copies('c2'),
  ]);
  assert.deepEqual(rows.map((r) => r.kind), ['blurry', 'copies']);
  assert.equal(rows[0].title, 'Blurry');
  assert.equal(rows[0].subtitle, '3 photos · 1.2 GB');
  assert.equal(rows[0].label, 'Blurry · 3 photos · 1.2 GB');
  assert.equal(rows[1].count, 2);
  assert.equal(rows[1].bytes, 2_000_000);
  assert.deepEqual(kindRows([]), []);
});

test('sizeTextUnits', () => {
  assert.equal(sizeText(412_000_000), '412 MB');
  assert.equal(sizeText(2_100_000), '2.1 MB');
  assert.equal(sizeText(1_250_000_000), '1.3 GB');
  assert.equal(sizeText(1_200_000_000), '1.2 GB');
  // formatMb rounds >= 100 MB to whole MB, so 999.5 MB and up would print "1000 MB"
  assert.equal(sizeText(999_400_000), '999 MB');
  assert.equal(sizeText(999_600_000), '1.0 GB');
  assert.equal(sizeText(1e9), '1.0 GB');
});

test('photosTextPlural', () => {
  assert.equal(photosText(1), '1 photo');
  assert.equal(photosText(2), '2 photos');
  assert.equal(photosText(1214), '1,214 photos');
});

test('lastScanTextSteps', () => {
  assert.equal(lastScanText(0, NOW), 'Not checked yet');
  assert.equal(lastScanText(NOW - 30_000, NOW), 'Checked just now');
  assert.equal(lastScanText(NOW - 61_000, NOW), 'Checked 1 minute ago');
  assert.equal(lastScanText(NOW - 5 * MIN, NOW), 'Checked 5 minutes ago');
  assert.equal(lastScanText(NOW - HOUR, NOW), 'Checked 1 hour ago');
  assert.equal(lastScanText(NOW - 3 * HOUR, NOW), 'Checked 3 hours ago');
  assert.equal(lastScanText(NOW - 26 * HOUR, NOW), 'Checked 1 day ago');
  assert.equal(lastScanText(NOW - 3 * DAY, NOW), 'Checked 3 days ago');
  assert.equal(lastScanText(NaN, NOW), 'Not checked yet');
  assert.equal(lastScanText(NOW, NaN), 'Checked just now');
});

test('initialTicksFromEngine', () => {
  assert.deepEqual(initialTicks([copies('c')]), { 'c-a': false, 'c-b': true });
});

test('mergeTicksKeepsOwnerChoices', () => {
  const g = [group('blurry', 'b', [photo('1', { ticked: true }), photo('2', { ticked: true }), photo('4', { ticked: false })])];
  // owner unticked 1; 3 is gone; 4 is new
  assert.deepEqual(mergeTicks({ '1': false, '2': true, '3': true }, g), { '1': false, '2': true, '4': false });
});

test('tickAllSkipsBest', () => {
  const g = [copies('c'), group('blurry', 'b', [photo('1'), photo('2')])];
  assert.deepEqual(tickAll(g, true), { 'c-a': false, 'c-b': true, '1': true, '2': true });
  assert.deepEqual(tickAll(g, false), { 'c-a': false, 'c-b': false, '1': false, '2': false });
});

test('selectionIgnoresGoneUris', () => {
  const g = [group('blurry', 'b', [photo('1', { bytes: 5 }), photo('2', { bytes: 7 })])];
  assert.deepEqual(selection(g, { '1': true, '2': false, gone: true }), { uris: ['1'], count: 1, bytes: 5 });
  // the same photo in two groups counts once
  const dup = [group('blurry', 'b', [photo('1', { bytes: 5 })]), group('dark', 'd', [photo('1', { bytes: 5 })])];
  assert.deepEqual(selection(dup, { '1': true }), { uris: ['1'], count: 1, bytes: 5 });
});

test('deleteLabels', () => {
  assert.equal(deleteLabel(37, 412_000_000), 'Delete 37 photos (412 MB)');
  assert.equal(deleteLabel(1, 2_100_000), 'Delete 1 photo (2.1 MB)');
  assert.equal(deleteLabel(0, 0), 'Delete');
});

test('wholeSetTicked', () => {
  const c = copies('c');
  assert.equal(wholeSetTicked([c], { 'c-a': false, 'c-b': true }), false);
  assert.equal(wholeSetTicked([c], { 'c-a': true, 'c-b': true }), true);
  const b = group('blurry', 'b', [photo('1'), photo('2')]);
  assert.equal(wholeSetTicked([b], { '1': true, '2': true }), false);
  const single = group('copies', 's', [photo('x')]);
  assert.equal(wholeSetTicked([single], { x: true }), false);
});

test('doneAndRestoredText', () => {
  const note = " Clean up couldn't add them to Recently removed. Undo now if you need them back, or look in your Gallery app's trash.";
  assert.equal(doneText(37, true), '37 photos moved to trash. You can restore them for 30 days.');
  assert.equal(doneText(1, true), '1 photo moved to trash. You can restore it for 30 days.');
  assert.equal(doneText(37, false), '37 photos moved to trash. You can restore them for 30 days.' + note);
  assert.equal(doneText(1, false), '1 photo moved to trash. You can restore it for 30 days.' + note);
  assert.equal(restoredText(37), '37 photos are back in your gallery.');
  assert.equal(restoredText(1), '1 photo is back in your gallery.');
});

test('removedTextDaysLeft', () => {
  const p = (expiresAt: number): RemovedPhoto => ({ uri: 'u', name: 'n', bytes: 2_100_000, trashedAt: 0, expiresAt });
  assert.equal(removedText(p(NOW + 27.2 * DAY), NOW), '2.1 MB · 27 days left');
  assert.equal(removedText(p(NOW + 0.5 * DAY), NOW), '2.1 MB · Less than a day left');
  assert.equal(removedText(p(NOW - DAY), NOW), '2.1 MB · Less than a day left');
  assert.equal(removedText(p(NaN), NOW), '2.1 MB · Less than a day left');
});

test('hiddenTextUsesKindName', () => {
  assert.equal(hiddenText('blurry'), 'Hidden from Blurry.');
  assert.equal(hiddenText('lookalikes'), 'Hidden from Look-alikes.');
});

test('blurMapping', () => {
  const b = { min: 10, max: 110 };
  assert.equal(blurAt(0, b), 10);
  assert.equal(blurAt(1, b), 110);
  assert.equal(blurAt(-1, b), 10);
  assert.equal(blurAt(2, b), 110);
  assert.ok(Math.abs(blurFraction(blurAt(0.39, b), b) - 0.39) < 1e-9);
  assert.equal(blurFraction(-50, b), 0);
  assert.equal(blurFraction(500, b), 1);
});
