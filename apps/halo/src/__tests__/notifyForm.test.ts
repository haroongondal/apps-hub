import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from 'halo-engine/src/settings.ts';
import { appSetting, brandColour, parseTime, pickStyle, sortApps, styleKey } from '../notifyForm.ts';

test('parseTime takes 24-hour HH:MM only', () => {
  assert.equal(parseTime('07:05'), '07:05');
  assert.equal(parseTime(' 22:00 '), '22:00');
  assert.equal(parseTime('23:59'), '23:59');
  assert.equal(parseTime('00:00'), '00:00');
  for (const bad of ['7:5', '7:05', '24:00', '12:60', '', '10-30', '10:30pm', '1030']) assert.equal(parseTime(bad), null, bad);
});

const apps = [
  { pkg: 'org.zebra', label: 'zebra', notified: false },
  { pkg: 'com.chat', label: 'Chat', notified: true },
  { pkg: 'com.alpha', label: 'Alpha', notified: false },
  { pkg: 'com.mail', label: 'mail', notified: true },
];

test('sortApps puts notified apps first, then label A to Z ignoring case', () => {
  assert.deepEqual(sortApps(apps, '').map((a) => a.pkg), ['com.chat', 'com.mail', 'com.alpha', 'org.zebra']);
});

test('sortApps searches label and package, ignoring case', () => {
  assert.deepEqual(sortApps(apps, 'ZEB').map((a) => a.pkg), ['org.zebra']);
  assert.deepEqual(sortApps(apps, 'com.').map((a) => a.pkg), ['com.chat', 'com.mail', 'com.alpha']);
  assert.deepEqual(sortApps(apps, '  chat ').map((a) => a.pkg), ['com.chat']);
  assert.deepEqual(sortApps(apps, 'nothing'), []);
});

test('sortApps does not change its input', () => {
  const copy = apps.map((a) => ({ ...a }));
  sortApps(apps, '');
  assert.deepEqual(apps, copy);
});

test('appSetting: a listed app keeps its own choice, others follow defaultOn and the shared style', () => {
  const own = { on: true, colour: '#FF0000', style: 'sweep' };
  const notify = { ...DEFAULT_SETTINGS.notify, defaultOn: false, apps: { 'com.chat': own } };
  assert.deepEqual(appSetting(notify, 'com.chat'), own);
  assert.deepEqual(appSetting(notify, 'com.other'), { on: false, colour: null, style: null });
  assert.deepEqual(appSetting({ ...notify, defaultOn: true }, 'com.other'), { on: true, colour: null, style: null });
  // A package named like an Object method is still just an unknown app.
  assert.deepEqual(appSetting(notify, 'constructor'), { on: false, colour: null, style: null });
});

test('brandColour knows WhatsApp and Instagram only', () => {
  assert.equal(brandColour('com.whatsapp'), '#25D366');
  assert.equal(brandColour('com.whatsapp.w4b'), '#25D366');
  assert.equal(brandColour('com.instagram.android'), '#FF3D9A');
  assert.equal(brandColour('com.chat'), null);
  assert.equal(brandColour('constructor'), null);
});

test('styleKey and pickStyle: a pattern choice keeps the pattern already picked, else takes the fallback', () => {
  assert.equal(styleKey('pulse'), 'pulse');
  assert.equal(styleKey('sweep'), 'sweep');
  assert.equal(styleKey('comet'), 'pattern');
  assert.equal(pickStyle('sweep', 'comet', 'rain'), 'sweep');
  assert.equal(pickStyle('pattern', 'comet', 'rain'), 'comet');
  assert.equal(pickStyle('pattern', 'pulse', 'rain'), 'rain');
  assert.equal(pickStyle('pattern', null, 'rain'), 'rain');
});
