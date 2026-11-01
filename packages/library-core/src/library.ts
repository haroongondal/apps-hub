import { LibraryError } from './errors.ts';
import { ftsQuery } from './fts-query.ts';
import { migrate } from './migrate.ts';
import { normalizeForSearch } from './normalize.ts';
import { ITEM_ID } from './orphan-dirs.ts';
import { LIBRARY_STEPS } from './schema.ts';
import type { Row, SqlPort, SqlValue } from './sql.ts';

export type ItemKind = 'pdf' | 'scan' | 'article';

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
export interface LibraryDeps {
  now(): number;
  newId(): string;
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
      const sets: string[] = [];
      const params: SqlValue[] = [];
      if (title !== undefined) (sets.push('title = ?'), params.push(title));
      if (patch.folderId !== undefined) {
        if (patch.folderId !== null) await folderIn(tx, patch.folderId);
        sets.push('folder_id = ?');
        params.push(patch.folderId);
      }
      if (patch.pageCount !== undefined) (sets.push('page_count = ?'), params.push(patch.pageCount));
      if (patch.sizeBytes !== undefined) (sets.push('size_bytes = ?'), params.push(patch.sizeBytes));
      if (sets.length) {
        sets.push('updated_at = ?');
        params.push(this.deps.now());
        await tx.run(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
        if (title !== undefined) {
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
  }): Promise<Item[]> {
    const order = q.sort === 'title' ? 'i.title COLLATE NOCASE, i.rid' : 'i.updated_at DESC, i.rid DESC';
    const kind = q.kind ?? null;
    const tagId = q.tagId ?? null;
    const rows = await this.db.all(
      `SELECT ${ITEM_COLUMNS} FROM items i
       WHERE (? = 1 OR i.folder_id IS ?)
         AND (? IS NULL OR i.kind = ?)
         AND (? IS NULL OR EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = i.id AND t.tag_id = ?))
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
      [q.everywhere ? 1 : 0, q.folderId ?? null, kind, kind, tagId, tagId, q.limit ?? DEFAULT_LIST_LIMIT, q.offset ?? 0],
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

  /** Moves items and subfolders to its parent first, so nothing is deleted with it (PRD invariant 4). */
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
      await tx.run('UPDATE folders SET parent_id = ? WHERE parent_id = ?', [parentId, id]);
      await tx.run('DELETE FROM folders WHERE id = ?', [id]);
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
