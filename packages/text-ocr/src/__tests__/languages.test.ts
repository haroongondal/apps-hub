import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_OCR_LANGUAGE, OCR_LANGUAGES, toOcrLanguage } from '../languages.ts';

test('English, Arabic, Urdu and each of the last two with English are offered, English first', () => {
  assert.deepEqual(OCR_LANGUAGES.map((l) => l.id), ['eng', 'ara', 'urd', 'ara+eng', 'urd+eng']);
  assert.equal(DEFAULT_OCR_LANGUAGE, 'eng');
});

test('every choice has a plain label and a hint that tells the person to check Arabic and Urdu results', () => {
  for (const l of OCR_LANGUAGES) {
    assert.match(l.label, /^[A-Z][a-z]+( and [A-Z][a-z]+)?$/, l.label);
    assert.ok(l.hint.endsWith('.'), l.hint);
    assert.ok(!/tesseract|ocr|model|traineddata|nastaliq|naskh/i.test(l.label + l.hint), `engineering word in "${l.label}": ${l.hint}`);
    if (l.id !== 'eng') assert.match(l.hint, /check the result/i, l.label);
  }
});

test('the Urdu hints say what the sample pictures showed: clear printed text works, curly lettering does not', () => {
  const urdu = OCR_LANGUAGES.find((l) => l.id === 'urd')!;
  assert.match(urdu.hint, /clear, printed text/);
  assert.match(urdu.hint, /misread/);
});

test('a saved value is used when it is a choice, and anything else falls back to English', () => {
  assert.equal(toOcrLanguage('urd+eng'), 'urd+eng');
  for (const bad of ['', 'fra', 'eng+ara', '../eng', null, undefined, 3, {}]) assert.equal(toOcrLanguage(bad), 'eng');
});
