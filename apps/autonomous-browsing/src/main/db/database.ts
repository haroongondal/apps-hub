import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

export const MIGRATIONS = [
  `CREATE TABLE system_routines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version INTEGER NOT NULL,
    description TEXT,
    definition TEXT NOT NULL,
    checksum TEXT NOT NULL,
    source_file TEXT NOT NULL,
    loaded_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE user_routines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    description TEXT,
    definition TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'chat' CHECK (source IN ('chat', 'import')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX idx_user_routines_updated ON user_routines (updated_at DESC);`,

  `CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('routine', 'chat')),
    routine_id TEXT,
    routine_kind TEXT CHECK (routine_kind IN ('system', 'user')),
    routine_name TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK (
      status IN ('running', 'held', 'done', 'assisted', 'error', 'cancelled', 'interrupted')
    ),
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    error TEXT,
    failed_step_index INTEGER,
    step_count INTEGER NOT NULL DEFAULT 0,
    human_steps INTEGER NOT NULL DEFAULT 0,
    opened_at INTEGER,
    recorded_steps TEXT
  ) STRICT;

  CREATE INDEX idx_runs_started ON runs (started_at DESC);

  CREATE TABLE run_events (
    run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    status TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    description TEXT NOT NULL,
    step_json TEXT,
    error TEXT,
    at INTEGER NOT NULL,
    PRIMARY KEY (run_id, seq)
  ) STRICT;

  CREATE TABLE run_artifacts (
    id INTEGER PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('screenshot', 'extract')),
    label TEXT NOT NULL,
    text_value TEXT,
    file_path TEXT
  ) STRICT;

  CREATE INDEX idx_run_artifacts_run ON run_artifacts (run_id);

  CREATE TABLE run_repairs (
    id INTEGER PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    reason TEXT NOT NULL,
    original TEXT NOT NULL,
    replacement TEXT NOT NULL,
    at INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX idx_run_repairs_run ON run_repairs (run_id);`,

  `CREATE TABLE repair_proposals (
    id INTEGER PRIMARY KEY,
    routine_id TEXT NOT NULL REFERENCES user_routines (id) ON DELETE CASCADE,
    run_id TEXT REFERENCES runs (id) ON DELETE SET NULL,
    step_index INTEGER NOT NULL,
    reason TEXT NOT NULL,
    original TEXT NOT NULL,
    replacement TEXT NOT NULL,
    screenshot_path TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (routine_id, step_index)
  ) STRICT;

  CREATE INDEX idx_repair_proposals_routine ON repair_proposals (routine_id);

  CREATE TABLE routine_versions (
    id INTEGER PRIMARY KEY,
    routine_id TEXT NOT NULL REFERENCES user_routines (id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    definition TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('manual', 'repair', 'import')),
    decided_by INTEGER REFERENCES repair_proposals (id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (routine_id, revision)
  ) STRICT;

  ALTER TABLE user_routines ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

  INSERT INTO routine_versions (routine_id, revision, definition, reason, created_at)
    SELECT id, 1, definition, 'manual', updated_at FROM user_routines;

  CREATE TABLE run_artifacts_rebuilt (
    id INTEGER PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('screenshot', 'extract', 'repair')),
    label TEXT NOT NULL,
    text_value TEXT,
    file_path TEXT
  ) STRICT;

  INSERT INTO run_artifacts_rebuilt (id, run_id, step_index, kind, label, text_value, file_path)
    SELECT id, run_id, step_index, kind, label, text_value, file_path FROM run_artifacts;

  DROP TABLE run_artifacts;

  ALTER TABLE run_artifacts_rebuilt RENAME TO run_artifacts;

  CREATE INDEX idx_run_artifacts_run ON run_artifacts (run_id);`,

  `CREATE TABLE repair_proposals_decided (
    id INTEGER PRIMARY KEY,
    routine_id TEXT NOT NULL REFERENCES user_routines (id) ON DELETE CASCADE,
    run_id TEXT REFERENCES runs (id) ON DELETE SET NULL,
    step_index INTEGER NOT NULL,
    reason TEXT NOT NULL,
    original TEXT NOT NULL,
    replacement TEXT NOT NULL,
    screenshot_path TEXT,
    created_at INTEGER NOT NULL,
    decision TEXT CHECK (decision IN ('accepted', 'accepted-once', 'rejected')),
    decided_at INTEGER
  ) STRICT;

  INSERT INTO repair_proposals_decided
      (id, routine_id, run_id, step_index, reason, original, replacement, screenshot_path, created_at)
    SELECT id, routine_id, run_id, step_index, reason, original, replacement, screenshot_path, created_at
      FROM repair_proposals;

  CREATE TABLE decided_link AS
    SELECT id, decided_by FROM routine_versions WHERE decided_by IS NOT NULL;

  DROP TABLE repair_proposals;

  ALTER TABLE repair_proposals_decided RENAME TO repair_proposals;

  UPDATE routine_versions SET decided_by =
    (SELECT decided_by FROM decided_link WHERE decided_link.id = routine_versions.id)
    WHERE id IN (SELECT id FROM decided_link);

  DROP TABLE decided_link;

  CREATE UNIQUE INDEX idx_repair_proposals_open
    ON repair_proposals (routine_id, step_index) WHERE decision IS NULL;

  CREATE INDEX idx_repair_proposals_routine ON repair_proposals (routine_id);`,

  // resolved_by carries no CHECK on purpose: a table constraint cannot be
  // ALTERed away, and the healing layers it names are still being reshaped.
  `CREATE TABLE run_steps (
    run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    kind TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 1,
    resolved_by TEXT NOT NULL,
    changed INTEGER,
    via TEXT CHECK (via IN ('cdp', 'synthetic')),
    recovered INTEGER,
    browser_ms INTEGER NOT NULL DEFAULT 0,
    model_ms INTEGER NOT NULL DEFAULT 0,
    held_ms INTEGER NOT NULL DEFAULT 0,
    llm_calls INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    static_looks INTEGER,
    thread_turns INTEGER,
    stop_reason TEXT,
    page_fingerprint TEXT,
    thinking INTEGER,
    PRIMARY KEY (run_id, step_index)
  ) STRICT;

  CREATE INDEX idx_run_steps_resolved ON run_steps (resolved_by);

  ALTER TABLE runs ADD COLUMN llm_calls INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN repair_calls INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN repair_budget_spent INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN model TEXT;`,

  // Nullable on purpose (chat runs hash nothing); SET NULL so retention prunes a member, never the chain.
  `ALTER TABLE runs ADD COLUMN rerun_of TEXT REFERENCES runs (id) ON DELETE SET NULL;
  ALTER TABLE runs ADD COLUMN resumed_from_run_id TEXT REFERENCES runs (id) ON DELETE SET NULL;
  ALTER TABLE runs ADD COLUMN resume_start_index INTEGER;
  ALTER TABLE runs ADD COLUMN definition_hash TEXT;
  ALTER TABLE runs ADD COLUMN routine_revision INTEGER;
  ALTER TABLE runs ADD COLUMN error_kind TEXT;
  ALTER TABLE runs ADD COLUMN resume_vars TEXT;
  ALTER TABLE run_steps ADD COLUMN committing INTEGER;`,

  `CREATE TABLE site_landmarks (
    id TEXT PRIMARY KEY,
    origin TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('control', 'route', 'obstacle')),
    fact_key TEXT NOT NULL,
    selector TEXT,
    step_kind TEXT,
    url TEXT,
    label TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 1,
    misses INTEGER NOT NULL DEFAULT 0,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX idx_site_landmarks_key ON site_landmarks (origin, kind, fact_key);
  CREATE INDEX idx_site_landmarks_origin ON site_landmarks (origin, last_seen DESC);`
]

// The db path is injected rather than derived from electron's `app` so the
// stores stay loadable under plain Node (test:db runs via ELECTRON_RUN_AS_NODE).
export function openDatabase(file: string): Database.Database {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

function applyMigrations(db: Database.Database): void {
  let version = db.pragma('user_version', { simple: true }) as number
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version]
    if (!sql) break
    const next = version + 1
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${next}`)
    })()
    version = next
  }
}
