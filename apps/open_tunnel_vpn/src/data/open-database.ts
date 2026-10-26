/** On-device cache wiring (React Native app only). */
import * as SQLite from 'expo-sqlite';
import { VpnNodeCache } from './node-cache.ts';
import { expoSqliteDriver } from './sqlite-driver.ts';

/**
 * Opens the shared on-disk cache used by the shipping app, mirroring the
 * Drift `AppDatabase.onDisk()` path (`opentunnel.sqlite3` in the app
 * container). Pass `:memory:` only from tests.
 */
export async function openVpnNodeCache(
  databaseName = 'opentunnel.sqlite3',
): Promise<VpnNodeCache> {
  const db = await SQLite.openDatabaseAsync(databaseName);
  // Non-rogue prebackups: enable WAL so concurrent UI reads never block the
  // refresh inside its transaction.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return new VpnNodeCache(expoSqliteDriver(db));
}
