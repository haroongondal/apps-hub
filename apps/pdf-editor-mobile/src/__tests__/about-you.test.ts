import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Cv } from '../cv/model.ts';
import { askContext, cvText, readAbout, saveAbout } from '../nexus/about-you.ts';

function memoryDb() {
  const kv = new Map<string, string>();
  return {
    async first(_sql: string, params?: readonly unknown[]) {
      const v = kv.get(params?.[0] as string);
      return v === undefined ? null : { value: v };
    },
    async run(_sql: string, params?: readonly unknown[]) {
      kv.set(params?.[0] as string, params?.[1] as string);
    },
  };
}

const cv = (id: string, name: string): Cv => ({
  id,
  name,
  title: 'Engineer',
  contact: ['sam@example.com'],
  sections: [{ heading: 'Work', entries: [{ title: 'Acme', subtitle: 'Lead', dates: '2020-2024', lines: ['Built things'], plain: false }] }],
  template: 'classic',
  updated: '2026-11-01',
});

test('the owner name and notes are kept, trimmed and cut', async () => {
  const db = memoryDb();
  assert.deepEqual(await readAbout(db), { name: '', notes: '' });
  await saveAbout(db, { name: '  Sam Reed ', notes: 'x'.repeat(5000) });
  const saved = await readAbout(db);
  assert.equal(saved.name, 'Sam Reed');
  assert.equal(saved.notes.length, 2000);
});

test('a CV reads as plain text with its sections', () => {
  assert.equal(cvText(cv('1', 'Sam Reed')), 'Sam Reed\nEngineer\nsam@example.com\nWork:\nAcme, Lead, 2020-2024\nBuilt things');
});

test('Ask gets the name and at most three CVs; an unreadable CV list is not fatal', async () => {
  const db = memoryDb();
  await saveAbout(db, { name: 'Sam Reed' });
  const ctx = await askContext(db, async () => ['a', 'b', 'c', 'd'].map((id) => cv(id, `Name ${id}`)));
  assert.equal(ctx.about?.name, 'Sam Reed');
  assert.equal(ctx.about?.notes, undefined);
  assert.deepEqual(ctx.extras?.map((e) => e.id), ['cv:a', 'cv:b', 'cv:c']);
  const none = await askContext(db, async () => {
    throw new Error('disk');
  });
  assert.deepEqual(none.extras, []);
});
