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
  - `sealed interface LostState { object None; data class Waiting(val releaseAt: Long?); object Ready }` and `fun lostRequest()`: if a claim is stored, ask `lostRelease` first and throw `IllegalStateException("request alive")` when it answers Ready or Waiting with a number; otherwise make `claim = Crypto.randomBytes(20)`, `lostRequest(Crypto.tokenHash(claim))`, **then** store `lostClaim = Base64(claim)`, `lostRequestedAt = clock()` and clear `lostBlob` (a failed network call leaves any stored claim untouched). **Resend the same claim (Task 4 review, supersedes the earlier one-hour cooldown idea):** the claim is minted once and saved BEFORE the network call; later requests resend the stored claim's hash (never mint a new one while one is stored), because the Worker records a claim and mails its link before replying, so a lost reply followed by a retry with a NEW claim would orphan the first email's link and block new claims for ~8 days. There is no client-side cooldown and no `lostRequestedAt` field. After a successful `lostOpen` the phone best-effort cancels the request on the server (otherwise it stays pending forever), and a normal password unlock clears a stored lost claim and blob (`clearLost()`). ostRequestedAt` field. After a successful `lostOpen` the phone best-effort cancels the request on the server (otherwise it stays pending forever), and a normal password unlock clears a stored lost claim and blob (`clearLost()`). 