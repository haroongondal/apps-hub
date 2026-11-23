import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ADD_TODO, validateExtras } from '@apps-hub/app-link-contract';
import type { Clip } from 'clipboard-core';
import { ibanTodo, inflowOutcomeMessage, parseInflowOutcome } from '../inflow.ts';
import { smartActions } from '../smart.ts';

const ROOT = path.join(import.meta.dirname, '..', '..', '..', '..');
const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'app-link-contract', 'fixtures', 'add-todo-extras.json'), 'utf8')) as Array<{ spec: unknown }>;
const clip = (text: string, kind: Clip['kind'] = 'text'): Clip => ({
  id: 1, at: 0, kind, text, mime: 'text/plain', source: null, via: 'app', grabMs: null, pinned: false,
});

test('ADD_TODO is the action the contract fixture describes', () => {
  assert.equal(ADD_TODO.name, 'com.haroon.inflow.action.ADD_TODO');
  for (const c of cases) assert.deepEqual(c.spec, ADD_TODO.extras);
});

test('an IBAN to-do passes the ADD_TODO extras check, title grouped in fours', () => {
  const todo = ibanTodo('PK36 SCBL 0000 0011 2345 6702');
  assert.deepEqual(todo, { title: 'Pay account PK36 SCBL 0000 0011 2345 6702', note: 'From Clipboard', source: 'Clipboard' });
  assert.deepEqual(validateExtras(ADD_TODO, { ...todo }), { ok: true, extras: todo });
  // The longest IBAN (32 characters, Saint Lucia) still fits the 200-character title.
  const longest = ibanTodo('LC55 HEMM 0001 0001 0012 0012 0002 3015');
  assert.ok(validateExtras(ADD_TODO, { ...longest }).ok);
});

test('only an IBAN carries Add to Inflow, and never on a hidden clip', () => {
  const [iban] = smartActions(clip('Send to PK36SCBL0000001123456702'));
  assert.equal(iban.todo?.title, 'Pay account PK36 SCBL 0000 0011 2345 6702');
  const others = smartActions(clip('https://example.com 0300-1234567 221B Baker Street\nLondon NW1 6XE 1Z999AA10123456784'));
  assert.ok(others.length >= 3);
  for (const a of others) assert.equal(a.todo, undefined, a.kind);
  for (const kind of ['secret', 'code', 'image'] as const) assert.deepEqual(smartActions(clip('PK36SCBL0000001123456702', kind)), []);
});

test('Inflow answers become plain words; anything unknown counts as refused', () => {
  assert.equal(parseInflowOutcome('added'), 'added');
  assert.equal(parseInflowOutcome('not_installed'), 'not_installed');
  assert.equal(parseInflowOutcome('something'), 'refused');
  assert.equal(parseInflowOutcome(undefined), 'refused');
  assert.equal(inflowOutcomeMessage('added')?.text, 'Added to your to-dos in Inflow.');
  assert.equal(inflowOutcomeMessage('cancelled')?.text, 'Nothing was added to Inflow.');
  assert.match(inflowOutcomeMessage('not_installed')?.text ?? '', /isn’t installed/);
  assert.match(inflowOutcomeMessage('refused')?.text ?? '', /didn’t take/);
  assert.equal(inflowOutcomeMessage('busy'), null);
});
