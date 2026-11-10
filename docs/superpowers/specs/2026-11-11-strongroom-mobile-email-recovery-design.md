# Strongroom Android: opt-in email recovery

Status: draft for owner approval, 2026-11-11. Progress and resume prompt: `docs/handoffs/strongroom-mobile-email-recovery.md`.

## Intent and why

The owner can lose the master password and the recovery key together. Today that means the vault is gone, even with sync on. The Chrome extension already has an opt-in answer (DESIGN.md §10 "Account key", the "Security hardening" part of §11): the owner escrows a sealed copy of the recovery key and account key with the vault server, under a code mailed to their own address, and a lockout recovery waits 24 hours, during which the owner can cancel. The phone is the main device and has none of it. This work adds the same capability to the Android app.

The Worker (`tools/vault-api`) is client-agnostic and already serves every route needed. **No server changes.**

## Goals

- From Settings, with sync on, the owner can turn on email recovery, see its state, and turn it off.
- A locked-out owner can start a request from the Unlock screen, wait out the 24 hours, then regain the vault with the emailed code and a new master password.
- The owner sees a pending request in the app and can cancel it.
- The sealed-blob and email-code formats match `packages/strongroom-core/src/escrow.ts` byte for byte, proved by vectors generated independently of both clients.

## Non-goals

- Any Worker, `strongroom-core` or extension change.
- Changing the email-code strength, the 24-hour wait, the cooldowns or the 7-day release grace (server-owned).
- A system notification for a pending request (owner decision, below).
- Deploying the Worker. It is not yet deployed to a real `PUBLIC_URL` with confirmed `MAIL_FROM`. Unit tests and the Gradle gate need no deploy; a real mail test does. Ask the owner before deploying.
- iOS (Strongroom is Android-only).

## Anti-goals (a failure even if it "works")

- The vault, the recovery key or the account key readable by the Worker, except the one already-accepted exception: enrolling sends the Worker the code and the sealed blob in one request (DESIGN.md anti-goals, ruling of 2026-11-10; same exception applies here).
- A recovery request that a stray tap, a double tap or a stale screen can discard while the server still counts it down.
- A half-written recovery-key rotation: the server escrow holds one recovery key while the phone's vault holds another.
- Unlock, the vault screen or Settings blocking or failing because the Worker is slow or offline.
- Local storage plus the emailed code being enough to open the vault without the server's 24-hour wait.

## Constraints

- Kotlin owns the logic. RN only renders and calls the native module. Android-only, private Store only.
- Repo hard rules: no Claude attribution in commits or PRs, explicit `git add` pathspecs, never push, merge or release without the owner's go-ahead in that conversation, coord-claim the app folder and `device:<serial>` before a build-install-test loop, never `adb install` (go through the Store).
- Work happens in `.claude/worktrees/strongroom-mobile-email-recovery`, branch `strongroom-mobile-email-recovery`, based on `origin/main` (not local `main`, which lacks PR #29).
- Copy: sentence case, active voice, errors say what happened and how to fix it. Adapt to the phone's existing Settings and Sync screens. Do not paste the extension's popup text.

## Decisions

Decided by the owner (2026-11-11):

- **Pending requests are shown in the app only.** A warning with a Cancel button on the vault screen, checked at unlock and on each sync. No Android notification. The Worker already emails the owner a cancel link.
- **The "lost both" entry point is the Unlock screen**, under "Forgot master password" ("I also lost my recovery key"). The last step reuses the existing server recovery, `SyncSession.recover(recoveryKey, newPassword, accountKey)`, with the keys taken from the opened escrow blob.

My calls (owner may overrule), each from verified code:

1. **Escrow crypto in Kotlin**: a new `core/Escrow.kt`, the Kotlin port of `escrow.ts`: seal `recoveryKey(20) || accountKey(20)` under `HKDF(code, "strongroom/v1/escrow")` with that label as AAD, using the existing `Crypto.hkdf` and AES-GCM seal; open returns null unless the plaintext is 40 bytes. The email code is a 20-byte value in the recovery-key text format; reuse `RecoveryKey`'s generator, formatter and parser. A new `tools/vectors/escrow_vectors.py` (plain Python crypto, run like `account_key_vectors.py`) writes an `escrow` section to `vault-vectors.json`. Kotlin tests read it. The TS `escrow.test.ts` should also check the same vectors if it can without touching `strongroom-core` source; if that needs a source change, skip it and say so.
2. **Gated on sync.** Enabling email recovery requires sync mode ON. Turning it off, cancelling and the status check need a sign-in token (read token suffices for status and cancel; the login token for turning off).
3. **Enrolling writes the rotated header locally first (through the existing `prepare` / `pendingHeader` bookkeeping, as `newRecoveryKey` does), then sends the PUT at once with the `escrow` field.** The Worker mails the code and writes the escrow before it replies, so a lost reply can leave the server on the new recovery key. Local-first means the phone is always at or ahead of the server: if the reply is lost, the pending mark stays and the next sync's `updateAccount` resends the same header and `recoveryHash` (which keeps the escrow, since the hash then matches). The worst outcome is "recovery key rotated, email recovery not on yet", never a server escrow around a key the phone doesn't hold. Steps: (a) preconditions: sync mode ON, no `accountPending` (if one is queued, run `sync(password)` first and refuse with "Sync first, then try again" if that fails, so `ifRev` is current); (b) re-check the master password; (c) rotate the recovery key, seal the escrow, call `prepare`, write the header; (d) PUT with `ifRev`. **Show the new recovery key as soon as step (c) is done, whatever step (d) returns**, as the existing New recovery key flow does, because the old paper key stops working the moment the server commits. A definite refusal (409, 400, 403, 502 mail failure) restores the original header and drops the pending mark, as `enable`'s `undo` does; an unclear failure (offline, timeout, 5xx) keeps the local header and pending mark and tells the owner "recovery key changed; email recovery isn't confirmed yet, it finishes when the phone is back online". The extension's two hardest review rounds were exactly here (a non-atomic escrow/account write; a 409 that never let a retry succeed), so tests must cover clean success, 409, 502, and a lost reply followed by the next sync.
4. **Server truth before acting.** Starting a lost-access request first asks the server about any stored claim and refuses while one is alive or ready, whatever the screen shows. Every operation is `@Synchronized` in the session so a double tap cannot race. (The extension needed three fix rounds to learn this.)
5. **Never block on the Worker.** Status checks use short timeouts and failures show "couldn't check", not an error screen. A phone whose sync needs sign-in does not call the Worker with the refused token (as `doSync` already does).
6. **Where the lost-access claim and the sealed blob live**: ordinary app preferences beside `SyncState`. The claim only buys the sealed blob after the wait, and the blob is useless without the emailed code. The enrol-time blob is kept only until the owner types the code to confirm, then deleted, so local storage plus the code is never enough. A "waiting for code" state must be escapable: the owner can turn email recovery off.
7. **Lost access works with sync off or no account on this phone**, since request and release take no bearer token. It needs only the built-in server URL. It covers a fresh phone and a phone whose sync is NEEDS_SIGN_IN. The entry is the Unlock screen; the plan decides whether the Sync sign-in screen (the other place `recoverSync` is reachable) also gets it.
8. **Disclosure the owner must read before enabling** (carried from the extension): whoever controls that inbox can start a recovery; the wait is 24 hours; recovery replaces the recovery key. Plain words, no engineering terms.
9. **Recovery-key lifecycle around escrow.**
   - "On" is whatever the server's `escrow` flag says (status call), combined with the local waiting-for-code flag, never local state alone.
   - The existing **New recovery key** flow sends a new `recoveryHash` with no escrow, and the Worker then deletes the escrow (verified in `index.ts`). So that screen must say, before the owner confirms, that this turns email recovery off and they can turn it on again in Settings. No automatic re-enrol (it would need the email again and another mailed code).
   - After a **successful lost-access open**, mirror the extension: clear the local claim and blob, leave email recovery on. `SyncSession.recover` sends no `recoveryHash`, so the recovery key and escrow stay valid; only the master password changes. Nothing is rotated.
10. **Which pending requests warn.** The vault-screen warning with Cancel appears only once the request is **confirmed** (`releaseAt` is a number). An unconfirmed request (`releaseAt` null) can be created by anyone, but it can't progress without the owner's inbox, so it gets no warning on the vault screen. On the Unlock lost-access screen, the two states read differently: "Open the link we emailed you to start the 24-hour wait" (claim stored, `releaseAt` null) versus "Ready at <time>" (number).
11. **Docs**: add a dated entry to DESIGN.md (§9 screens and §10 phone sync paragraphs, plus the "Security hardening" part of §11 cross-reference) saying the phone has email recovery, the entry points, and the two decisions above.

## Left to the builder

- Exact Expo-module function names and TS types (follow `enableSync`/`syncNow` style: native function, TS contract in `modules/strongroom-vault/src/index.ts`, thin RN call).
- Screen layout and wording inside the conventions above; the Settings entry's place relative to Sync.
- Transport additions (`lostRequest`, `lostRelease`, `lostStatus`, `lostCancel`, `deleteEscrow`, and the `escrow` field on `AccountUpdate`) and their reply checking in `SyncWire`, in the file's existing style.
- Test breakdown. Required coverage: vectors for seal/open and code format; enrol success, 409 and offline; confirm with a wrong and a right code; off; request refused while a claim is alive; release waiting vs ready; open success clears claim and blob; status never throwing into unlock.
- Verification gates: `pnpm test`, `pnpm typecheck`, and `cd apps/strongroom/android && ./gradlew :strongroom-vault:testDebugUnitTest :app:assembleDebug`. A device check goes through the Store, after the owner approves a build.
