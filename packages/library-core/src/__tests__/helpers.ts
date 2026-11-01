import { Library } from '../library.ts';
import { serialPort } from '../sql.ts';
import { nodeRawSql } from './node-sql.ts';

/** A real in-memory Library with a clock that ticks on every read and ids that count up. */
export async function openLibrary() {
  const db = serialPort(nodeRawSql());
  let t = 1_000;
  let n = 0;
  const lib = await Library.open(db, {
    now: () => ++t,
    newId: () => (++n).toString(36).padStart(16, '0'),
  });
  return { lib, db };
}

export const names = (rows: readonly { name: string }[]) => rows.map((r) => r.name);
export const titles = (rows: readonly { title: string }[]) => rows.map((r) => r.title);
