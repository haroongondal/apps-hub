import type { AccountPut, PullResponse, PushConflict, PushResponse, Upsert, WireRecord } from 'strongroom-core/src/sync/protocol.ts';

export type Row = Record<string, unknown>;
export interface Result { results: Row[] }
export interface Stmt {
  bind(...values: (string | number | null)[]): Stmt;
  first<T = Row>(): Promise<T | null>;
  all<T = Row>(): Promise<{ results: T[] }>;
}
export interface Db { prepare(sql: string): Stmt; batch(stmts: Stmt[]): Promise<Result[]> }

export type Account = { header: string; headerRev: number; loginHash: string; recoveryHash: string; readHash: string };

export const getAccount = (db: Db) =>
  db
    .prepare('SELECT header, header_rev AS headerRev, login_hash AS loginHash, recovery_hash AS recoveryHash, read_hash AS readHash FROM account WHERE id = 1')
    .first<Account>();

// The primary key on setup_done is the once-ever guard: a second create fails here even after the account row is deleted.
export async function createAccount(db: Db, a: AccountPut): Promise<boolean> {
  try {
    await db.batch([
      db.prepare("INSERT INTO meta (k, v) VALUES ('setup_done', '1')"),
      db
        .prepare('INSERT INTO account (id, header, header_rev, login_hash, recovery_hash, read_hash) VALUES (1, ?, 1, ?, ?, ?)')
        .bind(a.header, a.loginHash, a.recoveryHash, a.readHash),
    ]);
    return true;
  } catch (e) {
    if (await db.prepare("SELECT 1 AS done FROM meta WHERE k = 'setup_done'").first()) return false;
    throw e;
  }
}

export const updateAccount = async (db: Db, a: AccountPut, ifRev: number): Promise<number | null> =>
  (
    await db
      .prepare(
        'UPDATE account SET header = ?, header_rev = header_rev + 1, login_hash = ?, recovery_hash = ?, read_hash = ? WHERE id = 1 AND header_rev = ? RETURNING header_rev AS headerRev',
      )
      .bind(a.header, a.loginHash, a.recoveryHash, a.readHash, ifRev)
      .first<{ headerRev: number }>()
  )?.headerRev ?? null;

export async function pull(db: Db, since: number, limit: number): Promise<PullResponse | null> {
  const [account, records, meta] = await db.batch([
    db.prepare('SELECT header, header_rev AS headerRev FROM account WHERE id = 1'),
    db.prepare('SELECT id, rev, ciphertext, updated_at AS updatedAt FROM records WHERE rev > ? ORDER BY rev LIMIT ?').bind(since, limit + 1),
    db.prepare("SELECT CAST(v AS INTEGER) - 1 AS latestRev FROM meta WHERE k = 'next_rev'"),
  ]);
  const a = account.results[0] as { header: string; headerRev: number } | undefined;
  if (!a) return null;
  const rows = records.results as WireRecord[];
  const latestRev = meta.results[0].latestRev as number;
  return { header: a.header, headerRev: a.headerRev, records: rows.slice(0, limit), latestRev, more: rows.length > limit };
}

// A stale baseRev (or 0 for an id that exists) sets rev to NULL, and NOT NULL makes that an error that rolls back the whole batch.
const UPSERT = `INSERT INTO records (id, rev, ciphertext, updated_at)
  VALUES (?, (SELECT CAST(v AS INTEGER) FROM meta WHERE k = 'next_rev') + ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET rev = CASE WHEN records.rev = ? THEN excluded.rev END,
    ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`;

async function stale(db: Db, ups: Upsert[]): Promise<{ id: string; rev: number }[]> {
  const { results } = await db
    .prepare('SELECT id, rev FROM records WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(ups.map((u) => u.id)))
    .all<{ id: string; rev: number }>();
  const revs = new Map(results.map((r) => [r.id, r.rev]));
  return ups.filter((u) => (revs.get(u.id) ?? 0) !== u.baseRev).map((u) => ({ id: u.id, rev: revs.get(u.id) ?? 0 }));
}

export async function push(db: Db, ups: Upsert[], now: number): Promise<PushResponse | PushConflict> {
  const conflicts = await stale(db, ups);
  if (conflicts.length) return { conflicts };
  const writes = ups.map((u, i) => db.prepare(UPSERT).bind(u.id, i, u.ciphertext, now, u.baseRev));
  const bump = db
    .prepare("UPDATE meta SET v = CAST(v AS INTEGER) + ? WHERE k = 'next_rev' RETURNING CAST(v AS INTEGER) - 1 AS latestRev")
    .bind(ups.length);
  try {
    const results = await db.batch([...writes, bump]);
    const latestRev = results[results.length - 1].results[0].latestRev as number;
    return { revs: ups.map((u, i) => ({ id: u.id, rev: latestRev - ups.length + 1 + i })), latestRev };
  } catch (e) {
    const lost = await stale(db, ups);
    if (lost.length) return { conflicts: lost };
    throw e;
  }
}
