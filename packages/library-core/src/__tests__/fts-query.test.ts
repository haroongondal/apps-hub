import test from 'node:test';
import assert from 'node:assert/strict';

import { ftsQuery } from '../fts-query.ts';
import { nodeRawSql } from './node-sql.ts';

test('blank input is list mode', () => {
  assert.equal(ftsQuery(''), null);
  assert.equal(ftsQuery('   \t\n'), null);
});

test('each token is quoted and prefix-matched', () => {
  assert.equal(ftsQuery('Invo café'), '"Invo"* "café"*');
  assert.equal(ftsQuery('  one   two '), '"one"* "two"*');
});

test('double quotes are doubled', () => {
  assert.equal(ftsQuery('say "hi"'), '"say"* """hi"""*');
});

test('at most 8 tokens are kept', () => {
  assert.equal(ftsQuery('a b c d e f g h i j'), '"a"* "b"* "c"* "d"* "e"* "f"* "g"* "h"*');
});

test('the query is normalised like the indexed text', () => {
  assert.equal(ftsQuery('\u{0643}\u{0650}\u{062A}\u{0627}\u{0628}'), '"\u{06A9}\u{062A}\u{0627}\u{0628}"*');
  assert.equal(
    ftsQuery('\u{0645}\u{06CC}\u{200C}\u{062E}\u{0648}\u{0627}\u{0647}\u{0645}'),
    '"\u{0645}\u{06CC}\u{062E}\u{0648}\u{0627}\u{0647}\u{0645}"*',
  );
});

test('a token that normalises to nothing is dropped, and nothing left means list mode', () => {
  assert.equal(ftsQuery('\u{0640} abc'), '"abc"*');
  assert.equal(ftsQuery('\u{0640}\u{064B}'), null);
});

// FTS5 itself: operators must be literal and odd input must never raise a syntax error.
function fts() {
  const db = nodeRawSql();
  db.exec("CREATE VIRTUAL TABLE f USING fts5(body, tokenize = 'unicode61 remove_diacritics 2')");
  for (const body of ['parking permit', 'cats and dogs', 'near the cafe', 'tax: 2026 ^ plan', 'say hi']) {
    db.run('INSERT INTO f (body) VALUES (?)', [body]);
  }
  const hits = (input: string) =>
    (db.all('SELECT body FROM f WHERE f MATCH ?', [ftsQuery(input) as string]) as { body: string }[]).map((r) => r.body);
  return hits;
}

test('FTS5 operators typed by the user are literal words', () => {
  const hits = fts();
  assert.deepEqual(hits('cats AND dogs'), ['cats and dogs']);
  assert.deepEqual(hits('NEAR'), ['near the cafe']); // a word, not the NEAR operator
  assert.deepEqual(hits('tax:'), ['tax: 2026 ^ plan']);
});

test('hostile input does not raise an FTS5 syntax error', () => {
  const hits = fts();
  for (const input of ['"', '""', '*', '-', '^', ':', 'a OR', '(', ')', '{col}:x', 'NOT', 'a" b', '"-"*']) {
    assert.doesNotThrow(() => hits(input), input);
  }
});

test('a punctuation-only token is ignored in an AND (verified)', () => {
  const hits = fts();
  assert.deepEqual(hits('parking -'), hits('parking'));
  assert.deepEqual(hits('park'), ['parking permit']); // prefix
  assert.deepEqual(hits('café'), ['near the cafe']); // accents ignored
});
