/** On-device storage wiring (React Native app only). */
import * as SQLite from 'expo-sqlite';
import { VpnNodeCache } from './node-cache.ts';
import { AppSettingsStore } from './settings-store.ts';
import { expoSqliteDriver } from './sqlite-driver.ts';

/** Both stores share one connection to the one local database. */
export interface AppDatabase {
  nodes: VpnNodeCache;
  settings: AppSettingsStore;
}

/**
 * Opens the shared on-disk stores, mirroring the Drift `AppDatabase.onDisk()`
 * path (`opentunnel.sqlite3` in the app container). Pass `:memory:` only
 * from tests.
 */
export async function openAppDatabase(
  databaseName = 'opentunnel.sqlite3',
): Promise<AppDatabase> {
  const db = await SQLite.openDatabaseAsync(databaseName);
  // Non-rogue prebackups: enable WAL so concurrent UI reads never block the
  // refresh inside its transaction.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const driver = expoSqliteDriver(db);
  return {
    nodes: new VpnNodeCache(driver),
    settings: new AppSettingsStore(driver),
  };
}
