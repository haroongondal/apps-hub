# Strongroom for Chrome: lock-free autofill, fingerprint, export, email recovery

Date: 2026-11-08. Status: draft for the owner's approval. Scope: `apps/strongroom-extension`, `packages/strongroom-core`, `tools/vault-api`. Not the Android app.

## Why

The owner uses the extension daily and the 5-minute auto-lock plus master-password unlock gets in the way of autofill. They also hit a broken Import screen, want to move passwords back to Chrome, and want a way back in if they lose the account. Six requests, in the owner's words:

1. A fingerprint option on Mac and other OSes, behind a toggle.
2. Import UI is broken.
3. Export passwords for Chrome.
4. No lock to autofill; fingerprint only if the toggle is on and the computer can do it.
5. Passwords encrypted on the device.
6. Email integration to get back into a lost account.

## Goals

- Autofill works with no unlock, including after a browser restart (decided by the owner).
- With the fingerprint toggle on, every autofill asks for a fingerprint (decided by the owner).
- Import works. Export writes a CSV Chrome's own importer accepts.
- The vault and the account key are encrypted at rest. The key kept for lock-free autofill is itself wrapped.
- An opt-in email route back into the vault and the sync account.

## Non-goals

- Android changes (including a "recovery requested" banner on the phone).
- Firefox, Safari, other browsers.
- Changing the vault format, KDF defaults, or sync protocol beyond what email recovery needs.
- Deploying the Worker or publishing the extension. Both need the owner's word.

## Anti-goals (a failure even if it works)

- A key or password readable by the server or a third party. The email code and recovery key must never be stored together on the server.
- Filling on a lookalike site, or any new way for a web page to trigger a fill without the user's click. The trust boundary in `background.ts` stays.
- Losing or corrupting the vault while changing how the key is stored. Existing vaults must open after upgrade.
- Presenting the lock-free mode as stronger than it is. The UI says plainly: anyone who can use this browser profile can use the vault.

## Decisions by the owner

- Lock-free autofill keeps the vault key on this computer (not "once per browser session").
- Fingerprint on means a fingerprint before every autofill (not once per session).
- Email recovery covers both "get back into sync sign-in" and "get back into the vault" (see "Email recovery" for how they became one flow).
- Item 5 means: also encrypt the account key (it sits unencrypted in `chrome.storage.local` today). The vault itself is already AES-GCM encrypted.

## Calls made by me (check these)

- **The popup still locks.** Only autofill skips the unlock. Viewing, editing, Show, Copy, Export and Settings behave as today: unlock with the master password, or with a fingerprint when it is on; 5-minute auto-lock for that popup session. Reason: without it, anyone at an unlocked keyboard reads every password with one click. If the owner wants the popup open too, that is a smaller change.
- **Manual Lock deletes the stored vault key and login token** (the "key blob"), so "Lock" still means locked; the next master-password unlock stores them again. Browser restart does not delete them. Lock never deletes the account key (next item).
- **The account key has its own store and is never fingerprint-sealed.** It is sealed under the non-extractable device wrapper only, in its own `chrome.storage.local` entry, so a master-password unlock always works when the fingerprint is unavailable. It is useless without the master password, and item 5 is met. Migration: the first start after upgrade seals the existing plain `accountKey` into the new entry and only then removes the plain one; if sealing fails the plain one stays.
- **With the fingerprint on and PRF, background sync pauses** while the key blob cannot be opened without a touch. Sync resumes at the next fingerprint or popup unlock and the sync card says "Sync paused. Unlock to continue." Without PRF (gate only) the login token stays in the plain blob and sync keeps running.
- **If the fingerprint spike fails or PRF is missing:** no PRF means "gate only" (above). If WebAuthn does not work from an extension window at all, drop item 2 and tell the owner; items 1, 3, 4, 5 and 6 do not depend on it, so the spike runs first and the rest proceeds either way.
- **A changed recovery key deletes the email escrow.** The Worker deletes the escrow whenever `PUT /v1/account` changes `recoveryHash`, unless the same request carries a new escrow. The extension's own rotation sends a new escrow in the same call. A change from the phone therefore turns email recovery off, and the extension shows "Recovery by email is off. Turn it on again." the next time it syncs the header.
- **Enrolment is confirmed by the code:** the owner types the emailed code before enrolment completes, so a code that never arrived is caught. There is no resend; if the owner loses the email, they turn email recovery off and on again (which sends a new code and a new recovery key).
- **One email flow, not two.** A "reset sync sign-in" that does not return keys has nothing to give a new device, because sign-in needs the account key and the recovery key. See below.
- The device key is wrapped with a non-extractable WebCrypto key held in the extension's IndexedDB. That stops a copy of `chrome.storage.local` alone from opening the vault; it does not stop someone with the whole profile.
- Export is the five Google columns only (`name,url,username,password,note`), one row per site, so Chrome's importer takes it. Cards and notes are left out and the screen says so.

## Design

### 1. Device key (lock-free autofill)

On setup, unlock, sign-in or recovery, store the key blob `{vaultKey, loginToken?}` in `chrome.storage.local`, AES-GCM sealed under a non-extractable key from IndexedDB. The account key is a separate sealed entry (see "Calls made by me"). The service worker uses it for `candidates` and `fill` (the only requests a page may make), so a fill needs no popup session. The popup unlock path is unchanged. The auto-lock alarm now clears only the popup session. The sync alarm keeps working with the stored login token, so lock-free also means background sync keeps running (except with fingerprint and PRF, see "Calls made by me"). Existing installs: first unlock after upgrade writes the blob; until then fills ask to unlock as today.

### 2. Fingerprint

Toggle in Settings, shown only when `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` is true; otherwise the row is disabled with the reason. Uses WebAuthn with `userVerification: "required"` and platform attachment (Touch ID on Mac, Windows Hello on Windows, the Chrome fingerprint on other systems).

- Turning it on needs the popup unlocked. It enrolls a credential and tries the `prf` extension. With PRF, the key blob is re-sealed under a key from the fingerprint and the plain one is deleted: then the vault key on disk opens only with a fingerprint. Without PRF, the fingerprint is a gate in front of the fill and the device key stays; the UI says "gate only".
- Each autofill (in-page menu click or popup Fill) opens a small extension window that runs `credentials.get`; success lets the worker fill. A service worker has no WebAuthn, and a content script would use the page's origin, so it has to be an extension page.
- Popup unlock also accepts the fingerprint; the master password remains the fallback.
- Credential gone or enrolled on another profile: fall back to the master password and offer to enrol again. The existing `keyLost` state covers a vault whose account key can no longer be opened.
- Turning it off needs a fingerprint or the master password.

**First, a throwaway spike:** does WebAuthn (and PRF) work from a Chrome extension window on this Mac with Touch ID? Chromium for Testing cannot show Touch ID, so the owner confirms on their Chrome. If the spike fails the design for this item changes, so the spike comes before the rest of item 2.

### 3. Import

The popup closes when Chrome opens the file picker, so the import never completes. Open the Import screen in a full tab (`popup.html#import`), with the same service and the same unlock gate. The e2e already loads the popup as a tab; add a check that Import is opened from the popup button into a tab.

### 4. Export for Chrome

`formatCsv` in `packages/strongroom-core` (TypeScript port of the five-column part of Android's `CsvExport.kt`, same quoting as `parseCsv`'s inverse, tested against the shared vectors). An Export button in the popup, behind the master password (or fingerprint), with the warning that the file is plain text. Check with a real Chrome: import the file at `chrome://password-manager`.

### 5. Account key encrypted

Covered by the separate sealed account-key entry (see "Calls made by me"). It is not fingerprint-sealed.

### 6. Email recovery

Opt-in, off by default, in Settings, needs sync signed in and the popup unlocked.

**Enrol:** the recovery key is not kept after setup (only its wrap is), so enrolling rotates it: generate a new recovery key, write the new `recoveryWrap` into the header and the new `recoveryHash` (login-role `PUT /v1/account`, existing endpoint), show the new key with the existing "I've saved it" step (the old paper key stops working; the UI says so). Then a random 128-bit email code encrypts `{recoveryKey, accountKey}` into a blob; the blob and the destination email go to the Worker. The Worker emails the code once and does not store it.

**Recover (new device, nothing saved):** "Lost access" screen → request → the Worker emails a link → clicking it starts a 24-hour wait and emails again → on a signed-in device the extension shows a "someone asked to recover this vault" banner with Cancel (also an email link) → after 24 hours the Worker releases the blob → the user pastes the code from their inbox → the client opens the blob and runs the existing `signInRecovery` flow (recovery key + new password + account key). Rate-limit requests; always answer the same whether or not the address matches.

**Worker:** migration `0002`: escrow blob, email, pending request (token hash, release time, cancelled). New email-send binding. Mail goes through a small port so tests use a fake. Cloudflare only delivers to verified destination addresses, which suits one owner.

**Honest limit:** anyone who controls the inbox can request and confirm, then read the code; the 24-hour wait and the banner are the only protection, and they work only if the owner looks. A leak of the server's database alone gets only a blob that is useless without the code.

## Open: the email sender (the owner's to answer)

Which Cloudflare mail feature sends the mail, from which sender address, and whether the `personal` account has a domain with a verified destination address is not known to me. Until it is, the Worker's mail goes through a port and is tested against a fake, and the real adapter and `cloudflare.config.ts` binding are written last. Without a sendable address, item 6 cannot ship even though it can be built.

## Constraints

- Repo rules (AGENTS.md): `@apps-hub/ui` for all UI, sentence case, erasable TypeScript with `.ts` imports, `node --test`, no telemetry, FOSS-only, new dependencies need the owner's approval (none expected).
- No own crypto: `@noble/hashes` and WebCrypto only. The vault format and `vault-vectors.json` stay byte-compatible.
- Build from a fresh branch off `origin/main`. The current `strongroom-sync-followup` branch is 3 commits behind, and the Android app (0.3.0) has the export code.
- Add every new test file to the package's `test` script by name.
- Real-Chromium e2e for everything that does not need a fingerprint; fingerprint and PRF are verified by hand with the owner.
- Review the Worker change before calling it done (DESIGN §12). Confirm the Cloudflare account (`personal`, id in `cloudflare.config.ts`) and get the owner's word before any deploy; use the `cf` CLI.
- Commit, push, merge, release only when the owner says.

## Left to the builder

Blob and migration layout, the wrapper's key-derivation labels, screen layout and copy (within the UI rules), how the fingerprint window is opened and focused, how Settings is organised, email wording, request rate limits, version bump.
