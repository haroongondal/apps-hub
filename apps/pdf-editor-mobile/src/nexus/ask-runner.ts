import type { SyncReport } from '@apps-hub/knowledge-core';
import { SOURCE_APPS, type SourceApp } from '@apps-hub/library-core';

export const APP_NAMES: Record<SourceApp, string> = { inflow: 'Inflow', clipboard: 'Clipboard', deputy: 'Deputy' };
export const MAX_NEW_PER_RUN = 50;

export type Reports = Partial<Record<SourceApp, SyncReport>>;
export interface SyncPort {
  run(app: SourceApp, o: { maxNew: number }): Promise<SyncReport>;
  turnOn(app: SourceApp): Promise<void>;
  turnOff(app: SourceApp): Promise<number>;
}

/** Plain words for a source that could not be read. Its data is kept either way; null means nothing to say. */
export function statusLine(app: SourceApp, report: SyncReport | undefined): string | null {
  if (!report) return null;
  if (report.status === 'off' || report.status === 'missing') return `Off in ${APP_NAMES[app]}`;
  if (report.status === 'failed') return `Couldn't read ${APP_NAMES[app]} right now`;
  return null;
}

/** What a tap on a source switch does. Off still deletes when it already reads Off but copies are left (an earlier delete failed). */
export function switchStep(on: boolean, kept: number, key: 'on' | 'off'): 'on' | 'off' | null {
  if (key === 'on') return on ? null : 'on';
  return on || kept > 0 ? 'off' : null;
}

/**
 * Runs every source the owner switched on, one after the other. A request while a run is going is coalesced into one more run
 * after it, so requests never overlap and none is lost. Nothing is thrown out of it: a source that cannot be read is a report.
 */
export function createAskRunner(o: { sync: SyncPort; after?: (reports: Reports) => Promise<void>; wiped?: () => void; maxNew?: number }) {
  const reports: Reports = {};
  const listeners = new Set<() => void>();
  let current: Promise<Reports> | null = null;
  let again = false;

  const runApp = async (app: SourceApp): Promise<SyncReport> => {
    try {
      return await o.sync.run(app, { maxNew: o.maxNew ?? MAX_NEW_PER_RUN });
    } catch (err) {
      return { status: 'failed', added: 0, updated: 0, removed: 0, error: err instanceof Error ? err.message : String(err) };
    }
  };

  const once = async (): Promise<Reports> => {
    const fresh: Reports = {};
    for (const app of SOURCE_APPS) fresh[app] = reports[app] = await runApp(app);
    try {
      await o.after?.(fresh);
    } catch (err) {
      console.warn('Nexus could not follow up an Ask my life run', err);
    }
    listeners.forEach((l) => l());
    return fresh;
  };

  const loop = async (): Promise<Reports> => {
    try {
      let last: Reports;
      do {
        again = false;
        last = await once();
      } while (again);
      return last;
    } finally {
      current = null;
    }
  };

  const request = (): Promise<Reports> => {
    if (current) {
      again = true;
      return current;
    }
    return (current = loop());
  };

  return {
    request,
    /** The switch goes on first, so the run that follows (or the one already going, coalesced into one more) sees it. */
    async turnOn(app: SourceApp): Promise<void> {
      await o.sync.turnOn(app);
      await request();
    },
    /** Deletes everything kept from the app at once. A failure is thrown to the caller: a delete that did not happen must not look done. */
    async turnOff(app: SourceApp): Promise<number> {
      const removed = await o.sync.turnOff(app);
      delete reports[app];
      listeners.forEach((l) => l());
      o.wiped?.();
      return removed;
    },
    last: (): Reports => ({ ...reports }),
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
