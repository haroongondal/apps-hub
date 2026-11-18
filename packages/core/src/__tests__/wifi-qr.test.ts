import assert from 'node:assert/strict';
import { test } from 'node:test';

import { wifiQrText } from '../wifi-qr.ts';

// Raw strings, so the backslashes in the expected text are the real ones.
const raw = String.raw;

test('escapes ; and : in the password', () => {
  assert.equal(wifiQrText({ ssid: 'Home', password: 'p;a:ss', open: false }), raw`WIFI:T:WPA;S:Home;P:p\;a\:ss;;`);
});

test('an open network omits the password', () => {
  assert.equal(wifiQrText({ ssid: 'Guest', password: 'ignored', open: true }), 'WIFI:T:nopass;S:Guest;;');
});

test('escapes quotes and keeps non-ASCII', () => {
  assert.equal(
    wifiQrText({ ssid: 'Café "5G"', password: 'x1y!', open: false }),
    raw`WIFI:T:WPA;S:Café \"5G\";P:x1y!;;`,
  );
});

test('escapes the backslash once (first) and the comma', () => {
  assert.equal(wifiQrText({ ssid: raw`a\b,c`, password: raw`\;`, open: false }), raw`WIFI:T:WPA;S:a\\b\,c;P:\\\;;;`);
});

test('quotes an all-hex name or password', () => {
  assert.equal(wifiQrText({ ssid: '1234', password: 'deadBEEF', open: false }), 'WIFI:T:WPA;S:"1234";P:"deadBEEF";;');
  assert.equal(wifiQrText({ ssid: 'cafe', password: '', open: true }), 'WIFI:T:nopass;S:"cafe";;');
});

test('an empty name gives an empty string', () => {
  assert.equal(wifiQrText({ ssid: '', password: 'x', open: false }), '');
});
