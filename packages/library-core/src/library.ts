import { LibraryError } from './errors.ts';
import { ftsQuery } from './fts-query.ts';
import { migrate } from './migrate.ts';
import { normalizeForSearch } from './normalize.ts';
import { ITEM_ID } from './orphan-dirs.ts';
import { LIBRARY_STEPS } from './schema.ts';
import type { Row, SqlPort, SqlValue } from './sql.ts';

export type ItemKind = 'pdf' | 'scan' | 'article' | 'note' | 'audio' | 'image';

export interface Item {
  id: string;
  kind: ItemKind;
  title: string;
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
  sizeBytes: number;
  pageCount: number | null;
}
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  itemCount: number; // items directly inside
}
export interface Tag {
  id: string;
  name: string;
  itemCount: number;
}
/** `snippet` marks matches with U+0002 / U+0003. */
export interface SearchHit extends Item {
  snippet: string | null;
}
export type ReminderTrigger = 'arrive' | 'leave';
export interface PlaceReminder {
  id: string;
  itemId: string;
  lat: number;
  lng: number;
  radiusM: number;
  trigger: ReminderTrigger;
  createdAt: number;
}
/** A reminder with its item's title, which is what the notification shows. */
export interface ActivePlaceReminder extends PlaceReminder {
  title: string;
}
export interface LibraryDeps {
  now(): number;
  newId(): string;
}
/** Apps Nexus reads items from (Ask my life). */
export type SourceApp = 'inflow' | 'clipboard' | 'deputy';
export const SOURCE_FOLDERS: Readonly<Record<SourceApp, string>> = { inflow: 'From Inflow', clipboard: 'From Clipboard', deputy: 'From Deputy' };
export interface ItemSource {
  app: SourceApp;
  sourceId: number;
  sourceAt: number;
}
export interface DueItem {
  itemId: string;
  title: string;
  dueAt: number;
}

export const SOURCE_APPS: readonly SourceApp[] = ['inflow', 'clipboard', 'deputy'];

const isSourceApp = (app: unknown): app is SourceApp => SOURCE_APPS.includes(app as SourceApp);
const isTime = (ms: unknown): ms is number => Number.isSafeInteger(ms) && (ms as number) >= 0;
function checkApp(app: unknown): asserts app is SourceApp {
  if (!isSourceApp(app)) throw new LibraryError('invalid_source', `Nexus does not read items from "${String(app)}"`);
}

const MAX_TITLE = 200;
const MAX_NAME = 100;
const MAX_BODY = 1_000_000; // UTF-16 code units
const DEFAULT_LIST_LIMIT = 500;
const DEFAULT_SEARCH_LIMIT = 30; // snippet() costs ~1–8 ms a row, so keep pages short
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

const ITEM_COLUMNS = 'i.id, i.kind, i.title, i.folder_id, i.created_at, i.updated_at, i.size_bytes, i.page_count';
const FOLDER_SELECT = `SELECT f.id, f.name, f.parent_id, f.created_at,
  (SELECT COUNT(*) FROM items i WHERE i.folder_id = f.id) AS item_count FROM folders f`;

const toItem = (r: Row): Item => ({
  id: r.id as string,
  kind: r.kind as ItemKind,
  title: r.title as string,
  folderId: r.folder_id as string | null,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
  sizeBytes: r.size_bytes as number,
  pageCount: r.page_count as number | null,
});
const toFolder = (r: Row): Folder => ({
  id: r.id as string,
  name: r.name as string,
  parentId: r.parent_id as string | null,
  createdAt: r.created_at as number,
  itemCount: r.item_count as number,
});
const toTag = (r: Row): Tag => ({ id: r.id as string, name: r.name as string, itemCount: r.item_count as number });
const toReminder = (r: Row): PlaceReminder => ({
  id: r.id as string,
  itemId: r.item_id as string,
  lat: r.lat as number,
  lng: r.lng as number,
  radiusM: r.radius_m as number,
  trigger: r.trigger as ReminderTrigger,
  createdAt: r.created_at as number,
});
const REMINDER_COLUMNS = 'id, item_id, lat, lng, radius_m, trigger, created_at';
const MIN_RADIUS_M = 100; // Android ignores proximity alerts much tighter than this
const MAX_RADIUS_M = 5000;

/** Trims, then checks length (in characters) and control characters. Throws invalid_name. */
function cleanName(raw: string, max: number, what: string, allowSlash = true): string {
  const name = raw.trim();
  const length = Array.from(name).length;
  if (length < 1 || length > max) throw new LibraryError('invalid_name', `${what} must be 1 to ${max} characters`);
  if (CONTROL.test(name)) throw new LibraryError('invalid_name', `${what} can't contain control characters`);
  if (!allowSlash && name.includes('/')) throw new LibraryError('invalid_name', `${what} can't contain "/"`);
  return name;
}

/** The text as it is indexed, cut to MAX_BODY at a whitespace boundary (never mid-surrogate). */
function indexedBody(text: string): string {
  const body = normalizeForSearch(text);
  if (body.length <= MAX_BODY) return body;
  let end = MAX_BODY;
  if (!/\s/.test(body[end])) {
    let space = end - 1;
    while (space > 0 && !/\s/.test(body[space])) space--;
    if (space > 0) end = space; // no whitespace at all: hard cut
  }
  const last = body.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return body.slice(0, end);
}

async function ridOf(q: SqlPort, itemId: string): Promise<number> {
  const row = await q.first('SELECT rid FROM items WHERE id = ?', [itemId]);
  if (!row) throw new LibraryError('not_found', `No item ${itemId}`);
  return row.rid as number;
}
async function itemIn(q: SqlPort, id: string): Promise<Item | null> {
  const row = await q.first(`SELECT ${ITEM_COLUMNS} FROM items i WHERE i.id = ?`, [id]);
  return row ? toItem(row) : null;
}
async function folderIn(q: SqlPort, id: string): Promise<Folder> {
  const row = await q.first(`${FOLDER_SELECT} WHERE f.id = ?`, [id]);
  if (!row) throw new LibraryError('not_found', `No folder ${id}`);
  return toFolder(row);
}
async function assertNameFree(q: SqlPort, parentId: string | null, name: string, exceptId: string | null) {
  const clash = await q.first(
    "SELECT 1 AS x FROM folders WHERE ifnull(parent_id, '') = ifnull(?, '') AND name = ? COLLATE NOCASE AND id <> ?",
    [parentId, name, exceptId ?? ''],
  );
  if (clash) throw new LibraryError('duplicate_name', `A folder named "${name}" already exists here`);
}
async function tagsIn(q: SqlPort, itemId: string): Promise<Tag[]> {
  const rows = await q.all(
    `SELECT t.id, t.name, (SELECT COUNT(*) FROM item_tags x WHERE x.tag_id = t.id) AS item_count
     FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ? ORDER BY t.name COLLATE NOCASE`,
    [itemId],
  );
  return rows.map(toTag);
}
async function tagIn(q: SqlPort, id: string): Promise<Tag> {
  const row = await q.first(
    'SELECT t.id, t.name, (SELECT COUNT(*) FROM item_tags x WHERE x.tag_id = t.id) AS item_count FROM tags t WHERE t.id = ?',
    [id],
  );
  if (!row) throw new LibraryError('not_found', `No tag ${id}`);
  return toTag(row);
}
/** FR-4: a tag lives only while some item uses it. */
const pruneTags = (q: SqlPort) => q.run('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM item_tags)');

/**
 * Every write opens its own transaction on `db`, so don't call a Library method from inside a
 * `db.transaction` callback: the queue is held by that transaction and the call never returns.
 */
export class Library {
  readonly db: SqlPort;
  private readonly deps: LibraryDeps;

  private constructor(db: SqlPort, deps: LibraryDeps) {
    this.db = db;
    this.deps = deps;
  }

  /** Runs the 'library' track. The connection must already have foreign_keys ON (SPEC §4.1). */
  static async open(db: SqlPort, deps: LibraryDeps): Promise<Library> {
    const fk = await db.first('PRAGMA foreign_keys');
    if (fk?.foreign_keys !== 1) {
      throw new Error('Library needs PRAGMA foreign_keys = ON on its connection, or deletes would not cascade');
    }
    await migrate(db, 'library', LIBRARY_STEPS);
    return new Library(db, deps);
  }

  // items

  async createItem(input: {
    id?: string;
    kind: ItemKind;
    title: string;
    folderId?: string | null;
    pageCount?: number | null;
    sizeBytes?: number;
    body?: string;
  }): Promise<Item> {
    const title = cleanName(input.title, MAX_TITLE, 'Title');
    const id = input.id ?? this.deps.newId();
    if (!ITEM_ID.test(id)) throw new LibraryError('invalid_name', `Item id "${id}" is not a 16-character base-36 id`);
    const body = indexedBody(input.body ?? '');
    const folderId = input.folderId ?? null;
    const now = this.deps.now();
    return this.db.transaction(async (tx) => {
      if (folderId !== null) await folderIn(tx, folderId);
      await tx.run(
        `INSERT INTO items (id, kind, title, folder_id, created_at, updated_at, size_bytes, page_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.kind, title, folderId, now, now, input.sizeBytes ?? 0, input.pageCount ?? null],
      );
      await tx.run('INSERT INTO items_fts (rowid, title, body) VALUES (?, ?, ?)', [
        await ridOf(tx, id),
        normalizeForSearch(title),
        body,
      ]);
      return (await itemIn(tx, id))!;
    });
  }

  getItem(id: string): Promise<Item | null> {
    return itemIn(this.db, id);
  }

  async updateItem(
    id: string,
    patch: { title?: string; folderId?: string | null; pageCount?: number | null; sizeBytes?: number },
  ): Promise<Item> {
    const title = patch.title === undefined ? undefined : cleanName(patch.title, MAX_TITLE, 'Title');
    return this.db.transaction(async (tx) => {
      const rid = await ridOf(tx, id);
      const current = (await itemIn(tx, id))!;
      const sets: string[] = [];
      const params: SqlValue[] = [];
      // A value equal to the stored one is not a change, so it doesn't bump updated_at.
      const newTitle = title !== undefined && title !== current.title;
      if (newTitle) (sets.push('title = ?'), params.push(title));
      if (patch.folderId !== undefined && patch.folderId !== current.folderId) {
        if (patch.folderId !== null) await folderIn(tx, patch.folderId);
        sets.push('folder_id = ?');
        params.push(patch.folderId);
      }
      if (patch.pageCount !== undefined && patch.pageCount !== current.pageCount) {
        sets.push('page_count = ?');
        params.push(patch.pageCount);
      }
      if (patch.sizeBytes !== undefined && patch.sizeBytes !== current.sizeBytes) {
        sets.push('size_bytes = ?');
        params.push(patch.sizeBytes);
      }
      if (sets.length) {
        sets.push('updated_at = ?');
        params.push(this.deps.now());
        await tx.run(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
        if (newTitle) {
          await tx.run('UPDATE items_fts SET title = ? WHERE rowid = ?', [normalizeForSearch(title), rid]);
        }
      }
      return (await itemIn(tx, id))!;
    });
  }

  async touch(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await ridOf(tx, id);
      await tx.run('UPDATE items SET updated_at = ? WHERE id = ?', [this.deps.now(), id]);
    });
  }

  /** Replaces the item's search text. Does not bump updated_at. */
  async setBody(id: string, text: string): Promise<void> {
    const body = indexedBody(text);
    await this.db.transaction(async (tx) => {
      await tx.run('UPDATE items_fts SET body = ? WHERE rowid = ?', [body, await ridOf(tx, id)]);
    });
  }

  /** The normalised search text, not a display copy. */
  async getBody(id: string): Promise<string> {
    const row = await this.db.first(
      'SELECT f.body FROM items i JOIN items_fts f ON f.rowid = i.rid WHERE i.id = ?',
      [id],
    );
    if (!row) throw new LibraryError('not_found', `No item ${id}`);
    return String(row.body ?? '');
  }

  /** Deletes the row (cascades). The caller then removes library/<id>/. */
  async deleteItem(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await ridOf(tx, id);
      await tx.run('DELETE FROM items WHERE id = ?', [id]);
      await pruneTags(tx);
    });
  }

  async list(q: {
    folderId?: string | null;
    everywhere?: boolean;
    kind?: ItemKind;
    tagId?: string;
    sort?: 'recent' | 'title';
    limit?: number;
    offset?: number;
    /** Leaves out items read from other apps (item_sources). */
    ownOnly?: boolean;
  }): Promise<Item[]> {
    const order = q.sort === 'title' ? 'i.title COLLATE NOCASE, i.rid' : 'i.updated_at DESC, i.rid DESC';
    const kind = q.kind ?? null;
    const tagId = q.tagId ?? null;
    const rows = await this.db.all(
      `SELECT ${ITEM_COLUMNS} FROM items i
       WHERE (? = 1 OR i.folder_id IS ?)
         AND (? IS NULL OR i.kind = ?)
         AND (? IS NULL OR EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = i.id AND t.tag_id = ?))
         AND (? = 0 OR NOT EXISTS (SELECT 1 FROM item_sources s WHERE s.item_id = i.id))
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
      [q.everywhere ? 1 : 0, q.folderId ?? null, kind, kind, tagId, tagId, q.ownOnly ? 1 : 0, q.limit ?? DEFAULT_LIST_LIMIT, q.offset ?? 0],
    );
    return rows.map(toItem);
  }

  /** Blank text returns nothing: the caller uses `list` for that. */
  async search(text: string, q: { kind?: ItemKind; tagId?: string; limit?: number } = {}): Promise<SearchHit[]> {
    const match = ftsQuery(text);
    if (match === null) return [];
    const kind = q.kind ?? null;
    const tagId = q.tagId ?? null;
    const rows = await this.db.all(
      `SELECT ${ITEM_COLUMNS}, snippet(items_fts, -1, char(2), char(3), '…', 12) AS snippet
       FROM items_fts
       JOIN items i ON i.rid = items_fts.rowid
       WHERE items_fts MATCH ?
         AND (? IS NULL OR i.kind = ?)
         AND (? IS NULL OR EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = i.id AND t.tag_id = ?))
       ORDER BY bm25(items_fts, 10.0, 1.0), i.updated_at DESC
       LIMIT ?`,
      [match, kind, kind, tagId, tagId, q.limit ?? DEFAULT_SEARCH_LIMIT],
    );
    return rows.map((r) => ({ ...toItem(r), snippet: r.snippet as string | null }));
  }

  async allIds(): Promise<Set<string>> {
    return new Set((await this.db.all('SELECT id FROM items')).map((r) => r.id as string));
  }

  // folders

  async createFolder(name: string, parentId: string | null): Promise<Folder> {
    const clean = cleanName(name, MAX_NAME, 'Folder name', false);
    return this.db.transaction(async (tx) => {
      if (parentId !== null) await folderIn(tx, parentId);
      await assertNameFree(tx, parentId, clean, null);
      const id = this.deps.newId();
      await tx.run('INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)', [
        id,
        clean,
        parentId,
        this.deps.now(),
      ]);
      return folderIn(tx, id);
    });
  }

  async renameFolder(id: string, name: string): Promise<void> {
    const clean = cleanName(name, MAX_NAME, 'Folder name', false);
    await this.db.transaction(async (tx) => {
      const folder = await folderIn(tx, id);
      await assertNameFree(tx, folder.parentId, clean, id);
      await tx.run('UPDATE folders SET name = ? WHERE id = ?', [clean, id]);
    });
  }

  /** Rejects a move into itself or a descendant ('cycle'). */
  async moveFolder(id: string, parentId: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      const folder = await folderIn(tx, id);
      if (parentId !== null) {
        await folderIn(tx, parentId);
        const cycle = await tx.first(
          `WITH RECURSIVE up(id, parent_id) AS (
             SELECT id, parent_id FROM folders WHERE id = ?
             UNION ALL SELECT f.id, f.parent_id FROM folders f JOIN up ON f.id = up.parent_id)
           SELECT 1 AS x FROM up WHERE id = ? LIMIT 1`,
          [parentId, id],
        );
        if (cycle) throw new LibraryError('cycle', 'A folder can\'t go inside itself or one of its subfolders');
      }
      await assertNameFree(tx, parentId, folder.name, id);
      await tx.run('UPDATE folders SET parent_id = ? WHERE id = ?', [parentId, id]);
    });
  }

  /** Moves items and subfolders to its parent in the same transaction, so nothing is deleted with it (PRD invariant 4). */
  async deleteFolder(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { parentId } = await folderIn(tx, id);
      const clash = await tx.first(
        `SELECT c.name FROM folders c
         WHERE c.parent_id = ?
           AND EXISTS (SELECT 1 FROM folders s
                       WHERE ifnull(s.parent_id, '') = ifnull(?, '') AND s.id <> ? AND s.name = c.name COLLATE NOCASE)
         LIMIT 1`,
        [id, parentId, id],
      );
      if (clash) {
        throw new LibraryError('duplicate_name', `A folder named "${clash.name}" already exists one level up; rename one of them first`);
      }
      await tx.run('UPDATE items SET folder_id = ? WHERE folder_id = ?', [parentId, id]);
      // A subfolder may share this folder's name, so it moves up only after this one is gone.
      await tx.exec('PRAGMA defer_foreign_keys = ON');
      await tx.run('DELETE FROM folders WHERE id = ?', [id]);
      await tx.run('UPDATE folders SET parent_id = ? WHERE parent_id = ?', [parentId, id]);
    });
  }

  async listFolders(parentId: string | null): Promise<Folder[]> {
    const rows = await this.db.all(`${FOLDER_SELECT} WHERE f.parent_id IS ? ORDER BY f.name COLLATE NOCASE, f.id`, [parentId]);
    return rows.map(toFolder);
  }

  /** Root → id, for the breadcrumb. */
  async folderPath(id: string): Promise<Folder[]> {
    const rows = await this.db.all(
      `WITH RECURSIVE up(id, depth) AS (
         SELECT id, 0 FROM folders WHERE id = ?
         UNION ALL SELECT f.parent_id, up.depth + 1 FROM folders f JOIN up ON f.id = up.id WHERE f.parent_id IS NOT NULL)
       SELECT f.id, f.name, f.parent_id, f.created_at,
              (SELECT COUNT(*) FROM items i WHERE i.folder_id = f.id) AS item_count
       FROM up JOIN folders f ON f.id = up.id ORDER BY up.depth DESC`,
      [id],
    );
    if (!rows.length) throw new LibraryError('not_found', `No folder ${id}`);
    return rows.map(toFolder);
  }

  // tags

  async listTags(): Promise<Tag[]> {
    const rows = await this.db.all(
      `SELECT t.id, t.name, COUNT(it.item_id) AS item_count
       FROM tags t LEFT JOIN item_tags it ON it.tag_id = t.id GROUP BY t.id ORDER BY t.name COLLATE NOCASE`,
    );
    return rows.map(toTag);
  }

  tagsFor(itemId: string): Promise<Tag[]> {
    return tagsIn(this.db, itemId);
  }

  /**
   * Renames a tag on every item that has it. Spelling is kept as typed (trimmed); a change of case only
   * is a rename. When another tag already has the name (ignoring case) it throws duplicate_name, or with
   * `merge` moves this tag's items onto that tag, which keeps its own spelling, and returns it.
   */
  async renameTag(id: string, name: string, opts: { merge?: boolean } = {}): Promise<Tag> {
    const clean = cleanName(name, MAX_NAME, 'Tag name');
    return this.db.transaction(async (tx) => {
      await tagIn(tx, id);
      const clash = await tx.first('SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id <> ?', [clean, id]);
      if (!clash) {
        await tx.run('UPDATE tags SET name = ? WHERE id = ?', [clean, id]);
        return tagIn(tx, id);
      }
      if (!opts.merge) throw new LibraryError('duplicate_name', `A tag named "${clean}" already exists`);
      const target = clash.id as string;
      await tx.run('INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT item_id, ? FROM item_tags WHERE tag_id = ?', [target, id]);
      await tx.run('DELETE FROM tags WHERE id = ?', [id]);
      return tagIn(tx, target);
    });
  }

  /** Removes the tag from every item. The items themselves are untouched. */
  async deleteTag(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tagIn(tx, id);
      await tx.run('DELETE FROM tags WHERE id = ?', [id]);
    });
  }

  // place reminders

  async addReminder(input: {
    itemId: string;
    lat: number;
    lng: number;
    radiusM: number;
    trigger: ReminderTrigger;
  }): Promise<PlaceReminder> {
    if (!(Number.isFinite(input.lat) && input.lat >= -90 && input.lat <= 90 && Number.isFinite(input.lng) && input.lng >= -180 && input.lng <= 180)) {
      throw new LibraryError('invalid_place', 'The place needs a latitude from -90 to 90 and a longitude from -180 to 180');
    }
    if (!Number.isInteger(input.radiusM) || input.radiusM < MIN_RADIUS_M || input.radiusM > MAX_RADIUS_M) {
      throw new LibraryError('invalid_place', `The radius must be ${MIN_RADIUS_M} to ${MAX_RADIUS_M} metres`);
    }
    if (input.trigger !== 'arrive' && input.trigger !== 'leave') {
      throw new LibraryError('invalid_place', 'The reminder must fire when you arrive or when you leave');
    }
    const id = this.deps.newId();
    const now = this.deps.now();
    return this.db.transaction(async (tx) => {
      await ridOf(tx, input.itemId);
      await tx.run(
        `INSERT INTO reminders (id, item_id, lat, lng, radius_m, trigger, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, input.itemId, input.lat, input.lng, input.radiusM, input.trigger, now],
      );
      return toReminder((await tx.first(`SELECT ${REMINDER_COLUMNS} FROM reminders WHERE id = ?`, [id]))!);
    });
  }

  async listReminders(itemId: string): Promise<PlaceReminder[]> {
    const rows = await this.db.all(
      `SELECT ${REMINDER_COLUMNS} FROM reminders WHERE item_id = ? ORDER BY created_at, id`,
      [itemId],
    );
    return rows.map(toReminder);
  }

  /** Every reminder with its item's title. The native side registers exactly this list. */
  async activeReminders(): Promise<ActivePlaceReminder[]> {
    const rows = await this.db.all(
      `SELECT r.id, r.item_id, r.lat, r.lng, r.radius_m, r.trigger, r.created_at, i.title
       FROM reminders r JOIN items i ON i.id = r.item_id ORDER BY r.created_at, r.id`,
    );
    return rows.map((r) => ({ ...toReminder(r), title: r.title as string }));
  }

  async removeReminder(id: string): Promise<void> {
    await this.db.run('DELETE FROM reminders WHERE id = ?', [id]);
  }

  async putSourceItem(input: ItemSource & { title: string; body: string }): Promise<{ item: Item; created: boolean; changed: boolean }> {
    checkApp(input.app);
    if (!Number.isSafeInteger(input.sourceId) || input.sourceId <= 0) throw new LibraryError('invalid_source', 'The source id must be a positive whole number');
    if (!isTime(input.sourceAt)) throw new LibraryError('invalid_date', 'The source date must be a time in ms since 1970');
    const title = cleanName(input.title, MAX_TITLE, 'Title');
    const body = indexedBody(input.body);
    const { app, sourceId, sourceAt } = input;
    return this.db.transaction(async (tx) => {
      const known = await tx.first(
        `SELECT s.item_id, s.source_at, i.title, f.body FROM item_sources s
         JOIN items i ON i.id = s.item_id JOIN items_fts f ON f.rowid = i.rid WHERE s.app = ? AND s.source_id = ?`,
        [app, sourceId],
      );
      if (known) {
        const id = known.item_id as string;
        const changed = known.title !== title || known.source_at !== sourceAt || known.body !== body;
        if (changed) {
          await tx.run('UPDATE items SET title = ?, updated_at = ? WHERE id = ?', [title, this.deps.now(), id]);
          await tx.run('UPDATE items_fts SET title = ?, body = ? WHERE rowid = ?', [normalizeForSearch(title), body, await ridOf(tx, id)]);
          await tx.run('UPDATE item_sources SET source_at = ? WHERE item_id = ?', [sourceAt, id]);
        }
        return { item: (await itemIn(tx, id))!, created: false, changed };
      }
      const folderId = await this.sourceFolder(tx, app);
      const id = this.deps.newId();
      const now = this.deps.now();
      await tx.run('INSERT INTO items (id, kind, title, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, 'note', title, folderId, now, now]);
      await tx.run('INSERT INTO items_fts (rowid, title, body) VALUES (?, ?, ?)', [await ridOf(tx, id), normalizeForSearch(title), body]);
      await tx.run('INSERT INTO item_sources (item_id, app, source_id, source_at) VALUES (?, ?, ?, ?)', [id, app, sourceId, sourceAt]);
      return { item: (await itemIn(tx, id))!, created: true, changed: true };
    });
  }

  // Found by name, so a folder the owner renamed stays theirs and the next item makes a new one.
  private async sourceFolder(tx: SqlPort, app: SourceApp): Promise<string> {
    const name = SOURCE_FOLDERS[app];
    const found = await tx.first('SELECT id FROM folders WHERE parent_id IS NULL AND name = ? COLLATE NOCASE', [name]);
    if (found) return found.id as string;
    const id = this.deps.newId();
    await tx.run('INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, NULL, ?)', [id, name, this.deps.now()]);
    return id;
  }

  async sourceOf(itemId: string): Promise<ItemSource | null> {
    const row = await this.db.first('SELECT app, source_id, source_at FROM item_sources WHERE item_id = ?', [itemId]);
    return row ? { app: row.app as SourceApp, sourceId: row.source_id as number, sourceAt: row.source_at as number } : null;
  }

  async listSourceIds(app: SourceApp): Promise<{ sourceId: number; itemId: string }[]> {
    checkApp(app);
    const rows = await this.db.all('SELECT source_id, item_id FROM item_sources WHERE app = ? ORDER BY source_id', [app]);
    return rows.map((r) => ({ sourceId: r.source_id as number, itemId: r.item_id as string }));
  }

  async deleteSourceItem(app: SourceApp, sourceId: number): Promise<boolean> {
    checkApp(app);
    return this.db.transaction(async (tx) => {
      const row = await tx.first('SELECT item_id FROM item_sources WHERE app = ? AND source_id = ?', [app, sourceId]);
      if (!row) return false;
      await tx.run('DELETE FROM items WHERE id = ?', [row.item_id]);
      await pruneTags(tx);
      return true;
    });
  }

  async deleteAllFromSource(app: SourceApp): Promise<number> {
    checkApp(app);
    return this.db.transaction(async (tx) => {
      const n = (await tx.first('SELECT COUNT(*) AS n FROM item_sources WHERE app = ?', [app]))!.n as number;
      await tx.run('DELETE FROM items WHERE id IN (SELECT item_id FROM item_sources WHERE app = ?)', [app]);
      await pruneTags(tx);
      await tx.run(
        `DELETE FROM folders WHERE parent_id IS NULL AND name = ? COLLATE NOCASE
           AND NOT EXISTS (SELECT 1 FROM items WHERE folder_id = folders.id)
           AND NOT EXISTS (SELECT 1 FROM folders c WHERE c.parent_id = folders.id)`,
        [SOURCE_FOLDERS[app]],
      );
      return n;
    });
  }

  async setDue(itemId: string, dueAt: number | null): Promise<void> {
    if (dueAt !== null && !isTime(dueAt)) throw new LibraryError('invalid_date', 'The due date must be a time in ms since 1970');
    await this.db.transaction(async (tx) => {
      await ridOf(tx, itemId);
      if (dueAt === null) await tx.run('DELETE FROM item_due WHERE item_id = ?', [itemId]);
      else await tx.run('INSERT INTO item_due (item_id, due_at) VALUES (?, ?) ON CONFLICT(item_id) DO UPDATE SET due_at = excluded.due_at', [itemId, dueAt]);
    });
  }

  async getDue(itemId: string): Promise<number | null> {
    return ((await this.db.first('SELECT due_at FROM item_due WHERE item_id = ?', [itemId]))?.due_at as number | undefined) ?? null;
  }

  /** [startMs, endMs). Items read from other apps are left out: the titles shared onward must be the owner's own. */
  async dueBetween(startMs: number, endMs: number): Promise<DueItem[]> {
    const rows = await this.db.all(
      `SELECT d.item_id, i.title, d.due_at FROM item_due d JOIN items i ON i.id = d.item_id
       WHERE d.due_at >= ? AND d.due_at < ? AND NOT EXISTS (SELECT 1 FROM item_sources s WHERE s.item_id = d.item_id)
       ORDER BY d.due_at, i.title COLLATE NOCASE, d.item_id`,
      [startMs, endMs],
    );
    return rows.map((r) => ({ itemId: r.item_id as string, title: r.title as string, dueAt: r.due_at as number }));
  }

  /** Trims, dedupes ignoring case (an existing tag keeps its spelling), creates new tags, drops unused ones. */
  async setItemTags(itemId: string, names: readonly string[]): Promise<Tag[]> {
    const seen = new Set<string>();
    const clean: string[] = [];
    for (const raw of names) {
      const name = cleanName(raw, MAX_NAME, 'Tag name');
      if (!seen.has(name.toLowerCase())) (seen.add(name.toLowerCase()), clean.push(name));
    }
    return this.db.transaction(async (tx) => {
      await ridOf(tx, itemId);
      await tx.run('DELETE FROM item_tags WHERE item_id = ?', [itemId]);
      for (const name of clean) {
        const existing = await tx.first('SELECT id FROM tags WHERE name = ? COLLATE NOCASE', [name]);
        let tagId = existing?.id as string | undefined;
        if (!tagId) {
          tagId = this.deps.newId();
          await tx.run('INSERT INTO tags (id, name) VALUES (?, ?)', [tagId, name]);
        }
        await tx.run('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)', [itemId, tagId]);
      }
      await pruneTags(tx);
      return tagsIn(tx, itemId);
    });
  }
}
