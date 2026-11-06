import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeForSearch } from '../normalize.ts';

// Invisible and look-alike characters are written as code points so an editor can't change them unseen.

test('harakat (U+064B–U+065F, U+0670) are stripped', () => {
  assert.equal(normalizeForSearch('\u{0643}\u{064E}\u{062A}\u{064E}\u{0628}\u{064E}'), '\u{06A9}\u{062A}\u{0628}');
  assert.equal(normalizeForSearch('\u{0627}\u{0644}\u{0644}\u{0670}\u{0647}'), '\u{0627}\u{0644}\u{0644}\u{0647}');
  assert.equal(normalizeForSearch('\u{064B}'), '');
  assert.equal(normalizeForSearch('\u{065F}'), '');
});

test('tatweel is stripped', () => {
  assert.equal(normalizeForSearch('\u{0643}\u{0640}\u{062A}\u{0640}\u{0627}\u{0628}'), '\u{06A9}\u{062A}\u{0627}\u{0628}');
});

test('ZWNJ and ZWJ are stripped so the word joins up', () => {
  assert.equal(
    normalizeForSearch('\u{0645}\u{06CC}\u{200C}\u{062E}\u{0648}\u{0627}\u{0647}\u{0645}'),
    '\u{0645}\u{06CC}\u{062E}\u{0648}\u{0627}\u{0647}\u{0645}',
  );
  assert.equal(normalizeForSearch('a\u{200D}b'), 'ab');
});

test('Arabic yeh and kaf map to the Persian and Urdu forms', () => {
  assert.equal(normalizeForSearch('\u{064A}'), '\u{06CC}');
  assert.equal(normalizeForSearch('\u{0643}'), '\u{06A9}');
  assert.equal(normalizeForSearch('\u{0643}\u{062A}\u{0627}\u{0628}'), normalizeForSearch('\u{06A9}\u{062A}\u{0627}\u{0628}'));
});

test('the Persian and Urdu letters themselves are left alone', () => {
  assert.equal(normalizeForSearch('\u{06CC}\u{06A9}'), '\u{06CC}\u{06A9}');
});

test('NFKC folds presentation forms before the maps run', () => {
  assert.equal(normalizeForSearch('\u{FEFC}'), '\u{0644}\u{0627}'); // lam-alef final form: the Hermes check
  assert.equal(normalizeForSearch('\u{FEF1}'), '\u{06CC}'); // isolated Arabic yeh, then the yeh map
});

test('Latin passes through apart from NFKC folding', () => {
  assert.equal(normalizeForSearch('Invoice caf\u{00E9} 42'), 'Invoice caf\u{00E9} 42');
  assert.equal(normalizeForSearch('cafe\u{0301}'), 'caf\u{00E9}');
  assert.equal(normalizeForSearch('\u{FB01}ne'), 'fine');
  assert.equal(normalizeForSearch('\u{FF21}\u{FF22}\u{FF23}'), 'ABC');
});

test('the empty string stays empty', () => {
  assert.equal(normalizeForSearch(''), '');
});
