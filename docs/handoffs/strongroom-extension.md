# Handoff: Strongroom for Chrome (browser extension)

**See also:** this file documents the extension as it stood before the 2026-11-08
security plan. `docs/handoffs/strongroom-extension-security.md` is the current handoff;
it added lock-free autofill and sync, Export for Chrome, a sealed account key, and
opt-in email recovery.

## Resume prompt

Dated 2026-11-05. Strongroom is the owner's own-code password manager. Phase 1 (Android app) is
built and merged (0.1.1). Phase 3 (Chrome extension, built, verified in real Chromium, 33/33) is
**uncommitted** in the worktree `/Users/outsentia/Documents/apps-hub/.claude/worktrees/strongroom-extension`,
branch `strongroom-extension` (from `origin/main` ec23cbd, no upstream on purpose: never push it to
`main`). The next phase is **Phase 2: Cloudflare sync** (DESIGN §10).

Read completely first: this file, then `docs/strongroom/DESIGN.md` (§3 phases, §6 format, §10 sync,
§12 review gates), then `docs/handoffs/strongroom.md` (the Android side). Trust the decisions and
verified facts in them and don't redo that work. Follow the handoff contract in `~/.claude/CLAUDE.md`.
Commit, push, merge or deploy only when the owner says so. Never edit the worktree
`.claude/worktrees/strongroom-phase-1` (another session's, the Android app) if it still exists.

First message to the owner, all in one: (1) did the extension work when loaded unpacked from
`/Users/outsentia/Documents/apps-hub/strongroom-extension-dist`, and what broke? Fix that before
anything else. (2) Commit and merge the extension branch now? Phase 2's sync client builds on
`packages/strongroom-core`, so say whether Phase 2 branches from `main` after that merge or stacks on
this branch. (3) The open question in DESIGN §10: add a 128-bit account key (a second secret typed
once per new device)? It changes key derivation in both apps, so it is decided before planning.
Also raise: the 10,000-common-passwords check (DESIGN §6) is built in neither app, and once a server
holds a copy, the master password is all that stops offline guessing after a leak, so it should land
before sync goes live.

Then write `docs/strongroom/PHASE-2-PLAN.md` (each phase gets its own plan, DESIGN §3), get the
owner's approval, and build test-first. Likely order: the Worker `tools/vault-api` (D1, endpoints
per §10, pattern of `tools/store-api`) → pure-TS sync client and merge in `packages/strongroom-core`
(see `RecordStore` in `vault.ts` for how storage is injected today; enforce `KDF_FLOOR` and
`kdfInRange` on any header from the server) → the Android client in Kotlin against the same
`vault-vectors.json` → extension wiring. Constraints: confirm which Cloudflare account before any
deploy, use the `cf` CLI unless the project has a Wrangler config; the Android release build gets
`INTERNET` back only in this phase (§6); review the Worker before Phase 2 is called done (§12);
the vault format stays byte-compatible. The extension and the phone hold two separate vaults today;
joining them needs the owner's decision (the extension signs in and replaces its vault, or re-seals
its entries under the phone's key). Then continue from "Current state + exact next step".

## Goal and fixed constraints

- A Chrome (Manifest V3) extension for Strongroom on Mac and Windows: fill and save logins from an
  encrypted vault. All own code; audited primitives only (`@noble/hashes`, WebCrypto), no own crypto.
- The owner asked to build it now, **without waiting for Cloudflare sync**.
- Repo rules (AGENTS.md): `@apps-hub/ui` for all UI (`data-brand="strongroom"`), `node --test` for
  TS, erasable TypeScript with `.ts` import extensions, no telemetry, FOSS dependencies only, new
  dependencies need the owner's approval.
- Anti-goals from DESIGN §4 still hold: no password/key reaching a third party readable, never fill
  a lookalike site, never lose or corrupt the vault.

## Decisions made (with why)

- **Standalone local vault first.** The Android vault can't be read from the extension: no export
  feature (DESIGN non-goal) and the release APK has no INTERNET permission. So the extension creates
  its own vault in the identical format (`packages/strongroom-core`, same `vault-vectors.json` as the
  Kotlin tests). **Consequence:** two separate vaults (different vault keys) until sync exists. Joining
  later = decrypt one vault's entries and re-seal them under the other's key (or the extension signs
  in to the account and replaces its vault). Until then import the Google CSV into both.
- **esbuild 0.28.2** as the only new dev dependency (owner approved 2026-11-04; MIT, build-only;
  `esbuild: false` in `allowBuilds` so its install script never runs). `@noble/hashes` 2.4.0 is
  named in DESIGN §6. No `@types/chrome`: `src/chrome.d.ts` types the few APIs used.
- **No `tldts`:** matching reuses the Android app's `public_suffix_list.dat` (copied into `dist/`),
  with the same private-section rules, so both sides match the same way.
- **All vault logic runs in the service worker** (`service.ts`), key in `chrome.storage.session`
  (memory only, trusted contexts only). The popup and content script are thin.
- **Trust boundary:** the worker treats a sender whose URL starts with `chrome-extension://<id>/` as
  the popup; anything else is a web page context. A page context may only ask `candidates`, `fill`,
  `capture` (service.ts `FROM_PAGE`); `fill` re-checks the login is saved for `sender.url`.
- **Save offers go through the toolbar badge + popup**, not an in-page bar: the master password is
  never typed into a web page, and a locked vault holds the capture (5 min, memory only) until unlock.
- **Cuts (owner can reverse):** cards/notes UI (kept untouched in the vault), change master password,
  new recovery key, clipboard auto-clear, adjustable auto-lock (fixed 5 min), Touch ID, Firefox,
  frames (content script runs in the top frame only), password generator, "Other logins" picker.
- Master password at least 12 characters; KDF default 64 MiB, 3 passes (about 0.5 s in JS).

## Evidence / facts already verified

- `packages/strongroom-core`: 85 tests pass, including every shared vector (Argon2id for ASCII, NFD,
  Urdu and emoji passwords; HKDF; opening values sealed by the Android app; our entry encoding is the
  byte-identical plaintext), the upstream publicsuffix.org cases, and ports of the Kotlin matching,
  CSV and Google-import tests. Mutations (drop NFC, drop the https rule) are caught.
- `apps/strongroom-extension`: 27 service tests; `pnpm typecheck` clean for both packages; `pnpm install --frozen-lockfile` is in sync.
- **Real Chromium, 33/33, three runs in a row** (`pnpm --filter strongroom-extension build && ... test:e2e`): setup and
  recovery key, add/show/edit, fill from the in-page menu, no menu on another host or a lookalike,
  capture on submit → badge → popup offer → save, popup-driven fill, lock/unlock, wrong password,
  import of the Android fixture (9 found, 1 merged, 2 to review), the update offer for a changed
  password, a page that hides the menu cannot get it clicked, browser restart (locked, data intact,
  nothing readable in `chrome.storage.local`), auto-lock alarm set to 5 minutes.
- Harness needs `playwright-core` outside the repo (`~/Documents/browser-automation/node_modules`)
  and the cached Chromium 1228; Playwright 1.62 expects 1234, so `executablePath` is passed.
- The popup is only a real popup in Chrome's toolbar; the e2e loads `popup.html` as a tab, so the
  popup's own active-tab lookup (the "For this site" card and its Fill button) is **not** browser-tested
  (needs a real toolbar click; `activeTab` is in the manifest for it). Also not browser-tested:
  `storage.local` access level `TRUSTED_CONTEXTS` (set in `background.ts`; the worker still reads it).
- **Chrome clears a tab's badge on navigation**, and a sign-in navigates right after the capture, so
  `background.ts` sets the badge again on `tabs.onUpdated` complete. The e2e caught this (it failed
  3 of 3 runs before the fix); a fixed wait had hidden it earlier.
- Playwright quirk: a `type=email` field blocks submit when the username has no `@`; the test page
  uses `novalidate`.

## File map

- `packages/strongroom-core/src/`: `crypto.ts` (Argon2id, HKDF, AES-GCM), `format.ts` (header, wraps,
  sealed entries), `entry.ts`, `vault.ts` (store port, setup/unlock/recover/read/write),
  `recovery-key.ts`, `matching.ts` + `public-suffix.ts`, `csv.ts` + `google-import.ts`.
- `apps/strongroom-extension/src/`: `service.ts` (all logic, tested), `background.ts` (worker glue,
  alarms, trust check), `storage.ts` (chrome.storage adapters), `popup.ts/html/css`, `content.ts`,
  `manifest.json`, `chrome.d.ts`; `build.mjs` (esbuild → `dist/`), `test/e2e.mjs`.

## Session log

- 2026-11-04: found the Android app built and merged (0.1.1) with `vault-vectors.json`; built core,
  extension and docs test-first in a fresh worktree; owner approved esbuild; real-browser check
  30/30; independent security review (`security-engineer` agent, read-only) → 5 findings, fixed
  test-first below; real-browser check now 33/33.
- 2026-11-05: owner asked to install it. Branded Chrome 156 ignores `--load-extension` (removed in
  137), so the owner loads it by hand (`chrome://extensions` → Developer mode → Load unpacked); I
  opened the page and copied the path. Built `dist/` copied to
  `/Users/outsentia/Documents/apps-hub/strongroom-extension-dist` (a snapshot, hidden from git in
  the main checkout via `.git/info/exclude`; recopy after every rebuild). **An unpacked extension's
  ID comes from its folder path and the vault is stored under that ID**, so move the folder and the
  vault is gone: use throwaway logins until it has a permanent path or a manifest `key`. Owner has
  not reported a real-Chrome result yet. Publishing research (web, not re-verified today): Chrome
  Web Store $5 one-time, per account; Edge Add-ons free via Partner Center, and Edge can install
  Chrome Web Store extensions through "Allow extensions from other stores"; Firefox AMO free but
  needs the Firefox build (a cut). Owner then asked for the next-phase prompt: Phase 2 sync.
- 2026-11-05 (new session, Phase 2 start): verified, not assumed. `origin/main` is still `ec23cbd`
  (the branch base), so the merge is clean. `node tools/release/src/changed.ts origin/main` on this
  branch prints no apps: `apps/strongroom` depends only on `@apps-hub/ui` and `strongroom-vault`, not
  on `strongroom-core`, and the extension is not a Store app, so merging releases nothing (CI still
  runs `pnpm test` and `pnpm typecheck`). `strongroom-extension-dist` is byte-identical to
  `apps/strongroom-extension/dist` (`diff -rq`), no source is newer than the build, and every file the
  manifest names exists. No Chrome profile under `~/Library/Application Support/Google/Chrome` has an
  entry for the extension (checked `Preferences` and `Secure Preferences`, path match only), so as far
  as the disk shows it was never loaded: the real-Chrome check is still open. Waiting on the owner for:
  merge/branching, the account key (note: `SHA-256(loginToken)` on the server is a second offline
  guessing check, so the key must be mixed into `masterKey` before the HKDF split), the common-password
  list, and how the extension joins the phone's vault.

## Current state + exact next step

Everything is **uncommitted** in the worktree. All review findings that were confirmed are fixed;
what is left is listed below.

Next: (1) the owner loads the snapshot at `/Users/outsentia/Documents/apps-hub/strongroom-extension-dist`
(or `dist/`) unpacked in Chrome on the Mac, then on Windows (check whether Chrome there warns about
or disables developer-mode extensions, DESIGN §11), and tries the toolbar popup, which the e2e can't
(the "For this site" card and Fill); fix whatever they report; (2) the owner decides on commit/PR;
(3) **Phase 2 sync** is the next phase (the owner asked for it on 2026-11-05): settle the
account-key question (DESIGN §10) and the 10k common-password list, then write
`docs/strongroom/PHASE-2-PLAN.md`; the vault join described under Decisions belongs to it. Firefox
and the other cuts stay after that (Firefox: same code, background `scripts` in the manifest).

### Security review (2026-11-04, independent agent; each claim re-checked against the code)

Fixed, each with a failing test first:
- **High, fill race.** The popup checked the tab's URL, then sent raw credentials to whatever page the
  tab held by click time (an opener page can navigate it). Now the popup sends only
  `{type:'fillForm', id}`; the content script asks the worker for `fill` itself, and the worker checks
  the live `sender.url`. `fill` without a page context is refused (service test + e2e: another site
  gets nothing).
- **Medium, recovery key shown while locked.** An unconfirmed key stayed visible after auto-lock, so
  anyone at the computer could reset the master password. `status` now returns it only while
  unlocked; `confirmRecovery` needs the unlocked vault.
- **Medium, menu clickjacking.** A script on a same-registrable-domain page could hide or cover the
  menu so a real click fills. Menu clicks are now ignored until Intersection Observer v2 reports the
  menu visible (and for its first ~100 ms); e2e covers a page setting `opacity: 0`.
- **Low, forged sign-ins.** Synthetic clicks/keys no longer count as a sign-in (`isTrusted`), and the
  update card names the host. `form.requestSubmit()` still produces a trusted submit event.
- **Low, master-password rule.** One repeated character or a straight run (`abcdefghijkl`) is
  refused, per DESIGN §6.
- Suspicion taken: `chrome.storage.local` is set to `TRUSTED_CONTEXTS` so content scripts can't read
  the header and ciphertext (renderer-exploit offline-guessing).
- Found by the e2e, not the review: the badge race above, and the menu covering the Sign in button
  while typing (menu now hides on input and is not offered on a field that already has a value).

**Not fixed, owner or later decision:**
- **The 10,000-common-passwords list from DESIGN §6 is not built, here or in the Android app** (its
  setup hint says "no other rules"). Needs a vetted list with a licence, added to both.
- Updating a login overwrites the old password with no history (a forged update, or a mistake, can't be
  undone). A password-history field would fix it.
- Passwords captured while locked linger in session memory past the 5-minute limit until the next
  write or lock (filtered on read only); memory-only, extension pages only.
- DESIGN §6's "never accept a header with lower KDF settings" matters once sync exists.
- Dependencies were not audited by the reviewer; `supply-chain-risk-auditor` on `@noble/hashes` and
  `esbuild` is a good next check.
