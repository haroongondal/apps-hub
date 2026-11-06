import { fromBase64, headerFromJson, headerToJson, toBase64 } from 'strongroom-core';
import type { StoredRecord } from 'strongroom-core';
import type { KV, SyncPort } from './service.ts';

type Stored = { s: string; rev: number; dirty: boolean };
type Quarantined = { id: string; rev: number; s: string };

// Every read-modify-write runs in this one chain, so two quick saves, or a save and a sync's write, never overwrite each other.
let writing: Promise<unknown> = Promise.resolve();
const queued = <T>(run: () => Promise<T>): Promise<T> => {
  const next = writing.then(run, run);
  writing = next;
  return next;
};

const local = () => chrome.storage.local;

// Records saved before sync existed are plain base64; they read as dirty at rev 0, so the first sync uploads them.
async function rows(): Promise<Record<string, Stored>> {
  const { records = {} } = await local().get('records');
  return Object.fromEntries(Object.entries(records as Record<string, string | Stored>).map(([id, v]) => [id, typeof v === 'string' ? { s: v, rev: 0, dirty: true } : v]));
}
const meta = async (): Promise<{ lastRev: number; headerRev: number }> => ({ lastRev: 0, headerRev: 0, ...(await local().get('syncMeta')).syncMeta });
const NEVER_SYNCED = { lastSyncAt: null, blocked: 0, needsSignIn: false };

export const localStore: SyncPort = {
  async getHeader() {
    const { header } = await local().get('header');
    return typeof header === 'string' ? headerFromJson(header) : null;
  },
  async getRecords(): Promise<StoredRecord[]> {
    return Object.entries(await rows()).map(([id, r]) => ({ id, sealed: fromBase64(r.s) }));
  },
  commit({ header, records }) {
    return queued(async () => {
      const next: Record<string, unknown> = {};
      if (header) next.header = headerToJson(header);
      if (records?.length) {
        const all = await rows();
        for (const r of records) all[r.id] = { s: toBase64(r.sealed), rev: all[r.id]?.rev ?? 0, dirty: true };
        next.records = all;
      }
      await local().set(next);
    });
  },

  async getSyncRecords() {
    return Object.entries(await rows()).map(([id, r]) => ({ id, sealed: fromBase64(r.s), rev: r.rev, dirty: r.dirty }));
  },
  getSyncMeta: meta,
  applyPull(p) {
    return queued(async () => {
      const all = await rows();
      const before = await meta();
      let held = false;
      for (const { id, sealed, rev, seen } of p.records) {
        if (seen ? all[id]?.s !== toBase64(seen) : all[id] !== undefined) held = true;
        else all[id] = { s: toBase64(sealed), rev, dirty: false };
      }
      for (const { id, rev } of p.rebase) if (all[id]) all[id].rev = rev;
      const { quarantine = [] } = (await local().get('quarantine')) as { quarantine?: Quarantined[] };
      for (const q of p.quarantine) if (!quarantine.some((k) => k.id === q.id && k.rev === q.rev)) quarantine.push({ id: q.id, rev: q.rev, s: toBase64(q.sealed) });
      await local().set({
        ...(p.header && { header: headerToJson(p.header) }),
        records: all, quarantine, syncMeta: { lastRev: held ? before.lastRev : p.lastRev, headerRev: p.headerRev },
      });
    });
  },
  markPushed(items) {
    return queued(async () => {
      const all = await rows();
      for (const { id, sealed, rev } of items) {
        const r = all[id];
        if (!r) continue;
        r.rev = rev;
        if (r.s === toBase64(sealed)) r.dirty = false;
      }
      await local().set({ records: all });
    });
  },
  async getQuarantine() {
    const { quarantine = [] } = (await local().get('quarantine')) as { quarantine?: Quarantined[] };
    return quarantine.map(({ id, rev }) => ({ id, rev }));
  },

  async getSyncLocal() {
    const { accountKey, syncInfo, pendingAccount } = await local().get(['accountKey', 'syncInfo', 'pendingAccount']);
    return { accountKey: typeof accountKey === 'string' ? fromBase64(accountKey) : null, info: { ...NEVER_SYNCED, ...syncInfo }, pending: pendingAccount ?? null };
  },
  setSyncLocal(patch) {
    return queued(async () => {
      const next: Record<string, unknown> = {};
      if (patch.info) next.syncInfo = patch.info;
      if (patch.pending !== undefined) next.pendingAccount = patch.pending;
      if (patch.headerRev !== undefined) next.syncMeta = { ...(await meta()), headerRev: patch.headerRev };
      await local().set(next);
    });
  },
  setAccount(a) {
    return queued(async () => {
      const next: Record<string, unknown> = { header: headerToJson(a.header), accountKey: toBase64(a.accountKey), syncInfo: a.info, pendingAccount: a.pending };
      if (a.replace) {
        next.records = Object.fromEntries(a.replace.records.map((r) => [r.id, { s: toBase64(r.sealed), rev: r.rev, dirty: false }]));
        next.quarantine = a.replace.quarantine.map((q) => ({ id: q.id, rev: q.rev, s: toBase64(q.sealed) }));
        next.syncMeta = { lastRev: a.replace.lastRev, headerRev: a.headerRev };
      } else {
        next.syncMeta = { ...(await meta()), headerRev: a.headerRev };
      }
      await local().set(next);
    });
  },
};

export const sessionKv: KV = {
  get: async (key) => (await chrome.storage.session.get(key))[key],
  set: (key, value) => chrome.storage.session.set({ [key]: value }),
  remove: (key) => chrome.storage.session.remove(key),
};
