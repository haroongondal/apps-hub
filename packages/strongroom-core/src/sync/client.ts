import { headerFromJson, headerToJson, openEntry, toBase64 } from '../format.ts';
import type { Header } from '../format.ts';
import type { RecordStore, StoredRecord } from '../vault.ts';
import { planMerge } from './merge.ts';
import type { MergeRemote } from './merge.ts';
import { LIMITS } from './protocol.ts';
import { pullAll, SyncHttpError, SyncRollbackError } from './transport.ts';
import type { Transport } from './transport.ts';

export type SyncRecord = StoredRecord & { rev: number; dirty: boolean };
type Row = { id: string; sealed: Uint8Array; rev: number };

// commit({ records }) marks them dirty. applyPull is one atomic write and leaves what it writes clean. markPushed sets each rev but clears dirty only where the stored bytes still equal the pushed ones, so an edit made during the push stays dirty.
export interface SyncStore extends RecordStore {
  getSyncRecords(): Promise<SyncRecord[]>;
  getSyncMeta(): Promise<{ lastRev: number; headerRev: number }>;
  applyPull(p: { header?: Header; headerRev: number; records: Row[]; quarantine: Row[]; lastRev: number }): Promise<void>;
  markPushed(items: Row[]): Promise<void>;
  getQuarantine(): Promise<{ id: string; rev: number }[]>;
}

export type SyncReport = { pulled: number; pushed: number; conflicts: number; quarantined: number; blocked: number; headerChanged: boolean };

const row = ({ id, sealed, rev }: Row): Row => ({ id, sealed, rev });

export async function syncOnce(d: { store: SyncStore; transport: Transport; vaultKey: Uint8Array; token: Uint8Array; maxRetries?: number }): Promise<SyncReport> {
  const { store, transport, vaultKey, token, maxRetries = 3 } = d;
  const report: SyncReport = { pulled: 0, pushed: 0, conflicts: 0, quarantined: 0, blocked: 0, headerChanged: false };
  const blocked = new Set<string>();
  let skipped = 0;
  for (let round = 0; ; round++) {
    const meta = await store.getSyncMeta();
    const pulled = await pullAll(transport, token, meta.lastRev);
    if (!(pulled.headerRev >= meta.headerRev)) throw new SyncRollbackError();
    const remoteIds = new Set(pulled.rows.map((r) => r.id));
    const local = (await store.getSyncRecords()).filter((r) => r.dirty || remoteIds.has(r.id));
    const plan = planMerge(
      await Promise.all(local.map(async (r) => ({ ...r, entry: await openEntry(vaultKey, r.id, r.sealed) }))),
      await Promise.all(
        pulled.rows.map(async (r): Promise<MergeRemote> =>
          r.sealed ? { ...r, sealed: r.sealed, entry: await openEntry(vaultKey, r.id, r.sealed) } : { ...r, sealed: new Uint8Array(0), entry: null }),
      ),
    );

    const header = headerFromJson(pulled.header);
    const localHeader = await store.getHeader();
    const sameHeader = header !== null && localHeader !== null && headerToJson(header) === headerToJson(localHeader);
    report.headerChanged ||= !sameHeader;
    await store.applyPull({
      headerRev: sameHeader ? pulled.headerRev : meta.headerRev,
      records: plan.adopt.map(row),
      quarantine: plan.quarantine.map(row),
      lastRev: pulled.latestRev,
    });
    report.pulled += plan.adopt.length;
    report.conflicts += plan.conflicts;
    report.quarantined += plan.quarantine.length;
    skipped += pulled.skipped;
    for (const id of plan.blocked) blocked.add(id);

    // Never upload over a server version this device could not read (even one quarantined by an earlier sync), and never send a record over the size limit, whose 413 would fail the whole batch.
    const quarantine = await store.getQuarantine();
    const sealedOf = new Map(local.map((r) => [r.id, r.sealed]));
    const push = plan.push.filter((p) => {
      const skip = quarantine.some((q) => q.id === p.id && q.rev > p.baseRev) || Math.ceil(sealedOf.get(p.id)!.length / 3) * 4 > LIMITS.maxCiphertextChars;
      if (skip) blocked.add(p.id);
      return !skip;
    });
    let conflicted = false;
    for (let i = 0; i < push.length && !conflicted; i += LIMITS.maxUpserts) {
      const chunk = push.slice(i, i + LIMITS.maxUpserts).map((p) => ({ ...p, sealed: sealedOf.get(p.id)! }));
      const res = await transport.push(token, { upserts: chunk.map((c) => ({ id: c.id, baseRev: c.baseRev, ciphertext: toBase64(c.sealed) })) });
      if ('conflicts' in res) {
        conflicted = true;
        continue;
      }
      const revs = new Map(res.revs.map((r) => [r.id, r.rev]));
      const done = chunk.flatMap((c) => {
        const rev = revs.get(c.id);
        return rev !== undefined && Number.isSafeInteger(rev) ? [{ id: c.id, sealed: c.sealed, rev }] : [];
      });
      await store.markPushed(done);
      report.pushed += done.length;
    }
    report.blocked = blocked.size + skipped;
    if (!conflicted) return report;
    if (round >= maxRetries) throw new SyncHttpError(409, 'Another device kept changing the same entries. Sync again in a moment.');
  }
}
