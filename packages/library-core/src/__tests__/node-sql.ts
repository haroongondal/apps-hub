/** Test driver: the app's RawSql contract over Node's built-in SQLite (a real engine, no mocks). */
import { DatabaseSync } from 'node:sqlite';

import type { RawSql, Row, SqlValue } from '../sql.ts';

/** node:sqlite rows have a null prototype; expo-sqlite's are plain objects. */
const plain = (row: unknown): Row => ({ ...(row as Row) });

export function nodeRawSql(path = ':memory:'): RawSql & { close(): void } {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  return {
    run: (sql, params) => {
      db.prepare(sql).run(...(params as SqlValue[]));
    },
    all: (sql, params) => db.prepare(sql).all(...(params as SqlValue[])).map(plain),
    first: (sql, params) => {
      const row = db.prepare(sql).get(...(params as SqlValue[]));
      return row === undefined ? null : plain(row);
    },
    exec: (sql) => {
      db.exec(sql);
    },
    close: () => db.close(),
  };
}
