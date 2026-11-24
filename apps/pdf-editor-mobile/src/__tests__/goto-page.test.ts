import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { citedPage, clampPage, pageParam, pendingPage } from '../editor/goto-page.ts';

test('a page citation gives its page; time, null and bad pages give none', () => {
  assert.equal(citedPage({ page: 7 }), 7);
  assert.equal(citedPage({ startSec: 3, endSec: 9 }), null);
  assert.equal(citedPage(null), null);
  assert.equal(citedPage({ page: 0 }), null);
  assert.equal(citedPage({ page: 2.5 }), null);
});

test('the route param round-trips whole pages only', () => {
  assert.equal(pageParam(String(12)), 12);
  for (const bad of [undefined, '', '0', '-3', '2.5', 'abc', '3x']) assert.equal(pageParam(bad), null, String(bad));
});

test('a page is clamped to the document', () => {
  assert.equal(clampPage(5, 10), 5);
  assert.equal(clampPage(40, 10), 10);
  assert.equal(clampPage(0, 10), 1);
  assert.equal(clampPage(3, 0), 1);
});

test('the pending page waits for the load and is handed out once', () => {
  const p = pendingPage(40);
  assert.equal(p.take({ ok: true, pages: 12 }), 12);
  assert.equal(p.take({ ok: true, pages: 12 }), null, 'a later document in the same editor does not jump');
});

test('a failed load drops the pending page', () => {
  const p = pendingPage(3);
  assert.equal(p.take({ ok: false }), null);
  assert.equal(p.take({ ok: true, pages: 9 }), null);
});

test('no citation page means nothing to do', () => {
  assert.equal(pendingPage(null).take({ ok: true, pages: 9 }), null);
});

test('the engine handles every command the shell can send', () => {
  const bridge = readFileSync(join(import.meta.dirname, '../editor/bridge.ts'), 'utf8');
  const engine = readFileSync(join(import.meta.dirname, '../../../../packages/pdf-editor-engine/core.js'), 'utf8');
  const commands = bridge.slice(bridge.indexOf('export type WebCommand'), bridge.indexOf('export function parseMessage'));
  const types = [...commands.matchAll(/type: '([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(types.includes('goto-page'), String(types));
  for (const t of types) assert.ok(engine.includes(`type === '${t}'`), `core.js handles ${t}`);
});
