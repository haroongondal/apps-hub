import type { ItemSource, SourceApp } from '@apps-hub/library-core';

import { pruneConcepts, type Knowledge } from './knowledge.ts';

export type SourceStatus = 'ready' | 'off' | 'missing';

export interface SourceRow {
  id: number;
  text: string;
  at: number;
  from: string | null;
}

/** A reader throws or returns null when the app could not be read, so an unreachable app never looks empty and nothing is deleted. */
export type SourceProvider = PagedSource | SnapshotSource;
export interface PagedSource {
  status(): Promise<SourceStatus>;
  items(sinceId: number, limit: number): Promise<unknown[] | null>;
  liveIds(sinceId: number): Promise<unknown[] | null>;
}
export interface SnapshotSource {
  status(): Promise<SourceStatus>;
  snapshot(): Promise<unknown[] | null>;
}

export interface SwitchStore {
  get(app: SourceApp): Promise<boolean>;
  set(app: SourceApp, on: boolean): Promise<void>;
}

export interface SyncReport {
  status: SourceStatus | 'disabled' | 'failed';
  added: number;
  updated: number;
  removed: number;
  error?: string;
}

export const MAX_SOURCE_TEXT = 8000;
const MAX_FROM = 60;
const MAX_ID_PAGES = 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NAMES: Record<SourceApp, { app: string; thing: string }> = {
  inflow: { app: 'Inflow', thing: 'message' },
  clipboard: { app: 'Clipboard', thing: 'pin' },
  deputy: { app: 'Deputy', thing: 'run' },
};
const LINE_BREAKS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;
const CONTROL_BUT_LINES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const OTP_WORDS = 'otp|one[- ]?time|verification|verify|passcode|pass code|security code|log[- ]?in code|sign[- ]?in code|auth(?:entication)? code|2fa|code';
const DIGITS = '\\b\\d{4,8}\\b';
const OTP_NEAR = new RegExp(`\\b(?:${OTP_WORDS})\\b[\\s\\S]{0,40}${DIGITS}|${DIGITS}[\\s\\S]{0,40}\\b(?:${OTP_WORDS})\\b`, 'i');
const BARE_CODE = /^\s*(?:[a-z]{1,3}-)?\d{4,8}\s*\.?\s*$/i;

const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const markKey = (app: SourceApp) => `source_mark:${app}`;
const rescanKey = (app: SourceApp) => `source_rescan:${app}`;
const SET_META = 'INSERT INTO kn_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value';

export const dayLabel = (ms: number) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

export const sourceLabel = (s: Pick<ItemSource, 'app' | 'sourceAt'>) => `From ${NAMES[s.app].app} ${NAMES[s.app].thing}, ${dayLabel(s.sourceAt)}`;

export function sourceTitle(app: SourceApp, row: SourceRow): string {
  const day = dayLabel(row.at);
  if (app === 'inflow') return row.from ? `Message from ${row.from}, ${day}` : `Message, ${day}`;
  return app === 'clipboard' ? `Pinned clip, ${day}` : `Deputy run, ${day}`;
}

export const sourceBody = (app: SourceApp, row: SourceRow) =>
  `${sourceLabel({ app, sourceAt: row.at })}${row.from ? `, from ${row.from}` : ''}\n\n${row.text}`;

export const looksLikeOneTimeCode = (text: string) => BARE_CODE.test(text) || OTP_NEAR.test(text);

function cutText(text: string): string {
  const cut = text.slice(0, MAX_SOURCE_TEXT);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

export function cleanRow(raw: unknown): SourceRow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, text, at, from } = raw as Record<string, unknown>;
  if (!isId(id) || typeof text !== 'string' || !Number.isSafeInteger(at) || (at as number) < 0) return null;
  if (from !== undefined && from !== null && typeof from !== 'string') return null;
  const body = cutText(text.replace(CONTROL_BUT_LINES, ' ').trim()).trim();
  if (!body) return null;
  const sender = typeof from === 'string' ? from.replace(LINE_BREAKS, ' ').trim().slice(0, MAX_FROM).trim() : '';
  return { id, text: body, at: at as number, from: sender || null };
}

const answer = (x: unknown[] | null, what: string): unknown[] => {
  if (!Array.isArray(x)) throw new Error(`The app did not answer the ${what} request.`);
  return x;
};
const idOf = (raw: unknown): number | null => {
  const id = typeof raw === 'object' && raw !== null ? (raw as { id?: unknown }).id : undefined;
  return isId(id) ? id : null;
};

class Stale extends Error {}

export class SourceSync {
  private readonly kn: Knowledge;
  private readonly providers: Partial<Record<SourceApp, SourceProvider>>;
  private readonly switches: SwitchStore;
  private readonly epochs = new Map<SourceApp, number>();

  constructor(kn: Knowledge, providers: Partial<Record<SourceApp, SourceProvider>>, switches: SwitchStore) {
    this.kn = kn;
    this.providers = providers;
    this.switches = switches;
  }

  private epoch = (app: SourceApp) => this.epochs.get(app) ?? 0;

  turnOn(app: SourceApp): Promise<void> {
    return this.switches.set(app, true);
  }

  async turnOff(app: SourceApp): Promise<number> {
    this.epochs.set(app, this.epoch(app) + 1);
    await this.switches.set(app, false);
    return this.wipe(app);
  }

  private async wipe(app: SourceApp): Promise<number> {
    const db = this.kn.lib.db;
    const removed = await this.kn.lib.deleteAllFromSource(app);
    await pruneConcepts(db);
    await db.run('DELETE FROM kn_meta WHERE key IN (?, ?)', [markKey(app), rescanKey(app)]);
    return removed;
  }

  async run(app: SourceApp, o: { maxNew?: number } = {}): Promise<SyncReport> {
    const report: SyncReport = { status: 'disabled', added: 0, updated: 0, removed: 0 };
    const epoch = this.epoch(app);
    if (!(await this.switches.get(app))) return this.wipeLeftovers(app, report);
    const provider = this.providers[app];
    if (!provider) return { ...report, status: 'missing' };
    try {
      report.status = await provider.status();
      if (report.status !== 'ready') return report;
      // No await between live() and the write it guards, or turnOff's wipe could run before that write.
      const live = () => {
        if (this.epoch(app) !== epoch) throw new Stale();
      };
      const maxNew = Math.max(0, Math.floor(o.maxNew ?? 50));
      if ('snapshot' in provider) await this.fromSnapshot(app, provider, maxNew, live, report);
      else await this.fromPages(app, provider, maxNew, live, report);
    } catch (e) {
      if (e instanceof Stale) return { ...report, status: 'disabled' };
      return { ...report, status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
    return report;
  }

  // A switch reads Off but copies are still here: an earlier turnOff saved the switch and then failed to delete.
  private async wipeLeftovers(app: SourceApp, report: SyncReport): Promise<SyncReport> {
    try {
      if (!(await this.kn.lib.listSourceIds(app)).length) return report;
      return { ...report, removed: await this.wipe(app) };
    } catch (e) {
      return { ...report, status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async store(app: SourceApp, row: SourceRow, live: () => void, report: SyncReport): Promise<void> {
    const body = sourceBody(app, row);
    const title = sourceTitle(app, row);
    live();
    const put = await this.kn.lib.putSourceItem({ app, sourceId: row.id, sourceAt: row.at, title, body });
    if (put.created) report.added++;
    else if (put.changed) report.updated++;
    if (!put.changed && (await this.kn.job(put.item.id))) return;
    live();
    await this.kn.enqueueEmbedOnly(put.item.id, body);
  }

  private async meta(key: string): Promise<number | null> {
    const value = (await this.kn.lib.db.first('SELECT value FROM kn_meta WHERE key = ?', [key]))?.value;
    return value === undefined || value === null ? null : Number(value) || 0;
  }

  // Every read finishes before removeGone, so a failed page deletes nothing.
  private async fromPages(app: SourceApp, p: PagedSource, maxNew: number, live: () => void, report: SyncReport): Promise<void> {
    const db = this.kn.lib.db;
    const read = await this.readPages(app, p, markKey(app), (await this.meta(markKey(app))) ?? 0, Infinity, maxNew, live, report);
    const ids = await this.allLiveIds(p);
    let newest = 0;
    for (const id of ids) newest = Math.max(newest, id);
    let forward = read.mark;
    let rescan = await this.meta(rescanKey(app));
    if (newest < forward) {
      // Ruling R16: an empty list (Inflow switched off) or ids below the mark (deleted newest, or Inflow data reset).
      // The forward mark drops only to the newest live id, so new messages come next run; old rows are re-read behind it.
      forward = newest;
      rescan = newest ? 0 : null;
      live();
      if (newest) {
        await db.run(SET_META, [markKey(app), String(newest)]);
        await db.run(SET_META, [rescanKey(app), '0']);
      } else await db.run('DELETE FROM kn_meta WHERE key IN (?, ?)', [markKey(app), rescanKey(app)]);
    }
    if (rescan !== null) {
      const back = await this.readPages(app, p, rescanKey(app), rescan, forward, read.left, live, report);
      if (back.mark >= forward || back.left > 0) {
        live();
        await db.run('DELETE FROM kn_meta WHERE key = ?', [rescanKey(app)]);
      }
    }
    await this.removeGone(app, ids, live, report);
  }

  private async readPages(app: SourceApp, p: PagedSource, key: string, since: number, until: number, maxNew: number, live: () => void, report: SyncReport): Promise<{ mark: number; left: number }> {
    const db = this.kn.lib.db;
    let budget = maxNew;
    for (; budget > 0 && since < until; ) {
      const page = answer(await p.items(since, budget), 'items').slice(0, budget);
      const top = Math.max(since, ...page.map(idOf).filter((id): id is number => id !== null));
      if (top <= since) break;
      const rows = page.map(cleanRow).filter((r): r is SourceRow => r !== null && r.id > since && r.id <= until && !looksLikeOneTimeCode(r.text));
      for (const row of rows.sort((a, b) => a.id - b.id)) await this.store(app, row, live, report);
      live();
      await db.run(SET_META, [key, String(top)]);
      since = top;
      budget -= page.length;
    }
    return { mark: since, left: budget };
  }

  private async allLiveIds(p: PagedSource): Promise<Set<number>> {
    const kept = new Set<number>();
    let since = 0;
    for (let n = 0; n < MAX_ID_PAGES; n++) {
      const page = answer(await p.liveIds(since), 'ids');
      if (!page.length) return kept;
      if (!page.every(isId)) throw new Error('The app sent an id list Nexus could not read.');
      const top = Math.max(...page);
      if (top <= since) throw new Error('The app sent the same ids again.');
      for (const id of page) kept.add(id);
      since = top;
    }
    throw new Error('The app sent too many ids.');
  }

  private async fromSnapshot(app: SourceApp, p: SnapshotSource, maxNew: number, live: () => void, report: SyncReport): Promise<void> {
    const raw = answer(await p.snapshot(), 'snapshot');
    const kept = new Set(raw.map(idOf).filter((id): id is number => id !== null));
    const known = new Set((await this.kn.lib.listSourceIds(app)).map((k) => k.sourceId));
    const rows = new Map<number, SourceRow>();
    for (const row of raw.map(cleanRow)) if (row && !looksLikeOneTimeCode(row.text)) rows.set(row.id, row);
    let added = 0;
    for (const row of [...rows.values()].sort((a, b) => a.id - b.id)) {
      if (!known.has(row.id) && added++ >= maxNew) continue;
      await this.store(app, row, live, report);
    }
    await this.removeGone(app, kept, live, report);
  }

  private async removeGone(app: SourceApp, kept: Set<number>, live: () => void, report: SyncReport): Promise<void> {
    for (const { sourceId } of await this.kn.lib.listSourceIds(app)) {
      if (kept.has(sourceId)) continue;
      live();
      if (await this.kn.lib.deleteSourceItem(app, sourceId)) report.removed++;
    }
    if (report.removed) await pruneConcepts(this.kn.lib.db);
  }
}
