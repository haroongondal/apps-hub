export const KNOWLEDGE_STEPS: readonly string[] = [
  `
CREATE TABLE kn_jobs (
  item_id    TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  stage      TEXT NOT NULL CHECK (stage IN ('text', 'embed', 'graph', 'done')),
  status     TEXT NOT NULL CHECK (status IN ('queued', 'running', 'failed', 'done')),
  gen        INTEGER NOT NULL DEFAULT 0,    -- bumped by enqueue, so a run that started before an edit can't finish it
  attempts   INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX kn_jobs_queue ON kn_jobs (status, updated_at);

-- Kept so later stages never pay again for a transcript or OCR.
CREATE TABLE kn_segments (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,
  text    TEXT NOT NULL,
  locator TEXT,
  PRIMARY KEY (item_id, seq)
) WITHOUT ROWID;

CREATE TABLE kn_chunks (
  item_id   TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  seq       INTEGER NOT NULL,
  text      TEXT NOT NULL,
  locator   TEXT,
  embedding BLOB NOT NULL,
  PRIMARY KEY (item_id, seq)
) WITHOUT ROWID;

CREATE TABLE kn_nodes (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('source', 'concept', 'atom')),
  item_id    TEXT REFERENCES items(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  norm       TEXT,
  aliases    TEXT NOT NULL DEFAULT '[]',
  locator    TEXT,
  embedding  BLOB,
  created_at INTEGER NOT NULL
);
CREATE INDEX kn_nodes_item ON kn_nodes (item_id);
CREATE INDEX kn_nodes_norm ON kn_nodes (norm) WHERE type = 'concept';

-- One row per (edge, item that asserted it), so re-indexing an item removes only its own claims.
CREATE TABLE kn_edges (
  id       INTEGER PRIMARY KEY,
  from_id  TEXT NOT NULL REFERENCES kn_nodes(id) ON DELETE CASCADE,
  to_id    TEXT NOT NULL REFERENCES kn_nodes(id) ON DELETE CASCADE,
  rel      TEXT NOT NULL,
  weight   REAL NOT NULL DEFAULT 0.5,
  item_id  TEXT REFERENCES items(id) ON DELETE CASCADE,    -- NULL: linked by hand
  evidence TEXT
);
CREATE UNIQUE INDEX kn_edges_unique ON kn_edges (from_id, to_id, rel, ifnull(item_id, ''));
CREATE INDEX kn_edges_to ON kn_edges (to_id);
CREATE INDEX kn_edges_item ON kn_edges (item_id);
`,
  `
-- Which embedding model made the stored vectors. Vectors from two models are not comparable.
CREATE TABLE kn_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  `
-- Items the owner kept out of Nexus. Nothing indexes them again until they are taken off this list.
CREATE TABLE kn_excluded (
  item_id     TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  excluded_at INTEGER NOT NULL
);
`,
];
