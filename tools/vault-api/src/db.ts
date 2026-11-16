import type { AccountCreate, AccountUpdate, PullResponse, PushConflict, PushResponse, Upsert, WireRecord } from 'strongroom-core/src/sync/protocol.ts';

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

export type EscrowSet = { email: string; blob: string; now: number };
export type EscrowChange = { clear: boolean; set: EscrowSet | null };

// The primary key on setup_done is the once-ever guard: a second create fails here even after the account row is deleted.
export async function createAccount(db: Db, a: AccountCreate, escrow?: EscrowSet): Promise<boolean> {
  try {
    const stmts = [
      db.prepare("INSERT INTO meta (k, v) VALUES ('setup_done', '1')"),
      db
        .prepare('INSERT INTO account (id, header, header_rev, login_hash, recovery_hash, read_hash) VALUES (1, ?, 1, ?, ?, ?)')
        .bind(a.header, a.loginHash, a.recoveryHash, a.readHash),
    ];
    if (escrow) stmts.push(db.prepare('INSERT INTO escrow (id, email, blob, created_at) VALUES (1, ?, ?, ?)').bind(escrow.email, escrow.blob, escrow.now));
    await db.batch(stmts);
    return true;
  } catch (e) {
    if (await db.prepare("SELECT 1 AS done FROM meta WHERE k = 'setup_done'").first()) return false;
    throw e;
  }
}

// Escrow/lost_request run first, sharing the account UPDATE's exact precondition (header_rev = ifRev, read pre-write), so a stale
// ifRev leaves all three rows untouched; the UPDATE runs last so its failure rolls back the escrow/lost_request writes ahead of it.
export async function updateAccount(db: Db, a: Omit<AccountUpdate, 'ifRev'>, ifRev: number, escrow: EscrowChange = { clear: false, set: null }): Promise<number | null> {
  const unmoved = 'EXISTS (SELECT 1 FROM account WHERE id = 1 AND header_rev = ?)';
  const stmts: Stmt[] = [];
  if (escrow.clear) {
    stmts.push(db.prepare(`DELETE FROM escrow WHERE id = 1 AND ${unmoved}`).bind(ifRev));
    stmts.push(db.prepare(`DELETE FROM lost_request WHERE id = 1 AND ${unmoved}`).bind(ifRev));
  }
  if (escrow.set) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO escrow (id, email, blob, created_at) SELECT 1, ?, ?, ? WHERE ${unmoved}
           ON CONFLICT (id) DO UPDATE SET email = excluded.email, blob = excluded.blob, created_at = excluded.created_at`,
        )
        .bind(escrow.set.email, escrow.set.blob, escrow.set.now, ifRev),
    );
  }
  const updateIndex = stmts.length;
  stmts.push(
    db
      .prepare(
        'UPDATE account SET header = ?, header_rev = header_rev + 1, login_hash = ?, recovery_hash = COALESCE(?, recovery_hash), read_hash = ? WHERE id = 1 AND header_rev = ? RETURNING header_rev AS headerRev',
      )
      .bind(a.header, a.loginHash, a.recoveryHash ?? null, a.readHash, ifRev),
  );
  const results = await db.batch(stmts);
  return (results[updateIndex].results[0] as { headerRev: number } | undefined)?.headerRev ?? null;
}

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

export type Escrow = { email: string; blob: string; createdAt: number };
export const getEscrow = (db: Db) => db.prepare('SELECT email, blob, created_at AS createdAt FROM escrow WHERE id = 1').first<Escrow>();

export const setEscrow = (db: Db, email: string, blob: string, now: number) =>
  db
    .prepare(
      'INSERT INTO escrow (id, email, blob, created_at) VALUES (1, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET email = excluded.email, blob = excluded.blob, created_at = excluded.created_at',
    )
    .bind(email, blob, now)
    .all();

export const clearEscrow = (db: Db) => db.batch([db.prepare('DELETE FROM escrow WHERE id = 1'), db.prepare('DELETE FROM lost_request WHERE id = 1')]);

export type LostRequest = { claimHash: string; confirmHash: string; requestedAt: number; releaseAt: number | null; cancelled: number };
export const getLostRequest = (db: Db) =>
  db
    .prepare('SELECT claim_hash AS claimHash, confirm_hash AS confirmHash, requested_at AS requestedAt, release_at AS releaseAt, cancelled FROM lost_request WHERE id = 1')
    .first<LostRequest>();

// Atomic claim-or-skip, one write per race. A confirmed row is replaceable only graceMs after release_at — not the
// instant it releases — so a stranger can't wipe it out from under the real claimant before they call /lost/release.
export const claimLostRequest = async (db: Db, claimHash: string, confirmHash: string, now: number, cooldownMs: number, graceMs: number): Promise<boolean> =>
  (await db
    .prepare(
      `INSERT INTO lost_request (id, claim_hash, confirm_hash, requested_at, release_at, cancelled) VALUES (1, ?, ?, ?, NULL, 0)
       ON CONFLICT (id) DO UPDATE SET claim_hash = excluded.claim_hash, confirm_hash = excluded.confirm_hash, requested_at = excluded.requested_at, release_at = NULL, cancelled = 0
       WHERE lost_request.cancelled = 1
          OR (lost_request.release_at IS NULL AND ? - lost_request.requested_at >= ?)
          OR (lost_request.release_at IS NOT NULL AND ? >= lost_request.release_at + ?)
       RETURNING id`,
    )
    .bind(claimHash, confirmHash, now, now, cooldownMs, now, graceMs)
    .first()) !== null;

// release_at IS NULL means not yet confirmed: a second confirm of an already-confirmed (or already-released) request is a no-op, not a fresh 24-hour wait.
export const confirmLostRequest = async (db: Db, confirmHash: string, releaseAt: number): Promise<boolean> =>
  (await db.prepare('UPDATE lost_request SET release_at = ? WHERE id = 1 AND confirm_hash = ? AND cancelled = 0 AND release_at IS NULL RETURNING id').bind(releaseAt, confirmHash).first()) !== null;

export const cancelLostRequestByToken = async (db: Db, confirmHash: string): Promise<void> => {
  await db.prepare('UPDATE lost_request SET cancelled = 1 WHERE id = 1 AND confirm_hash = ?').bind(confirmHash).all();
};

export const cancelLostRequest = async (db: Db): Promise<void> => {
  await db.prepare('UPDATE lost_request SET cancelled = 1 WHERE id = 1').all();
};

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
