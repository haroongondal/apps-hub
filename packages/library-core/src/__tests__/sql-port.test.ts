import test from 'node:test';
import assert from 'node:assert/strict';

import { serialPort } from '../sql.ts';
import type { RawSql, SqlPort } from '../sql.ts';
import { nodeRawSql } from './node-sql.ts';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function open(): { port: SqlPort; raw: RawSql } {
  const raw = nodeRawSql();
  raw.exec('CREATE TABLE t (n INTEGER)');
  return { port: serialPort(raw), raw };
}

/** Wraps a driver so every call is logged and writes take a few ms (to expose interleaving). */
function slowWrites(inner: RawSql, log: string[]): RawSql {
  return {
    run: async (sql, params) => {
      log.push(`start ${sql}`);
      await wait(5);
      await inner.run(sql, params);
      log.push(`end ${sql}`);
    },
    all: (sql, params) => inner.all(sql, params),
    first: (sql, params) => inner.first(sql, params),
    exec: async (sql) => {
      log.push(`start ${sql}`);
      await wait(5);
      await inner.exec(sql);
      log.push(`end ${sql}`);
    },
  };
}

test('writes run one at a time, in the order they were issued', async () => {
  const log: string[] = [];
  const raw = nodeRawSql();
  raw.exec('CREATE TABLE t (n INTEGER)');
  const port = serialPort(slowWrites(raw, log));
  await Promise.all([
    port.run('INSERT INTO t VALUES (1)'),
    port.run('INSERT INTO t VALUES (2)'),
    port.run('INSERT INTO t VALUES (3)'),
  ]);
  const starts = log.filter((l) => l.startsWith('start'));
  assert.equal(starts.length, 3);
  // Each write ends before the next one starts.
  for (let i = 0; i < log.length; i += 2) {
    assert.ok(log[i].startsWith('start') && log[i + 1].startsWith('end'), log.join(' | '));
  }
  assert.deepEqual((await port.all('SELECT n FROM t ORDER BY rowid')).map((r) => r.n), [1, 2, 3]);
});

test('a write issued during a transaction waits for it to finish', async () => {
  const { port } = open();
  const order: string[] = [];
  const tx = port.transaction(async (t) => {
    await t.run('INSERT INTO t VALUES (1)');
    await wait(20);
    order.push('tx done');
  });
  await wait(2);
  const outside = port.run('INSERT INTO t VALUES (99)').then(() => order.push('outside done'));
  await Promise.all([tx, outside]);
  assert.deepEqual(order, ['tx done', 'outside done']);
});

test('reads see the committed rows and do not wait for the write queue', async () => {
  const { port } = open();
  await port.run('INSERT INTO t VALUES (7)');
  assert.deepEqual(await port.first('SELECT n FROM t'), { n: 7 });
  assert.equal(await port.first('SELECT n FROM t WHERE n = ?', [8]), null);
});

test('a throwing transaction rolls back and rethrows the original error', async () => {
  const { port } = open();
  await port.run('INSERT INTO t VALUES (1)');
  await assert.rejects(
    port.transaction(async (t) => {
      await t.run('INSERT INTO t VALUES (2)');
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.deepEqual((await port.all('SELECT n FROM t')).map((r) => r.n), [1]);
  // The queue is not wedged: a later write still works.
  await port.run('INSERT INTO t VALUES (3)');
  assert.deepEqual((await port.all('SELECT n FROM t ORDER BY n')).map((r) => r.n), [1, 3]);
});

test('a commit makes the transaction visible', async () => {
  const { port } = open();
  const result = await port.transaction(async (t) => {
    await t.run('INSERT INTO t VALUES (5)');
    return (await t.first('SELECT COUNT(*) AS c FROM t'))?.c;
  });
  assert.equal(result, 1);
  assert.deepEqual(await port.first('SELECT COUNT(*) AS c FROM t'), { c: 1 });
});

test('tx.transaction throws instead of nesting', async () => {
  const { port } = open();
  await assert.rejects(
    port.transaction(async (t) => {
      await t.transaction(async () => {});
    }),
    /nested/i,
  );
  // The outer transaction rolled back and released the queue.
  await port.run('INSERT INTO t VALUES (1)');
});

test('a failed write does not block the queue', async () => {
  const { port } = open();
  await assert.rejects(port.run('INSERT INTO nope VALUES (1)'));
  await port.run('INSERT INTO t VALUES (1)');
  assert.deepEqual(await port.first('SELECT COUNT(*) AS c FROM t'), { c: 1 });
});
