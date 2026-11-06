CREATE TABLE account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  header TEXT,
  header_rev INTEGER,
  login_hash TEXT,
  recovery_hash TEXT,
  read_hash TEXT
);

-- Nothing deletes setup_done, so removing the account row never reopens setup.
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);

CREATE TABLE records (
  id TEXT PRIMARY KEY,
  rev INTEGER NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX records_rev ON records (rev);

CREATE TABLE auth_state (id INTEGER PRIMARY KEY CHECK (id = 1), failures INTEGER);

INSERT INTO meta (k, v) VALUES ('next_rev', '1');
INSERT INTO auth_state (id, failures) VALUES (1, 0);
