# Handoff: Strongroom (own-code password manager)

## Resume prompt

Dated 2026-11-01 (fourth session). Work only in the worktree
`/Users/outsentia/Documents/apps-hub/.claude/worktrees/strongroom-phase-1`
(branch `strongroom-phase-1`; enter it with EnterWorktree path). Read
`docs/handoffs/strongroom.md` there completely first, then
`docs/strongroom/DESIGN.md`, then the SDD ledger at
`.superpowers/sdd/PHASE-1-PLAN/progress.md` (its rulings, carries and
deferred minors bind the remaining work). The 12 plan tasks are done; what is
left is the numbered list in "Current state + exact next step". Use
superpowers:subagent-driven-development for code work (implementer and
task-reviewer templates, a review after every change, explicit models) and
ledger every ruling. Trust the decisions, verified facts and ledger and don't
redo that work. Follow the handoff contract in `~/.claude/CLAUDE.md`. Commit on
the branch; never push, merge or release (`pnpm release`) without the owner's
explicit word in this chat; phone installs only via the Store; adb on the
phone only for logcat, screenshots, taps and uiautomator dumps, always with
`-s <phone serial>`; debug builds only on an emulator.

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
- **Owner's phone:** Xiaomi 24116RACCG (`obsidian`), HyperOS 3.0 / Android 16,
  Chrome 156, Gboard, no Firefox. adb serial is the mDNS name
  `adb-49kjmnuwonkffqzh-zHnffO._adb-tls-connect._tcp`. Its Wi-Fi IP changes
  (DHCP; .209 → .94 on 2026-10-31) and wireless adb then drops; `adb connect` to
  the advertised ip:port can time out, so ask the owner to toggle Wireless
  debugging and keep the screen on. FLAG_SECURE blacks out screenshots of
  Strongroom; read its screens with `adb -s <serial> exec-out uiautomator dump
  /dev/tty` and parse the XML (attribute order varies; parse each `<node>`
  into a dict). The dump shows vault rows (names, usernames), so read only
  what a check needs.
- **Autofill debugging on the phone:** `cmd autofill set log_level verbose`
  (resets on reboot), `logcat -c`, reproduce, then `logcat -d | grep -i
  autofill`; `dumpsys autofill` shows the request history incl. `aug:`
  (augmented) sessions.
- **Test pages for Chrome:** the auto-mode classifier blocks serving on the LAN
  (`0.0.0.0:80`). Serve on the Mac's loopback (`python3 -m http.server 8080
  --bind 127.0.0.1` from a scratch dir) and tunnel with `adb -s <serial>
  reverse tcp:80 tcp:8080`; the phone opens `http://localhost/…`, and
  `http://127.0.0.1/…` works as a second origin for frame tests. Chrome's
  `webDomain` has no port; frame fields carry the frame's own domain.
- **Releases:** run `pnpm release strongroom` from this worktree (main's
  `tools/release/src/apps.ts` has no `strongroom` entry). The classifier blocks
  it as a production deploy unless the owner has said to release in the chat.
  The release APK is 73.6 MB (four ABIs: `reactNativeArchitectures` in
  `apps/strongroom/android/gradle.properties`, same in every app). The Store
  downloads with a 15 s connect / 60 s read timeout
  (`apps/store/modules/store-installer/.../Installer.kt:48-49`), and Play
  Protect's "Scan app" prompt must be answered within ~17 s. A GET of the live
  manifest with the release token returned 403 on 2026-10-31 (not explained).
- **Emulators:** `emulator-5554` (`apps-hub-test`) is shared with another
  session that drove it during Task 12; Strongroom has its own AVD
  `strongroom-task12` (emulator-5556, same image).
- **Sandbox:** compound shell commands that mix adb with variables, pipes into
  other interpreters, or globbed URLs get refused as unverifiable; split them
  into plain commands and quote URLs.

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
- 2026-10-31: Strongroom 0.1.0 (versionCode 2) published to the Store with
  `pnpm release strongroom`. Not yet installed: the owner was using the phone,
  so no taps were sent. Install from the Store app (or hand the screen over and
  the controller taps through it). The Store app itself wasn't re-released.
- 2026-10-31 ~15:33 phone time: installed on the owner's phone (Xiaomi
  24116RACCG, HyperOS 3.0 / Android 16) through the Store: versionCode 2,
  `installerPackageName=initiatingPackageName=com.haroon.store`. The Store
  download was 74 MB; Play Protect showed "App scan recommended" with the new
  icon rendering correctly. The phone's `autofill_service` is already
  `com.haroon.strongroom/…StrongroomAutofillService`. Wireless adb dropped
  mid-install and came back on a new port (the serial in `adb devices` is the
  mDNS name `adb-49kjmnuwonkffqzh-zHnffO._adb-tls-connect._tcp`; always pin it
  with `-s`). The checklist items above are still to do.
- 2026-10-31 ~15:45 phone time, first checks (controller driving over wireless
  adb; the owner had already set up the vault, imported Google logins and
  unlocked by fingerprint):
  - Settings → Checks: **Chrome: Recognised** (Chrome 156.0.8078.47; no
    Firefox installed). "Last unlock: Not timed yet" because only a
    master-password unlock is timed (the owner unlocked by fingerprint), so
    the 1–2 s check still needs a master-password unlock.
  - Chrome's own setting "Autofill service provider" is already "Autofill
    using another service" (Chrome → Settings → Autofill and passwords →
    Autofill settings), and the phone's `autofill_service` is Strongroom.
  - Added a throwaway login **`sg-test-lan`** (username `sg-test-user`, site
    `http://192.168.18.242`) to the owner's vault for the fill test.
    **DELETE IT when the tests end.** Test pages were served from the Mac
    (`login.html`; `frame.html` with a cross-origin iframe on
    `192-168-18-242.nip.io`), server stopped now; recreate from the scratchpad
    or rewrite them (a username + password form, autocomplete attributes set).
  - Chrome fill, first try: tapping the Username field on
    `http://192.168.18.242/login.html` (landscape, Gboard) showed **no
    Strongroom suggestion** after 3 s. Not diagnosed yet: next, verbose
    autofill logging (`cmd autofill set log_level verbose`), retry in
    portrait with a longer wait, and check whether the unlock/locked state or
    the 5 s cold-start limit explains it.
  - Wireless adb dropped twice (once mid-install, once here); the phone
    answers ping but stops advertising. A reconnect needs Wireless debugging
    toggled off/on.
- 2026-10-31 ~16:00 phone time, second round (portrait; the phone's IP had
  changed .209 → .94, which explains the drops; the test server now runs on the
  Mac's loopback only (`python3 -m http.server 8080 --bind 127.0.0.1`) and the
  phone reaches it through `adb -s <phone> reverse tcp:80 tcp:8080` as
  `http://localhost/…`; the auto-mode classifier blocked serving it on the LAN):
  - **Chrome fill works** (vault unlocked): `login.html` on `localhost`, tap
    Username → inline suggestions "sg-test-user · localhost" and "Other
    logins"; tapping the login filled the username and the 17-character
    password. Chrome's `webDomain` carries no port and the page scheme matched
    an `http://` login.
  - **S1 PASS (the blocker):** with the login saved for `localhost` and a
    cross-origin frame on `127.0.0.1`, the frame's fields got no suggestion; with
    the login re-pointed to `127.0.0.1`, the frame's fields offered it (its own
    origin) and the top page (`localhost`) offered nothing from it. So Chrome
    marks frame nodes with their own domain and the top page's login never
    enters the frame.
  - **NEW BUG (open): no answer when no login matches.** On pages with no
    matching login the strip shows nothing, not even "Other logins". The log
    (`logcat`, verbose autofill) shows `finishing session due to service
    timeout`: fill request sent 16:00:00.962, timed out 16:00:05.968
    (`mLatencyFillResponseReceivedMillis=5026`). Matching cases answered in
    time. `Presenter` is non-blocking and the wrapper in
    `StrongroomAutofillService.onFillRequest` catches only `Exception`, so an
    `Error` in the worker thread would look identical (thread dies, no
    callback). Needs a device repro with timing logs (or a JVM test with a
    vault of a few hundred logins and a non-matching requester): suspect
    `Matching.matches` over all entries (the owner imported hundreds) when none
    matches, or a first-use cost; also make the wrapper catch `Throwable`
    and always call the callback.
  - **Augmented autofill sessions on the real phone:** `dumpsys autofill`
    request history shows repeated `aug:` sessions (Google's
    `AiAiAugmentedAutofillService`, Android System Intelligence) on
    `com.haroon.strongroom/.MainActivity` from 15:13 to 15:54 while the
    owner and the controller used the app's own screens. Task 12 verdict 3
    only reasoned about password-type fields; the Add form (name, username,
    Show secrets, search) and revealed passwords (visible-password input) are
    other fields. Decide whether to build the native secret field
    (`getAutofillType() = AUTOFILL_TYPE_NONE`) plus
    `importantForAutofill="noExcludeDescendants"` fixes before wider use.
  - Still to do: S2 (does Chrome set `webScheme`: needs an https page, e.g.
    save a login for `https://the-internet.herokuapp.com` and open its
    `/login`), card fill asks for the fingerprint, save/update prompts, the
    master-password unlock time ("Last unlock" still said "Not timed yet"
    after the owner unlocked, perhaps by fingerprint), Deputy's view, S4/S5,
    U1, U2. The throwaway `sg-test-lan` login is still in the vault (site now
    `http://127.0.0.1`): **delete it at the end**. Verbose autofill logging is
    on (`cmd autofill set log_level verbose`, resets on reboot).

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

**Exact next step (updated 2026-11-01):** Tasks 1–12 (Steps 1–3, 5) are
done and reviewed; 0.1.0 (2) is installed on the phone via the Store; Chrome
fill and the S1 frame check pass on the phone. Open work, in order:
1. **Fix the no-match fill timeout** (phone results above): with no matching
   login Strongroom misses Android's 5 s limit, so "Other logins" never shows.
   Reproduce in a JVM test (a vault of a few hundred logins, a non-matching
   `Web` requester, time `respond`'s matching loop), fix the slow path, and
   make `onFillRequest` catch `Throwable` and always call the callback.
2. **Smaller APK** (owner asked; awaiting go-ahead): the release APK is 73.6
   MB because it ships four ABIs; the Store's download stalls and hits its
   60 s read timeout (`apps/store/.../Installer.kt:49`) on the owner's phone.
   Build Strongroom's release for `arm64-v8a` only (~20 MB), keeping x86_64
   for emulator debug builds. Releases run from this worktree, not the main
   checkout (main's `tools/release/src/apps.ts` has no `strongroom`).
3. **Owner decision: native secret field.** Google's autofill (emulator) and
   Android System Intelligence's augmented autofill (phone, `dumpsys autofill`
   `aug:` sessions) open sessions on Strongroom's own screens despite the
   exclusion flags. Fix: a native `EditText` with `getAutofillType() =
   AUTOFILL_TYPE_NONE` for every secret input, `UnlockActivity`'s included.
4. **Rest of the phone checklist:** S2 (https page), card fill asks for the
   fingerprint, save/update prompts, the master-password unlock time, B5
   (Deputy's view), S4/S5, U1, U2, the two-step save. Then delete the
   `sg-test-lan` test login, and the owner switches autofill back to Google.
5. **Final whole-branch review** (opus) over the ledger's deferred minors and
   "carry to final review" lines; one fix wave; then
   superpowers:finishing-a-development-branch (never merge or push without the
   owner's word: CI releases registered apps on main).
6. **Owner items before Phase 2:** the account-key question (§10); Deputy
   refusing to operate Strongroom; card import (only if a Google Pay/Takeout
   export holds full card numbers; owner checks first).
Implementers so far: sonnet for Tasks 2–8 and 11, opus for Tasks 9–10 and
12; reviewers opus for crypto/format/session/matching/platform, sonnet
otherwise.
