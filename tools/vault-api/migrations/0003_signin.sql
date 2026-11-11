-- The account key only, sealed on the client under the emailed code; the code is mailed, never stored.
CREATE TABLE signin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  blob TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Hashes of secrets the server never stores: the client's claim and two mailed tokens, kept apart so a leaked deny link can't approve.
CREATE TABLE signin_request (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  claim_hash TEXT NOT NULL,
  approve_hash TEXT NOT NULL,
  deny_hash TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  approved_at INTEGER,
  cancelled INTEGER NOT NULL DEFAULT 0
);
