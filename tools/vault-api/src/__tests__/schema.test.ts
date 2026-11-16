import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migration = readFileSync(new URL('../../migrations/0001_init.sql', import.meta.url), 'utf8');
const escrowMigration = readFileSync(new URL('../../migrations/0002_escrow.sql', import.meta.url), 'utf8');

function fresh() {
  const db = new DatabaseSync(':memory:');
  db.exec(migration);
  return db;
}

function freshWithEscrow() {
  const db = fresh();
  db.exec(escrowMigration);
  return db;
}

const plain = (rows: unknown[]) => rows.map((r) => ({ ...(r as object) }));

test('migrationCreatesTheTablesTheRevIndexAndTheSeeds', () => {
  const db = fresh();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  assert.deepEqual(plain(tables), [{ name: 'account' }, { name: 'auth_state' }, { name: 'meta' }, { name: 'records' }]);
  const index = db.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all() as { tbl_name: string; sql: string }[];
  assert.equal(index.length, 1);
  assert.equal(index[0].tbl_name, 'records');
  assert.match(String(index[0].sql), /\(rev\)/);
  assert.deepEqual(plain(db.prepare('SELECT k, v FROM meta').all()), [{ k: 'next_rev', v: '1' }]);
  assert.deepEqual(plain(db.prepare('SELECT id, failures FROM auth_state').all()), [{ id: 1, failures: 0 }]);
  assert.deepEqual(plain(db.prepare('SELECT * FROM account').all()), []);
});

test('accountAndAuthStateHoldOneRowOnly', () => {
  const db = fresh();
  db.exec("INSERT INTO account (id, header, header_rev) VALUES (1, '{}', 1)");
  assert.throws(() => db.exec("INSERT INTO account (id, header, header_rev) VALUES (2, '{}', 1)"), /CHECK constraint failed/);
  assert.throws(() => db.exec('INSERT INTO auth_state (id, failures) VALUES (2, 0)'), /CHECK constraint failed/);
});

test('recordRevAndCiphertextAreRequired', () => {
  const db = fresh();
  assert.throws(() => db.exec("INSERT INTO records (id, rev, ciphertext, updated_at) VALUES ('a', NULL, 'x', 1)"), /NOT NULL/);
  assert.throws(() => db.exec("INSERT INTO records (id, rev, ciphertext, updated_at) VALUES ('a', 1, NULL, 1)"), /NOT NULL/);
  db.exec("INSERT INTO records (id, rev, ciphertext, updated_at) VALUES ('a', 1, 'x', 1)");
  assert.throws(() => db.exec("INSERT INTO records (id, rev, ciphertext, updated_at) VALUES ('a', 2, 'y', 1)"), /UNIQUE/);
});

test('escrowMigrationAddsEscrowAndLostRequestHoldingOneRowEach', () => {
  const db = freshWithEscrow();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  assert.deepEqual(plain(tables), [{ name: 'account' }, { name: 'auth_state' }, { name: 'escrow' }, { name: 'lost_request' }, { name: 'meta' }, { name: 'records' }]);

  db.exec("INSERT INTO escrow (id, email, blob, created_at) VALUES (1, 'a@example.com', 'blob', 1)");
  assert.throws(() => db.exec("INSERT INTO escrow (id, email, blob, created_at) VALUES (2, 'b@example.com', 'blob', 1)"), /CHECK constraint failed/);

  db.exec("INSERT INTO lost_request (id, claim_hash, confirm_hash, requested_at) VALUES (1, 'c', 'd', 1)");
  assert.throws(() => db.exec("INSERT INTO lost_request (id, claim_hash, confirm_hash, requested_at) VALUES (2, 'c', 'd', 1)"), /CHECK constraint failed/);
  assert.deepEqual(plain(db.prepare('SELECT release_at AS releaseAt, cancelled FROM lost_request').all()), [{ releaseAt: null, cancelled: 0 }]);
});
