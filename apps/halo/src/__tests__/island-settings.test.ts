import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULTS, SWATCHES, availableSamples, clockLabel, earPlan, foldLabel, moveWidget, normalize, pillHex, resolveSample, rowsFor, widgetLabel } from '../island/settings.ts';

test('the pill colours match the native card', () => {
  assert.equal(pillHex('black', 'indigo'), '#000000');
  assert.equal(pillHex('graphite', 'indigo'), '#1C1C1E');
  // The accent at 20% over black; truncated per channel, as Colours.kt does.
  assert.equal(pillHex('tinted', 'indigo'), '#191C31');
});

test('clock labels in 12 and 24 hours', () => {
  assert.equal(clockLabel(21, 5, '24'), '21:05');
  assert.equal(clockLabel(0, 0, '12'), '12:00');
  assert.equal(clockLabel(13, 7, '12'), '1:07');
});

test('missing or non-object input gives the defaults', () => {
  assert.deepEqual(normalize(undefined), DEFAULTS);
  assert.deepEqual(normalize('nope'), DEFAULTS);
});

test('an unknown value falls back for that field only', () => {
  const s = normalize({ accent: 'neon', size: 'large' });
  assert.equal(s.accent, DEFAULTS.accent);
  assert.equal(s.size, 'large');
});

test('a fold time outside the allowed set falls back to the default', () => {
  assert.equal(normalize({ foldMs: 7000 }).foldMs, 5000);
  assert.equal(normalize({ foldMs: 0 }).foldMs, 0);
});

test('unknown and repeated widgets are dropped, order kept', () => {
  assert.deepEqual(normalize({ widgets: ['battery', 'nope', 'battery', 'clock'] }).widgets, ['battery', 'clock']);
});

test('an empty widget list is kept', () => {
  assert.deepEqual(normalize({ widgets: [] }).widgets, []);
});

test('moveWidget places an item and clamps to the list', () => {
  assert.deepEqual(moveWidget(['clock', 'battery', 'timer'], 'timer', 0), ['timer', 'clock', 'battery']);
  assert.deepEqual(moveWidget(['clock', 'battery'], 'clock', 99), ['battery', 'clock']);
});

test('every swatch is a #RRGGBB colour', () => {
  for (const hex of Object.values(SWATCHES)) assert.match(hex, /^#[0-9A-F]{6}$/i);
});

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('every swatch reaches WCAG AA on the black and graphite pills', () => {
  for (const hex of Object.values(SWATCHES)) {
    assert.ok(contrast(hex, '#000000') >= 4.5, `${hex} on black`);
    assert.ok(contrast(hex, '#1C1C1E') >= 4.5, `${hex} on graphite`);
  }
});

test('fold labels read in plain words', () => {
  assert.equal(foldLabel(0), 'Never');
  assert.equal(foldLabel(3000), '3 seconds');
});

test('ears: clock left, battery right, date line only with the clock', () => {
  assert.deepEqual(earPlan(['clock', 'battery']), { time: true, battery: true, dateLine: true });
  assert.deepEqual(earPlan(['battery']), { time: false, battery: true, dateLine: false });
  assert.deepEqual(earPlan([]), { time: false, battery: false, dateLine: false });
});

test('rowsFor follows widget order and skips clock and battery', () => {
  assert.deepEqual(rowsFor(['media', 'clock', 'timer', 'battery']), ['media', 'timer']);
  assert.deepEqual(rowsFor(['clock', 'battery']), []);
});

test('widgetLabel uses plain words', () => {
  assert.equal(widgetLabel('media'), 'Now playing');
  assert.equal(widgetLabel('timer'), 'Timer');
  assert.equal(widgetLabel('clock'), 'Clock');
  assert.equal(widgetLabel('battery'), 'Battery');
});

test('event switches default on and fall back one by one', () => {
  assert.deepEqual(DEFAULTS.events, { charging: true, ringer: true, dnd: true, bluetooth: true });
  assert.deepEqual(normalize({ accent: 'mint' }).events, DEFAULTS.events);
  assert.deepEqual(normalize({ events: { charging: false, ringer: 'no', dnd: 1, bluetooth: 'false' } }).events, { charging: false, ringer: true, dnd: true, bluetooth: true });
  assert.deepEqual(normalize({ events: { bluetooth: false } }).events, { charging: true, ringer: true, dnd: true, bluetooth: false });
  assert.deepEqual(normalize({ events: [false] }).events, DEFAULTS.events);
});

test('event switches survive a round trip through JSON', () => {
  const s = { ...DEFAULTS, events: { charging: false, ringer: true, dnd: false, bluetooth: false } };
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(s))), s);
});

test('progress cards default on, reject non-booleans and survive a round trip', () => {
  assert.equal(DEFAULTS.progressCards, true);
  assert.equal(normalize({ accent: 'mint' }).progressCards, true);
  assert.equal(normalize({ progressCards: false }).progressCards, false);
  assert.equal(normalize({ progressCards: 'false' }).progressCards, true);
  assert.equal(normalize({ progressCards: 0 }).progressCards, true);
  const s = { ...DEFAULTS, progressCards: false };
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(s))), s);
});

test('preview samples follow the widgets that are on', () => {
  assert.deepEqual(availableSamples(['clock', 'battery']), ['call', 'event', 'ears']);
  assert.deepEqual(availableSamples(['media', 'timer']), ['music', 'call', 'timer', 'event', 'ears']);
  assert.deepEqual(availableSamples(['timer']), ['call', 'timer', 'event', 'ears']);
});

test('a sample whose widget was switched off falls back to the first available one', () => {
  assert.equal(resolveSample('music', ['clock']), 'call');
  assert.equal(resolveSample('timer', ['media']), 'music');
  assert.equal(resolveSample('music', ['media']), 'music');
  assert.equal(resolveSample('event', []), 'event');
});

test('message peek defaults off with no apps', () => {
  assert.deepEqual(DEFAULTS.messagePeek, { on: false, apps: [] });
  assert.deepEqual(normalize({ accent: 'mint' }).messagePeek, { on: false, apps: [] });
  assert.deepEqual(normalize({ messagePeek: [true] }).messagePeek, { on: false, apps: [] });
});

test('message peek fields fall back on their own and reject strings', () => {
  assert.deepEqual(normalize({ messagePeek: { on: true, apps: 'com.whatsapp' } }).messagePeek, { on: true, apps: [] });
  assert.deepEqual(normalize({ messagePeek: { on: 'true', apps: ['com.whatsapp'] } }).messagePeek, { on: false, apps: ['com.whatsapp'] });
  assert.equal(normalize({ messagePeek: { on: 1 } }).messagePeek.on, false);
});

test('message peek keeps only valid, unique package names, at most 20', () => {
  const apps = ['com.whatsapp', 1, null, true, 'com.whatsapp', 'bad/pkg', '', 'a'.repeat(151), 'org.telegram.messenger'];
  assert.deepEqual(normalize({ messagePeek: { on: true, apps } }).messagePeek.apps, ['com.whatsapp', 'org.telegram.messenger']);
  const many = Array.from({ length: 25 }, (_, i) => `com.app${i + 1}`);
  const capped = normalize({ messagePeek: { apps: many } }).messagePeek.apps;
  assert.equal(capped.length, 20);
  assert.equal(capped[0], 'com.app1');
});

test('message peek survives a round trip through JSON', () => {
  const s = { ...DEFAULTS, messagePeek: { on: true, apps: ['com.whatsapp', 'org.telegram.messenger'] } };
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(s))), s);
});
