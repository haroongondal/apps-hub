-- The account key only, sealed on the client under the emailed code; the code is mailed, never stored.
CREATE TABLE signin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  blob TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Hashes of secrets the server never stores: the client's claim and two mailed tokens, kept apart so a leaked deny link can't approve.
-- One row per claim (at most 5 in an hour), so a stranger's request can't take the owner's place.
CREATE TABLE signin_request (
  id INTEGER PRIMARY KEY,
  claim_hash TEXT NOT NULL UNIQUE,
  approve_hash TEXT NOT NULL UNIQUE,
  deny_hash TEXT NOT NULL UNIQUE,
  requested_at INTEGER NOT NULL,
  approved_at INTEGER,
  cancelled INTEGER NOT NULL DEFAULT 0
);
