/**
 * Two SQLite drivers for the {@link VpnNodeCache}: the on-device
 * `expo-sqlite` driver and a Node-only `node:sqlite` driver used by the unit
 * tests. Both are real engines — tests exercise the app's actual SQL with
 * no mocks.
 */
import type * as SQLite from 'expo-sqlite';

export interface SqliteRowSet {
  [column: string]: string | number | null;
}

export type SqlValue = string | number | null;

export interface SqliteDriver {
  run(sql: string, params: readonly SqlValue[]): void | Promise<void>;
  all(
    sql: string,
    params?: readonly SqlValue[],
  ): SqliteRowSet[] | Promise<SqliteRowSet[]>;
  first(
    sql: string,
    params?: readonly SqlValue[],
  ): SqliteRowSet | null | Promise<SqliteRowSet | null>;
  /** Serialized multi-statement transaction. */
  transaction(fn: () => void | Promise<void>): Promise<void> | void;
}

/** Adapts Expo SDK 54's async `SQLiteDatabase` onto the driver contract. */
export function expoSqliteDriver(db: SQLite.SQLiteDatabase): SqliteDriver {
  const binds = (params: readonly SqlValue[]): SQLite.SQLiteBindValue[] => [...params];
  return {
    run: async (sql, params) => {
      await db.runAsync(sql, binds(params));
    },
    all: async (sql, params = []) =>
      (await db.getAllAsync(sql, binds(params))) as SqliteRowSet[],
    first: async (sql, params = []) =>
      (await db.getFirstAsync(sql, binds(params))) as SqliteRowSet | null,
    transaction: async (fn) => {
      await db.withTransactionAsync(async () => {
        await fn();
      });
    },
  };
}

interface NodeStatementLike {
  run(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
  get(...params: SqlValue[]): unknown;
}

interface NodeDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): NodeStatementLike;
}

export interface NodeDatabaseSyncConstructor {
  new (path: string): NodeDatabaseLike;
}

/** Wraps Node's built-in `DatabaseSync` (tests and the smoke tool). */
export function nodeSqliteDriver(
  DatabaseSyncCtor: NodeDatabaseSyncConstructor,
): (path: string) => SqliteDriver {
  return (path: string) => {
    const db = new DatabaseSyncCtor(path);
    return {
      run: (sql, params) => {
        db.prepare(sql).run(...params);
      },
      all: (sql, params = []) =>
        db.prepare(sql).all(...params) as SqliteRowSet[],
      first: (sql, params = []) =>
        (db.prepare(sql).get(...params) as SqliteRowSet | null) ?? null,
      transaction: async (fn) => {
        db.exec('BEGIN IMMEDIATE');
        try {
          await fn();
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    };
  };
}
