# Inflow handoff (formerly Notebox)

## Resume prompt (2026-11-17, late: items 1-4 built and on the phone as a test build; item 5 designed, not planned)

```
Continue the Inflow work (Android app com.haroon.inflow, apps/inflow), resume prompt dated 2026-11-17 (late).
The owner's 5-item list: items 1-4 are BUILT, reviewed and installed on the phone as a test build; item 5 (UX rework
+ quieter SMS) is DESIGNED and APPROVED but has no plan yet.

Work only in the worktree /Users/outsentia/Documents/apps-hub-wt/inflow (branch inflow/post-release, not pushed; it is
2 commits behind origin/main), never in the main checkout /Users/outsentia/Documents/apps-hub. Claim the worktree with
coord first (~/.claude/plugins/cache/claude-agent-workflow/coord/1.0.0/bin/coord claim <folder>) and release it when you
stop. Agent work: cd-engineering-tools:parallel-agents-coord, never superpowers:subagent-driven-development.

1. Read docs/handoffs/inflow.md completely first, then progress.md (ledger of the reports plan, rulings R47-R51) and
   the tail of progress-stage-4b.md (entries 52-56: items 1-2 and the item 3/4 design). Trust the decisions and
   verified facts; do not redo reviews, fix waves or designs already done; do not re-ask what the owner settled.
2. NEXT: write the item 5 plan from docs/superpowers/specs/2026-11-17-inflow-ux-design.md (approved), using
   superpowers:writing-plans; show it to the owner; on their OK build it with parallel-agents-coord (one Kotlin agent,
   one TS agent, disjoint files as in docs/superpowers/plans/2026-11-17-inflow-reports.md), then one opus review, one
   fix agent, a scoped re-review, the gates, and a phone test.
3. GATES: from the worktree root `pnpm test` and `pnpm typecheck`; from apps/inflow/android
   `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
   ./gradlew :inflow-core:testDebugUnitTest :app:assembleDebug :app:processReleaseMainManifest` (386 tests at 3e15ed3; the
   fresh merged release manifest is app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml,
   NOT the older merged_manifests/... file; expected permissions: READ_SMS, RECEIVE_SMS, INTERNET, POST_NOTIFICATIONS,
   USE_BIOMETRIC, USE_FINGERPRINT, DYNAMIC_RECEIVER).
4. PHONE: only `adb -s adb-49kjmnuwonkffqzh-zHnffO._adb-tls-connect._tcp` (emulator-5556 is another session's; never adb
   kill-server). Claim device:49kjmnuwonkffqzh with coord; other sessions queue for it (hand it over while you wait,
   ask for it back). The owner unlocks Inflow (fingerprint) and types names/keys; screenshots of secure screens are black.
   The phone now runs the STORE-SIGNED Inflow (release key e3af4a92...317d; the owner reinstalled from the Store on
   2026-11-16 23:13, which wiped the old debug-build data). Debug-signed builds can NOT be installed any more. The owner
   allowed adb TEST installs (2026-11-17): build `NODE_ENV=production ./gradlew :app:assembleRelease` with versionCode 2
   (temporarily `versionCode 2` in apps/inflow/android/app/build.gradle, then put back 1; never commit it), re-sign with
   `apksigner sign --ks <APPS_HUB_RELEASE_STORE_FILE> --ks-key-alias <APPS_HUB_RELEASE_KEY_ALIAS> --ks-pass env:SP
   --key-pass env:KP` reading the values from ~/.gradle/gradle.properties without printing them, verify the cert is
   e3af4a92 and versionCode 2, then `adb install -r` (keeps data; installer becomes null). Keep versionCode 2 so the next
   Store release (versionCode 3) is still an update. After an install check `dumpsys notification` for a live
   InflowListener and logcat for "Reject service" (HyperOS Autostart).
5. RELEASE only on the owner's explicit go: merge origin/main into the branch, push, PR to main, squash merge with
   "[skip ci]", then from a clean worktree of the merged commit `NODE_ENV=production pnpm release inflow -m "<plain words>"`
   (versionCode 3). The owner has not asked for a release yet (they may want items 1-5 in one release).
6. Open on the phone (owner): Settings > Your name may be empty after the Store reinstall (own NayaPay transfer counted
   as spending): it must be the full name as the bank writes it ("Haroon Mukhtar"). Categorising old transactions runs in
   the background (100 per batch, 5 batches per 30-min tick). Not yet tried: Make a report now, the notification
   permission prompt and a tapped notification, the SMS/Gmail contact lists (SMS unreachable from Home until item 5).
7. Keep this handoff and progress.md current; at ~85% context stop and rewrite this prompt. No Claude attribution lines.
   Never push, merge or release without the owner's go.
```

## Goal and fixed constraints

Build Inflow (`apps/inflow`, `com.haroon.inflow`, Store id `inflow`): a private
Android app that saves every notification, imports SMS, downloads marked Gmail
emails, builds a spending ledger from bank messages, runs AI over new items in
30-minute batches, and organises it all. Full design and every owner decision:
`docs/superpowers/specs/2026-11-13-inflow-design.md`.

Fixed:
- Five stages, each planned, built, released through the private Store and tested
  on the owner's phone before the next starts (owner's request). Order: 1 capture
  and browse, 2 SMS and money, 3 Gmail, 4 AI, 5 rules.
- Repo rules in AGENTS.md / CLAUDE.md apply: Kotlin owns capture, storage, parsing,
  Gmail and AI; RN only renders with `@apps-hub/ui` (new `inflow` brand); no
  proprietary SDKs or telemetry.
- Never adb-install on the owner's phone; install via the Store. Release only on the
  owner's go (memory: release-by-local-command). Claim `device:<serial>` with coord
  before touching the phone.
- No Claude attribution lines in commits or PRs (memory: no-claude-attribution).
- Multi-agent execution: use `cd-engineering-tools:parallel-agents-coord` (and
  `cd-engineering-tools:phased-orchestration` if a stage outgrows one context),
  never `superpowers:subagent-driven-development`. If a plan template names it,
  substitute and say so.

## Decisions made (with why)

All are in the design under "What the owner decided" and "Calls I made". The ones
most likely to be second-guessed:
- AI via API like Deputy, not on-device (owner said so).
- Gmail only, via app password over IMAP; Google sign-in rejected (unverified private
  app is signed out every 7 days).
- Home screen is "summary first" (owner picked option C from three mockups).
- Everything is in version one but built in stages (owner first said "biggest
  version", then agreed it must be staged).
- AI runs on every notification not blocked, batched every 30 min, one request for
  all pending; original text never changed.
- Builder-check answers (my calls): OTP items deleted entirely with a hash tombstone;
  own transfers matched by name and by out/in pairing within 30 min; duplicates merge
  only across channels, transaction ID wins.

## Evidence / facts already verified

- Deputy's AI plumbing to reuse: `LlmProvider` / `OpenAiCompatProvider`
  (`apps/deputy/modules/deputy-agent/android/.../core/Provider.kt`), `KeyVault`
  (Keystore AES-GCM, `.../android/KeyVault.kt`), `Settings.KNOWN` model list, key UI in
  `apps/deputy/src/SettingsScreen.tsx` (`KeyPanel`, includes the free-tier Gemini
  warning).
- Strongroom already uses `androidx.biometric:biometric:1.1.0` (fingerprint lock) and
  Keystore keys (`apps/strongroom/.../android/Keys.kt`, `VaultHolder.kt`).
- `packages/ui/src/tokens.ts` `BrandKey` currently: netlens, opentunnel, store, pdf,
  design, deputy, strongroom. Adding `inflow` needs `pnpm --filter @apps-hub/ui build:css`.
- Owner's real bank SMS formats (Alfalah credit, Alfalah debit card, UBL Raast) and a
  Jazz Roman Urdu sample are quoted verbatim in the design; use them as test fixtures.
- Not yet checked: whether the Store's installer lets Inflow be granted READ_SMS
  (hard-restricted permission). Stage 2 starts with that check.

## File map

- Design: `docs/superpowers/specs/2026-11-13-inflow-design.md`
- This handoff: `docs/handoffs/inflow.md`
- Closest existing apps to copy structure from: `apps/deputy`, `apps/strongroom`
- Store / release: `docs/app-store.md`, `tools/release`

## Session log

- 2026-11-13: brainstorm with the owner, design written, builder check run and its
  four questions folded in (three settled as my calls, one left open: see design
  "Open question"). Nothing built. Design and handoff are untracked files in the
  main checkout, which was on branch `model-host` with unrelated uncommitted work.
- 2026-11-13 (same day): worktree `/Users/outsentia/Documents/apps-hub-wt/inflow` on branch
  `inflow/stage-1` (from main 226a947) holds copies of the design and this handoff. Stage 1
  plan written there: `docs/superpowers/plans/2026-11-13-inflow-stage-1.md` (9 tasks).
  Nothing committed yet.

- 2026-11-13 (build session 1): design, plan and handoff committed (bbe0e5c). Controller ledger
  is `progress.md` in the worktree root (untracked on purpose; it holds the conflict scan,
  rulings and per-task status). coord claim on the worktree needs
  `CLAUDE_CODE_SESSION_ID` set by hand in this harness. Task 1 done (588e74f): app shell,
  `inflow` brand, backup rules, Store registration; Gradle gate green. Plan gaps found and fixed:
  `ANDROID_PACKAGES` in `packages/store-manifest/src/index.ts` needs the new app, `.gitignore`
  entries per app, INTERNET only in debug manifests plus a release `tools:node="remove"` overlay.
  Ruling: Tasks 2 and 3 run one after the other (a red test file breaks the other agent's Gradle
  compile); Task 7 (TS only) runs alongside the Kotlin chain.

- 2026-11-13 (session 3): coord claim on the worktree needs `CLAUDE_CODE_SESSION_ID` set by hand
  (harness does not export it; any unique string works, none held the folder). The batched review of
  the risky commits was finished by reading the code myself (opus and sonnet reviewers had timed out):
  OTP detector, ingest, listener, store key paths and tombstones, no Important findings. Task 9 step 1
  gates run from the repo root: `pnpm test` exit 0 (inflow 16/16), `pnpm typecheck` exit 0, Gradle
  `:inflow-core:testDebugUnitTest :app:assembleDebug` BUILD SUCCESSFUL. `expo-doctor` run from
  `apps/inflow` (Inflow has no doctor script, like Strongroom and Deputy): 16/18, the two failures
  are the usual prebuild-app warnings (gitignored `modules/*/android/build`, app.json fields with a
  committed `android/`); module sources are tracked (27 files).

  Final reviewers on `226a947..HEAD`: invariant-reviewer "no findings" (merged release manifest
  re-checked by hand: no INTERNET, no QUERY_ALL_PACKAGES, allowBackup false); code-reviewer "approve
  with comments", fixed: list paging skipped items sharing a `posted_at` (now pages on time and id,
  `listItems(filter, before, limit, beforeId)`), and `raw.fill(0)` on the SQLCipher key array removed
  because the connection config re-reads it. Gates re-run green after the fixes.

  2026-11-13 (session 4): asked the owner for the release go. Answer: "not yet", fix all three
  deferred minors first. Fixed in 7cbdb47: `PRAGMA secure_delete = ON` through a `SQLiteDatabaseHook`
  `postKey` on every connection; the listener schedules a purge at each saved OTP's expiry
  (`Ingest(onOtpSaved)` callback, scheduled single-thread executor; in-process, so the old purge on next
  notification or Home stays as the fallback); `settingFor` looks up the app name. Kotlin 46/46 (forced
  re-run), `:app:assembleDebug` green; no TS changed. `origin/main` was 2 Strongroom commits ahead;
  `git merge-tree` showed a clean merge.

  2026-11-13 (session 5): the owner renamed the app (they plan a separate note-taking app) and asked
  to build stage 2 now, before stage 1 is released. Name picked: Inflow (`com.haroon.inflow`, Store
  id and brand `inflow`, `apps/inflow`, module `inflow-core`, Kotlin `expo.modules.inflowcore`,
  `InflowCoreModule`, `InflowListener`, db `inflow.db`, Keystore alias `inflow-db`). Worktree moved
  to `/Users/outsentia/Documents/apps-hub-wt/inflow`, branch renamed `inflow/stage-1`. Gates after the
  rename: inflow 16/16, ui 19/19, release 6/6, typecheck 0, Kotlin 46/46, debug APK badging
  `com.haroon.inflow` / "Inflow". The baseline experiment keeps its old names
  (`apps-hub-wt/notebox-baseline`, branch `notebox/baseline-single`).

  2026-11-13 (session 5, continued): stage 2 plan committed (1aecca6). Agent T: 787c43c (contract,
  money helpers, SMS setup row), f7298f4 (Money tab, Home money block, owner name, TxnSheet). Agent
  K: 45361c2 (bank parser), 33e84a3 (ledger, dedup, own transfers), 5ce6426 (SMS ingest, merge,
  schema v2), c793110 (importer, receiver, SqlLedgerStore, module API). Controller-checked: pnpm
  test 0, pnpm typecheck 0, Kotlin 84/84 (--rerun-tasks), assembleDebug green, 21 module functions
  match the TS contract, each commit only its agent's files. Final reviews: invariant-reviewer
  clean on manifest (no INTERNET, no QUERY_ALL_PACKAGES), receiver (BROADCAST_SMS), logs,
  backup, deps and rename wiring, one Important (bank SMS can be classed OTP and purged);
  code-reviewer (opus) four Important + two Minor + three nits. All are F1-F10 in
  fix-1-brief.md; rulings R10-R12 in progress.md (receiver only triggers inbox syncs; items
  rebuilt with AUTOINCREMENT in the v2 step; one fix agent then a scoped opus re-review).
  250d62a updated AGENTS.md's Inflow entry. The fix agent was stopped by a session restart
  after writing four red tests (uncommitted); no fix code landed.

  2026-11-13 (session 6): fix wave 1, one sonnet fix agent: 496f08e (Kotlin F1-F7, kept the four
  red tests; three were red without the fix, ownerNameChangeLeavesPairedAndHandSetAlone is a
  guard) and 9372f96 (TS F8-F10). F2 design: `txn_sources.channel` holds a comma list
  ("SMS_NOTIFICATION,SMS"), appended with a whole-token `instr` guard; no schema change. F6: two
  importer passes (`_id <= start AND date > lastSmsDate`, then `_id > lastSmsId`), meta
  `lastSmsDate`, 100-row batches. Controller re-ran: Kotlin 88 tests 0 failures (--rerun-tasks),
  assembleDebug green, pnpm test 0, pnpm typecheck 0, each commit only its files. Scoped opus
  re-review over e7412d2..9372f96: approve, F1-F10 all ADDRESSED, no Important. It ran SCHEMA_V1
  then the v2 rebuild in desktop sqlite3 3.50.6 on a v1 db with rows (ids kept, five indexes back,
  no reuse after) and the F2 UPDATE twice (idempotent). Its conditional Minor: a db from a pre-fix
  stage-2 build would re-read the whole inbox once and could double count purged SMS; no such
  build was ever installed, so no change (wipe such an install if one turns up). Nit left:
  `setOwnerName` re-labels on the JS thread (sync Function); fine at current sizes.

- 2026-11-17 (post-release session): owner list of five items. (1) Unlock spun after minimizing: BiometricPrompt drops a
  request made after onSaveInstanceState; fixed 335f7e2 (prompt waits for AppState active; native returns at once unless RESUMED).
  (2) Group by contact, per app (owner: "show only the app's messages"; also "similar case for transactions"): spec dd15112,
  plan docs/superpowers/plans/2026-11-17-inflow-contacts.md, built 04528e2 (Kotlin) + 3bf8003 (TS). (3)+(4) categories and
  weekly/monthly reports: owner picked approach A (the AI computes the numbers as JSON; the app validates and draws), accepted
  the category list and the playback; design docs/superpowers/specs/2026-11-17-inflow-reports-design.md under builder check;
  owner answered "Send both"; built 723095a..657d291 + aa70ccb, review fixes 6cc1f6c, 70126ad, 3e15ed3 (386 tests). (5) UI/UX + quieter SMS:
  phone walkthrough, design approved (2026-11-17-inflow-ux-design.md). Phone: owner had switched to the Store build; test build
  installed by adb with the release key (owner's OK).

## Current state and next step

State (2026-11-18): items 1-5 BUILT on branch inflow/post-release (not pushed). Item 5 (UX rework, quieter SMS): plan docs/superpowers/plans/2026-11-18-inflow-ux.md, commits 554bd2a, c0fa8a2, 3853704, b69a9de, then review fixes e2bee03, 177e66c, 1094de0, 75775fb, docs fc10f87d (SQL proof: docs/handoffs/inflow-ux-sql-proof.md). One opus review + one scoped re-review done (R52, R53 in progress.md); parked: M4 (a default SMS app outside Sms.KNOWN_APPS with unmatched notifications can show a sender in both lists), F6 (SMS keep-days can fold a bank), Home per-conversation "today" counts across apps (pre-existing). Gates at 75775fb: Gradle 396 tests 0 failures, inflow 61/61, typecheck 0, manifest permissions unchanged. Test APK (release key e3af4a92, versionCode 2, built from 75775fb) is in the 2026-11-18 session scratchpad (gone with it; rebuild with the recipe in the resume prompt). NOT yet on the phone: the phone was held by other sessions (Design Editor test, Strongroom OTP); this session was queued for device:49kjmnuwonkffqzh.

Next step: when the phone is free, claim it, `adb install -r` the test APK, check dumpsys notification for a live InflowListener and logcat for "Reject service", ask the owner to unlock and check: Home order (Money card, Inbox, Important without payments, Coming up, Recent chats, All apps), Money Overview/Reports/All, SMS contact list Promotions row and "Move to Promotions"/"Keep in my list" in an SMS item sheet, short code 8287 named after its bank, same-name apps merged in All apps, LinkedIn chat not named "1 new message". Then release only on the owner's go (items 1-5 in one release, versionCode 3).
