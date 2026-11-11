# Strongroom Android email recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring opt-in email recovery (escrow of the recovery key and account key under an emailed code, a 24-hour owner-cancellable wait) from the Chrome extension to the Strongroom Android app.

**Architecture:** A Kotlin port of `escrow.ts` plus new wire calls on the existing `SyncTransport`. Enrolling reuses the phone's local-first recovery-key rotation and sends one immediate account PUT carrying the escrow. A new `EmailRecovery` class holds status, confirm, off, cancel, and lost-access request, check and open. The lost-access open step ends in the existing `SyncSession.recover`. Kotlin owns every decision; RN renders and calls thin Expo module functions.

**Tech Stack:** Kotlin (JUnit, Gradle JVM tests), Expo module `strongroom-vault`, TypeScript run by `node --test`, React Native 0.81, Python 3 (vectors only).

**Spec:** `docs/superpowers/specs/2026-11-11-strongroom-mobile-email-recovery-design.md` (read it first; its "Decisions" 1-11 are binding). Reference client: `apps/strongroom-extension/src/service.ts` (`emailRecovery*`, `lostAccess*`, around lines 365-505). Server: `tools/vault-api/src/{index,lost-access}.ts` (no changes allowed).

## Global Constraints

- No Worker, `packages/strongroom-core` or extension changes. Android only.
- Kotlin owns logic; RN only renders. TypeScript is erasable (no enums/namespaces/parameter properties), imports end in `.ts`/`.tsx` as the neighbours do.
- A new `*.test.ts` does nothing until listed in `apps/strongroom/package.json` `test` script.
- Copy: sentence case, active voice, errors say what happened and how to fix it; no emoji, no ALL-CAPS labels, no engineering terms on screens.
- Commits: no Claude attribution or Co-Authored-By line (the owner's standing rule overrides any tool reminder); explicit `git add <paths>`, never `-A` or `.`. Never push, merge, deploy or release. Never `adb install`; a device check goes through the Store only after the owner approves a build.
- Before any Gradle run, `coord claim apps/strongroom`; release it when the task's gates pass. Do not touch the phone without `coord claim device:<serial>`.
- Gradle: `cd apps/strongroom/android && JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew :strongroom-vault:testDebugUnitTest [--tests '<class>']`.
- Work in `.claude/worktrees/strongroom-mobile-email-recovery` (branch `strongroom-mobile-email-recovery`). Update the session log and "Current state" of `docs/handoffs/strongroom-mobile-email-recovery.md` as each task lands.

Kotlin paths below are relative to `apps/strongroom/modules/strongroom-vault/android/src/`: `main/` = `main/java/expo/modules/strongroomvault/`, `test/` = `test/java/expo/modules/strongroomvault/`. The Expo module's TS is `apps/strongroom/modules/strongroom-vault/src/index.ts`.

## Wire facts (verified in the Worker; use as given)

- `PUT /v1/account` body may carry `escrow: { email, blob, code }`: `email` ≤ 320 chars; `blob` standard Base64 of the sealed escrow; `code` the formatted email code (`RecoveryKey.format` text). With `escrow` the body must also carry `recoveryHash` (else 400). The Worker mails the code, then writes; mail failure → **502 before any write**. A changed `recoveryHash` with no `escrow` **deletes the stored escrow**.
- `POST /v1/lost/request` `{claimHash}` (no auth; `claimHash` = `Crypto.tokenHash(claimBytes)`) → `{ok:true}` always.
- `POST /v1/lost/release` `{claim}` (no auth; `claim` = Base64 of 16-64 bytes, we use 20) → `{state:"ready", blob}` or `{state:"waiting", releaseAt: number|null}`.
- `GET /v1/lost/status` (Bearer login|recovery|read) → `{escrow: boolean, pending: {releaseAt: number|null} | null}`.
- `POST /v1/lost/cancel` (Bearer login|recovery|read) → `{ok:true}`. `DELETE /v1/escrow` (Bearer **login** only) → `{ok:true}`.
- Escrow seal: `Crypto.seal(Crypto.hkdf(code, "strongroom/v1/escrow"), recoveryKey(20) || accountKey(20), utf8("strongroom/v1/escrow"))`; open returns null unless 40 plaintext bytes. The code is 20 random bytes in recovery-key text format.

## Review Focus

Failure modes the design implies but no feature task would otherwise test; each has its test in the task named:

1. Email typed with spaces or capitals, or over 320 characters: trimmed and checked before any network call (Task 3 and Task 6).
2. Email code typed lowercase, with spaces or without dashes: accepted as `RecoveryKey.parse` accepts a recovery key (Task 4).
3. Enrol while the vault is locked or sync is off or the account update is still queued: refused with a clear code, nothing changed (Task 3).
4. A reply the Worker mangles (missing field, wrong type, oversized body) on any new call: a `SyncHttpError`, never a crash (Task 2).
5. Enrol cut short between the local header write and the PUT (process death): the next sync sends the header without escrow, and status never shows "waiting for code" for an escrow the server doesn't hold (Task 3).

---

### Task 1: Escrow crypto and vectors

**Files:**
- Create: `main/core/Escrow.kt`, `test/core/EscrowTest.kt`, `apps/strongroom/tools/vectors/escrow_vectors.py`
- Modify: `apps/strongroom/modules/strongroom-vault/android/src/test/resources/vault-vectors.json` (adds an `escrow` section, written by the script)

**Interfaces:**
- Produces: `class EscrowKeys(val recoveryKey: ByteArray, val accountKey: ByteArray)`; `object Escrow { fun seal(code: ByteArray, recoveryKey: ByteArray, accountKey: ByteArray): ByteArray; fun open(code: ByteArray, blob: ByteArray): EscrowKeys? }`. The email code is just `RecoveryKey.generate/format/parse` (no alias).

- [ ] **Step 1: Baseline.** In the worktree run `pnpm install`, then `pnpm --filter strongroom test` and the Gradle `:strongroom-vault:testDebugUnitTest`. Record the pass counts in the handoff log. Expected: all green (if not, stop and report).
- [ ] **Step 2: Write `escrow_vectors.py`** in the style of `account_key_vectors.py` (imports its `hkdf` and `VECTORS`; `cryptography` AES-GCM with a fixed 12-byte nonce; fixed 20-byte code, recovery key and account key; flags `--write` like the sibling). It adds `escrow` to `vault-vectors.json` with hex `code`, `recoveryKey`, `accountKey`, `nonce`, `blob` (nonce || ciphertext || tag), the `label`, and a `note` naming the script. Run it in a throwaway venv (`pip install cryptography`) with `--write`.
- [ ] **Step 3: Write the failing tests** in `EscrowTest.kt` (read the vectors the way `VaultFormatTest` does): `openReadsTheIndependentlyComputedBlob` (keys equal the vector's); `sealThenOpenRoundTrips`; `aWrongCodeOpensNothing` (null); `aBlobSealedAroundTheWrongLengthOpensNothing` (seal 20+19 bytes by hand, expect null); `aTamperedBlobOpensNothing` (flip one byte); `sealUsesAFreshNonceEachTime` (two seals of the same input differ).
- [ ] **Step 4: Run** `--tests '*EscrowTest'`. Expected: FAIL (`Escrow` undefined).
- [ ] **Step 5: Implement `Escrow`** in `Escrow.kt` per the Wire facts (`Crypto.hkdf(ikm, info: String)` and `Crypto.seal/open`); wipe intermediate keys.
- [ ] **Step 6: Run** `--tests '*EscrowTest'`. Expected: PASS.
- [ ] **Step 7: Commit** `git add apps/strongroom/tools/vectors/escrow_vectors.py apps/strongroom/modules/strongroom-vault/android/src/test/resources/vault-vectors.json apps/strongroom/modules/strongroom-vault/android/src/main/java/expo/modules/strongroomvault/core/Escrow.kt apps/strongroom/modules/strongroom-vault/android/src/test/java/expo/modules/strongroomvault/core/EscrowTest.kt` with message `Strongroom: escrow seal and open, with independent vectors`.

### Task 2: Wire types, HTTP transport and the fake Worker

**Files:**
- Modify: `main/core/SyncProtocol.kt`, `main/android/HttpSyncTransport.kt`, `test/core/SyncFakes.kt`, `test/android/HttpSyncTransportTest.kt`, `test/core/SyncProtocolSamplesTest.kt`

**Interfaces:**
- Consumes: `SyncWire` reply checking style (`shaped`, `json`).
- Produces (all in `core`):
  - `data class EscrowBody(val email: String, val blob: String, val code: String)`.
  - `AccountUpdate` gains a last parameter `val escrow: EscrowBody? = null` (existing callers compile unchanged); `SyncWire.toJson(AccountUpdate)` writes `"escrow": {email, blob, code}` only when set.
  - `data class LostStatus(val escrow: Boolean, val pending: Boolean, val releaseAt: Long?)`.
  - `sealed interface LostRelease`: `data class Ready(val blob: String) : LostRelease`, `data class Waiting(val releaseAt: Long?) : LostRelease`.
  - `SyncTransport` gains: `fun lostRequest(claimHash: String)`, `fun lostRelease(claim: String): LostRelease`, `fun lostStatus(token: ByteArray): LostStatus`, `fun lostCancel(token: ByteArray)`, `fun deleteEscrow(token: ByteArray)`.
  - `SyncWire.lostStatus(status, body)`, `SyncWire.lostRelease(status, body)`, `SyncWire.ok(status, body)` (each checked like `account`; a 401 is `SyncAuthError`; `ready` blob must be valid Base64 and ≤ `MAX_CIPHERTEXT_CHARS`).
  - Test fake: `FakeWorker` implements the five calls and the escrow rules from "Wire facts": fields `escrow: FakeEscrow?`(email, blob, code), `mails: MutableList<String>` (codes mailed), `failMail: Boolean` (→ `SyncHttpError(502)` before any write), `lost: FakeLost?`(claimHash, `confirmedReleaseAt: Long?`, cancelled), and helpers `confirmLost(releaseAt: Long)` (the owner clicking the mailed link) and `calls` entries for each new call. Update-with-`recoveryHash`-change-and-no-escrow clears `escrow` (as the Worker). Escrow without `recoveryHash` → `SyncHttpError(400)`.

- [ ] **Step 1: Write the failing tests.** In `SyncProtocolSamplesTest`/a new `SyncWireEscrowTest` (same package): `accountUpdateWithEscrowSerializesTheEscrowObject`, `accountUpdateWithoutEscrowOmitsIt`, `lostStatusParsesPendingAndNull`, `lostReleaseParsesReadyAndWaiting`, and (Review Focus 4) `mangledLostRepliesAreUnreadableNotCrashes` over: missing `state`, `releaseAt` as a string, `blob` not Base64, body not an object, status 500. In `HttpSyncTransportTest`, one test per new call that asserts method, path, Authorization header (none for `lostRequest`/`lostRelease`) and body against the existing TLS harness.
- [ ] **Step 2: Run** the new tests. Expected: FAIL (types undefined).
- [ ] **Step 3: Implement** the types, `SyncWire` functions and `HttpSyncTransport` methods (paths and verbs from "Wire facts"; `deleteEscrow` is `DELETE /v1/escrow`; `lostCancel` is `POST /v1/lost/cancel`, **not** the mailed-link route). Update `FakeWorker` as specified so the whole existing suite still compiles.
- [ ] **Step 4: Run** the full `:strongroom-vault:testDebugUnitTest`. Expected: PASS, with the pre-task count plus the new tests.
- [ ] **Step 5: Commit** the five files with message `Strongroom: escrow and lost-access calls on the sync transport`.

### Task 3: Enrol, confirm, turn off, status

**Files:**
- Create: `main/core/EmailRecovery.kt`, `test/core/EmailRecoveryTest.kt`
- Modify: `main/core/SyncSession.kt`, `test/core/SyncFakes.kt`

**Interfaces:**
- Consumes: Task 1 `Escrow`, Task 2 transport and `FakeWorker`; existing `SyncSession.newRecoveryKey`-style local-first path (`vault.newRecoveryKey` with `prepare`), `dropPending`, `commitHeader`, `secrets`.
- Produces:
  - `data class RecoveryLocal(val escrowBlob: String? = null, val confirmed: Boolean = false, val lostClaim: String? = null, val lostBlob: String? = null)`; `interface RecoverySettings { fun load(): RecoveryLocal; fun save(r: RecoveryLocal) }`; test fake `MemoryRecoverySettings` in `SyncFakes.kt`; `TestPhone` gains `val recoverySettings` and `val recovery = EmailRecovery(session, secrets, recoverySettings, transport) { time }`.
  - `SyncSession`: `fun enrolEscrow(password: CharArray, escrow: (recoveryKey: ByteArray) -> EscrowBody): Enrolment?` and `class Enrolment(val recoveryKey: ByteArray, val sent: Boolean)`. Null for a wrong password. Throws `SyncAuthError` when the mode is NEEDS_SIGN_IN (also if the pre-flush ends there) and `IllegalStateException("sync off")` for any other not-ON mode (the module maps these to SYNC_SIGN_IN / SYNC_OFF), `IllegalStateException("sync first")` when `accountPending` after one flush attempt, and the vault's locked error when locked. Internally: extract `updateAccount`'s body into `private fun sendAccount(t, escrow: EscrowBody?)` that lets `SyncHttpError(409)` propagate; `updateAccount` keeps its 409→`SyncAuthError` mapping by wrapping it. Enrol = flush any pending update (`sync(password)`), then `vault.newRecoveryKey(password) { h, rk -> prepare(h, password, hashOf(recoveryLoginToken(rk))) }`, then `sendAccount(t, escrow(rk))`. **Definite refusal** (`SyncAuthError`, `SyncHttpError` with status 400-499 or 502): restore the original header with `store.putHeader(original)`, `dropPending()`, run `runCatching { sync(password) }` on 409, rethrow; the old recovery key stays valid and no new key is returned. **Unclear failure** (`SyncOfflineError`, other `SyncHttpError`): keep the new header and the pending mark, return `Enrolment(key, sent=false)`.
  - `data class EmailRecoveryStatus(val available: Boolean, val checked: Boolean, val enrolled: Boolean, val waitingForCode: Boolean, val pendingRecovery: PendingRecovery?, val wasTurnedOff: Boolean)`, `data class PendingRecovery(val releaseAt: Long?)`.
  - `class EmailRecovery(sync: SyncSession, secrets: SyncSecrets, settings: RecoverySettings, transport: SyncTransport?, clock: () -> Long)` with `@Synchronized` methods: `fun enrol(email: String, password: CharArray): Enrolment?` (trims; rejects blank, over 320 chars, or no `@` with `IllegalArgumentException("bad email")` before any call; generates the code with `RecoveryKey.generate()`, builds `EscrowBody(email, Base64(Escrow.seal(code, rk, accountKey)), RecoveryKey.format(code))` where `accountKey` comes from `secrets`; before the PUT saves `RecoveryLocal(escrowBlob = blob, confirmed = false)`; clears that blob again on a definite refusal); `fun confirm(codeText: String): Boolean` (needs a stored blob, `IllegalStateException("not waiting")` otherwise; false for a bad or wrong code; on success `confirmed = true` and `escrowBlob = null`); `fun turnOff()` (needs the **login** token; `deleteEscrow`; clears local state); `fun status(): EmailRecoveryStatus`.
  - `status()` rules: `available` = transport present; makes the Worker call only when sync mode is ON (no call for OFF, PENDING_SETUP or NEEDS_SIGN_IN), using the read token; any `SyncOfflineError`/`SyncHttpError`/`SyncAuthError` → `checked = false`, nothing else changed and no change to sync mode; `enrolled` = server `escrow` and not `waitingForCode`; `waitingForCode` = local blob present, unconfirmed, **and** the server holds an escrow; if the server answers `escrow=false` for an unconfirmed local blob, delete that blob (the PUT never landed); `wasTurnedOff` = locally confirmed but the server has none.

- [ ] **Step 1: Write the failing tests** (`EmailRecoveryTest`, fast KDF and `FakeWorker` as `SyncSessionTest` does; helper `syncedPhone()` copied in style): `enrolRotatesTheKeyMailsTheCodeAndSealsTheEscrow` (server `escrow` set, one mail, the blob opens with the mailed code to `{newRecoveryKey, accountKey}`, new recovery key unlocks `vault.recover`, old one no longer does, server `recoveryHash` matches the new key); `confirmWithTheMailedCodeTurnsItOnAndDropsTheLocalBlob`; `confirmWithAWrongCodeKeepsWaiting`; `confirmAcceptsLowercaseSpacedCodeWithoutDashes` (Review Focus 2); `enrolWithAWrongPasswordChangesNothing` (null, header equal, no calls); `enrolRefusesBadEmailBeforeAnyCall` (Review Focus 1: blank, 321 chars, `no-at-sign`, and `"  A@B.co "` is accepted trimmed); `enrolRefusedWhenSyncIsOffLockedOrAnUpdateIsStillQueued` (Review Focus 3, three assertions each leaving the header unchanged); `a409RestoresTheOldKeyAndTellsTheOwnerToSyncAndRetry` (make `w.headerRev` advance after the pre-flush; header back to original, no pending mark, old recovery key still works, server escrow untouched); `aMailFailureRestoresTheOldKey` (`failMail`, 502); `aLostReplyKeepsTheNewKeyAndTheNextSyncFinishesIt` (offline during the PUT: result `sent=false`, local header rotated, then back online one `session.sync()` sends the same `recoveryHash` and the escrow is **not** cleared if the first PUT had landed, or stays absent if it hadn't, both variants); `enrolCutShortBeforeThePutLeavesNoWaitingForCodeWithoutAnEscrow` (Review Focus 5: write the local blob, never PUT, `status()` clears it); `aSecondEnrolReplacesTheEscrowAndEmail`; `turnOffDeletesTheEscrowAndClearsLocalState`; `statusWhenOfflineIsUncheckedNotAnError`; `statusMakesNoCallWhenSignInIsNeeded`; `newRecoveryKeyWithoutEscrowTurnsItOffOnTheServer` (the existing flow; status then `enrolled=false, wasTurnedOff=true`).
- [ ] **Step 2: Run** `--tests '*EmailRecoveryTest'`. Expected: FAIL.
- [ ] **Step 3: Implement** the `SyncSession` change and `EmailRecovery` per the Interfaces. Zero every `ByteArray` secret after use (the file's existing habit).
- [ ] **Step 4: Run** `--tests '*EmailRecoveryTest'` then the full `:strongroom-vault:testDebugUnitTest`. Expected: PASS, the existing `SyncSessionTest` unchanged and green.
- [ ] **Step 5: Commit** `git add` the six files with message `Strongroom: turn email recovery on and off, with a local-first key rotation`.

### Task 4: Lost access (request, check, open) and cancel

**Files:**
- Modify: `main/core/EmailRecovery.kt`, `test/core/EmailRecoveryTest.kt`

**Interfaces:**
- Consumes: Task 3 `EmailRecovery`, `RecoverySettings`; `SyncSession.recover(recoveryKey: ByteArray, newPassword: CharArray, accountKey: ByteArray?)`.
- Produces on `EmailRecovery` (all `@Synchronized`):
  - `sealed interface LostState { object None; data class Waiting(val releaseAt: Long?); object Ready }` and `fun lostRequest()`: if a claim is stored, ask `lostRelease` first and throw `IllegalStateException("request alive")` when it answers Ready or Waiting with a number; otherwise make `claim = Crypto.randomBytes(20)`, `lostRequest(Crypto.tokenHash(claim))`, **then** store `lostClaim = Base64(claim)`, `lostRequestedAt = clock()` and clear `lostBlob` (a failed network call leaves any stored claim untouched). **Resend the same claim (Task 4 review, supersedes the earlier one-hour cooldown idea):** the claim is minted once and saved BEFORE the network call; later requests resend the stored claim's hash (never mint a new one while one is stored), because the Worker records a claim and mails its link before replying, so a lost reply followed by a retry with a NEW claim would orphan the first email's link and block new claims for ~8 days. There is no client-side cooldown and no `lostRequestedAt` field. After a successful `lostOpen` the phone best-effort cancels the request on the server (otherwise it stays pending forever), and a normal password unlock clears a stored lost claim and blob (`clearLost()`). Needs only the transport (works with sync off or no account).
  - `fun lostCheck(): LostState`: no claim → None; `Waiting` passes through; `Ready` stores `lostBlob`.
  - `fun lostOpen(codeText: String, newPassword: CharArray): Boolean`: `IllegalStateException("not ready")` without a stored blob; false for a bad or wrong code; if the Keystore holds an account key different from the opened one, `IllegalStateException("different account")` without any change; otherwise `sync.recover(opened.recoveryKey, newPassword, opened.accountKey)`, then clear `lostClaim` and `lostBlob`.
  - `fun cancelLost()`: needs a read, login or recovery token; `lostCancel`.

- [ ] **Step 1: Write the failing tests:** `requestStoresAClaimAndTheServerSeesItsHash`; `aSecondRequestIsRefusedWhileOneIsAliveWhateverTheScreenSays` (confirmed refused; unconfirmed under one hour old refused; unconfirmed one hour or older replaced and the fake's `lost.claimHash` becomes the new claim's hash, so the phone and server agree); `aFailedRequestKeepsTheOldClaim` (offline); `requestWorksWithSyncOff` (a fresh `TestPhone` with no account); `checkIsWaitingUntilReleaseThenReadyAndStoresTheBlob` (advance the fake clock past `releaseAt`); `openWithTheMailedCodeRecoversTheVaultAndClearsClaimAndBlob` (fresh phone and signed-in-elsewhere variants; vault unlocks with the new password; entries present; server recovery hash unchanged; escrow still on); `openWithAWrongCodeChangesNothing`; `openRefusesADifferentAccountKey`; `cancelStopsTheWaitAndCheckThenSaysNone`-style assertion via fake `lost.cancelled`; `doubleOpenIsSerialized` (second call after success throws `not ready`).
- [ ] **Step 2: Run** `--tests '*EmailRecoveryTest'`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** as above; claim and blob wiped from memory after use.
- [ ] **Step 4: Run** the full Gradle test task. Expected: PASS.
- [ ] **Step 5: Commit** both files with message `Strongroom: lost-access request, wait and open`.

### Task 5: Expo module functions, TS contract and wiring

**Files:**
- Modify: `main/android/VaultHolder.kt` (add `PrefsRecoverySettings` next to `PrefsSyncSettings`, keys `escrowBlob`, `escrowConfirmed`, `keyUnseen`, `lostClaim`, `lostBlob`, (**`keyUnseen` must be persisted, or the lost-key warning silently does nothing on a device**; add a test that a save/load round trip through a fake `SharedPreferences` keeps every field), `commit()` like its neighbour; add `VaultHolder.recovery(context): EmailRecovery` built the way `sync(context)` is), `main/StrongroomVaultModule.kt`, `apps/strongroom/modules/strongroom-vault/src/index.ts`, `test/ModuleErrorsTest.kt`

**Interfaces:**
- Produces (module functions, all `AsyncFunction ... Coroutine` on `Dispatchers.IO` inside `syncCall`, secrets wiped in `finally` like `enableSync`; ones that need the unlocked vault call `vault()`, the lost-access ones do not need an unlocked vault):
  - `emailRecoveryStatus(): EmailRecoveryStatus` (never `vault()`; never throws for offline).
  - `enableEmailRecovery(email: string, password: string): Promise<{ recoveryKey: string; sent: boolean } | null>` (null = wrong password; bad email → `CodedException("BAD_EMAIL", "That email address isn't valid. Check it and try again.")`; `sync off`/`sync first` → `SYNC_OFF` / `SYNC_FIRST` with owner-ready messages; after a result call `VaultHolder.syncSoon(context, 0)` as `newRecoveryKey` does).
  - `confirmEmailRecovery(code: string): Promise<boolean>`; `turnOffEmailRecovery(): Promise<void>`; `cancelLostRequest(): Promise<void>`.
  - `lostAccessRequest(): Promise<void>` (`request alive` → `LOST_STILL_ALIVE`); `lostAccessCheck(): Promise<LostAccessState>`; `lostAccessOpen(code: string, newPassword: string): Promise<boolean>` (true on success after `SyncJobService.schedule(context)` and `VaultHolder.afterUnlock(context, byPassword = true)` exactly as `recoverSync`; `not ready` → `LOST_NOT_READY`; `different account` → `LOST_DIFFERENT_ACCOUNT`).
- TS types exported from `index.ts`: `EmailRecoveryStatus { available; checked; enrolled; waitingForCode; pendingRecovery: { releaseAt: number | null } | null; wasTurnedOff; keyUnseen: boolean }` (**`keyUnseen` is added in Task 5**: Task 3's review fix round adds it to the Kotlin status; Task 6 shipped the type without it, so Task 5 adds it to `index.ts` AND teaches `recovery-flow.ts` `emailRecoveryView` a danger row "Your recovery key changed but you haven't saved it" with a new action `'newKey'` that is offered whenever `keyUnseen` is true, even when `checked` is false, with its test in `recovery.test.ts`; Task 5 therefore also owns `src/recovery-flow.ts` and `src/__tests__/recovery.test.ts` for that one change). Also add `markRecoveryKeyShown(): Promise<void>` (calls `EmailRecovery.keyShown()`); the enrol screen (Task 7) calls it after the owner confirms the key, and the Settings row's `'newKey'` action opens the existing New recovery key flow, which ends by calling it too. `emailRecoveryStatus` and `enableEmailRecovery` must run on `Dispatchers.IO` (status holds a lock across a network call), and `enableEmailRecovery` must call `markRecoveryKeyShown` only when the screen says so, never itself, `LostAccessState = { state: 'none' } | { state: 'waiting'; releaseAt: number | null } | { state: 'ready' }`, and the seven functions on `StrongroomVaultApi` with one-line comments for null/false meanings. Add the new codes to the comment listing codes.

- [ ] **Step 1: Write the failing test** in `ModuleErrorsTest` for each new code→message mapping (follow its existing structure). Expected: FAIL.
- [ ] **Step 2: Implement** the functions, the prefs class and the TS contract.
- [ ] **Step 3: Run** the full Gradle test task, `:app:assembleDebug`, and `pnpm --filter strongroom typecheck`. Expected: PASS and a built debug APK (do not install it).
- [ ] **Step 4: Commit** the four files with message `Strongroom: email recovery in the vault module`.

### Task 6: RN copy and logic (pure, tested)

**Files:**
- Create: `apps/strongroom/src/recovery-flow.ts`, `apps/strongroom/src/__tests__/recovery.test.ts`
- Modify: `apps/strongroom/package.json` (add `src/__tests__/recovery.test.ts` to the `test` script)

**Interfaces:**
- Consumes: Task 5 TS types; style of `sync-flow.ts`.
- Produces (pure functions and constants; wording is yours within the Global Constraints, shape is fixed):
  - `export const EMAIL_DISCLOSURE: string[]` (three plain sentences: whoever controls that inbox can start a recovery; the wait is 24 hours and you can cancel; recovery replaces your master password but keeps the recovery key) and `export const NEW_KEY_ESCROW_WARNING: string` (this turns email recovery off; turn it on again in Settings).
  - `emailProblem(email: string): string | null`; `emailRecoveryView(s: EmailRecoveryStatus): { title: string; subtitle: string; tone: SyncTone; actions: ('turnOn' | 'enterCode' | 'turnOff' | 'cancel')[] }` (rows for: unavailable, unchecked, off, waiting for code, on, turned off on the server, pending request).
  - `pendingBanner(s: EmailRecoveryStatus | null, now: number): { title: string; body: string } | null` (non-null only for a numeric `releaseAt`, per design decision 10) and `lostAccessView(s: LostAccessState, now: number): { title: string; body: string; actions: ('request' | 'enterCode')[] }` (waiting with `releaseAt=null` reads as "open the link we emailed you"; with a number reads "ready at ..."; ready offers the code field).
  - `explainRecovery(e: unknown): string` mapping the codes from Task 5 (and falling back to `messageOf`).
- [ ] **Step 1: Write the failing tests** in `recovery.test.ts`: `emailProblem` accepts `" A@B.co "`, rejects blank, 321 characters and no `@`; `pendingBanner` is null for `releaseAt: null`, null for no pending, set for a number; `lostAccessView` distinguishes null and numeric `releaseAt`; `emailRecoveryView` offers `turnOn` only when `available && checked && !enrolled && !waitingForCode`, `enterCode` when waiting, `turnOff` when enrolled, nothing when `!checked` except a "couldn't check" subtitle; `explainRecovery` maps each new code; copy rule test: no string in the exported copy contains an emoji or a word in ALL CAPS of length > 3.
- [ ] **Step 2: Run** `pnpm --filter strongroom test`. Expected: FAIL.
- [ ] **Step 3: Implement** `recovery-flow.ts` and add the test file to the package script.
- [ ] **Step 4: Run** `pnpm --filter strongroom test` and `pnpm --filter strongroom typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** the three files with message `Strongroom: email recovery copy and logic`.

### Task 7: Screens and wiring

**Files:**
- Create: `apps/strongroom/src/EmailRecoveryScreen.tsx`, `apps/strongroom/src/LostAccessScreen.tsx`
- Modify: `apps/strongroom/src/SettingsScreen.tsx` (add `'emailRecovery'` to `SettingsFlow`; a Row in the "Master password and recovery key" group whose subtitle comes from `emailRecoveryView`), `apps/strongroom/App.tsx` (route `{ name: 'emailRecovery' }`, `FLOW_ROUTES`, render branch like `sync`'s; the back handler must not leave while the new recovery key is on screen, as for `newKey`), `apps/strongroom/src/VaultScreen.tsx` (a `Notice tone="warn"` with a Cancel button above `SyncFooter` from `pendingBanner`, refreshed on mount and on each `addSyncListener` event; a failed or unchecked status shows nothing), `apps/strongroom/src/SettingsFlows.tsx` (`NewRecoveryKeyScreen` shows `NEW_KEY_ESCROW_WARNING` before the password prompt when status says `enrolled`), `apps/strongroom/src/UnlockScreen.tsx` (in `Recover`, a ghost Button "I also lost my recovery key" that opens `LostAccessScreen`; back returns to `Recover`)

**Interfaces:**
- `EmailRecoveryScreen({ onBack, onDone, onLocked }: Flow)`: state machine over `emailRecoveryView`: disclosure then email + master password (`AskPassword`-style) → shows the new recovery key with `RecoveryKeyCard` and the existing "I've saved it" gate (`sent=false` adds a notice that the key changed but email recovery isn't confirmed yet and finishes when the phone is back online) → code entry (`confirmEmailRecovery`) → done notice; Turn off (master password not needed) and Cancel request buttons per `actions`. Every failure shows `explainRecovery`.
- `LostAccessScreen({ onBack, onUnlocked })`: `lostAccessCheck()` on open and on a Check again button; `lostAccessView` drives the body; Start request button disabled while busy (a double tap cannot send two requests; the native side refuses anyway); code + new master password (`NewPasswordFields`, `validateMasterPassword`) calls `lostAccessOpen`, then `onUnlocked()`.
- Screens contain no business rules (Kotlin owns them).

- [ ] **Step 1: Implement** the two screens and the five edits above following the neighbouring screens' patterns (`SyncScreen.tsx`, `SettingsFlows.tsx`) and `@apps-hub/ui` components only (no hand-rolled colours).
- [ ] **Step 2: Run** `pnpm --filter strongroom typecheck` and `pnpm --filter strongroom test`. Expected: PASS. There are no RN component tests in this app; the typecheck is the gate.
- [ ] **Step 3: Run** `pnpm test` at the worktree root. Expected: exit 0.
- [ ] **Step 4: Commit** with message `Strongroom: email recovery screens` using explicit paths for every file listed above.

### Task 8: Docs and final gates

**Files:**
- Modify: `docs/strongroom/DESIGN.md`, `docs/handoffs/strongroom-mobile-email-recovery.md`

- [ ] **Step 1: Docs.** Add a dated 2026-11-11 entry to DESIGN.md: §9 (Settings gains Email recovery; Unlock's reset screen gains "I also lost my recovery key"), §10 (the phone's enrol is local-first then one PUT; the New recovery key flow turns escrow off; the pending warning shows only once confirmed; no system notification), and a pointer from the §11 "Security hardening" paragraph saying the phone has the same feature. State the owner's two decisions and that the Worker is unchanged.
- [ ] **Step 2: Gates**, with real output pasted into the handoff log: `pnpm test`, `pnpm typecheck`, and `cd apps/strongroom/android && ./gradlew :strongroom-vault:testDebugUnitTest :app:assembleDebug` (with `JAVA_HOME`).
- [ ] **Step 3: Commit** with message `Strongroom: document email recovery on the phone`.
- [ ] **Step 4: Stop.** Do not push, open a PR, install on the phone or deploy the Worker. Hand back to the owner: what is built, the gate output, and the owner-gated follow-ups (deploy the Worker with a real `PUBLIC_URL` and confirmed `MAIL_FROM`; a Store build and a real-mail device test; push and PR). Release the coord claims.
