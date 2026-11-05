// The reference SyncStore for tests (here and in tools/vault-api): the extension's chrome.storage store and the Kotlin SQLite store must behave the same.
import { equalBytes } from '../crypto.ts';
import type { Header } from '../format.ts';
import type { SyncRecord, SyncStore } from '../sync/client.ts';
import type { StoredRecord } from '../vault.ts';

type Row = { id: string; sealed: Uint8Array; rev: number };

export class MemorySyncStore implements SyncStore {
  header: Header | null = null;
  records = new Map<string, { sealed: Uint8Array; rev: number; dirty: boolean }>();
  meta = { lastRev: 0, headerRev: 0 };
  quarantine: Row[] = [];
  writes = 0;

  async getHeader() { return this.header; }
  async getRecords(): Promise<StoredRecord[]> { return [...this.records].map(([id, r]) => ({ id, sealed: r.sealed })); }
  async commit(change: { header?: Header; records?: StoredRecord[] }) {
    this.writes++;
    if (change.header) this.header = change.header;
    for (const r of change.records ?? []) this.records.set(r.id, { sealed: r.sealed, rev: this.records.get(r.id)?.rev ?? 0, dirty: true });
  }

  async getSyncRecords(): Promise<SyncRecord[]> { return [...this.records].map(([id, r]) => ({ id, ...r })); }
  async getSyncMeta() { return { ...this.meta }; }
  async applyPull(p: Parameters<SyncStore['applyPull']>[0]) {
    this.writes++;
    if (p.header) this.header = p.header;
    let held = false;
    for (const { id, sealed, rev, seen } of p.records) {
      const now = this.records.get(id)?.sealed;
      if (seen ? !now || !equalBytes(now, seen) : now !== undefined) held = true;
      else this.records.set(id, { sealed, rev, dirty: false });
    }
    this.meta = { lastRev: held ? this.meta.lastRev : p.lastRev, headerRev: p.headerRev };
    for (const q of p.quarantine) if (!this.quarantine.some((k) => k.id === q.id && k.rev === q.rev)) this.quarantine.push(q);
    for (const { id, rev } of p.rebase) {
      const r = this.records.get(id);
      if (r) r.rev = rev;
    }
  }
  async markPushed(items: Row[]) {
    this.writes++;
    for (const { id, rev, sealed } of items) {
      const r = this.records.get(id);
      if (!r) continue;
      r.rev = rev; // the server now holds the pushed bytes at this rev, so it is the base of any newer edit too
      if (equalBytes(r.sealed, sealed)) r.dirty = false;
    }
  }
  async getQuarantine() { return this.quarantine.map(({ id, rev }) => ({ id, rev })); }
}
