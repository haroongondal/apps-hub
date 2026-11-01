import { LibraryError } from './errors.ts';
import type { SqlPort } from './sql.ts';

/**
 * Applies `steps[version..]` of one track in one transaction and returns the new version
 * (the number of steps applied). A step is one SQL string run with `exec`; steps are
 * append-only. A database newer than the code throws `too_new` before anything runs.
 */
export async function migrate(db: SqlPort, track: string, steps: readonly string[]): Promise<number> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_tracks (track TEXT PRIMARY KEY, version INTEGER NOT NULL)');
  return db.transaction(async (tx) => {
    const row = await tx.first('SELECT version FROM schema_tracks WHERE track = ?', [track]);
    const version = typeof row?.version === 'number' ? row.version : 0;
    if (version > steps.length) {
      throw new LibraryError('too_new', `Track "${track}" is at version ${version}, this code knows ${steps.length}`);
    }
    for (const step of steps.slice(version)) await tx.exec(step);
    await tx.run(
      'INSERT INTO schema_tracks (track, version) VALUES (?, ?) ON CONFLICT(track) DO UPDATE SET version = excluded.version',
      [track, steps.length],
    );
    return steps.length;
  });
}
