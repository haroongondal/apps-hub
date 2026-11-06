/** Track `library` (SPEC §4.2). Append-only: never edit or reorder a shipped step. */
export const LIBRARY_STEPS: readonly string[] = [
  `
CREATE TABLE folders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES folders(id),   -- no cascade: a folder with children can't be deleted
  created_at INTEGER NOT NULL               -- ms since epoch, UTC
);
CREATE UNIQUE INDEX folders_unique_name ON folders (ifnull(parent_id, ''), name COLLATE NOCASE);

CREATE TABLE items (
  rid        INTEGER PRIMARY KEY,           -- rowid alias, stable across VACUUM; = items_fts.rowid
  id         TEXT NOT NULL UNIQUE,          -- public id, directory name, referenced by feature tables
  kind       TEXT NOT NULL CHECK (kind IN ('pdf', 'scan', 'article')),
  title      TEXT NOT NULL,
  folder_id  TEXT REFERENCES folders(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,    -- total of library/<id>/
  page_count INTEGER                        -- null when unknown or not paged
);
CREATE INDEX items_folder_updated ON items (folder_id, updated_at DESC);
CREATE INDEX items_updated ON items (updated_at DESC);

CREATE TABLE tags (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE item_tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
) WITHOUT ROWID;
CREATE INDEX item_tags_tag ON item_tags (tag_id);

-- Body text lives only here (OCR text, extracted PDF text, article text), normalised (§4.3).
-- Library writes the row: createItem inserts (rid, normalizeForSearch(title), normalizeForSearch(body ?? '')),
-- updateItem rewrites title, setBody rewrites body. No insert or title trigger.
CREATE VIRTUAL TABLE items_fts USING fts5(
  title, body,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN
  DELETE FROM items_fts WHERE rowid = old.rid;
END;
`,
];
