/** Track `scan`, step 1 (SPEC §4.2) plus `kind`; the step is unshipped, so it is edited in place. */
export const SCAN_STEPS: readonly string[] = [
  `CREATE TABLE scan_pages (
  item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  page_id    TEXT NOT NULL,
  position   INTEGER NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'page' CHECK (kind IN ('page', 'card', 'sheet')),
  quad       TEXT NOT NULL,
  rotation   INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270)),
  filter     TEXT NOT NULL CHECK (filter IN ('original', 'auto', 'gray', 'bw')),
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  bits_width INTEGER,
  bits_height INTEGER,
  ocr_state  TEXT NOT NULL DEFAULT 'pending' CHECK (ocr_state IN ('pending', 'done', 'failed')),
  ocr_text   TEXT,
  ocr_words  TEXT,
  ocr_conf   REAL,
  ocr_error  TEXT,
  PRIMARY KEY (item_id, page_id)
) WITHOUT ROWID;
CREATE INDEX scan_pages_order ON scan_pages (item_id, position);
CREATE INDEX scan_pages_pending ON scan_pages (ocr_state) WHERE ocr_state = 'pending';`,
];
