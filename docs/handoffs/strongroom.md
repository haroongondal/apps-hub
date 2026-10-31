# Handoff: Strongroom (own-code password manager)

## Resume prompt

Dated 2026-10-30 (second session). Work only in the worktree
`/Users/outsentia/Documents/apps-hub/.claude/worktrees/strongroom-phase-1`
(branch `strongroom-phase-1`; enter it with EnterWorktree path). Read
`docs/handoffs/strongroom.md` there completely first, then
`docs/strongroom/DESIGN.md`, then the SDD ledger at
`.superpowers/sdd/PHASE-1-PLAN/progress.md` (its rulings, carries and
deferred minors bind later tasks), and continue executing
`docs/strongroom/PHASE-1-PLAN.md` with superpowers:subagent-driven-development
(implementer and task-reviewer templates, a review after every task, explicit
models). Trust the decisions, verified facts and ledger and don't redo that
work. Follow the handoff contract in `~/.claude/CLAUDE.md`. Read "Current state
+ exact next step" before doing anything, then continue from it. Commit per
task on the branch; never push, merge or release without the owner's word;
phone installs only via the Store; debug runs on the emulator only, and the
owner's phone is attached over adb, so always target `-s emulator-5554`.

## Goal and fixed constraints

- Personal password manager replacing Google Password Manager, **all the
  owner's own code** (self-hosted Vaultwarden/Bitwarden or KeePass apps were
  offered and declined).
- Android first (apps + Chrome on the phone), then Cloudflare sync, then a Chrome
  extension on the Mac, then Firefox. iPhone + Safari deferred: no paid Apple
  developer account.
- Repo rules (AGENTS.md): Expo SDK 54 / RN 0.81.5, `@apps-hub/ui` for all UI,
  native code in Expo local modules, `node --test` for TS, Gradle JVM tests for
  Kotlin, no telemetry, FOSS dependencies only.
- Install on the phone only through the private Store (memory: install-via-store-only).

## Decisions made (with why)

Owner's answers, 2026-10-29:
- **Why:** all four reasons at once: a company could read the passwords, a breach
  could leak them, a locked account could lose them, and they want to own it.
- **Build scope:** all own code.
- **Sync:** the owner's own Cloudflare account, ciphertext only.
- **Apple:** not now; keep the design open for iPhone/Safari.
- **First:** Android phone end to end.
- **Import:** yes, from a Google Password Manager export.
- **Forgotten master password:** recovery key shown once at setup.
- **Contents:** logins, cards, secure notes. No 2FA codes.
- **Mockups:** accepted ("go ahead") after viewing the Android fill/save/vault mockups.
- **Locked fill:** show the matching login while locked, via a Keystore-encrypted
  match index of sites/apps/usernames (passwords stay locked). Chosen over a
  generic "Unlock" chip.
- **Backup gap:** Phase 1 is testing only. Google stays the daily autofill
  service until Phase 2 sync runs. No backup-file feature.
- **Windows (2026-10-30):** owner also uses Chrome on Windows. Phase 3's Chrome
  extension covers Mac and Windows; no desktop app (Chrome only lets extensions
  fill pages).
- Builder-check points adopted as Claude's calls: webDomain trusted only from
  allowlisted browsers, revealed passwords hidden from accessibility services,
  sync token in a no-auth Keystore key (download-only while locked), base-rev
  409 on stale uploads, owner-run redaction script for the import fixture.

Claude's calls (marked in DESIGN.md, owner can override): name "Strongroom",
`com.haroon.strongroom`, Kotlin owns the vault, minSdk 33, AES-256-GCM + Argon2id
+ HKDF, D1 for the Worker, 5-minute auto-lock, master password ≥ 12 chars,
no password generator / CSV export / card saving in v1.

## Evidence / facts already verified

- `tools/store-api` is the Worker pattern to copy: `cf` CLI,
  `cloudflare.config.ts` with the personal account id, secrets in `.dev.vars`,
  `safeEqual` for constant-time token compare.
- Apps register for release in `tools/release/src/apps.ts`.
- Deputy sets `android.minSdkVersion=33` in `apps/deputy/android/gradle.properties`.
- No crypto dependency exists in the repo yet.
- Task 12, on the emulator's ART (API 35), running the debug APK's own classes through `app_process`:
  Android's ICU-backed `java.net.IDN` gives `bücher.de` ↔ `xn--bcher-kva.de`, and `Matching`
  matches them both ways (`ß` still matches nothing). AndroidKeyStore throws
  `AEADBadTagException` (cause `android.security.KeyStoreException`) for a bad GCM tag.
- Android 15 Google image: `device_config` autofill has `trigger_fill_request_on_unimportant_view=true`
  and `include_all_autofill_type_not_none_views_in_assist_structure=true`, so the system opens
  autofill sessions for Strongroom's own password-type fields despite `importantForAutofill="no"`
  and the content view's `NO_EXCLUDE_DESCENDANTS` (seen in verbose autofill logs).

## File map

- `docs/strongroom/DESIGN.md`: the design.
- `docs/strongroom/PHASE-1-PLAN.md`: Phase 1 plan, 12 tasks (Task 1 = threat-model gate).
- `.superpowers/brainstorm/6147-1793289451/content/android-flows.html`: mockups (git-ignored).
- `apps/strongroom/tools/disk-check.sh <username> <password> [serial]`: debug-build
  on-disk scan (plain, UTF-16, Base64); serial defaults to `emulator-5554`.
- `.superpowers/sdd/PHASE-1-PLAN/`: SDD ledger (`progress.md`), Task 1 rulings,
  report and review (git-ignored scratch; the git log is the durable record).

## Session log

- 2026-10-29: brainstorming session; design written; builder check run; owner
  answered its two questions; DESIGN.md updated.
- 2026-10-30: Windows added to Phase 3 (same Chrome extension); design approved;
  Phase 1 plan written and self-reviewed. Owner chose subagent-driven execution.
  Worktree created (another session owns the main checkout on deputy-speed).
  Baseline `pnpm test` exit 0 (181 pass). Task 1: security-engineer threat model
  (17 findings, 0C/5H/5M/7L) → rulings in `.superpowers/sdd/PHASE-1-PLAN/task-1-rulings.md`
  → folded into DESIGN.md + plan (commit 5879adb) → review: 1 Important + 11
  Minor → fix round 1 (20b52ef) → re-review clean. Task 1 complete.
- 2026-10-30 (cont.): Task 2 scaffold (fcdc2ab: bcprov 1.86, biometric 1.1.0,
  autofill 1.3.0). Task 3 crypto (aefc01d + 51da896: KDF ceiling now also
  t ≤ 16, p ≤ 4; password bytes encode lone surrogates as U+FFFD like
  TextEncoder). Task 4 vault format + `vault-vectors.json` (c983a25 + ed7ba1b;
  reviewer recomputed every vector in Python and Node). Task 5 vault session
  (0d55a75 + 6a0bb2d + 8f288d0: a sealed `key-check` tombstone lets a
  biometric key be verified; header writes compare keys first). Task 6
  matching (69b67c0 + 8157955: PSL, test_psl and Chrome/Firefox digests match
  fresh downloads; fails closed on IDNA deviation characters and odd schemes).
  Task 7 import (f02537f + 9b73d29: unlinked logins keyed by raw URL/name,
  rows wider than the header refused, redaction script has a node test;
  the owner's real export is still needed for Step 0). Task 8 form detection
  (aad67dc + ce4aac2: ranked password signals, bounded keyword). Task 9
  Android adapters + JS bridge (6724726; emulator: setup/unlock/lock, Chrome
  trusted, fingerprint and reboot rules, no plaintext in db or index) in
  review. Rulings and deferred minors are in the ledger.
- 2026-10-30: Task 10 autofill service + UnlockActivity (8142517). **Task 10
  emulator results** (API 35, `apps-hub-test`; app checks used a throwaway
  native login app built in the scratchpad):
  - Works: app fill unlocked and locked (match index, then master password or
    fingerprint); `FLAG_IMMUTABLE` auth intents complete every fill (S6, no
    mutable intent needed); Other logins: Fill once stores no link, Always use
    here does; Save after sign-up, Update after a password change, locked save
    held in `pending.bin` and applied at the next unlock; card fill asks for
    the master password or fingerprint even when unlocked, and the locked
    "Unlock to fill a card" path; no "Save to Google" offer for the master
    password with Google selected; 30 s clipboard clear works with the app in
    the background (toast unchanged).
  - Needed `QUERY_ALL_PACKAGES`: without it package visibility hid every
    requesting app's certificate (`AppsFilter ... BLOCKED`), so nothing filled.
  - **Chrome not checked:** the emulator has Chrome 124 (third-party autofill
    starts at 131) and no Play Store. S1 frames, S2 `webScheme`, the port in
    `webDomain` and a checkout-page card fill in Chrome move to the phone
    (Task 12).
  - Firefox 158.0.2 (official Mozilla build, signer matches the allowlist)
    stood in: it sets `webScheme` (`http`), its `webDomain` has **no port**
    (`10.0.2.2` for `10.0.2.2:8000`), so a login linked to an IP address fills
    on any port of that IP (owner to know). A cross-origin iframe is reported
    under the frame's own origin (`localhost`), so the top page's login wasn't
    offered there. Firefox sends no card forms to autofill services.
  - Owner/Task 11–12 notes: right after a reinstall `autofillSelected` reads
    false until any autofill session runs (system NPE in `isServiceEnabled`);
    with the Strongroom process dead, the first fill can miss the system's 5 s
    timeout (debug build; recheck with release on the phone); an
    augmented-autofill-only session still opens on UnlockActivity's password
    field (it showed nothing).
  - Emulator state left: PIN 1234 + one enrolled fingerprint, Firefox and
    `com.example.logintest` installed, a fresh test vault (master password in
    the Task 9 check button), Google as the autofill service again.
- 2026-10-30 (third session): Task 10 review (0C/1I/10M) → fix round 1
  (249682b: sideload warning is now an allowlist of known stores in
  `LinkPrompt.installedFromFile`; requester domain comes from the target
  fields via `FormDetector.origin`; "Other logins" keeps an inline slot) →
  re-review clean. Task 10 complete. Chrome checks (S1 frames as a blocker,
  S2, port, card checkout, HyperOS installer name, inline cap) carried to
  Task 12 in the ledger.
- 2026-10-31: Task 11 screens (022867b) → review (0C/2I/10M) → fix round 1
  (8c9413b: Settings sub-flows are routes with no tab bar, Back and tabs
  ignored during a derivation; a native `onLock` event clears revealed values
  and drafts on auto-lock; `messageOf` pinned to expo-modules-core 3.0.30's
  real rejection format) → re-review clean. Task 11 complete. Incident: the
  implementer's first Metro start (`--android=false`) began fetching Expo Go
  for the phone; killed in seconds, nothing installed. Later dispatches pin
  `ANDROID_SERIAL=emulator-5554` and start Metro with no platform flags.
- 2026-10-31: Task 12 Steps 1–3 (Step 4 waits for the owner). Step 1:
  security-engineer review (0C/0H/1M/1L, 4 unconfirmed; findings and rulings in
  `.superpowers/sdd/PHASE-1-PLAN/task-12-security-findings.md`) → fixes 411bd51:
  F1 an http page is refused, never filled or linked, for a login saved for the
  same site over https; F2 `dataExtractionRules` (committed prebuild only); U1
  the unlock screen touches the vault only on the owner's taps; U3 Urdu and emoji
  derivation vectors from argon2-cffi, plus a non-blocking keyboard notice for a
  non-ASCII master password; U4 hidden nodes are skipped. **Task 12 emulator results:**
  - Another session drove emulator-5554 from 13:05 (it installed
    `dev.spike.clipprobe`, typed into Strongroom's setup field), so the UI
    checks ran on a dedicated AVD `strongroom-task12` (emulator-5556, same
    android-35 google_apis image; PIN 1234, Firefox 158, `com.example.logintest`,
    a test vault). emulator-5554 itself went down at about 13:23, not stopped
    by this session.
  - `disk-check.sh disk-check-user Disk-Check-Pass-7731 emulator-5556`, with the
    vault locked and one pending save: `0 hits in 21 files`, exit 0. Same for
    the master password and a recovery-key group. Positive controls planted in
    `files/` (plain, UTF-16LE, Base64 at an offset) each hit, exit 1.
  - Fresh install, Google as the autofill service, setup then Add: no save UI
    in any session (`mSaveUiShownReason=0`, `mSaveInfoCount=-1`). That proves
    little: the emulator has no Google account, and Android 15 still sent
    Google a FillRequest (`FLAG_PASSWORD_INPUT_TYPE`) for the recovery-key group
    field and tracked its 4 typed characters (flags in the verified facts).
    Phone check added below.
  - IDN on Android's ICU: passes (verified facts). Keystore bad tag:
    `AEADBadTagException`. Lock mid-unlock: Enter and the screen lock sent
    together; the unlock finished with `deviceLocked=1`, `pending.bin` stayed
    untouched, `index.bin` was deleted (`refreshIndex` fails closed); the next
    unlock applied the save (password 7731 → 7732), no lost save.
  - U1: launched on a locked vault, the unlock screen shows the password form,
    then the list after unlock. The 1-minute timing check couldn't run there
    (Gboard drops into its hardware-keyboard toolbar after adb key events and
    hides suggestions): phone check below.
  - U4: Firefox fills the password on a plain http login page. The filter only
    skips Firefox's own GONE chrome stubs (an A/B build logged them; no web
    input is skipped). **The username field isn't detected** on that page with
    or without U4 (datasets target only the password field): existing
    behaviour, for the final review.
  - Step 3: `pnpm test` exit 0 (204 pass), `pnpm typecheck` exit 0, Gradle
    254 JVM tests / 0 failures + `:app:assembleDebug`. Release APK: no
    `android.permission.INTERNET`; `dataExtractionRules=@xml/data_extraction_rules`,
    and the rules XML is in the APK.

**The owner's phone is attached over wifi adb.** Every adb/expo command must
target the emulator explicitly (`-s emulator-5554`). After Task 12, emulator-5554's
Strongroom has no vault (`pm clear`), its autofill service is Google and verbose
autofill logging is on; the dev-server override to port 8082 is restored (another
session's Metro holds 8081). To put Strongroom back: `adb -s emulator-5554 shell
settings put secure autofill_service com.haroon.strongroom/expo.modules.strongroomvault.android.StrongroomAutofillService`.

Debug runs use the AVD `apps-hub-test` (android-35 google_apis arm64):
`~/Library/Android/sdk/emulator/emulator -avd apps-hub-test`. Gradle builds
keep `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`.

## Task 12 Step 4: the owner's phone checklist (record each result here)

Only with the owner's go-ahead: `pnpm release strongroom`, install from the
Store (never `adb install`). Phone: Android 16, HyperOS.

Settings → Checks:
- Unlock time is 1–2 s. If not, change `KdfParams.DEFAULT` (m 32768–131072 KiB,
  t 2–6, never below `KdfParams.FLOOR`), update the vectors note, release again.
  The header stores the params, so an existing vault keeps working.
- Chrome (and Firefox if installed) shows "Recognised".

Fill, save and platform:
- Chrome 131+ with "use another autofill service" on: fill on a site.
  - **S1 (blocker):** a login form inside a cross-origin iframe gets no
    top-page login. `StructureReader` gives each field its nearest ancestor's
    `webDomain`, so Chrome must mark frame nodes with their own domain. If it
    reports a domain only on the root, web fill in Chrome can't ship.
  - S2: does Chrome set `webScheme`? (Without it, https logins never fill.)
  - Does `webDomain` carry a port? (Firefox's doesn't, so an IP-address login
    fills on any port of that IP.)
  - A checkout-page card fill asks for the fingerprint even when unlocked.
- First fill with a cold Strongroom process lands within Android's 5 s limit (release build).
- `autofillSelected` right after the Store install (on the emulator it reads
  false until an autofill session runs).
- What `getInstallSourceInfo` reports for an APK sideloaded on HyperOS
  (allowlist: Play, com.haroon.store, F-Droid, Xiaomi GetApps).
- Gboard's inline suggestion cap: with more matching logins than the cap,
  "Other logins" stays visible (reserved last slot).
- B5: Deputy's tree dump of Strongroom's main screen with a password shown,
  and of the unlock screen, is empty.
- S6: the `FLAG_IMMUTABLE` authentication intents complete a fill.
- S4: after Show and after typing the master password, the keyboard doesn't
  suggest the password back.
- S5: after Copy, the keyboard's clipboard history doesn't show the password.
  If it does, say so in the copy toast.
- U2: remove and re-add the screen lock, unlock Strongroom, and confirm locked
  suggestions come back.
- From Task 12 Step 2 (the emulator couldn't settle these):
  - With Google as the autofill service and a signed-in Google account: setup
    (or Settings → Change master password) and Add never offer "Save to
    Google". Android 15+ sends Strongroom's password fields to the autofill
    service despite the exclusion flags, and the emulator had no account.
  - U1: auto-lock 1 minute, unlock, wait 40 s, open "Other logins" in an app
    and cancel, wait 35 s more, open it again: it must ask for the master password.
  - Firefox: on a normal login page, the username fills as well as the
    password (on the emulator only the password filled).
  - A save on a two-step login page with a hidden username input still
    updates the existing login rather than creating a new one (U4 skips
    non-VISIBLE nodes, so a browser that marks that input hidden drops the username).

Then walk through DESIGN §13 together and record pass/fail for each line. No
fixture apps exist for the §13 matching lines about a different-signature app
(no suggestion, can't be linked) or a non-browser app's WebView: record those as
JVM-only, covered by `MatchingTest` (`appNeedsPackageAndCert`,
`webDomainFromNonBrowserIsIgnored`) and `LinkPromptTest`
(`linkRefusedForSamePackageOtherCert`). Tell the owner the items in the next
section. Afterwards the owner switches autofill and Chrome back to Google.

Phone results (fill in as they come):
- (none yet)

## Owner items to raise at the end of Phase 1 (from Task 1)

- Before Phase 2: decide whether to add an account key (a second secret typed
  once per new device). It protects the server copy if the password leaks (A4).
- "Other logins" defaults to Fill once. "Always use here" is a separate button
  (A1/A2). Every card fill asks for the fingerprint (B10).
- Deputy should refuse to operate Strongroom (B5). That's a Deputy change,
  outside this plan.
- Mi Browser (HyperOS) isn't on the browser allowlist, so it only gets
  domain-scoped links.

## Current state + exact next step

DESIGN.md and PHASE-1-PLAN.md approved (2026-10-30). The owner chose
**subagent-driven** execution (superpowers:subagent-driven-development). The
redacted Google export comes later, so Task 7 uses a hand-made fixture until then.

Work happens in the **worktree**
`/Users/outsentia/Documents/apps-hub/.claude/worktrees/strongroom-phase-1`
(branch `strongroom-phase-1`, from main `6daca33`). Another session works on
`deputy-speed` in the main checkout, so never switch branches there. The
untracked copies of these docs in the main checkout are stale. This worktree's
copies are the source of truth.

SDD ledger (task progress, rulings, deferred minors):
`.superpowers/sdd/PHASE-1-PLAN/progress.md` in the worktree. Trust it and
`git log` over memory. Phone installs only via the Store (release builds);
debug work uses the emulator.

**Exact next step:** Tasks 1–11 and Task 12 Steps 1–3 and 5 are complete
(Task 12 re-review clean; commits up to 036eff7, plus the launcher icon
142fc7c). The owner asked on 2026-10-31 to test on the phone instead of the
emulator, which is the go-ahead for Step 4: `pnpm release store` (so the Store
lists Strongroom; the branch differs from main only by that `<queries>` line),
then `pnpm release strongroom`, then the owner installs from the Store (never
`adb install`; adb on the phone only for logcat, screenshots and taps). Walk
the phone checklist above with the owner and record each result there. Before
typing the master password the owner sets the phone's autofill service to
Strongroom (or None): Android 15 sent Strongroom's own password-type fields
to Google autofill on the emulator despite the exclusion flags. If the phone
shows Google offering to save any Strongroom secret, build the native secret
field next (an `EditText` whose `getAutofillType()` is `AUTOFILL_TYPE_NONE`,
for every secret input including `UnlockActivity`'s). Fix whatever the phone
shows, then the final whole-branch review (opus), pointed at the ledger's
deferred minors and "carry to final review" lines. Then
superpowers:finishing-a-development-branch: never merge or push without the
owner's word (CI releases registered apps on main). Implementers so far:
sonnet for Tasks 2–8 and 11, opus for Tasks 9–10 and 12; reviewers opus for
crypto/format/session/matching/platform, sonnet otherwise.
