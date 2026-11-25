import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ean13CheckDigit, editableWifi, normalisePassCode, parseWifi, secondsLeft, secondsLeftText, validateExpiry, validatePass, validateWifi, wifiCode } from '../forms.ts';

test('a pass needs a name and a code', () => {
  assert.equal(validatePass('  ', '123', 'qr'), 'Give this pass a name.');
  assert.equal(validatePass('Gym', '   ', 'qr'), 'Enter the code printed under or inside the barcode.');
  assert.equal(validatePass('Gym', 'https://example.com/ticket?id=7', 'qr'), null);
});

test('EAN-13 takes 12 or 13 digits only', () => {
  assert.equal(validatePass('Milk', '4006381333931', 'ean13'), null);
  assert.equal(validatePass('Milk', '400638133393', 'ean13'), null);
  for (const bad of ['40063813339', '40063813339311', '40063813339a', '4006 3813 3393']) {
    assert.match(validatePass('Milk', bad, 'ean13')!, /^An EAN-13 code is 12 or 13 digits/, bad);
  }
});

test('Code 128 takes printable ASCII only', () => {
  assert.equal(validatePass('Locker', 'AB 12-x~', 'code128'), null);
  assert.match(validatePass('Locker', 'café', 'code128')!, /^A Code 128 code can only use/);
  assert.match(validatePass('Locker', 'a\tb', 'code128')!, /^A Code 128 code can only use/);
});

test('the countdown rounds up and stops at zero', () => {
  assert.equal(secondsLeft(60_000, 0), 60);
  assert.equal(secondsLeft(60_000, 100), 60);
  assert.equal(secondsLeft(60_000, 59_001), 1);
  assert.equal(secondsLeft(60_000, 61_000), 0);
});

test('EAN-13 with 13 digits must have the right check digit', () => {
  assert.equal(validatePass('Milk', '4006381333931', 'ean13'), null);
  assert.equal(validatePass('Milk', '4006381333930', 'ean13'), 'The last digit of this EAN-13 code is wrong');
  assert.equal(ean13CheckDigit('400638133393'), '1');
  assert.equal(ean13CheckDigit('000000000000'), '0');
});

test('a 12-digit EAN-13 is stored with its check digit, other codes only trimmed', () => {
  assert.equal(normalisePassCode(' 400638133393 ', 'ean13'), '4006381333931');
  assert.equal(normalisePassCode('4006381333931', 'ean13'), '4006381333931');
  assert.equal(normalisePassCode(' 400638133393 ', 'qr'), '400638133393');
});

test('Code 128 stops at 80 characters and QR at 2000, like the native encoder', () => {
  assert.equal(validatePass('L', 'a'.repeat(80), 'code128'), null);
  assert.equal(validatePass('L', 'a'.repeat(81), 'code128'), 'That code is too long for Code 128');
  assert.equal(validatePass('T', 'a'.repeat(2000), 'qr'), null);
  assert.equal(validatePass('T', 'a'.repeat(2001), 'qr'), 'That code is too long for a QR code');
});

test('the countdown says "1 second left" and "N seconds left"', () => {
  assert.equal(secondsLeftText(1), '1 second left');
  assert.equal(secondsLeftText(0), '0 seconds left');
  assert.equal(secondsLeftText(60), '60 seconds left');
});

test('an expiry date is optional, and when typed is a real day as year-month-day', () => {
  assert.equal(validateExpiry(''), null);
  assert.equal(validateExpiry('  '), null);
  assert.equal(validateExpiry(' 2027-03-31 '), null);
  assert.equal(validateExpiry('2028-02-29'), null);
  for (const bad of ['2027-02-29', '2027-13-01', '31/03/2027', '2027-3-31', '1999-12-31', 'soon']) {
    assert.equal(validateExpiry(bad), 'Enter the expiry date as year-month-day, such as 2027-03-31.', bad);
  }
});

test('a Wi-Fi network becomes the standard WIFI: code and reads back, odd characters included', () => {
  assert.equal(wifiCode('Home', 'hunter2hunter2', 'WPA'), 'WIFI:T:WPA;S:Home;P:hunter2hunter2;;');
  assert.equal(wifiCode('Cafe', '', 'nopass'), 'WIFI:T:nopass;S:Cafe;;');
  const tricky = { ssid: 'Mum & Dad; "5G": ok', password: 'a\\b;c,d:e"f', security: 'WPA' as const };
  assert.deepEqual(parseWifi(wifiCode(tricky.ssid, tricky.password, 'WPA')), tricky);
  assert.deepEqual(parseWifi(wifiCode('Cafe', 'ignored', 'nopass')), { ssid: 'Cafe', password: '', security: 'nopass' });
  assert.equal(parseWifi('https://example.com'), null);
  assert.equal(parseWifi('WIFI:T:WPA;P:x;;'), null);
});

test('a Wi-Fi code needs a network name and, unless open, a password', () => {
  assert.equal(validateWifi('  ', 'x', 'WPA'), 'Enter the network name.');
  assert.equal(validateWifi('Home', '', 'WPA'), 'Enter the Wi-Fi password, or choose Open for a network with none.');
  assert.equal(validateWifi('Home', '', 'nopass'), null);
  assert.equal(validateWifi('Home', 'pw', 'WPA'), null);
});

// The same cases are in WifiTest.kt (Wifi.editable): the screen and the native hint must open the same passes as Wi-Fi.
test('a pass opens as Wi-Fi only when the form wrote it, so editing never rewrites a saved network', () => {
  const real = 'WIFI:T:WPA;S:TP-Link_5G;P:s3cret;;';
  assert.deepEqual(editableWifi('TP-Link_5G', real, 'qr'), { password: 's3cret', security: 'WPA' });
  assert.deepEqual(editableWifi('  Home ', wifiCode('Home', 'pw', 'WPA'), 'qr'), { password: 'pw', security: 'WPA' });
  assert.deepEqual(editableWifi('Cafe', wifiCode('Cafe', '', 'nopass'), 'qr'), { password: '', security: 'nopass' });
  const tricky = wifiCode('Mum & Dad; "5G": ok', 'a\\b;c,d:e"f', 'WPA');
  assert.deepEqual(editableWifi('Mum & Dad; "5G": ok', tricky, 'qr'), { password: 'a\\b;c,d:e"f', security: 'WPA' });
  // The entry name is not the network name: saving the form would turn S:TP-Link_5G into S:Home router.
  assert.equal(editableWifi('Home router', real, 'qr'), null);
  for (const code of [
    'WIFI:T:WPA;S:Home;P:pw;H:true;;', 'WIFI:T:WPA2-EAP;S:Home;E:PEAP;I:alice;P:pw;;', 'WIFI:T:WEP;S:Home;P:pw;;', 'WIFI:T:SAE;S:Home;P:pw;;',
    'WIFI:S:Home;P:pw;;', 'WIFI:T:WPA;P:pw;;', 'WIFI:T:WPA;S:Home;P:pw', 'https://example.com', '',
  ]) assert.equal(editableWifi('Home', code, 'qr'), null, code);
  for (const f of ['code128', 'ean13'] as const) assert.equal(editableWifi('TP-Link_5G', real, f), null, f);
});
