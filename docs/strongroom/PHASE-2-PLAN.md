# Strongroom Phase 2: Cloudflare sync, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The phone and the Chrome extension share one vault through a Worker on the owner's own Cloudflare account that only ever holds ciphertext, with a second secret (the account key) so a leaked database can't be guessed offline.

**Architecture:** A new Worker, `tools/vault-api` (D1), exposes four routes. A pure-TypeScript sync client, merge and header-adoption rules go in `packages/strongroom-core`, and the same logic is written again in Kotlin in `strongroom-vault`. Both clients pass the same shared vector and protocol-sample files. The extension signs in and replaces its own vault; the phone creates the account.

**Tech Stack:** Cloudflare Worker + D1 (`cf` CLI, pattern of `tools/store-api`), `@noble/hashes` and WebCrypto (TS), BouncyCastle Argon2 and `javax.crypto` (Kotlin), `HttpURLConnection` and `JobScheduler` (platform, no new dependency), `node:sqlite` for the Worker's test database.

**Spec:** `docs/strongroom/DESIGN.md` §6 (format), §10 (sync), §11 (extension), §12 (review gates). Decisions taken 2026-11-05 are in "Decisions" below; Task 1 writes them into DESIGN.

## Decisions (owner delegated them on 2026-11-05: "do what you think is best")

- **Account key: yes.** 20 random bytes, shown like the recovery key (8 groups of 4 base32 characters; the existing recovery-key encoder is reused). It is mixed into the master key **right after Argon2id and before the HKDF split**, so the wrap key, `loginToken` and `readToken` all depend on it. Mixing it into the wrap alone would leave `SHA-256(loginToken)` on the server as a second offline guessing check.
  `mixed = HKDF-SHA-256(ikm = argon2id output, salt = accountKey, info = "strongroom/v1/account", 32)`, then `hkdf(mixed, "strongroom/v1/wrap" | "…/login" | "…/read")`.
  The recovery key path is unchanged (160 random bits already).
- **Header flag, not a version bump.** The header gets an optional `"accountKey": true`. A header without it behaves and serialises exactly as today (existing vectors keep passing, records are untouched). Strongroom 0.1.1 can't read a flagged header and fails closed as "wrong password".
- **Vault join: the extension signs in and replaces its vault.** It holds throwaway logins today. If its vault has entries, it shows the count and needs a confirmation. The old vault is replaced only after every step succeeded.
- **Where each device keeps the account key:** phone in the Android Keystore (same key class as the match index, `setUnlockedDeviceRequired(true)`); extension in `chrome.storage.local` (trusted contexts only) beside the header. Shown again only after re-entering the master password.
- **Common-password list:** the Android app already checks it (`apps/strongroom/src/common-passwords.ts`: the 10 entries of 12+ characters from the SecLists 10k, which is all that can matter at a 12-character floor). Only the extension lacks it; Task 7 adds the same 10 entries with a test that the two files agree.
- **Branching:** the push of the extension branch was denied by the auto-mode classifier on 2026-11-05, so `main` has no `strongroom-core` yet. Phase 2 works on branch `strongroom-sync`, created from `strongroom-extension` (`c3da09c`). Once the owner has merged the extension PR: `git rebase --onto origin/main c3da09c strongroom-sync` (if the PR was squashed) or a plain rebase (if not).
- **Release:** Phase 2 changes `apps/strongroom` and `strongroom-vault`, so CI would release Strongroom on merge to `main`. Merge with `[skip ci]`, then `pnpm release strongroom` locally, only on the owner's word (memory: release-by-local-command). Version 0.2.0.

## Global Constraints

- KDF floor `m = 32 MiB, t = 2, p = 1`; ceiling `m = 1 GiB, t = 16, p = 4`; default `m = 64 MiB, t = 3, p = 1`. A device refuses params outside the range **before deriving anything**, and never accepts a header whose params are lower than the one it holds.
- AES-256-GCM, random 96-bit nonce per encryption, never taken from the caller; record AAD = `strongroom/v1/record/<id>`. No own cipher or KDF.
- Nothing but ciphertext, record ids, sizes and timestamps reaches Cloudflare. No telemetry, no crash reporting, no new third-party dependency (if one turns out to be needed, stop and ask the owner).
- Vault format stays byte-compatible: record bytes, header layout and existing vectors do not change.
- UI only from `@apps-hub/ui`; copy in sentence case, active voice, errors say what happened and how to fix it; no emoji icons.
- TypeScript is erasable (no enums, namespaces or parameter properties), imports end in `.ts`. A new `*.test.ts` does nothing until it is listed in that package's `test` script.
- `cf` CLI for Cloudflare (the project has `cloudflare.config.ts`, no Wrangler config). Confirm the account with the owner before any deploy; `tools/store-api` pins the personal account `29ada9205500ff7931f09084daf89597`. Do not guess `cf` subcommands: find them with `cf cli search`.
- Android: `minSdk 33`; Kotlin owns the vault and the sync; install on the phone only through the Store; adb on the phone only for logcat, screenshots and uiautomator dumps, always `-s <serial>`.
- Commits: no `Co-Authored-By` and no "Generated with" line (owner's rule). No push, merge, release or deploy without the owner's word in the chat.

## Protocol (every binary field is standard base64; every body is JSON; errors are `{ "error": string }`)

A token is 32 bytes, sent as `Authorization: Bearer <base64>`. A token hash is `base64(SHA-256(raw token bytes))`.

| Route | Accepts | Request → success response |
|---|---|---|
| `GET /v1/prelogin` | nobody | → `{ version, kdf, salt, accountKey }`; `404` if no account |
| `PUT /v1/account` | create: `SETUP_TOKEN`, once ever. Update: login or recovery token | `{ header: string, loginHash, recoveryHash, readHash, ifRev?: number }` → `{ headerRev }`. `409` if `ifRev` is stale; `403` if setup already happened and the token is `SETUP_TOKEN` |
| `GET /v1/records?since=N&limit=M` | login, recovery or read token | → `{ header: string, headerRev, records: [{ id, rev, ciphertext, updatedAt }], latestRev, more }` (ascending `rev`, `limit` ≤ 500) |
| `POST /v1/records` | login or recovery token | `{ upserts: [{ id, baseRev, ciphertext }] }` → `{ revs: [{ id, rev }], latestRev }`; `409 { conflicts: [{ id, rev }] }` if any `baseRev` is stale (`0` means "new id", stale if the id exists). All or nothing |

Limits: id is a lowercase UUID; `ciphertext` ≤ 90,000 base64 characters (about 64 KiB); ≤ 100 upserts per POST (`413`/`400` otherwise). Revisions come from one global counter. Deletions are tombstone records, never row deletes. No CORS headers (browsers can't call it from a web page).

---

## Review Focus

Failure modes the spec implies that no plain "happy path" test reaches, most likely first. Each has a named test in the owning task.

1. **A push that committed on the server but was never marked done locally** (app killed, network dropped on the reply). The next sync pushes again with the old base revision, gets `409`, pulls its own record back and must treat identical bytes as clean, not as a conflict. → Task 3 `interruptedPushIsNotAConflict`, Task 5 `interruptedPushIsNotAConflict`.
2. **The password was changed on another device.** This device's token now gets `401`; it must say "sign in again" and stop, not retry in a loop, and must accept the new header only after the new password unwraps it to the vault key it already holds. → Task 3 `authFailureStopsAndAsksToSignIn`, `adoptsHeaderOnlyWithNewPasswordAndSameVaultKey`.
3. **A device clock that is wrong.** Last-writer-wins on `updatedAt` means a clock a day ahead wins every conflict. The result must at least be deterministic and counted, never a crash or a silent tombstone loss. → Task 3 `skewedClockIsDeterministicAndCounted`.
4. **A server that lies**: a header with lower KDF settings or without the account-key flag, a revision that goes backwards, a record with a bad id or oversize or not base64. All must be refused or skipped and reported, never applied, and nothing local deleted. → Task 3 `refusesWeakerHeader`, `refusesDroppedAccountKeyFlag`, `rollbackIsReportedAndDeletesNothing`, `badRowsAreSkippedAndReported`.
5. **First sync on a brand-new device, and an empty server.** A fresh device must only pull; it must never push tombstones or an empty header over the account. → Task 3 `freshDeviceOnlyPulls`; Task 2 `secondSetupIsRefusedEvenAfterAccountRowIsDeleted`.

---

## File map

- Create `tools/vault-api/` (`package.json`, `tsconfig.json`, `vite.config.ts`, `cloudflare.config.ts`, `migrations/0001_init.sql`, `src/index.ts`, `src/db.ts`, `src/auth.ts`, `src/__tests__/…`, `.gitignore` with `.dev.vars`).
- Create `packages/strongroom-core/src/sync/` (`protocol.ts`, `transport.ts`, `merge.ts`, `header-adopt.ts`, `client.ts`, `signin.ts`) and `src/__tests__/` files for each; modify `format.ts`, `crypto.ts`, `index.ts`.
- Modify `apps/strongroom/modules/strongroom-vault/android/src/test/resources/vault-vectors.json` (new `accountKey` section); create `…/sync-samples.json` beside it.
- Kotlin, in `apps/strongroom/modules/strongroom-vault/android/src/main/java/expo/modules/strongroomvault/`: modify `core/VaultFormat.kt`, `core/RecordStore.kt`, `android/SqliteRecordStore.kt`, `android/VaultHolder.kt`, `StrongroomVaultModule.kt`; create `core/SyncMerge.kt`, `core/SyncClient.kt`, `core/AccountKey.kt`, `android/HttpSyncTransport.kt`, `android/SyncKeys.kt`, `android/SyncJobService.kt`, `android/SyncConfig.kt`.
- Phone UI in `apps/strongroom/src/` (`SyncScreen.tsx`, changes to `SettingsScreen.tsx`, `VaultScreen.tsx` footer); release manifest `apps/strongroom/android/app/src/release/AndroidManifest.xml`.
- Extension: `apps/strongroom-extension/src/` (`storage.ts`, `service.ts`, `popup.ts`, `background.ts`, `sync-url.ts`, `common-passwords.ts`), `manifest.json`, `test/e2e.mjs`.
- Docs: `docs/strongroom/DESIGN.md`, `AGENTS.md`, `docs/handoffs/strongroom-extension.md` and `docs/handoffs/strongroom.md`.

---

### Task 1: Account key and tokens in strongroom-core, with shared vectors

**Files:**
- Modify: `packages/strongroom-core/src/format.ts`, `crypto.ts`, `recovery-key.ts`, `index.ts`
- Modify: `apps/strongroom/modules/strongroom-vault/android/src/test/resources/vault-vectors.json`
- Create: `apps/strongroom/tools/vectors/account_key_vectors.py` (computes the new vectors independently of both implementations)
- Test: `packages/strongroom-core/src/__tests__/format.test.ts`, `crypto.test.ts`, `recovery-key.test.ts`; DESIGN §6/§10 text

**Interfaces:**
- Produces (all in `strongroom-core`):
  - `type Header = { …existing; accountKey?: true }`; `headerToJson` omits the field when absent, `headerFromJson` accepts a boolean `true` and rejects any other value of the field.
  - `class AccountKeyRequired extends Error`.
  - `generateAccountKey(): Uint8Array` (20 bytes), `formatAccountKey`, `parseAccountKey` (the recovery-key encoder under account-key names).
  - `createVault(password, recoveryKey, opts?: Options & { accountKey?: Uint8Array })` sets the flag when a key is given.
  - `unlockWithPassword(h, password, floor?, accountKey?)` throws `AccountKeyRequired` when `h.accountKey` and no key is given.
  - `openWithPassword(h, password, floor?, accountKey?): Promise<{ vaultKey: Uint8Array; loginToken: Uint8Array; readToken: Uint8Array } | null>` (one Argon2 run yields all three).
  - `recoveryLoginToken(recoveryKey: Uint8Array): Uint8Array`.
  - `withNewPassword(h, vaultKey, password, opts & { accountKey? })` keeps the flag and uses the key.
  - `withAccountKey(h, vaultKey, password, accountKey, opts?): Promise<Header>` (the migration the phone runs when sync is turned on; new salt, same KDF, only `passwordWrap` and the flag change).
  - `tokenHash(token: Uint8Array): string` = `base64(SHA-256(token))`.

- [ ] **Step 1: Compute the vectors independently.** Write `account_key_vectors.py` (argon2-cffi + `hmac`/`hashlib` HKDF) and run it for the existing test password, salt and KDF plus a fixed 20-byte account key. Paste into `vault-vectors.json` a new `accountKey` section: `key`, `mixedMasterKey`, `wrapKey`, `loginToken`, `readToken`, `tokenHash(loginToken)`, a `header` with `accountKey: true`, and a `passwordWrap` sealed with the fixed test nonce.
- [ ] **Step 2: Write the failing tests** (`format.test.ts` unless noted):
  - `accountKeyVectorsMatch`: derived `mixedMasterKey`, `wrapKey`, `loginToken`, `readToken` equal the vector; `tokenHash` equals the vector's.
  - `opensVectorHeaderWithAccountKey`: the vector header opens to the vector vault key with the key, and `unlockWithPassword` without it throws `AccountKeyRequired`.
  - `wrongAccountKeyIsNull`: same header and password, one flipped byte in the key → `null`.
  - `headerWithoutFlagIsByteIdentical`: `headerToJson(headerFromJson(existingVectorHeader))` equals the existing vector JSON exactly; `headerFromJson` returns `null` for `"accountKey": false`, `"accountKey": "true"` and `"accountKey": 1`.
  - `withAccountKeyMigratesAndKeepsRecords`: after `withAccountKey` the old password-only unlock fails with `AccountKeyRequired`, the new one returns the **same vault key**, and a record sealed before still opens.
  - `withNewPasswordKeepsAccountKey`: flag kept, new password + same key opens, old password does not.
  - `recoveryPathIgnoresAccountKey`: `unlockWithRecovery` on a flagged header returns the vault key; `recoveryLoginToken` equals the existing `recovery.loginToken` vector.
  - `accountKeyRoundTripsThroughText` (`recovery-key.test.ts`): `parseAccountKey(formatAccountKey(k))` equals `k`; a text with one wrong character returns `null`.
  - `kdfRangeStillCheckedBeforeDeriving` (`format.test.ts`): a flagged header with `m = 1024` throws `KdfOutOfRange` without calling Argon2 (spy on `argon2id`).
- [ ] **Step 3: Run them to see them fail.** `pnpm --filter strongroom-core test` → the new tests fail with missing exports.
- [ ] **Step 4: Implement** the interfaces above in `format.ts` / `crypto.ts` (add an `hkdf` overload with a salt; keep the existing one). Add the new test names to the package's `test` script if a new file was created.
- [ ] **Step 5: Run `pnpm --filter strongroom-core test && pnpm --filter strongroom-core typecheck`.** Expected: all pass, existing 85 included.
- [ ] **Step 6: Docs.** DESIGN §10: replace the "Open question" paragraph with the decision above (mix point, header flag, where each device keeps it); §6 header line mentions the optional flag; §11 notes the extension signs in. Commit: `git add … && git commit -m "Strongroom: account key and login/read tokens in strongroom-core"`.

---

### Task 2: The Worker `tools/vault-api`

**Files:**
- Create: everything under `tools/vault-api/` listed in the file map
- Create: `apps/strongroom/modules/strongroom-vault/android/src/test/resources/sync-samples.json` (one request and response sample per route, all fixed)
- Test: `tools/vault-api/src/__tests__/worker.test.ts`, `schema.test.ts`

**Interfaces:**
- Consumes: `tokenHash`, `AccountPut`/`PullResponse`/`PushRequest` types from Task 3's `sync/protocol.ts`. **Order:** write `protocol.ts` first (types and `LIMITS` only, no logic) as the opening step of this task; Task 3 builds on it.
- Produces: `export interface Db { prepare(sql: string): Stmt; batch(stmts: Stmt[]): Promise<Result[]> }` (the D1 subset used); `export interface Env { DB: Db; SETUP_TOKEN: string }`; `export function handle(req: Request, env: Env, deps?: { now?: () => number; sleep?: (ms: number) => Promise<void> }): Promise<Response>`; `export default { fetch }`.
- Test helper: `d1FromNodeSqlite(db: DatabaseSync): Db` in `src/__tests__/d1-fake.ts`; `batch` is one transaction that rolls back if any statement throws.

Schema (`migrations/0001_init.sql`): `account(id INTEGER PRIMARY KEY CHECK (id = 1), header TEXT, header_rev INTEGER, login_hash TEXT, recovery_hash TEXT, read_hash TEXT)`; `meta(k TEXT PRIMARY KEY, v TEXT)` holding `setup_done` and `next_rev`; `records(id TEXT PRIMARY KEY, rev INTEGER NOT NULL, ciphertext TEXT NOT NULL, updated_at INTEGER NOT NULL)` with an index on `rev`; `auth_state(id INTEGER PRIMARY KEY CHECK (id = 1), failures INTEGER)`.

- [ ] **Step 1: Write the failing tests** against `handle` with the node:sqlite D1 fake and a fixed `now`:
  - `preloginIs404BeforeSetupThenPublic`: 404; after setup, 200 with `{version, kdf, salt, accountKey}` and no auth header needed.
  - `setupNeedsSetupTokenAndWorksOnce`: a wrong or short token → 401; the right one → 200 `{headerRev: 1}`; the second create → 403.
  - `secondSetupIsRefusedEvenAfterAccountRowIsDeleted`: delete the `account` row directly, then create again → 403 (the `setup_done` marker survives).
  - `loginAndRecoveryTokensWorkReadTokenOnlyReads`: login and recovery tokens can `GET` and `POST`; the read token can `GET` but `POST` and `PUT /v1/account` return 401.
  - `staleBaseRevIs409AndNothingIsWritten`: two upserts, one with a stale `baseRev` → 409 listing it, and neither row changed, **including under an interleaved second push** (second request runs between the revision read and the write).
  - `newIdWithBaseRevZeroConflictsIfItExists`; `revsAreIncreasingAcrossBatches`; `pullReturnsOnlyNewerAscendingWithMore` (limit 2 over 5 records pages correctly); `tombstoneIsJustARecord`.
  - `headerCompareAndSwap`: `PUT /v1/account` with a stale `ifRev` → 409, header unchanged; with the right one, tokens change atomically (old login token → 401, new → 200).
  - `inputLimits`: oversize ciphertext, 101 upserts, non-UUID id, non-base64 ciphertext, a token that is not 32 bytes → 4xx and nothing written.
  - `failedAuthBacksOffButCorrectTokenIsNeverDelayed`: after 5 consecutive failures the 401 response waits `min(2^(n-5), 30)` s (assert on the injected `sleep`); a correct token returns at once and resets the counter. There is no lockout.
  - `noCorsHeadersAndNoStoreCaching`: every response has `cache-control: private, no-store` and no `access-control-*`.
  - `responsesMatchTheSharedSamples`: each route's real response equals `sync-samples.json` in shape and fixed values.
- [ ] **Step 2: Run to see them fail.** `pnpm --filter @apps-hub/vault-api test` → fails (no package yet).
- [ ] **Step 3: Scaffold the package** from `tools/store-api` (same devDependencies pins, so no new package enters the lockfile; script `"test": "node --disable-warning=ExperimentalWarning --test src/__tests__/…"` listing each file). Add `SETUP_TOKEN: bindings.secret()` and the D1 binding in `cloudflare.config.ts`; **look up the D1 binding helper in the installed `cf` types before writing it** and note the name used.
- [ ] **Step 4: Implement `handle`** with the protocol table above. Compare token hashes with a constant-time compare (the store-api `safeEqual` idea with a per-request random HMAC key, so no extra secret). Batch writes: `D1.batch` is transactional; make a lost compare-and-set race throw so the whole batch rolls back and answer 409.
- [ ] **Step 5: Run `pnpm --filter @apps-hub/vault-api test && … typecheck`.** Expected: all pass.
- [ ] **Step 6: Commit** `git add tools/vault-api … && git commit -m "Strongroom: the vault-api Worker (D1), not deployed"`.

---

### Task 3: Sync client, merge and header adoption in strongroom-core

**Files:**
- Create: `packages/strongroom-core/src/sync/transport.ts`, `merge.ts`, `header-adopt.ts`, `client.ts`, `signin.ts` and a test file for each
- Create: `tools/vault-api/src/__tests__/sync-e2e.test.ts` (the TS client against the real `handle` and the D1 fake)
- Modify: `packages/strongroom-core/src/index.ts`

**Interfaces:**
- Consumes: Task 1's `openWithPassword`, `recoveryLoginToken`, `tokenHash`, `withNewPassword`; Task 2's `protocol.ts`.
- Produces:
  - `type SyncRecord = StoredRecord & { rev: number; dirty: boolean }`.
  - `interface SyncStore extends RecordStore { getSyncRecords(): Promise<SyncRecord[]>; getSyncMeta(): Promise<{ lastRev: number; headerRev: number }>; applyPull(p: { header?: Header; headerRev: number; records: { id: string; sealed: Uint8Array; rev: number }[]; quarantine: { id: string; sealed: Uint8Array; rev: number }[]; lastRev: number }): Promise<void>; markPushed(items: { id: string; rev: number; sealed: Uint8Array }[]): Promise<void>; getQuarantine(): Promise<{ id: string; rev: number }[]> }`. `commit({ records })` marks those records `dirty`. `applyPull` is one atomic write and never marks dirty. `markPushed` clears `dirty` only if the stored bytes still equal `sealed`, so an edit made during the push stays dirty.
  - `interface Transport { prelogin(): Promise<Prelogin | null>; pull(token: Uint8Array, since: number): Promise<PullResponse>; push(token: Uint8Array, req: PushRequest): Promise<PushResponse | { conflicts: { id: string; rev: number }[] }>; putAccount(auth: Uint8Array | { setupToken: string }, body: AccountPut): Promise<{ headerRev: number }> }`; `fetchTransport(baseUrl: string, fetchFn?: typeof fetch): Transport` (30 s timeout); errors `SyncHttpError(status)`.
  - `planMerge(local: MergeLocal[], remote: MergeRemote[]): MergePlan` with `MergeLocal = { id; rev; dirty; sealed; entry: Entry | null }`, `MergeRemote = { id; rev; sealed; entry: Entry | null }`, `MergePlan = { adopt: MergeRemote[]; push: { id: string; baseRev: number }[]; quarantine: MergeRemote[]; blocked: string[]; conflicts: number }`.
  - `adoptHeader(local: Header, remote: Header, password: string, accountKey: Uint8Array | undefined, vaultKey: Uint8Array): Promise<Header | 'refused'>`.
  - `syncOnce(d: { store: SyncStore; transport: Transport; vaultKey: Uint8Array; token: Uint8Array; maxRetries?: number }): Promise<SyncReport>`, `SyncReport = { pulled; pushed; conflicts; quarantined; blocked; headerChanged: boolean }`; errors `SyncAuthError` (401), `SyncRollbackError`, `SyncOfflineError`.
  - `signInWithPassword(t: Transport, password: string, accountKey?: Uint8Array): Promise<SignedIn>` and `signInWithRecovery(t: Transport, recoveryKey: Uint8Array): Promise<SignedIn>`, `SignedIn = { header: Header; headerRev: number; records: { id; sealed; rev }[]; lastRev: number; vaultKey: Uint8Array; loginToken: Uint8Array; readToken: Uint8Array | null }`. They write nothing; the caller commits atomically.

Merge rules: pull since `lastRev`, then push dirty records. Per id: remote only → adopt; local only → push with `baseRev 0`; both and local clean → take remote; both and local dirty → later `updatedAt` wins, equal → the tombstone wins, otherwise remote; a winner that is local is pushed with the remote `rev` as `baseRev`. A remote record that does not decrypt goes to quarantine and its id is added to `blocked` (never uploaded over, reported); a readable local record is kept. Identical sealed bytes on both sides is never a conflict.

- [ ] **Step 1: Write the failing merge tests** (`merge.test.ts`, pure): `remoteOnlyIsAdopted`, `localOnlyIsPushedWithBaseRevZero`, `cleanLocalTakesRemote`, `laterEditWins`, `tombstoneWinsOnEqualTime`, `editNewerThanTombstoneWins`, `undecryptableRemoteIsQuarantinedAndBlocked`, `readableLocalBeatsUndecryptableRemote`, `neverDeletesAnything` (plan never has a delete), `interruptedPushIsNotAConflict` (identical `sealed` both sides, local dirty), `skewedClockIsDeterministicAndCounted` (remote `updatedAt` a day ahead: remote wins, `conflicts` is 1, same result when run twice).
- [ ] **Step 2: Write the failing client and header tests** against an in-memory `SyncStore` and a fake `Transport`: `freshDeviceOnlyPulls` (empty local, populated server: nothing pushed, no tombstones), `pullsInPagesAndAdvancesLastRevOnlyWithTheBatch` (a failure on page 2 leaves `lastRev` at the old value), `pushRetriesAfter409UpToMaxRetries`, `markPushedKeepsEditsMadeDuringThePush`, `interruptedPushIsNotAConflict` (server has the record with a new rev, local still dirty with the old base: ends clean, nothing pushed), `authFailureStopsAndAsksToSignIn` (401 → `SyncAuthError`, one request only), `rollbackIsReportedAndDeletesNothing` (`latestRev` below `lastRev` → `SyncRollbackError`, store untouched), `badRowsAreSkippedAndReported` (bad id, oversize, bad base64), `refusesWeakerHeader` (any KDF axis lower than local, or out of range), `refusesDroppedAccountKeyFlag`, `adoptsHeaderOnlyWithNewPasswordAndSameVaultKey` (a header whose wrap opens to a different vault key → `'refused'`), `signInChecksKdfBeforeDeriving` (server `prelogin` with `m = 1024` → `KdfOutOfRange`, Argon2 never called), `signInWithWrongAccountKeyFails`.
- [ ] **Step 3: Write the end-to-end test** `sync-e2e.test.ts` in the Worker package: set up an account through the real Worker, two in-memory devices sign in with password + account key, one edits and one deletes the same login, both `syncOnce`, both end with the same entries; then a password change on one device and a `401` then re-sign-in on the other.
- [ ] **Step 4: Run to see them fail**, then **implement** the interfaces above (one concern per file; `client.ts` only orchestrates the others).
- [ ] **Step 5: Run `pnpm --filter strongroom-core test` and `pnpm --filter @apps-hub/vault-api test`, then both `typecheck`.** Expected: all pass.
- [ ] **Step 6: Commit** `git commit -m "Strongroom: sync client, merge and header adoption in strongroom-core"`.

---

### Task 4: Account key and tokens in Kotlin, against the same vectors

**Files:**
- Modify: `core/VaultFormat.kt`, `core/Crypto.kt` (uses the existing salted `hkdf` overload), `core/RecoveryKey.kt`; create `core/AccountKey.kt`
- Test: `core/VaultFormatTest.kt`, `core/RecoveryKeyTest.kt`, `core/CryptoTest.kt`

**Interfaces:**
- Produces, mirroring Task 1 exactly: `Header.accountKey: Boolean` (JSON field emitted only when true, rejected unless the boolean `true`); `class AccountKeyRequired : Exception`; `VaultFormat.create(…, accountKey: ByteArray? = null)`; `VaultFormat.unlockWithPassword(h, password, accountKey: ByteArray? = null)`; `VaultFormat.openWithPassword(h, password, accountKey): Opened?` where `Opened(vaultKey, loginToken, readToken)`; `VaultFormat.recoveryLoginToken(recoveryKey)`; `VaultFormat.withAccountKey(h, vaultKey, password, accountKey)`; `AccountKey.generate()`, `format`, `parse`; `Crypto.tokenHash(token): String`.

- [ ] **Step 1: Write the failing tests** reading the **same** `accountKey` vector section as Task 1: `accountKeyVectorsMatch`, `opensVectorHeaderWithAccountKey`, `withoutKeyThrowsAccountKeyRequired`, `wrongAccountKeyIsNull`, `headerWithoutFlagIsByteIdentical`, `withAccountKeyMigratesAndKeepsRecords`, `recoveryPathIgnoresAccountKey`, `accountKeyRoundTripsThroughText`, `kdfRangeCheckedBeforeDerivingWithFlag`.
- [ ] **Step 2: Run to see them fail:** `cd apps/strongroom/android && JAVA_HOME=$JAVA_HOME ./gradlew :strongroom-vault:testDebugUnitTest --tests '*VaultFormatTest' --tests '*RecoveryKeyTest'`.
- [ ] **Step 3: Implement.** The mix and labels are fixed in "Decisions"; do not invent others.
- [ ] **Step 4: Run the full module gate:** `./gradlew :strongroom-vault:testDebugUnitTest :app:assembleDebug`. Expected: 0 failures, every existing test included (record the count before and after).
- [ ] **Step 5: Commit** `git commit -m "Strongroom: account key and tokens in Kotlin, same vectors"`.

---

### Task 5: Kotlin sync: store schema 2, merge and client

**Files:**
- Modify: `core/RecordStore.kt`, `android/SqliteRecordStore.kt`; create `core/SyncMerge.kt`, `core/SyncClient.kt`
- Test: `core/SyncMergeTest.kt`, `core/SyncClientTest.kt`, `core/SyncProtocolSamplesTest.kt`, `android/SqliteMigrationTest.kt` (Robolectric is not in the module; test the SQL through `MemoryRecordStore` and assert the migration statements as text, then prove the real migration on the emulator in Task 6)

**Interfaces:**
- Produces: `interface SyncRecordStore : RecordStore { fun syncRecords(): List<SyncRecord>; fun syncMeta(): SyncMeta; fun applyPull(p: PullApplied); fun markPushed(items: List<PushedItem>); fun quarantine(): List<Pair<String, Long>> }` mirroring the TS `SyncStore` (same atomicity and "clear dirty only if bytes still equal"); `SyncMerge.plan(local, remote): MergePlan` with the same rules and field meanings as Task 3; `interface SyncTransport` with the same four calls; `SyncClient.syncOnce(store, transport, vaultKey, token, maxRetries = 3): SyncReport`; the same error classes.
- Schema 2 (`SQLiteOpenHelper` version 2): `records` gains `rev INTEGER NOT NULL DEFAULT 0` and `dirty INTEGER NOT NULL DEFAULT 0`; new `meta(k, v)` and `quarantine(id, rev, sealed)`. **On upgrade every existing record is marked `dirty = 1`**, so the first sync uploads the phone's current vault. `putAll` (local writes) sets `dirty = 1`.

- [ ] **Step 1: Write the failing tests:** the same named cases as Task 3's merge and client lists (`remoteOnlyIsAdopted` … `skewedClockIsDeterministicAndCounted`, `freshDeviceOnlyPulls`, `interruptedPushIsNotAConflict`, `authFailureStopsAndAsksToSignIn`, `rollbackIsReportedAndDeletesNothing`, `badRowsAreSkippedAndReported`, `refusesWeakerHeader`, `refusesDroppedAccountKeyFlag`, `adoptsHeaderOnlyWithNewPasswordAndSameVaultKey`), plus `upgradeMarksExistingRecordsDirty` and `SyncProtocolSamplesTest.parsesEverySampleFromTheWorker` (parses each request and response in `sync-samples.json`, re-encodes the requests, and compares).
- [ ] **Step 2: Run to see them fail,** then **implement.** `HttpSyncTransport` is not part of this task; a fake transport drives the tests.
- [ ] **Step 3: Run `./gradlew :strongroom-vault:testDebugUnitTest :app:assembleDebug`.** Expected: 0 failures.
- [ ] **Step 4: Commit** `git commit -m "Strongroom: sync merge, client and store schema 2 in Kotlin"`.

---

### Task 6: Android adapters, module API, screens, release manifest

**Files:**
- Create: `android/HttpSyncTransport.kt` (`HttpURLConnection`, TLS only, 15 s connect / 30 s read), `android/SyncKeys.kt` (Keystore AES key with `setUnlockedDeviceRequired(true)` for the account key; a second key with **no** unlocked-device requirement for `readToken`), `android/SyncJobService.kt` (`JobScheduler`, network required, periodic 15 min, **download only**), `android/SyncConfig.kt` (`BASE_URL`)
- Modify: `android/VaultHolder.kt`, `StrongroomVaultModule.kt`, `apps/strongroom/modules/strongroom-vault/src/index.ts` (adapter), the module manifest (service), `apps/strongroom/android/app/src/release/AndroidManifest.xml`
- Create: `apps/strongroom/src/SyncScreen.tsx`; modify `SettingsScreen.tsx`, `VaultScreen.tsx` (footer shows sync state, DESIGN §9)
- Test: `AdaptersTest.kt`, `apps/strongroom/src/__tests__/sync.test.ts` (node), `apps/strongroom/src/__tests__/manifest.test.ts`

**Interfaces:**
- Produces module functions: `syncStatus(): { state: 'off' | 'pendingSetup' | 'idle' | 'syncing' | 'needsSignIn' | 'error'; lastSyncAt: number | null; blocked: number; quarantined: number }`; `enableSync(setupToken: string, password: string): { accountKey: string }` (shows the key once); `showAccountKey(password: string): string`; `signInSync(password: string, accountKey: string): void`; `recoverSync(recoveryKey: string, newPassword: string): void`; `syncNow(): SyncReport`; event `onSync`. A password crosses to JS only as before.
- `enableSync` order (retry-safe): re-derive from the master password → generate the account key → **store it in the Keystore first** → commit the re-wrapped header locally (`withAccountKey`) → `PUT /v1/account` with `SETUP_TOKEN` → set state `idle`. A failure after the local commit leaves state `pendingSetup`, and a retry only repeats the `PUT`.
- Sync runs on unlock, after every local change (debounced 2 s), by `syncNow`, and from the job (download only while locked; merge and upload wait for unlock).

- [ ] **Step 1: Write the failing tests:**
  - `manifest.test.ts`: the release manifest no longer removes `INTERNET`; `usesCleartextTraffic` is false; the module declares exactly one new service (`SyncJobService`, not exported) and no other new permission; `allowBackup` is still `false`.
  - `AdaptersTest.kt`: `readTokenKeyNeedsNoUnlockedDevice` and `accountKeyKeyNeedsUnlockedDevice` (key specs), `httpTransportRefusesCleartext` (an `http://` base URL throws), `jobIsDownloadOnlyWhenLocked` (the job path never calls `applyPull` writes of local records or `POST`; it calls `GET` with the read token only).
  - `sync.test.ts`: the screen state machine: `pendingSetup` offers "Finish setting up sync", `needsSignIn` offers the password and account-key form, the setup screen refuses to continue until one group of the account key is typed back (as for the recovery key), copy rules (no ALL-CAPS, no emoji).
- [ ] **Step 2: Run to see them fail, then implement.** The screens use `@apps-hub/ui` components only. The `BASE_URL` stays empty until Task 8; with it empty the Sync entry says "Sync isn't available in this build."
- [ ] **Step 3: Gates:** `pnpm --filter strongroom test && pnpm --filter strongroom typecheck`; `./gradlew :strongroom-vault:testDebugUnitTest :app:assembleDebug`; `./gradlew :app:assembleRelease` then `aapt2 dump permissions` on the APK: the list now holds `INTERNET` and nothing that Phase 1 did not hold.
- [ ] **Step 4: Emulator proof on `strongroom-task12` (emulator-5556, never the phone):** run a local `vault-api` through the node:sqlite harness on `127.0.0.1` with `adb reverse`, point a debug build at it, then: enable sync, see the account key once, add a login, sync, `pm clear`, sign in again with password + account key and see the login. Upgrade check: install the 0.1.1 release build, create two logins, install this build over it, enable sync, confirm both reach the server. Update `apps/strongroom/tools/disk-check.sh` to also scan for the account key text and the `readToken` (plain, UTF-16, Base64); run it with sync on: 0 hits.
- [ ] **Step 5: Commit** `git commit -m "Strongroom Android: sync client, Keystore tokens, background download, INTERNET"`.

---

### Task 7: Extension wiring, and the common-password rule

**Files:**
- Modify: `apps/strongroom-extension/src/storage.ts` (a `SyncStore` over `chrome.storage.local`: per-record `rev`/`dirty`, meta, quarantine, one serialized write chain as today), `service.ts`, `popup.ts`, `popup.html`, `background.ts`, `manifest.json`, `build.mjs`, `test/e2e.mjs`
- Create: `src/sync-url.ts` (`SYNC_URL`), `src/common-passwords.ts` (the same 10 entries as the phone)
- Test: `src/__tests__/service.test.ts`, a new `src/__tests__/common-passwords.test.ts` (added to the package `test` script)

**Interfaces:**
- Produces new service messages: `{ type: 'syncStatus' }`, `{ type: 'signIn'; password: string; accountKey: string; replace?: boolean }`, `{ type: 'signInRecovery'; recoveryKey: string; newPassword: string; accountKey: string; replace?: boolean }`, `{ type: 'syncNow' }`. `signIn` returns `{ needsConfirm: true; entries: number }` when the local vault has entries and `replace` is not set. Page contexts may not send any of these (the existing `FROM_PAGE` allow-list stays `candidates`, `fill`, `capture`).
- While unlocked the worker keeps `loginToken` in `chrome.storage.session` (memory only) and syncs on unlock, after saves, and from a `chrome.alarms` alarm every 5 minutes; lock clears the token. The account key is stored in `chrome.storage.local`.
- Manifest: `host_permissions: ["<SYNC_URL origin>/*"]`; no other new permission.

- [ ] **Step 1: Write the failing tests:**
  - `signInReplacesTheLocalVaultOnlyAfterConfirmation`: with entries locally, first call → `{ needsConfirm: true, entries: 2 }` and nothing changed; with `replace: true` → vault, header, account key and sync meta all replaced in one write.
  - `failedSignInKeepsTheOldVault`: wrong password, wrong account key, a server header with out-of-range KDF, a network failure → the old vault and its unlock still work unchanged.
  - `syncMergesAndShowsRemoteEdits`; `lockClearsTheLoginTokenAndStopsSyncing`; `pageContextCannotSignInOrSync` (a message from a web page sender gets the same refusal as other non-allowed types); `setupRejectsCommonPassword` (each of the 10 phone entries, in any letter case, is refused with the existing "too common" message) and `commonPasswordListsAgree` (reads `apps/strongroom/src/common-passwords.ts` and compares the sets).
  - e2e (real Chromium, against the Worker harness): `signsInAndSeesThePhonesLogin`, `editOnOneSideAppearsOnTheOther`, `restartKeepsSyncStateAndStaysLocked`, `storageLocalHasNoReadableTokenOrAccountKeyText` (scan `chrome.storage.local` dump for the account key text and token text in plain and Base64).
- [ ] **Step 2: Run to see them fail, then implement.** Popup: a "Sync" card with the sign-in form (password, account key) and the replace confirmation naming the entry count; sentence-case copy; `@apps-hub/ui` classes only.
- [ ] **Step 3: Gates:** `pnpm --filter strongroom-extension test && … typecheck`; `pnpm --filter strongroom-extension build && pnpm --filter strongroom-extension test:e2e` (needs `playwright-core` outside the repo and Chromium 1228, per the handoff). Expected: the previous 33 e2e checks plus the new ones pass.
- [ ] **Step 4: Commit** `git commit -m "Strongroom for Chrome: sign in to sync, merge, and the common-password rule"`.

---

### Task 8: Review, deploy, live checks (owner-gated)

Nothing in this task runs without the owner's word in the chat, step by step.

- [ ] **Step 1: Reviews (DESIGN §12.2), read-only agents:** `security-engineer` on `tools/vault-api` and the sync code in core and Kotlin (auth, rate limit, header adoption, quarantine, the account-key mix); `invariant-reviewer` on the diff against AGENTS.md; `supply-chain-risk-auditor` confirming no new dependency; `docs-keeper` for DESIGN, AGENTS.md and the handoffs. Fix confirmed findings test-first; re-run every gate.
- [ ] **Step 2: Confirm the Cloudflare account** with the owner (name and id); `cf` must be signed in to it. Find the D1 create, migrate, secret and deploy commands with `cf cli search`; show the owner the exact commands.
- [ ] **Step 3: Deploy.** Create the D1 database, apply `0001_init.sql`, set `SETUP_TOKEN` (generated with `openssl rand -base64 32`, kept only in the git-ignored `.dev.vars`), deploy. Smoke test: `GET /v1/prelogin` returns 404 and `POST /v1/records` without a token returns 401.
- [ ] **Step 4: Put the Worker URL in `SyncConfig.BASE_URL` and `sync-url.ts`,** with a node test that the two constants are equal; rebuild.
- [ ] **Step 5: Release 0.2.0 only on the owner's explicit word:** merge with `[skip ci]`, then `pnpm release strongroom` from the right checkout; the owner installs from the Store (never `adb install`).
- [ ] **Step 6: Live checks with the owner:** create the account on the phone and write the account key down; sign in from the extension; an edit each way; a delete each way; change the master password on one device and sign in again on the other; the on-disk check on the phone; Strongroom stays a test autofill service until the owner confirms the server copy and says Google's copies can go (DESIGN §3).
- [ ] **Step 7: Update the handoff** (`docs/handoffs/strongroom.md` and `strongroom-extension.md`): state, URL, what was verified, what is next (re-key, Firefox, iPhone).

---

## Self-review (run 2026-11-05)

- **Spec coverage (DESIGN §10):** Worker with D1, account row with three hashes, `prelogin` with client range check, bearer tokens with constant-time compare, read token limited to `GET`, `since` pull, atomic batch POST with 409, `PUT /v1/account`, one-time setup with a surviving marker, backoff without lockout (Task 2); per-entry merge, tombstones, quarantine, never uploading over an undecryptable record, header adoption rule (Task 3, 5); sync on unlock/change/background with a download-only locked path (Task 6); new-device sign-in (Tasks 3, 6, 7); account key (Tasks 1, 4). **Re-key (new vault key, every record re-sealed) is listed in DESIGN §10 as "Phase 2 adds it" and is not in this plan.** It needs its own decision about the cost (a full re-upload and every other device re-signing in); proposed as Task 9 after the owner has used sync for a while. Flagged here instead of dropped.
- **Names checked across tasks:** `openWithPassword`, `recoveryLoginToken`, `tokenHash`, `withAccountKey`, `SyncStore`/`SyncRecordStore`, `planMerge`/`SyncMerge.plan`, `syncOnce`, `SyncReport`, `adoptHeader`, `signInWithPassword` agree between the TS and Kotlin lists; the protocol table is the single source for field names.
- **Known limits (not fixed here):** last-writer-wins can overwrite an older edit with no history (the password-history field is still a cut); a server can roll back or withhold records (reported, not repaired); a stale device after a password change needs the new password once.
