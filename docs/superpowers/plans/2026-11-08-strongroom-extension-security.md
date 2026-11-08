# Strongroom for Chrome: lock-free autofill, fingerprint, export, email recovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Chrome extension autofill with no unlock (optional fingerprint before every fill), fix Import, add Export for Chrome, seal the account key, and add opt-in email recovery.

**Architecture:** The service worker (`apps/strongroom-extension/src/service.ts`) keeps all logic and gains a `DeviceVault` (keys sealed under a non-extractable WebCrypto key) used only by `candidates`, `fill` and background sync; the popup session keeps its lock. Fingerprint and mail are injected ports, faked in tests. Email recovery adds an escrow blob and lost-access endpoints to the Worker `tools/vault-api`, and pure helpers to `packages/strongroom-core`.

**Tech Stack:** TypeScript (erasable, `.ts` imports), `node --test`, WebCrypto, `@noble/hashes` (already used), esbuild (existing), Cloudflare Worker + D1, real-Chromium e2e (`test/e2e.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-08-strongroom-extension-security-design.md` (read it first; its "Calls made by me" section is binding).

## Global Constraints

- Work in a new worktree `.claude/worktrees/strongroom-ext-security`, branch `strongroom-extension-security` from `origin/main` (Task 1). Never touch other worktrees.
- Use explicit `git add <paths>`, never `-A`. Commit messages carry no Claude attribution and no Co-Authored-By line (owner's rule). Commit only the task's files. Do not push, merge, release or deploy.
- UI uses `@apps-hub/ui` classes only (`ui-*`, `--c-*`); copy is sentence case, active voice; errors say what happened and how to fix it; no emoji, no ALL-CAPS labels.
- No own crypto: `@noble/hashes` and WebCrypto only. Vault format and `vault-vectors.json` unchanged.
- No new dependencies. No telemetry.
- Every new `*.test.ts` is added by name to that package's `package.json` `test` script.
- Only `candidates`, `fill`, `capture` may come from a web page (`FROM_PAGE` in `service.ts`); that rule and the lookalike-host refusal stay.
- Real-Chromium e2e covers everything that needs no fingerprint; fingerprint and PRF are checked by hand with the owner.
- Update `docs/handoffs/strongroom-extension-security.md` (session log + current state) when each task lands.

## Review Focus

1. **Existing install upgrades:** a vault with a plain `accountKey` and no device keys still unlocks, and an interrupted migration never loses the account key (Task 7).
2. **A page can't skip the gate:** with fingerprint on, a `fill` from a page context is refused when verification fails or is absent; a lookalike host is still refused when the device keys are used (Tasks 8, 9).
3. **Lock semantics:** after the manual Lock button plus a browser restart, fills ask to unlock; after only a restart (or the auto-lock alarm), fills still work (Task 8).
4. **Export edge cases:** commas, quotes, newlines and Urdu text in a note round-trip through `parseCsv`; logins with no website are left out and counted, not exported with an empty URL (Task 4).
5. **Lost-access abuse:** a request with no escrow answers exactly like one with escrow; repeat requests within an hour send no second mail; release before 24 hours or after cancel is refused (Task 12).

---

### Task 1: Worktree, handoff file, baseline

**Files:**
- Create: `docs/handoffs/strongroom-extension-security.md` (in the new worktree)

- [ ] **Step 1:** From `/Users/outsentia/Documents/apps-hub`: `git fetch origin && git worktree add .claude/worktrees/strongroom-ext-security -b strongroom-extension-security origin/main`, then `cd` into it and `pnpm install --frozen-lockfile`.
- [ ] **Step 2:** Copy the spec and this plan from `.claude/worktrees/strongroom-sync/docs/superpowers/` into the same paths in the new worktree (they are uncommitted there). Create the handoff file per `~/.claude/CLAUDE.md` (resume prompt, goal and constraints, decisions with why, verified facts, file map, session log, current state and next step), pointing at the spec and plan.
- [ ] **Step 3:** Baseline: run `pnpm --filter strongroom-core test && pnpm --filter strongroom-extension test && pnpm --filter strongroom-extension typecheck && pnpm --filter vault-api test` (package names per each `package.json`). Expected: all pass. Record the counts in the handoff.
- [ ] **Step 4:** `git add docs/handoffs/strongroom-extension-security.md docs/superpowers/specs/2026-11-08-strongroom-extension-security-design.md docs/superpowers/plans/2026-11-08-strongroom-extension-security.md && git commit -m "Strongroom extension security: spec, plan and handoff"`.

### Task 2: Throwaway spike — WebAuthn and PRF from an extension page (owner at the keyboard)

**Files:** scratch only, under the session scratchpad `spike/` (never committed): `manifest.json` (MV3, no background, name "spike"), `page.html`, `page.js`.

**Interfaces:** Produces a yes/no for each of: (a) `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`, (b) `navigator.credentials.create` with `authenticatorAttachment: 'platform'`, `userVerification: 'required'`, `rp.id = location.hostname` (the extension id), `extensions: { prf: {} }` succeeds from an extension page and `getClientExtensionResults().prf.enabled` is true, (c) `credentials.get` with `extensions: { prf: { eval: { first: <32 bytes> } } }` returns `prf.results.first` (32 bytes) after a fingerprint, (d) the same works inside a window opened by `chrome.windows.create({ type: 'popup' })` from another extension page.

- [ ] **Step 1:** Write the three files so the page has Enroll and Verify buttons and prints the four results plus any error name/message.
- [ ] **Step 2:** Ask the owner to load the folder at `chrome://extensions` (Developer mode, Load unpacked), press Enroll then Verify, and paste what the page prints. Do not ask for anything else.
- [ ] **Step 3:** Record the results in the handoff file. Decide: (b)+(c) pass → Tasks 9 and 10 use PRF mode. (b) passes, (c) fails → "gate only" mode. (a) or (b) fails, or (d) fails → drop Tasks 9 and 10, tell the owner, continue with the rest.
- [ ] **Step 4:** Commit only the handoff change.

### Task 3: Import opens in a tab

**Files:**
- Modify: `apps/strongroom-extension/src/popup.ts` (`importScreen`, `main`, the Import button in `vaultScreen`)
- Modify: `apps/strongroom-extension/test/e2e.mjs`

**Interfaces:** Produces: `popup.html#import` opens straight to the Import screen once unlocked. A page whose URL hash is `#import` is "a tab"; any other is the popup.

- [ ] **Step 1: e2e check.** In `e2e.mjs`, where the suite already loads `popup.html` as a tab and imports the fixture, change the import step to click the Import button on the plain `popup.html` page, wait for a new page whose URL ends `#import`, assert it shows the file input, and do the existing import there. Name: `Import opens in its own tab and imports`.
- [ ] **Step 2:** Run `pnpm --filter strongroom-extension build && pnpm --filter strongroom-extension test:e2e`. Expected: the new check FAILS (no new tab).
- [ ] **Step 3:** In `popup.ts`, make the Import button call `chrome.tabs.create({ url: chrome.runtime.getURL('popup.html#import') })` then `window.close()` when `location.hash !== '#import'`, and call `importScreen()` directly otherwise. In `main()`, when the hash is `#import` and the vault is unlocked, render `importScreen`; when locked, show the unlock screen first and go to Import after unlocking. In the tab, `importScreen`'s Back and Done go to `vaultScreen` (no active-tab lookup: `tab` stays null).
- [ ] **Step 4:** Rebuild and rerun e2e. Expected: all checks pass, including the new one.
- [ ] **Step 5:** Commit `apps/strongroom-extension/src/popup.ts apps/strongroom-extension/test/e2e.mjs` — "Strongroom extension: open Import in a tab so the file picker doesn't close it".

### Task 4: `exportForChrome` in strongroom-core

**Files:**
- Create: `packages/strongroom-core/src/chrome-export.ts`, `packages/strongroom-core/src/__tests__/chrome-export.test.ts`
- Modify: `packages/strongroom-core/src/index.ts` (add `export * from './chrome-export.ts';`), `packages/strongroom-core/package.json` (test script)

**Interfaces:**
- Consumes: `Login` (`entry.ts`: `name, username, password, sites: Site[], apps, note`), `parseCsv` (`csv.ts`).
- Produces: `formatCsv(rows: string[][]): string` (a cell is quoted when it holds `,` `"` CR or LF, quotes doubled, rows end CRLF); `exportForChrome(logins: Login[]): { csv: string; rows: number; leftOut: number }`.

- [ ] **Step 1: Tests** (name → assertions):
  - `formatCsv round-trips through parseCsv` → for cells `['a,b','say "hi"','line1\nline2','اردو','']`, `parseCsv(formatCsv([cells]))` equals `[cells]`.
  - `exportForChrome writes Chrome's five columns` → first row is exactly `name,url,username,password,note`.
  - `one row per website` → a login with sites `https://a.com` and `http://b.org` gives two rows with urls `https://a.com` and `http://b.org`, same name/username/password/note; `rows` is 2.
  - `logins with no website are left out and counted` → a login with `sites: []` (app-only) adds no row and `leftOut` is 1.
  - `rows are sorted by name, case-insensitive` → names `b`, `A` come out `A`, `b`.
- [ ] **Step 2:** Run `pnpm --filter strongroom-core test`. Expected: FAIL, module missing.
- [ ] **Step 3:** Implement both functions in `chrome-export.ts` per the Interfaces; a site's URL is `` `${s.https ? 'https' : 'http'}://${s.host}` ``.
- [ ] **Step 4:** Run the core tests. Expected: PASS.
- [ ] **Step 5:** Commit the four files — "strongroom-core: export logins as Chrome's password CSV".

### Task 5: Export request and popup Export screen

**Files:**
- Modify: `apps/strongroom-extension/src/service.ts` (Request union, `handle`), `apps/strongroom-extension/src/popup.ts`, `apps/strongroom-extension/src/__tests__/service.test.ts`, `apps/strongroom-extension/test/e2e.mjs`

**Interfaces:**
- Consumes: `exportForChrome` (Task 4), `logins(key)` and `requireKey()` in `service.ts`, `openWithPassword`.
- Produces: `Request` gains `{ type: 'export'; password: string }` returning `{ csv: string; rows: number; leftOut: number }`; wrong password → `UserError("That master password isn't right.")`; locked → the existing LOCKED error. Not in `FROM_PAGE`.

- [ ] **Step 1: Tests** in `service.test.ts` using the file's existing helper that builds a service with a fake store: `export refuses a wrong master password`; `export refuses while locked`; `export returns one row per site and counts logins without a website` (save two logins, one with a site, one with only a note and no site; assert `rows`, `leftOut`, header line); `export from a page context is refused`.
- [ ] **Step 2:** Run `pnpm --filter strongroom-extension test`. Expected: the four FAIL.
- [ ] **Step 3:** Implement the `export` case: `requireKey()`, re-derive with `openWithPassword(header, req.password, deps.floor, accountKey)` and compare to the session key with `equalBytes`, then `exportForChrome(found.map(f => f.login))`. Call `deps.resetAutoLock()`.
- [ ] **Step 4:** In `popup.ts` add an Export button in `vaultScreen` and `exportScreen()`: explains in plain words that the file is for Chrome, holds passwords in plain text, leaves out cards, notes and logins without a website (show the count after export), asks for the master password, then downloads `strongroom-passwords.csv` through a `Blob` and an `<a download>`, and reminds the user to delete the file.
- [ ] **Step 5:** e2e: `Export asks for the master password and downloads a CSV Chrome can read` — click Export, wrong password shows the error, right password triggers a download whose first line is the five columns and which contains the fixture's logins. Run build + `test:e2e`; Expected: pass.
- [ ] **Step 6:** Manual (owner): import the downloaded file at `chrome://password-manager` and confirm the logins appear. Record in the handoff.
- [ ] **Step 7:** Commit the touched files — "Strongroom extension: export passwords as a Chrome CSV".

### Task 6: `DeviceVault`

**Files:**
- Create: `apps/strongroom-extension/src/device-vault.ts`, `apps/strongroom-extension/src/__tests__/device-vault.test.ts`
- Modify: `apps/strongroom-extension/package.json` (test script)

**Interfaces:**
- Consumes: `KV` from `service.ts`; `seal`, `open`, `hkdf`, `utf8`, `toBase64`, `fromBase64` from `strongroom-core`.
- Produces:
  ```ts
  export type KeyStore = { get(): Promise<CryptoKey | undefined>; put(k: CryptoKey): Promise<void> };
  export type DeviceKeys = { vaultKey: Uint8Array; loginToken?: Uint8Array };
  export interface DeviceVault {
    saveKeys(k: DeviceKeys, prf?: Uint8Array): Promise<void>; // device mode: seals under the wrapper; fingerprint mode: re-seals under prf, no-op without prf
    loadKeys(prf?: Uint8Array): Promise<DeviceKeys | null>;   // null if none, unreadable, or fingerprint mode without prf
    clearKeys(): Promise<void>;
    mode(): Promise<'none' | 'device' | 'fingerprint'>;
    protect(prf: Uint8Array): Promise<void>;   // device -> fingerprint: re-seal under prf, delete the wrapper-sealed copy
    unprotect(prf: Uint8Array): Promise<void>; // fingerprint -> device
    saveAccountKey(k: Uint8Array): Promise<void>; // always wrapper-sealed, own entry
    loadAccountKey(): Promise<Uint8Array | null>;
  }
  export function createDeviceVault(area: KV, keys: KeyStore): DeviceVault;
  export const idbKeyStore: KeyStore; // IndexedDB database 'strongroom-device', object store 'keys', key 'wrapper'; generates AES-GCM 256, extractable: false, on first use
  ```
  Storage entries in `area`: `deviceKeys` (`{mode, sealed}` JSON), `accountKeySealed`. Wrapper sealing uses `crypto.subtle` AES-GCM directly with the non-extractable `CryptoKey` (core's `seal` takes raw bytes), with AAD labels `strongroom/ext/device-keys` and `strongroom/ext/account-key`; fingerprint mode uses core `seal(hkdf(prf, 'strongroom/ext/fingerprint'), …)`.

- [ ] **Step 1: Tests** with an in-memory `KV` and a `KeyStore` backed by a variable holding a non-extractable key made by `crypto.subtle.generateKey`:
  - `saved keys load back in device mode`; `clearKeys removes them`; `mode is none before any save`.
  - `the stored bytes do not contain the vault key` (scan the JSON for the base64 of the key).
  - `a different wrapper cannot open the keys` (new `KeyStore` → `loadKeys` is null, no throw).
  - `protect moves keys to fingerprint mode: loadKeys without prf is null, with prf returns them, no device-sealed copy remains`.
  - `saveKeys in fingerprint mode without prf changes nothing; with prf re-seals`.
  - `unprotect returns to device mode`.
  - `account key round-trips and survives clearKeys`.
- [ ] **Step 2:** Run the extension tests. Expected: FAIL, module missing.
- [ ] **Step 3:** Implement `createDeviceVault` and `idbKeyStore`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit the three files — "Strongroom extension: DeviceVault, keys sealed under a device key".

### Task 7: Account key in its own sealed entry, with migration

**Files:**
- Modify: `apps/strongroom-extension/src/storage.ts` (`localStore` becomes `createLocalStore(device: DeviceVault): SyncPort`; add `localKv: KV` and `migrateAccountKey(local: KV, device: DeviceVault): Promise<void>`), `apps/strongroom-extension/src/background.ts`, `apps/strongroom-extension/src/__tests__/sync-store.test.ts`

**Interfaces:**
- Consumes: `DeviceVault` (Task 6).
- Produces: `getSyncLocal().accountKey` reads `device.loadAccountKey()`; `setAccount` writes `device.saveAccountKey`; the plain `accountKey` storage entry is no longer read or written after migration. `background.ts` builds `const device = createDeviceVault(localKv, idbKeyStore)` and awaits `migrateAccountKey` before handling any message.

- [ ] **Step 1: Tests** in `sync-store.test.ts` (adapt its existing fake `chrome.storage.local` setup to build the store with a fake `DeviceVault`):
  - `a plain account key is sealed and the plain entry removed`.
  - `if sealing fails the plain key stays and is still readable` (a vault whose `saveAccountKey` rejects).
  - `if the sealed key reads back different the plain key stays`.
  - `a second migration run changes nothing`.
  - `setAccount stores the account key sealed, not as plain base64`.
  - Update existing tests that read the plain `accountKey` entry.
- [ ] **Step 2:** Run the extension tests. Expected: new tests FAIL.
- [ ] **Step 3:** Implement per Interfaces. `migrateAccountKey` order: read plain → `saveAccountKey` → `loadAccountKey` equals plain → only then remove plain. Until migration has run, `getSyncLocal` falls back to the plain entry so nothing is lost on an early read.
- [ ] **Step 4:** Run tests and `pnpm --filter strongroom-extension typecheck`. Expected: pass.
- [ ] **Step 5:** Commit the touched files — "Strongroom extension: seal the account key, migrate the old plain one safely".

### Task 8: Lock-free fills and sync from device keys (service)

**Files:**
- Modify: `apps/strongroom-extension/src/service.ts`, `apps/strongroom-extension/src/background.ts`, `apps/strongroom-extension/src/popup.ts` (Lock button sends `manual: true`), `apps/strongroom-extension/src/__tests__/service.test.ts`, `apps/strongroom-extension/test/e2e.mjs`

**Interfaces:**
- Consumes: `DeviceVault` (Task 6).
- Produces: `Deps` gains `device?: DeviceVault`. `Request` changes `{ type: 'lock' }` to `{ type: 'lock'; manual?: boolean }`. `opened(key, loginToken?)` also calls `device.saveKeys({ vaultKey: key, loginToken })`. A new internal `fillKey(): Promise<Uint8Array | null>` returns the session key, else `(await device.loadKeys())?.vaultKey ?? null`; `candidates` and `fill` use it. `doSync` takes its vault key and login token from the session, else from `device.loadKeys()`. `lock` clears the session; with `manual: true` it also calls `device.clearKeys()`. The alarm in `background.ts` sends `{ type: 'lock' }` (no `manual`). `status` still reports `locked` from the session key only.

- [ ] **Step 1: Tests** with a fake in-memory `DeviceVault`:
  - `after unlock, a fill works once the session is cleared` (call `handle({type:'lock'})` then `fill` from a page ctx → returns the login).
  - `a manual lock ends fills` (`{type:'lock', manual:true}` then `fill` → LOCKED error).
  - `the auto-lock request does not end fills` and `status says locked after it`.
  - `candidates works from device keys with the popup locked`.
  - `a lookalike host is still refused with device keys`.
  - `a page cannot call export, get, list or save` (all NOT_ALLOWED from a page ctx).
  - `sync runs from device keys after the session is gone` (fake transport sees the stored login token).
  - `opened is not required for fills in a service built without a DeviceVault` (existing behavior unchanged).
- [ ] **Step 2:** Run the tests. Expected: new ones FAIL.
- [ ] **Step 3:** Implement per Interfaces. In `background.ts` pass `device` to `createService`, and send `manual: true` only from the popup's Lock button.
- [ ] **Step 4:** e2e: `fill still works after the popup session auto-locks` (set the lock alarm to fire at once or message `{type:'lock'}`, then fill from the in-page menu) and `fill asks to unlock after the manual Lock button and a browser restart`. Run build + `test:e2e`. Expected: pass, including all earlier checks (the old "locked after restart" check must be rewritten to the new rules: after a restart only a manual lock keeps it locked).
- [ ] **Step 5:** Commit the touched files — "Strongroom extension: autofill and sync no longer need the vault unlocked".

### Task 9: Fingerprint gate, PRF sealing and popup unlock (service, faked)

**Files:**
- Modify: `apps/strongroom-extension/src/service.ts`, `apps/strongroom-extension/src/__tests__/service.test.ts`

**Interfaces:**
- Consumes: `DeviceVault` (Task 6), `fillKey` and `doSync` (Task 8). Only if Task 2 passed.
- Produces:
  ```ts
  export interface Fingerprint {
    available(): Promise<boolean>;
    enroll(): Promise<{ credentialId: string; prf?: Uint8Array } | null>;
    verify(credentialId: string): Promise<{ prf?: Uint8Array } | null>;
  }
  ```
  `Deps` gains `fingerprint?: Fingerprint` and `settings: KV` (persistent, `chrome.storage.local` in the browser; stores `fingerprint` = `{ credentialId: string; prf: boolean }`). New requests (none allowed from a page): `{ type: 'fingerprintStatus' }` → `{ available: boolean; on: boolean; sealed: boolean }`; `{ type: 'fingerprintOn' }` (popup unlocked); `{ type: 'fingerprintOff' }` (needs a successful `verify`); `{ type: 'unlockFingerprint' }` (verify, load keys, `opened`). `export` accepts `{ password?: string; fingerprint?: true }`. `fillKey()` when fingerprint is on calls `verify` on every fill and refuses with `UserError('Fingerprint not recognised. Try again, or unlock with your master password.')` on null; with `prf` it loads the sealed keys. `opened()` passes the prf it has so a sealed copy is refreshed. `SyncStatus` gains `paused: boolean` (true when sync could run but the keys are fingerprint-sealed and no session exists).

- [ ] **Step 1: Tests** with fakes: `fingerprintStatus is unavailable when the port says so`; `with fingerprint on, each fill calls verify` (two fills → two verifies); `a refused fingerprint refuses the fill and returns nothing`; `a page-context fill without a passing verify is refused`; `turning on with prf seals the keys and removes the device-sealed copy`; `turning on without prf keeps device mode and a fill still needs verify`; `turning off needs a passing verify`; `master-password unlock still works while fingerprint is on` (account key is wrapper-sealed, Task 7); `unlockFingerprint opens the popup session`; `sync is paused, not failed, when keys are sealed and nothing is unlocked` (`syncStatus().paused === true`).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run tests and typecheck. Expected: pass.
- [ ] **Step 5:** Commit — "Strongroom extension: fingerprint before every fill, behind a toggle".

### Task 10: Fingerprint in the browser and the Settings screen

**Files:**
- Create: `apps/strongroom-extension/src/fingerprint.html`, `apps/strongroom-extension/src/fingerprint.ts`
- Modify: `apps/strongroom-extension/src/background.ts`, `apps/strongroom-extension/build.mjs` (add `fingerprint` entry point, copy the html), `apps/strongroom-extension/src/popup.ts`, `apps/strongroom-extension/src/service.ts` only if the spike showed a needed change

**Interfaces:**
- Consumes: `Fingerprint` and the requests from Task 9; the spike results.
- Produces: `browserFingerprint: Fingerprint` in `background.ts`. `enroll` and `verify` open `chrome.windows.create({ url: 'fingerprint.html?mode=…&cred=…', type: 'popup', width: 360, height: 240 })`; `fingerprint.ts` calls WebAuthn (`rp.id = location.hostname`, platform attachment, `userVerification: 'required'`, PRF salt = 32 fixed bytes from `utf8('strongroom/ext/prf')` hashed with SHA-256) and replies with `chrome.runtime.sendMessage({ type: 'fingerprintResult', … })`; the worker resolves the pending promise, closes the window, and resolves null if the window closes first or 60 seconds pass. `fingerprintResult` is accepted only from the extension's own pages (not `FROM_PAGE`). `available()` answers `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` from an extension page, so the popup asks and passes the answer, or the window page does; implementer picks the working one.
- A Settings screen in the popup (a Settings button in `vaultScreen`): the fingerprint toggle (disabled with the reason when unavailable; text says plainly whether it seals the key or only gates fills), "Anyone who can use this browser profile can use this vault" note for the lock-free mode, the Export button moves here or stays — implementer's call. The unlock screen offers "Unlock with fingerprint" when it is on.

- [ ] **Step 1:** Implement the window, the worker side and the popup Settings and unlock changes. Keep `dist/` free of anything not listed in `build.mjs`.
- [ ] **Step 2:** Build, run `pnpm --filter strongroom-extension test && pnpm --filter strongroom-extension typecheck && pnpm --filter strongroom-extension test:e2e`. Expected: all pass (the e2e browser has no fingerprint, so the toggle must show disabled with a reason; add a check `fingerprint toggle explains why it is unavailable`).
- [ ] **Step 3:** Manual with the owner on their Chrome: turn the toggle on, fill on a test page (fingerprint asked each time), refuse once (nothing fills), turn it off, unlock the popup with the fingerprint. Record results (including whether PRF mode or gate-only was used) in the handoff.
- [ ] **Step 4:** Commit the touched files — "Strongroom extension: fingerprint window and Settings screen".

### Task 11: Escrow helpers in strongroom-core

**Files:**
- Modify: `packages/strongroom-core/src/format.ts`, `packages/strongroom-core/src/index.ts`, `packages/strongroom-core/package.json`
- Create: `packages/strongroom-core/src/escrow.ts`, `packages/strongroom-core/src/__tests__/escrow.test.ts`

**Interfaces:**
- Consumes: `generateRecoveryKey`, `formatRecoveryKey`, `parseRecoveryKey` (`recovery-key.ts`), `seal`, `open`, `hkdf`, `utf8`, `recoveryLoginToken`, `tokenHash`, `unlockWithRecovery`.
- Produces:
  ```ts
  // format.ts
  export async function rotateRecoveryKey(h: Header, vaultKey: Uint8Array): Promise<{ header: Header; recoveryKey: Uint8Array; recoveryHash: string }>;
  // escrow.ts
  export const generateEmailCode: () => Uint8Array;   // = generateRecoveryKey
  export const formatEmailCode: (b: Uint8Array) => string;  // = formatRecoveryKey
  export const parseEmailCode: (s: string) => Uint8Array | null; // = parseRecoveryKey
  export function sealEscrow(code: Uint8Array, s: { recoveryKey: Uint8Array; accountKey: Uint8Array }): Promise<Uint8Array>;
  export function openEscrow(code: Uint8Array, blob: Uint8Array): Promise<{ recoveryKey: Uint8Array; accountKey: Uint8Array } | null>;
  ```
  `recoveryHash` is `tokenHash(recoveryLoginToken(recoveryKey))`. Escrow AAD label `strongroom/v1/escrow`, key `hkdf(code, 'strongroom/v1/escrow')`.

- [ ] **Step 1: Tests:** `rotateRecoveryKey: the new key opens the header, the old one no longer does, the password still does`; `rotateRecoveryKey changes only recoveryWrap` (salt, kdf, passwordWrap equal); `rotateRecoveryKey recoveryHash matches tokenHash(recoveryLoginToken(newKey))`; `escrow round-trips`; `escrow with a wrong code is null`; `escrow with a flipped byte is null`.
- [ ] **Step 2:** Run core tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Add `escrow.test.ts` to the core test script.
- [ ] **Step 4:** Run core tests. Expected: PASS.
- [ ] **Step 5:** Commit the touched files — "strongroom-core: rotate the recovery key, seal and open an email escrow".

### Task 12: Worker — escrow and lost-access endpoints

**Files:**
- Create: `tools/vault-api/migrations/0002_escrow.sql`, `tools/vault-api/src/lost-access.ts`, `tools/vault-api/src/__tests__/lost-access.test.ts`
- Modify: `tools/vault-api/src/index.ts`, `tools/vault-api/src/db.ts`, `tools/vault-api/src/__tests__/d1-fake.ts` (if the fake needs the new tables), `packages/strongroom-core/src/sync/protocol.ts` (`AccountUpdate` gets `escrow?: { email: string; blob: string; code: string }`), `tools/vault-api/package.json` (test script)

**Interfaces:**
- Produces: `export interface Mailer { send(to: string, subject: string, text: string): Promise<void> }`; `Env` gains optional `MAIL?: Mailer` and `PUBLIC_URL?: string` (the base of emailed links); `Deps` gains `mail?: Mailer`. Migration: `escrow(id INTEGER PRIMARY KEY CHECK (id = 1), email TEXT NOT NULL, blob TEXT NOT NULL, created_at INTEGER NOT NULL)`; `lost_request(id INTEGER PRIMARY KEY CHECK (id = 1), claim_hash TEXT NOT NULL, confirm_hash TEXT NOT NULL, requested_at INTEGER NOT NULL, release_at INTEGER, cancelled INTEGER NOT NULL DEFAULT 0)`.
- Endpoints (JSON, errors as `{ error }` in plain words like the existing ones):
  - `PUT /v1/account` (existing; `login`/`recovery` role): when `recoveryHash` is present and differs from the stored one, delete `escrow` and `lost_request`; when the body has `escrow`, `recoveryHash` must be present (else 400), send the code by mail first (`mail.send(escrow.email, …)`, 502 `{ error }` if it throws, nothing stored), then store `{ email, blob }`. The code is never stored or logged.
  - `DELETE /v1/escrow` (`login` role) → removes escrow and any request.
  - `POST /v1/lost/request` (no auth) body `{ claimHash: base64 32 bytes }` → always `200 { ok: true }`. If an escrow exists and no request was made in the last hour, store the request (random 32-byte confirm token, hash only) and mail `{PUBLIC_URL}/v1/lost/confirm?t=<token>`; otherwise do nothing visible.
  - `GET /v1/lost/confirm?t=` → if the token matches and not cancelled, set `release_at = now + 24h`, mail a notice with a cancel link, answer a small HTML page "Confirmed. Strongroom will let you in after 24 hours." Wrong token → same page text as an expired one.
  - `GET /v1/lost/cancel?t=` (same confirm token) and `POST /v1/lost/cancel` (`login`/`recovery`/`read` role) → set `cancelled = 1`.
  - `GET /v1/lost/status` (`login`/`recovery`/`read`) → `{ escrow: boolean; pending: { releaseAt: number | null } | null }` (pending only when a non-cancelled request exists).
  - `POST /v1/lost/release` body `{ claim: base64 }` → `200 { state: 'ready', blob }` when `sha256(claim)` equals `claim_hash`, not cancelled and `now >= release_at`; otherwise `200 { state: 'waiting', releaseAt: number | null }`; a claim that matches nothing answers `{ state: 'waiting', releaseAt: null }` exactly like no request.

- [ ] **Step 1: Tests** in `lost-access.test.ts` (fake clock, fake D1, fake `Mailer` recording mails):
  - `enrolling stores the blob and mails the code once, and the code is not in the database`.
  - `a mail failure answers 502 and stores nothing`.
  - `escrow without a recoveryHash is rejected`.
  - `a changed recoveryHash deletes the escrow unless the same call carries a new one`.
  - `request with no escrow answers 200 and sends no mail`; `request with escrow mails one confirm link`; `a second request within an hour sends no second mail`.
  - `confirming starts a 24-hour wait and mails a notice`; `a wrong confirm token changes nothing`.
  - `release before 24 hours is waiting with the release time`; `release at 24 hours returns the blob`; `release with a wrong claim looks the same as no request`; `release after cancel is refused`.
  - `status shows the pending request to a signed-in device and nothing to a stranger (401)`.
  - `DELETE /v1/escrow needs the login role`.
- [ ] **Step 2:** Run `pnpm --filter vault-api test`. Expected: FAIL.
- [ ] **Step 3:** Implement: migration, `db.ts` helpers, `lost-access.ts` handlers wired from `route()` in `index.ts`, and the `escrow` handling in `PUT /v1/account`. Reuse `authorize` and the existing json/fail helpers. Add `lost-access.test.ts` to the test script. Extend `schema.test.ts` if it lists tables.
- [ ] **Step 4:** Run the Worker tests. Expected: PASS. Run `pnpm --filter strongroom-core typecheck`.
- [ ] **Step 5:** Commit the touched files — "Vault server: email escrow and lost-access endpoints (mail port, no deploy)".

### Task 13: Transport methods for escrow and lost access

**Files:**
- Modify: `packages/strongroom-core/src/sync/transport.ts`, `packages/strongroom-core/src/__tests__/sync-transport.test.ts`, `apps/strongroom-extension/src/__tests__/sync-world.ts` (the fake server the extension tests use), `tools/vault-api/src/__tests__/sync-e2e.test.ts` if it implements `Transport`

**Interfaces:**
- Produces on `Transport`:
  ```ts
  lostRequest(claimHash: string): Promise<void>;
  lostRelease(claim: string): Promise<{ state: 'waiting'; releaseAt: number | null } | { state: 'ready'; blob: string }>;
  lostStatus(token: Uint8Array): Promise<{ escrow: boolean; pending: { releaseAt: number | null } | null }>;
  lostCancel(token: Uint8Array): Promise<void>;
  deleteEscrow(token: Uint8Array): Promise<void>;
  ```
  and `putAccount(auth: Uint8Array, body: AccountUpdate)` already carries `escrow` via the protocol type. Shapes are checked like existing calls (a wrong body is a `SyncHttpError`, never a TypeError).

- [ ] **Step 1: Tests** (`sync-transport.test.ts`, existing fake `fetch` style): `lostRequest posts the claim hash with no authorization header`; `lostRelease reads waiting and ready`; `lostRelease rejects a malformed body as a readable error`; `lostStatus and lostCancel send the bearer token`; `deleteEscrow sends DELETE /v1/escrow with the bearer token`.
- [ ] **Step 2:** Run core tests. Expected: FAIL.
- [ ] **Step 3:** Implement the five methods with the file's `call`/`ok` helpers; update every `Transport` implementation and fake in the repo so typecheck stays clean (`pnpm typecheck`).
- [ ] **Step 4:** Run core, extension and Worker tests and typecheck. Expected: pass.
- [ ] **Step 5:** Commit the touched files — "strongroom-core: transport calls for email recovery".

### Task 14: Email recovery in the extension — enrol, confirm, turn off, banner

**Files:**
- Modify: `apps/strongroom-extension/src/service.ts`, `apps/strongroom-extension/src/popup.ts`, `apps/strongroom-extension/src/__tests__/service.test.ts`, `apps/strongroom-extension/src/sync-copy.ts` (+ its test) for any new copy

**Interfaces:**
- Consumes: Tasks 11 and 13; `SyncPort`/`Transport` in `service.ts`.
- Produces: `Request` gains `{ type: 'emailRecovery'; action: 'status' }` → `{ available: boolean; enrolled: boolean; waitingForCode: boolean; pendingRecovery: { releaseAt: number | null } | null; wasTurnedOff: boolean }`; `{ …; action: 'enrol'; email: string }` → `{ recoveryKey: string }` (also sets `session.recovery` so the existing "Save your recovery key" screen and `confirmRecovery` run); `{ …; action: 'confirm'; code: string }`; `{ …; action: 'off' }`; `{ …; action: 'cancelRecovery' }`. None allowed from a page. State kept in `deps.settings`: `escrowBlob` (base64, until confirmed) and `escrowConfirmed`.
- Enrol: needs the popup unlocked, sync signed in, and a plausible email; runs `rotateRecoveryKey`, builds `sealEscrow(code, { recoveryKey: new, accountKey })`, then `transport.putAccount(loginToken, { header, loginHash, readHash, recoveryHash, ifRev, escrow: { email, blob, code } })`, where `loginHash` and `readHash` come from the token hashes the existing code derives for the current header. On a 409 it pulls and tells the user to try again. Confirm: `openEscrow(parseEmailCode(code), blob)` non-null → `escrowConfirmed`. `wasTurnedOff` is true when `escrowConfirmed` is set locally but `lostStatus().escrow` is false (the server dropped it because the recovery key changed elsewhere); the popup shows "Recovery by email is off. Turn it on again."

- [ ] **Step 1: Tests** with the fake server from `sync-world.ts` extended in Task 13: `enrol rotates the recovery key: the new key opens the vault, the old one does not`; `enrol sends the code to the mailer once and the server never stores it`; `enrol needs sync signed in`; `enrol needs the vault unlocked`; `confirm with the right code marks it enrolled`; `confirm with a wrong code does not`; `off deletes the escrow`; `status shows wasTurnedOff after the server drops the escrow`; `status shows a pending recovery and cancelRecovery clears it`; `none of these requests work from a page`.
- [ ] **Step 2:** Run the extension tests. Expected: FAIL.
- [ ] **Step 3:** Implement the service side, then the Settings section in `popup.ts`: an "Email recovery" group with plain-words copy (what it does, that anyone who controls your inbox could start a recovery and that you have 24 hours to cancel, that turning it on replaces your recovery key), the email field, the code field after enrolling, Turn off, the pending-recovery banner with Cancel on the vault screen, and the turned-off notice.
- [ ] **Step 4:** Run tests, typecheck and `test:e2e` (add one e2e check against the local test Worker world: enrol → code typed → status enrolled). Expected: pass.
- [ ] **Step 5:** Commit the touched files — "Strongroom extension: opt-in email recovery".

### Task 15: Lost access flow on a new device

**Files:**
- Modify: `apps/strongroom-extension/src/service.ts`, `apps/strongroom-extension/src/popup.ts`, `apps/strongroom-extension/src/__tests__/service.test.ts`

**Interfaces:**
- Consumes: Tasks 11, 13, 14; the existing `signInRecovery` request.
- Produces: `Request` gains `{ type: 'lostAccess'; action: 'request' }` (makes a random 20-byte claim, saves it in `deps.settings` as `lostClaim`, calls `lostRequest(tokenHash(claim))`); `{ …; action: 'check' }` → `{ state: 'none' } | { state: 'waiting'; releaseAt: number | null } | { state: 'ready' }` (calls `lostRelease`; keeps the blob in `settings.lostBlob` when ready); `{ …; action: 'open'; code: string; newPassword: string }` → opens `lostBlob` with `parseEmailCode(code)` and runs the same code as `signInRecovery` with the opened `recoveryKey` and `accountKey`, then clears `lostClaim` and `lostBlob`. Available only when sync is available and the vault is not unlocked; none allowed from a page.

- [ ] **Step 1: Tests:** `a fresh device can request, wait, then open with the code and ends signed in with a new password`; `check before 24 hours reports waiting`; `a wrong code leaves the claim and blob in place and says so in plain words`; `open without a ready blob is refused`; `lostAccess is refused from a page`; `after open the old recovery key is the rotated one (the pasted blob key works, an earlier key does not)`.
- [ ] **Step 2:** Run the extension tests. Expected: FAIL.
- [ ] **Step 3:** Implement the service side and a "Lost access" screen reachable from the unlock and sign-in screens: Request, then a status view with "Check again" showing the release time, then the code and new-password form.
- [ ] **Step 4:** Run tests, typecheck, `test:e2e` with one check that walks the screen against the local Worker world with a fake clock. Expected: pass.
- [ ] **Step 5:** Commit the touched files — "Strongroom extension: get back in through email after losing access".

### Task 16: Gates, docs and review (no deploy)

**Files:**
- Modify: `apps/strongroom-extension/README.md` (what it does, "Not in this version"), `docs/handoffs/strongroom-extension-security.md`, `docs/handoffs/strongroom-extension.md` (link forward), `docs/strongroom/DESIGN.md` only where it now disagrees (the extension no longer auto-locks fills; email recovery exists)

- [ ] **Step 1:** Run everything and record the real output in the handoff: `pnpm test`, `pnpm typecheck`, `pnpm --filter strongroom-extension build && pnpm --filter strongroom-extension test:e2e`.
- [ ] **Step 2:** Dispatch reviewers on the diff against `origin/main`: `code-reviewer`, `invariant-reviewer`, `security-engineer` (the Worker and the key storage, DESIGN §12), `requirements-verifier` against the spec. Fix what they confirm, test-first.
- [ ] **Step 3:** Update the docs per Files. Do not bump the version or release; tell the owner what a release needs (`pnpm release` is theirs to say go on).
- [ ] **Step 4:** Commit the docs — "Strongroom extension: docs for lock-free autofill, fingerprint, export and email recovery".

### Task 17: Real mail adapter (blocked on the owner's answer)

Blocked until the owner says which Cloudflare mail feature and sender address to use. Then: implement `Mailer` against it, add the binding to `tools/vault-api/cloudflare.config.ts` (`cf` CLI, personal account only), add a unit test with a fake binding, and stop before any deploy — deploying needs the owner's word and a confirmed account.

---

## Self-review notes

- Spec coverage: item 1 → Tasks 2, 9, 10; item 2 → 3; item 3 → 4, 5; item 4 → 6, 8; item 5 → 6, 7; item 6 → 11–15, 17; popup-stays-locked, manual-Lock, migration, PRF-sync-pause, escrow-invalidation, code-confirmed enrolment → 7, 8, 9, 12, 14.
- Names used across tasks: `DeviceVault`, `DeviceKeys`, `fillKey`, `Fingerprint`, `exportForChrome`, `rotateRecoveryKey`, `sealEscrow/openEscrow`, `Mailer`, `lostRequest/lostRelease/lostStatus/lostCancel/deleteEscrow` are defined once and reused unchanged.
