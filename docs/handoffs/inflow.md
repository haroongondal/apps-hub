# Inflow handoff (formerly Notebox)

## Resume prompt (2026-11-16, stage 4b installed and tested on the phone; next build pending)

```
Continue the Inflow work (formerly Notebox), resume prompt dated 2026-11-16. Work only in the
worktree /Users/outsentia/Documents/apps-hub-wt/inflow (branch inflow/stage-4b, which holds stages
1-4 and 4b), never in the main checkout /Users/outsentia/Documents/apps-hub (branch model-host,
unrelated uncommitted work; its untracked docs/handoffs/notebox.md and Notebox design copy are
stale leftovers, delete only after the merge and with the owner's OK). Claim the worktree folder
with coord before you start (~/.claude/plugins/cache/claude-agent-workflow/coord/1.0.0/bin/coord
claim <folder>) and release it when you stop. Use cd-engineering-tools:parallel-agents-coord
(never superpowers:subagent-driven-development) for any agent work.

1. Read docs/handoffs/inflow.md completely first (especially "Current state and next step"), then
   progress.md (untracked ledger of stage 4b: rulings R35-R46, reviews, fix waves, the 2026-11-16
   phone results; progress-stage-{1..4}.md hold earlier stages). Plans: docs/superpowers/plans/
   2026-11-13-inflow-stage-{1,2,3}.md, 2026-11-14-inflow-stage-4.md, 2026-11-16-inflow-stage-4b.md;
   briefs fix-4b/4c/4d-brief.md. Trust the decisions, rulings and verified facts; do not re-ask what
   the owner settled; do not re-run reviews or fix waves already done.
2. PHONE RULES: the owner's phone is reached ONLY with `adb -s adb-49kjmnuwonkffqzh-zHnffO._adb-tls-connect._tcp`
   (an emulator, emulator-5556, belongs to ANOTHER session: never use it, never `adb kill-server`).
   Claim `device:49kjmnuwonkffqzh` with coord first and release it when done. Inflow is adb-installed
   (installer null, debug-signed, same cert fac61745...3b9c, versionCode 1): `adb install -r` of the
   new APK keeps data. Never uninstall. The owner unlocks Inflow, ticks HyperOS risk boxes, enables
   Autostart/notification access, and types settings themselves; never enter their PIN or credentials.
   Screenshots of lock/secure screens are black (Android). Describe the owner's messages by structure only.
3. State (updated 16:05): installed on the phone = 2b46d9e (d999812 + name hint, step 4a/4b DONE). Older note: c74d2f1 was installed, then d999812 (AI-filter gaps L1-L5: Ask txns of
   notification-only sources, default SMS app eligible, accounts list, versioned backfill cursor,
   AI-made txns re-read) is committed and gated (313 Kotlin tests, pnpm 46/46) but NOT installed.
   Build the next release APK from HEAD (`NODE_ENV=production ./gradlew :app:assembleRelease` in
   apps/inflow/android, JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home,
   ANDROID_HOME=/opt/homebrew/share/android-commandlinetools), check cert/badging, `adb -s <phone> install -r`.
   After an update check `adb logcat | grep AutoStartManagerService`: HyperOS may reject binding the
   notification listener (Autostart reset): the owner then enables Inflow in Security > Background
   autostart (open with `am start -n com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity`)
   and toggles notification access off/on.
4. Remaining TODO, in order: (a) T copy: hint under Settings > Your name must say "your full name as
   your bank writes it" (owner typed first name, then a name with a surname the bank omits; the matcher is
   exact + at most one bank tag by design). (b) Build/install d999812 + (a). (c) Phone checks still open:
   Ask AI money answer on the corrected ledger; WhatsApp MEDIA test (ask the owner's friend to send a photo,
   video, voice note, document, sticker, GIF, location, contact; read Settings > Saved media counters and the
   item sheets; unknown whether WhatsApp notifications expose any media the listener can read); Gmail (owner
   enters their own app password) ; a live bank SMS gives one item + one txn; AI summaries only for SMS/email
   now (R44). (d) Parked minors R43/R46: media read holds the DB write lock; legacy "You" copy with a twin and a
   todo stays; empty-text unreadable media row shows nothing; mixed-source (SMS + push) txn is excluded from
   Ask money (relax if totals look low). (e) Owner decisions pending: release of stages 1-4b (owner said
   "hold release"); never merge/push/release without their go. Stage 5 (rules/tags) is the last stage.
5. Keep docs/handoffs/inflow.md and progress.md current; at ~85% context stop, rewrite this prompt.
   No Claude attribution lines in commits or PRs. Never adb-install a Store-installed app.
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

## Current state and next step

State (2026-11-16 16:05): stages 1-4 and 4b built, reviewed, fixed and installed on the owner's phone (adb install -r, build 2b46d9e = d999812 AI-filter gaps + the 'full name as your bank writes it' hint). Listener bound, no Autostart reject. Gates at d999812: Kotlin 313 tests 0 failures, assembleDebug, processReleaseMainManifest (no new permission), pnpm test 0, typecheck 0 (inflow 46/46). Nothing pushed, merged or released (owner: "hold release").

Phone results 2026-11-16 (details in progress.md): v4->v5 upgrade on the real SQLCipher database worked (WhatsApp "You" duplicates repaired into one thread); LedgerBackfill re-read the saved SMS: November Money now in 840,749.01 / out 381,902.20 / 49 txns (was 20 txns, out 58,090.20), and after Settings > Your name = "Haroon Mukhtar" own transfers drop out: in 645,749.01 / out 356,902.20 / 47 txns; AI (Groq, GPT-OSS 20B) summaries and Ask AI work; Settings order, "Never sent to AI" labels ok; HyperOS rejected the listener after the first update until Autostart + notification access were re-enabled.

Decisions this round: WhatsApp text kept forever; WhatsApp grouped by contact; all media WhatsApp notifications expose stored encrypted (untested: owner skipped the media test); AI sees only SMS and email (R44; WhatsApp summaries from 14:06-14:07 were sent by the old build before R44); Ask AI uses transactions of any age (R35/R41); bank fees not added (R37).

Next step: phone checks that need the owner: Ask AI money answer, WhatsApp media test (friend), Gmail (owner's app password), a live bank SMS (resume prompt step 4c). Then owner decision on release; never merge, push or release without their go.
