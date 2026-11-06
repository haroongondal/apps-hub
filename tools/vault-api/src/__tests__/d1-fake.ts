import type { DatabaseSync } from 'node:sqlite';
import type { Db, Result, Row, Stmt } from '../db.ts';

type FakeStmt = Stmt & { exec(): Result };

// The D1 subset the Worker uses, over node:sqlite. Like D1, `batch` is one transaction that rolls back if any statement throws.
export function d1FromNodeSqlite(db: DatabaseSync): Db {
  const stmt = (sql: string, params: (string | number | null)[] = []): FakeStmt => {
    const exec = (): Result => ({ results: (db.prepare(sql).all(...params) as Row[]).map((r) => ({ ...r })) });
    return {
      exec,
      bind: (...values) => stmt(sql, values),
      first: async <T = Row>() => (exec().results[0] ?? null) as T | null,
      all: async <T = Row>() => exec() as { results: T[] },
    };
  };
  return {
    prepare: (sql) => stmt(sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => (s as FakeStmt).exec());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
