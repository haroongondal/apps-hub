import type { SourceApp, SqlPort } from '@apps-hub/library-core';
import type { SwitchStore } from '@apps-hub/knowledge-core';

type MetaDb = Pick<SqlPort, 'first' | 'run'>;

// kn_meta lives in the same database as the items a switch guards, so the switch and the data it controls can never disagree after a restore or a wipe.
export const TODAY_KEY = 'today_share';
export const sourceKey = (app: SourceApp) => `source_switch:${app}`;

export function metaFlags(db: MetaDb) {
  return {
    async get(key: string): Promise<boolean> {
      return (await db.first('SELECT value FROM kn_meta WHERE key = ?', [key]))?.value === '1';
    },
    async set(key: string, on: boolean): Promise<void> {
      await db.run('INSERT INTO kn_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, on ? '1' : '0']);
    },
  };
}

export function sourceSwitches(db: MetaDb): SwitchStore {
  const flags = metaFlags(db);
  return { get: (app) => flags.get(sourceKey(app)), set: (app, on) => flags.set(sourceKey(app), on) };
}
