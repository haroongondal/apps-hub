CREATE TABLE escrow (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  blob TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- claim_hash/confirm_hash are hashes of secrets the server never stores: a client-held claim, and a mailed confirm token.
CREATE TABLE lost_request (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  claim_hash TEXT NOT NULL,
  confirm_hash TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  release_at INTEGER,
  cancelled INTEGER NOT NULL DEFAULT 0
);
