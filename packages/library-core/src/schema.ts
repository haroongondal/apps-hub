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
`,  // Nexus: adds note, audio and image items. SQLite can't alter a CHECK, so items is rebuilt with
  // the same rid (items_fts.rowid). DROP TABLE cascades every table that references items (only
  // item_tags at this step; a later rebuild must also keep aside the kn_* and feature tables).
  `
CREATE TEMP TABLE keep_item_tags AS SELECT item_id, tag_id FROM item_tags;
CREATE TABLE items_new (
  rid        INTEGER PRIMARY KEY,
  id         TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL CHECK (kind IN ('pdf', 'scan', 'article', 'note', 'audio', 'image')),
  title      TEXT NOT NULL,
  folder_id  TEXT REFERENCES folders(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER
);
INSERT INTO items_new (rid, id, kind, title, folder_id, created_at, updated_at, size_bytes, page_count)
  SELECT rid, id, kind, title, folder_id, created_at, updated_at, size_bytes, page_count FROM items;
DROP TABLE items;
ALTER TABLE items_new RENAME TO items;
CREATE INDEX items_folder_updated ON items (folder_id, updated_at DESC);
CREATE INDEX items_updated ON items (updated_at DESC);
CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN
  DELETE FROM items_fts WHERE rowid = old.rid;
END;
INSERT INTO item_tags (item_id, tag_id) SELECT item_id, tag_id FROM temp.keep_item_tags;
DROP TABLE temp.keep_item_tags;
`,
  `
CREATE TABLE reminders (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  lat        REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  radius_m   INTEGER NOT NULL CHECK (radius_m BETWEEN 100 AND 5000),
  trigger    TEXT NOT NULL CHECK (trigger IN ('arrive', 'leave')),
  created_at INTEGER NOT NULL
);
CREATE INDEX reminders_item ON reminders (item_id);
`,  // Nexus: place reminders. Later rebuilds of items must keep this table too (DROP cascades it).
  `
-- Items read from another app (Ask my life). app is checked in code (SOURCE_APPS), so a new app needs no rebuild.
CREATE TABLE item_sources (
  item_id   TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  app       TEXT NOT NULL,
  source_id INTEGER NOT NULL,               -- the row id in that app's share
  source_at INTEGER NOT NULL,               -- ms since epoch, when it happened in that app
  UNIQUE (app, source_id)
);
`,  // Later rebuilds of items must keep this table too (DROP cascades it).
  `
CREATE TABLE item_due (
  item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  due_at  INTEGER NOT NULL                  -- ms since epoch, UTC
);
CREATE INDEX item_due_at ON item_due (due_at);
`,  // Later rebuilds of items must keep this table too (DROP cascades it).
];
