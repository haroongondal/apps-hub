import test from 'node:test';
import assert from 'node:assert/strict';

import { LibraryError } from '../errors.ts';
import { migrate } from '../migrate.ts';
import { serialPort } from '../sql.ts';
import { nodeRawSql } from './node-sql.ts';

const open = () => serialPort(nodeRawSql());
const tables = async (db: ReturnType<typeof open>) =>
  (await db.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((r) => r.name);

test('a fresh database applies every step and records the version', async () => {
  const db = open();
  const version = await migrate(db, 'a', ['CREATE TABLE a1 (x)', 'CREATE TABLE a2 (x)']);
  assert.equal(version, 2);
  assert.deepEqual(await tables(db), ['a1', 'a2', 'schema_tracks']);
  assert.deepEqual(await db.first("SELECT version FROM schema_tracks WHERE track = 'a'"), { version: 2 });
});

test('running the same steps again changes nothing', async () => {
  const db = open();
  const steps = ['CREATE TABLE a1 (x)']; // would throw if applied twice
  await migrate(db, 'a', steps);
  assert.equal(await migrate(db, 'a', steps), 1);
});

test('only the appended steps run on the next start', async () => {
  const db = open();
  await migrate(db, 'a', ['CREATE TABLE a1 (x)']);
  assert.equal(await migrate(db, 'a', ['CREATE TABLE a1 (x)', 'CREATE TABLE a2 (x)']), 2);
  assert.deepEqual(await tables(db), ['a1', 'a2', 'schema_tracks']);
});

test('tracks keep separate versions', async () => {
  const db = open();
  await migrate(db, 'library', ['CREATE TABLE l1 (x)']);
  await migrate(db, 'scan', ['CREATE TABLE s1 (x)', 'CREATE TABLE s2 (x)']);
  await migrate(db, 'library', ['CREATE TABLE l1 (x)', 'CREATE TABLE l2 (x)']);
  const rows = await db.all('SELECT track, version FROM schema_tracks ORDER BY track');
  assert.deepEqual(rows, [
    { track: 'library', version: 2 },
    { track: 'scan', version: 2 },
  ]);
});

test('a database newer than the code is refused with too_new and left alone', async () => {
  const db = open();
  await migrate(db, 'a', ['CREATE TABLE a1 (x)', 'CREATE TABLE a2 (x)']);
  await assert.rejects(migrate(db, 'a', ['CREATE TABLE a1 (x)']), (e: unknown) => {
    assert.ok(e instanceof LibraryError);
    assert.equal(e.code, 'too_new');
    return true;
  });
  assert.deepEqual(await db.first("SELECT version FROM schema_tracks WHERE track = 'a'"), { version: 2 });
});

test('a failing step rolls the whole run back', async () => {
  const db = open();
  await assert.rejects(migrate(db, 'a', ['CREATE TABLE a1 (x)', 'CREATE TABLE a1 (x)']));
  assert.deepEqual(await tables(db), ['schema_tracks']);
  assert.equal(await db.first("SELECT version FROM schema_tracks WHERE track = 'a'"), null);
});
