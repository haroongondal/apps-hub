import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ean13CheckDigit, normalisePassCode, secondsLeft, secondsLeftText, validatePass } from '../forms.ts';

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
