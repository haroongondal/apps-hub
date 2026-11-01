import type { RawSql, Row } from '@apps-hub/library-core';
import type { SQLiteDatabase } from 'expo-sqlite';

export function expoRawSql(db: SQLiteDatabase): RawSql {
  return {
    run: async (sql, params) => {
      await db.runAsync(sql, [...params]);
    },
    all: (sql, params) => db.getAllAsync<Row>(sql, [...params]),
    first: (sql, params) => db.getFirstAsync<Row>(sql, [...params]),
    exec: (sql) => db.execAsync(sql),
  };
}
