import { Library, serialPort } from '@apps-hub/library-core';
import * as SQLite from 'expo-sqlite';

import { newId } from './ids';
import { expoRawSql } from './sql-expo';
import { sweepLibrary } from './sweep';

let opening: Promise<Library> | null = null;

/** One connection per process. The first open also sweeps, so no file can be created before it has run. */
export function openLibrary(): Promise<Library> {
  if (!opening) {
    opening = (async () => {
      const db = await SQLite.openDatabaseAsync('library.db');
      try {
        await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
        const lib = await Library.open(serialPort(expoRawSql(db)), { now: Date.now, newId });
        await sweepLibrary(lib).catch((err) => console.warn('Library sweep failed', err));
        return lib;
      } catch (err) {
        await db.closeAsync();
        throw err;
      }
    })();
    opening.catch(() => {
      opening = null;
    });
  }
  return opening;
}
