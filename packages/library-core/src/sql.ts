export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

/** What a driver must provide: four direct calls on one connection. */
export interface RawSql {
  run(sql: string, params: readonly SqlValue[]): Promise<void> | void;
  all(sql: string, params: readonly SqlValue[]): Promise<Row[]> | Row[];
  first(sql: string, params: readonly SqlValue[]): Promise<Row | null> | Row | null;
  exec(sql: string): Promise<void> | void; // several statements, no params
}

/** What the Library and feature stores use. */
export interface SqlPort {
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  all(sql: string, params?: readonly SqlValue[]): Promise<Row[]>;
  first(sql: string, params?: readonly SqlValue[]): Promise<Row | null>;
  exec(sql: string): Promise<void>;
  /** BEGIN IMMEDIATE … COMMIT; ROLLBACK and rethrow on error. No nesting. */
  transaction<T>(fn: (tx: SqlPort) => Promise<T>): Promise<T>;
}

/**
 * One connection, one write queue. Reads go straight through; writes and transactions wait
 * their turn. A transaction hands its callback a port that bypasses the queue (the queue is
 * held by the transaction itself), so the callback must not be awaited from outside it.
 */
export function serialPort(raw: RawSql): SqlPort {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const result = tail.then(job);
    tail = result.catch(() => {}); // a failed job must not wedge the queue
    return result;
  };

  const direct = {
    run: async (sql: string, params: readonly SqlValue[] = []) => {
      await raw.run(sql, params);
    },
    all: async (sql: string, params: readonly SqlValue[] = []) => raw.all(sql, params),
    first: async (sql: string, params: readonly SqlValue[] = []) => raw.first(sql, params),
    exec: async (sql: string) => {
      await raw.exec(sql);
    },
  };

  const tx: SqlPort = {
    ...direct,
    transaction: async () => {
      throw new Error('Nested transactions are not supported');
    },
  };

  return {
    all: direct.all,
    first: direct.first,
    run: (sql, params = []) => enqueue(() => direct.run(sql, params)),
    exec: (sql) => enqueue(() => direct.exec(sql)),
    transaction: <T>(fn: (t: SqlPort) => Promise<T>) =>
      enqueue(async () => {
        await raw.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(tx);
          await raw.exec('COMMIT');
          return result;
        } catch (error) {
          try {
            await raw.exec('ROLLBACK');
          } catch {
            // the original error is the one worth reporting
          }
          throw error;
        }
      }),
  };
}
