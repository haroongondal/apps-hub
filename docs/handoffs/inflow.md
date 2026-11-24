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

Receipts (2026-11-20, item 6, built on the same branch, not on the phone): a transaction's sheet has a Receipt row. It asks for READ_MEDIA_IMAGES (the owner allowed gallery access), lists photos taken or added from 3 days before to 1 day after the transaction, reads the nearest 40 on the phone with the text-ocr module (Tesseract, from PR #58 merged into this branch as `packages/text-ocr`, not yet in main), ranks them by amount match (+2) and counterparty word match (+1), and attaches the tapped photo as encrypted media of the transaction's first source message. Code: `src/receipts.ts` (+ `src/__tests__/receipts.test.ts`), `src/ReceiptSheet.tsx`, `modules/inflow-core/.../android/Gallery.kt`, `galleryBetween` / `attachReceipt` in `InflowCoreModule.kt`. New permission: READ_MEDIA_IMAGES (add to the expected list above). Not yet tested on the phone; the Store release waits for the owner's go.

Next step: when the phone is free, claim it, `adb install -r` the test APK, check dumpsys notification for a live InflowListener and logcat for "Reject service", ask the owner to unlock and check: Home order (Money card, Inbox, Important without payments, Coming up, Recent chats, All apps), Money Overview/Reports/All, SMS contact list Promotions row and "Move to Promotions"/"Keep in my list" in an SMS item sheet, short code 8287 named after its bank, same-name apps merged in All apps, LinkedIn chat not named "1 new message". Then release only on the owner's go (items 1-5 in one release, versionCode 3).

## Vitals (health) section (eco/inflow, 2026-11-23, tip 87b98f3e; V1-V4 built, gated and security-reviewed)

Plain words: a Health section inside Inflow (steps, sleep, heart rate, medicines, journal, Doctor summary). Not a medical device. Ledger: `/Users/outsentia/Documents/apps-hub-wt/eco-work/vitals/progress.md` (outside the repo, may be gone). SQL proof: `docs/handoffs/vitals-sql-proof.md`.

What was built:

| Part | What | Commits |
|---|---|---|
| Signing carry-in | `apps/inflow/android/app/build.gradle` wired to the shared Store signing key | 2121f7a1 |
| V1 Health Connect, read only | pure aggregation, `androidx.health.connect:connect-client` 1.1.0 (Apache-2.0, no Play Services; adds guava, protobuf-lite, coroutines-guava), permissions READ_STEPS, READ_SLEEP, READ_HEART_RATE only, rationale screen, schema v9 `health_daily` | f4f97d8d, c47cab3a, 3051b5b4, df1ec69a |
| V1 screens | Health entry on Home (not a fifth tab), steps/sleep/heart rate, empty states, refresh at most once per 15 minutes | d535b009, cd9ea10a |
| V2 + V3 medicines and journal | schema v10 `medicines`, `dose_log`, `journal`; reminders on one inexact alarm (channel 'Medicine reminders', Taken, Skip, Snooze, no new permission); adherence; mood and symptom journal | 31c8c04e, 28e64012, e96b1edb, 7db7c79d, a16102e9 |
| V4 Doctor summary | payload with SHA-256, send to Groq, plain-text reply, PDF; 'Include health in Ask AI' (meta `healthInAsk`) | e93f6a93, fa4ac710, 420574c3, 991cf764 |
| Fix wave after review | lock grace judged on return, wording, U+2028/2029 folded, PDF opened with mode `wt` | c25492ee, 87b98f3e |

Rulings that matter (V ledger):
- R4: Health refreshes only while the app is open. No worker, no READ_HEALTH_DATA_IN_BACKGROUND, no foreground service. Cost if wrong: data is as fresh as the last open.
- R2: the Doctor summary calls Groq `openai/gpt-oss-120b` (`https://api.groq.com/openai/v1/`) with the owner's Groq key saved in AI settings, whatever model the 30-minute batch uses. No Groq key means a plain message and nothing sent. Cost if wrong: the owner needs a Groq key.
- R10: 'Include health in Ask AI' is off by default. On, Ask gets only aggregates (daily steps, sleep minutes, heart rate average and lowest, per-medicine dose counts without names) for at most 31 days. Journal text and medicine names never go to Ask, on or off.
- R11: the PDF is saved only through the system file picker (ACTION_CREATE_DOCUMENT), no share sheet, so no FileProvider path for health files exists.
- R12: native recomputes the payload at send time and refuses when its SHA-256 differs from the one the owner confirmed on the preview. The text the owner sees is the user message of the request.
- R8: native health functions do not check the lock (like every data function); the lock lives in JS, and health screens render only under the unlocked tree.
- R15 (V5 not built): no separate Vitals share. The P2 `briefing` share carries next dose and steps (see the P2 section).
- Lock grace (`src/lockGrace.ts`, 2 minutes, `PROMPT_GRACE_MS`): the app stays unlocked only while a system picker or permission screen is open; on return it judges the time away and locks at 2 minutes or more.

Exclusions that must stay true (do not weaken; the tests are the fence):
- Health, medicine, dose and journal data never reach the 30-minute AI batch, reports, categorisation, Autopilot suggestions or the Autopilot provider. `HealthTables`, `HealthForAsk`, `VitalsSqlWiringTest` and `NEVER_SHARE_DATA` (packages/autopilot-contract/src/index.ts: health, journal, medicine, steps, sleep, heart) enforce it. Health SQL lives only in the schema and the health stores.
- Only the two opt-in ways leave the phone: the Doctor summary (only on the owner's tap, range at most 90 days, only the ticked sections, at most 40,000 characters, exact text previewed, Send tapped) and 'Include health in Ask AI'. Nothing is sent on a schedule or in the background.
- The only exception added later is in P2: the next medicine time (no name, no dose) and today's steps in the `briefing` share to Halo and in the morning summary, only while 'Include medicines and steps in my morning briefing' is on (off by default).

Gates at tip 87b98f3e: Gradle 670 tests 0 failures (572 before Vitals, +6 from the E1 merge), inflow ts 142, autopilot-contract 6, app-link-contract 133, ui 29, typecheck 0; release manifest permissions = baseline + READ_STEPS, READ_SLEEP, READ_HEART_RATE only. Security review: PASS WITH FINDINGS, then scoped re-review PASS. Parked: delete a PDF left by a failed overwrite (needs a phone), supply-chain audit of connect-client's transitive dependencies (licences: guava Apache-2.0, protobuf-lite BSD-3, coroutines-guava Apache-2.0).

Phone checks NOT run (the V ledger holds no list; these come from the V briefs and the code, none done):
1. Fresh Store install: Health opens from Home, shows 'Health Connect is missing' in plain words when it is not installed (Android 13 and lower), and the permission screen lists only steps, sleep and heart rate.
2. After allowing, open Health: today's steps, last night's sleep and a 7-day view fill in; a second refresh within 15 minutes does nothing; the manual Refresh button works.
3. While Health Connect's permission screen is open, Inflow does not lock; leave it with Home and wait over 2 minutes: Inflow is locked on return.
4. Add a medicine with a time, wait for the reminder: Taken, Skip and Snooze work; the lock screen shows only 'Medicine reminder'. Known gap: see open findings in the P2 section.
5. Doctor summary: pick a range, tick sections, read the preview, Send with a Groq key saved: plain-text answer; with no Groq key: a plain message and nothing sent; save the PDF through the file picker and open it.
6. 'Include health in Ask AI' off (default): Ask never answers from health numbers; on: it can answer a steps question and never quotes journal text or a medicine name.

## P2 (Wave 3, eco/inflow), 2026-11-24, tip e5e3cb48

Plain words: Inflow now takes part in the app links of the other apps. Everything stays on the phone from Inflow's side; no new network flow. Ledger: `/Users/outsentia/Documents/apps-hub-wt/eco-work/p2-inflow/progress.md`; per-task reports `task-*-report.md` in the same folder (outside the repo, may be gone). Contract and recipes: `packages/app-link-contract/README.md`. Share declarations: `packages/autopilot-contract/src/inflow-shares.ts` (R3; not exported from `index.ts`), fixtures in `packages/autopilot-contract/fixtures/`.

### What was built

| # | Item | What | Commits |
|---|---|---|---|
| 1 | Health row | `health` path on the link provider (`com.haroon.inflow.autopilot`): app_id inflow, accessibility null, listener 1/0, `ai_source` own/none, heartbeat `last_seen_at` (meta `healthLastSeenAt`, written on module create, foreground and listener connect; a query never writes). Same-key callers only, always, no switch. No personal data. | 86b83845 |
| 2 | ADD_TODO | `com.haroon.inflow.action.ADD_TODO`: exported `AddTodoActivity` behind the signature permission. `AppLinkActivityCaller.allowed` first, extras validated, fingerprint prompt (the app's own `Lock.authenticate`) on every start, then a screen; one to-do is written only on the owner's Add tap. The note is shown, not saved (R6). | 304f8bda |
| 3 | Briefing builder and readers | pure `Briefing.build`: bills and events due in 3 days (at most 5, kind and date only), yesterday's money out per currency, next medicine time and today's steps (only while the health switch is on), counts or first names from HomeNet (`who_is_home`), Strongroom (`expiry`, cards this month), Deputy (`waiting`), Nexus (`today`, count only). Readers only query, 2 s deadline, check the provider's package and key first, validate every row, skip silently. Lines at most 60 characters, at most 20. | 3015235d, 19ba54b6, fcad5e35 |
| 3 | `briefing` share | columns {line_id, kind, text, at, personal}, 20 rows. Served from a cached snapshot (meta `briefingSnapshot`, rebuilt off-thread, never inside the query) to Halo alone. | 39add5ee, 7230ed40, 6ed59216, 359281b3 |
| 4 | Summary | 08:00 and 20:00 notification (inexact alarm, channel 'Daily summary', low importance), boot receiver re-arms it. Morning: the briefing lines. Evening: today's spend and tomorrow's bills and meetings. At most 5 lines. | d7dce157, e2a0a3eb, 02e0223a |
| 4 | CHANGED ping | data-free `com.haroon.autopilot.CHANGED` to `com.haroon.halo` only, after `AppLinkTarget.trustedReceiver`, permission AUTOPILOT, no extras, at most one a minute (one trailing ping), sent 1.5 s late. Fires when the briefing lines or the set of waiting suggestions change. | d7dce157, 49d09f90 |
| 5 | Nexus shares | `ask_items/<sinceId>` {id, app, sender, text, at}, `ask_ids/<sinceId>` {id}, `debits/<sinceId>` {id, amount_minor, at, merchant, account}, 200 rows a page, Nexus alone | 95aa3d6e, 9e7bcba0, ebdef912, e5e3cb48 |
| 6 | Pay with Deputy | ghost button on a waiting bill row (Home and Suggestions): `proposeToDeputy(suggestionId)` starts Deputy's `PROPOSE_TASK` with `startActivityForResult`, explicit intent, `AppLinkTarget.trustedActivity` first. Extras: fixed task sentence, `context` "Payee: X. Due: d MMM yyyy.", `ref` = suggestion id. No amount. | d3fc5b9c, 4ae7c172, e5e3cb48 |
| 7 | AppLinkTarget adoption | merge of eco/base, `AppLinkTarget.kt` copied in (package line only); every sibling read (`trustedProvider`) and start or broadcast (`trustedActivity`, `trustedReceiver`) asks first; `SiblingTrustWiringTest` fails on any `sendBroadcast`, `bindService` or `startService` without it; `<queries><package>` for netlens, strongroom, pdfeditor, halo (deputy existed) | 66541c26, 37534923 |

Who may read what:

| Share (authority `com.haroon.inflow.autopilot`) | Caller | Condition |
|---|---|---|
| `health` | any same-key sibling | always |
| `suggestions` (older) | any same-key sibling | as before |
| `briefing` | `com.haroon.halo` alone (`getPackagesForUid(Binder.getCallingUid())` is exactly that one package, R17) | 'Show my morning briefing in Halo' on |
| `ask_items`, `ask_ids` | `com.haroon.pdfeditor` (Nexus) alone, same rule | 'Let Nexus read my messages' on, and an AI key was saved (`enabledSince()`; none saved means an empty cursor) |
| `debits` | Nexus alone | 'Let Nexus match my receipts' on |

Every query runs `requireSibling()` first (signature permission plus same key, else SecurityException). Any other caller, or a switch that is off, gets an empty cursor with the right columns. All paths are read-only (insert and delete throw, update answers 0).

What the shares hold:
- `ask_items`: SMS and email only, Ask AI's `NEVER_SEND_FILTER` (no one-time codes, nothing kept from AI, no app records), never Strongroom or Inflow items, never the Autopilot picked-chat exception, only items saved at or after AI was first turned on in Inflow, text cut at 4000, app and sender at 80. `ask_ids` lists the ids `ask_items` would serve, so Nexus can delete what no longer qualifies. Nexus sends what it reads to Gemini and Groq (its own keys or AI hub); the switch says so.
- `debits`: money out from the last 60 days (newest 500 by id; a per-pass cap), own transfers left out, `amount_minor` in the transaction's own minor unit in any currency, merchant the shown name cut at 80, `account` a label with at most the last four digits of the whole string. Debits stay on the phone in Nexus (never indexed into Ask).
- `briefing`: lines built in code, never raw message text or other people's titles. `kind` is bill, event, spent, medicine, steps, home, cards, tasks or nexus. `personal` is 1 for spent, medicine, steps and home (forced at serve time). Medicine and steps rows are filtered at serve time while the health switch is off.

### Switches (Settings, all plain On/Off, all off by default)

| Group | Exact title | Meta key | Native functions |
|---|---|---|---|
| Health in Ask AI (Vitals) | Include health in Ask AI | `healthInAsk` | `healthInAsk()`, `setHealthInAsk` |
| Morning briefing | Show my morning briefing in Halo | `briefingShare` | `briefingShare()`, `setBriefingShare` |
| Morning briefing | Include medicines and steps in my morning briefing | `healthInBriefing` | `healthInBriefing()`, `setHealthInBriefing` |
| Morning briefing | Morning and evening summary | `digest` | `digest()`, `setDigest` |
| Nexus | Let Nexus read my messages | `nexusAsk` | `nexusAsk()`, `setNexusAsk` |
| Nexus | Let Nexus match my receipts | `nexusDebits` | `nexusDebits()`, `setNexusDebits` |

Subtitles (SettingsScreen.tsx): the Halo switch says Halo can read these lines and nothing leaves the phone; the health switch says it adds the next medicine time and today's steps to the morning summary and to the briefing Halo shows; the summary switch names who is home and the other apps' lines; the messages switch says Nexus keeps a copy and sends the text to Gemini and Groq, through AI hub or with the owner's own keys, that one-time codes are left out, and that only messages from after AI was first turned on in Inflow are read. The summary default is off (R12).

### Summary lock-screen rule

If any shown line is personal (spent, medicine, steps, who is home) the summary posts `VISIBILITY_SECRET`: nothing on a secure lock screen. Otherwise `VISIBILITY_PRIVATE` with a public version that holds only the title and a count ('3 things today', 'N things tonight', N = lines shown, at most 5). A late alarm (over 3 hours after its slot) posts nothing and arms the next one. No lines means no notification. The tap opens Inflow behind the fingerprint lock.

### Rulings (R1-R17, one line each)
- R1 no locks, one worker at a time. Cost if wrong: none.
- R2 the briefing flag column is `personal` (first `sensitive`, because `defineShare` refuses `private`; changed to match Halo's reader). Cost: one rename.
- R3 share declarations live in `packages/autopilot-contract/src/inflow-shares.ts`, not exported from `index.ts`. Cost: a file move.
- R4 `debits.account` stays `account`, a display label only. Cost: one rename and fixture.
- R5 the heartbeat is written on every foreground, and a Kotlin test reads `HEALTH_AUTHORITIES` from `health.ts` by regex. Cost: one-line fixes.
- R6 ADD_TODO shows the note and does not save it (no note column). Cost: a later migration.
- R7 ADD_TODO asks for the fingerprint on every start. Cost: one extra prompt.
- R8 who is home, spend, medicine and steps lines are `personal`. Cost: Halo hides them on the always-on screen.
- R9 the Nexus line is a count; titles never enter a line; Deputy and Strongroom lines are counts. Cost: less detail.
- R10 the share serves a cached snapshot, rebuilt off-thread (foreground, listener connect, switch change, stale after 10 minutes, at most once a minute). Cost: a line up to 10 minutes old.
- R11 the snapshot rebuilds only while the Halo switch is on; the summary builds directly. Cost: a small widen.
- R12 the summary is off by default; lock-screen text is a count only; boot re-arms only the summary. Cost: one default, or a later boot re-arm for the older reminders.
- R13 the CHANGED ping goes 1.5 s after the decision, the trailing ping is not saved, the lines ping follows the Halo switch and the waiting ping does not. Cost: one constant or line.
- R14 REVOKED. First ruled that `ask_items` ignores the first-AI-key date; now `ask_items` and `ask_ids` apply `enabledSince()`, as Ask AI does. Cost: Nexus gets nothing until an AI key is saved; older messages are not searchable (the owner can relax it).
- R15 AMENDED. Pay with Deputy's detail is the bill's row; first it carried an amount read from the dedupe key, now it carries no amount at all (the largest number in a message can be a year or a reference number). Cost: no Amount line until the AI bill result carries one.
- R16 the summary is `VISIBILITY_SECRET` when any shown line is personal. Cost: personal summaries show only after unlock.
- R17 the `briefing` share is served to Halo alone. Cost: a later reader needs an allow-list entry.

### Reviews and what was fixed (2026-11-24, tip 4ae7c172)

security-engineer: 0 High, 3 Medium, 1 Low. invariant-reviewer: 4 Important, 5 Minor. Fix wave (task 8a, 02e0223a, 359281b3, e5e3cb48; Gradle 833 tests, 7 deliberate bypasses each made a test fail):
- FIX-1 (Medium): the summary showed lines on a locked phone when the owner's Android setting shows sensitive content. Fixed by R16.
- FIX-2 (Medium and Important): the briefing went to every same-key app. Fixed by R17; the switch now says Halo.
- FIX-3 (Important): the Nexus messages subtitle said nothing leaves the phone, which was false (Nexus sends to Gemini and Groq). Subtitle rewritten; R14 revoked.
- FIX-4 (Important): the Deputy draft could show a wrong amount. Amount removed (R15).
- FIX-5 (Minor): source pins added so tests fail when `BriefingSource.healthOn`, the provider's `BriefingShare.serve` line or the order in `AddTodoActivity` changes.
- FIX-6 (Minor): the public count uses the lines shown; two subtitles name what the switch covers.
- Scoped re-review of 4ae7c172..e5e3cb48 (provider caller check, notification visibility, Nexus SQL): all six fixes ADDRESSED; two Minor findings, both fixed in fix round 2 (see the session log line below): the no-key source pin in `NexusShareSqlTest` sat inside a test skipped when sqlite3 is missing (moved into its own test with no skip), and the Nexus messages subtitle now ends 'One-time codes are left out. Only messages from after you first added an AI key in Inflow.'
- Unproven suspicions from the re-review (not changed): a paired Wear OS watch receives notifications whatever their lock-screen visibility, so a personal summary could show on the watch (`setLocalOnly(true)` on the summary would close it); whether HyperOS honours `VISIBILITY_SECRET` is a phone check (17 below).

### Open findings (not fixed)
- Nexus shows 'ready', not 'off', when a switch here is off (an empty cursor, not a SecurityException). Nexus-side change.
- `OtpDetector` misses an OTP SMS that also carries an amount and a verb (older than P2), so such a code can slip into `ask_items`; Nexus filters it again.
- A paired Wear OS watch may show the summary's lines whatever the lock-screen visibility (suspicion, unproven; `setLocalOnly(true)` would close it).
- The medicine reminder notification has the same lock-screen gap the summary had (`VISIBILITY_PRIVATE` is a request; `MedicineReminders.kt` sets PRIVATE with a public version). Pre-existing Vitals, reported, not changed.
- A reader pool thread can leak when a sibling hangs (low).
- `NEXUS_READS` literals in `inflow-shares.test.ts` are copied from eco/nexus and can drift; recheck after the merge.
- The amount is missing in Deputy's draft until the AI bill result carries one (change in `Ai.kt` prompt and schema).
- No boot re-arm for the older suggestion reminders and the medicine alarm (only the summary is re-armed).
- Also noted: the trailing CHANGED ping is lost if the process dies; the debits share has no delete path (Nexus side); an item that qualifies later with an id below Nexus's cursor is not re-sent; the 500 debit cap is per paging pass.

### Gates (final, tip e5e3cb48)
- Gradle `:inflow-core:testDebugUnitTest :app:assembleDebug :app:processReleaseMainManifest --rerun-tasks`: 833 tests, 0 failures.
- `pnpm --filter inflow test`: 143. `pnpm --filter @apps-hub/app-link-contract test`: 138. `pnpm --filter @apps-hub/autopilot-contract test`: 17. All typechecks exit 0.
- Release manifest permissions: INTERNET, POST_NOTIFICATIONS, READ_MEDIA_IMAGES, READ_SMS, RECEIVE_SMS, RECEIVE_BOOT_COMPLETED (new in P2), USE_BIOMETRIC, USE_FINGERPRINT, READ_HEART_RATE, READ_SLEEP, READ_STEPS, DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION, com.haroon.permission.AUTOPILOT. Exported (9): MainActivity, InflowListener, AutopilotProvider, HealthRationaleActivity, ViewPermissionUsageActivity, AddTodoActivity, SmsReceiver, HealthDataSdkService, ProfileInstallReceiver. New in P2, not exported: `DigestAlarmReceiver`, `DigestBootReceiver`.

### File map (apps/inflow/modules/inflow-core, `.../java/expo/modules/inflowcore/`)
- `core/` (pure): `AppHealth.kt`, `AddTodo.kt`, `Briefing.kt`, `BriefingHealth.kt`, `BriefingReaders.kt`, `BriefingSnapshot.kt` (also `BriefingShare`), `BriefingRefresher.kt`, `Digest.kt`, `ChangedPing.kt`, `NexusShares.kt`, `ProposeToDeputy.kt`.
- `android/` (glue): `AutopilotProvider.kt` (paths health, briefing, ask_items, ask_ids, debits), `AddTodoActivity.kt`, `BriefingSource.kt`, `BriefingRefresh.kt`, `DigestAlarm.kt`, `DigestNotifier.kt`, `HaloPing.kt`, `ProposeBill.kt`, `SqlItemStore.kt` (`nexusAskItems`, `nexusAskIds`), `SqlLedgerStore.kt` (`nexusDebits`).
- `applink/`: copies of `AppLinkGuard.kt`, `AppLinkCaller.kt`, `AppLinkActivityCaller.kt`, `AppLinkTarget.kt` (package line only; `packages/app-link-contract/src/__tests__/copies.test.ts` fails on drift).
- TS: `apps/inflow/modules/inflow-core/src/index.ts` (contract), `apps/inflow/src/SettingsScreen.tsx` (switches), `apps/inflow/src/autopilot.ts` (`payWithDeputyMessage`, `useSuggestionActions`).
- Contract: `packages/autopilot-contract/src/inflow-shares.ts`, `fixtures/*.share.json`, `*-rows.sample.json`, tests in `src/__tests__/inflow-shares.test.ts`.
- Pins: `VitalsSqlWiringTest` (health reaches the briefing only through `StoreBriefingHealth`; summary and ping files name no health code; Nexus SQL names no health table), `SiblingTrustWiringTest`, `DigestWiringTest`, `AutopilotProviderShareTest`, `NexusShareSqlTest` (runs the real SQL in the system `sqlite3`; skipped where there is none).

### Current state and next step
State (2026-11-24): P2 built and gated on branch `eco/inflow` at e5e3cb48 (not pushed, not merged). Nothing of P2 has run on a phone. Root AGENTS.md and `docs/handoffs/ecosystem.md` are updated by the main session (exact AGENTS.md text was handed over separately).

Next step: merge `eco/inflow` to main (owner's go; release by local command only on the owner's go, with `[skip ci]` on the merge), then run the phone checks below with the Store-signed apps (debug builds share a public key and protect nothing between them). Claim the phone first; install through the Store only.

### Phone checks NOT run (P2; none done)
1. Health row: from a same-key sibling (the Store's Setup and health screen) read `content://com.haroon.inflow.autopilot/health`: one row, app_id inflow, accessibility null, listener 1 with notification access on (0 after turning it off), `ai_source` none with no AI key and own with one, `last_seen_at` near now after opening Inflow and unchanged by repeated reads; a non-sibling caller gets SecurityException.
2. ADD_TODO: from a same-key app start an Intent with action `com.haroon.inflow.action.ADD_TODO` through `startActivityForResult` (Clipboard's 'Add to Inflow' on an IBAN is one), extras `title`, `dueAt`, `note`. Expect the 'Unlock Inflow' fingerprint prompt, then 'Add to your to-dos?' with 'From <app name>'. Cancel the prompt: no screen, result cancelled, list unchanged. Cancel and Back on the screen: nothing added. Add: result OK, one new to-do (title as edited, due date, no note). A plain `startActivity` or `adb shell am start -a com.haroon.inflow.action.ADD_TODO` is refused. Extras with an unknown key, a 201-character title or a blank title are refused. Rotate the screen: the fingerprint is asked again. The caller's name must show without a `<queries>` entry (else add one).
3. Briefing share: with the Halo switch off (default) Halo reads an empty cursor with five columns. Turn it on with a bill due tomorrow: within seconds Halo reads 'Bill due 25 Nov' (personal 0), no medicine or steps lines while the health switch is off; turn the health switch on and open the app: 'Medicine at HH:MM' and 'N steps' appear with personal 1; off again: they vanish at once. The first read after a fresh install with the switch on can be empty; the next ones hold the lines.
4. Briefing caller rule: from Deputy or Nexus (same key) a query of `.../briefing` returns an empty cursor with the five columns; from Halo it returns lines; a debug-signed or unsigned caller gets SecurityException. `adb shell content query` is refused.
5. Readers: with Store-signed HomeNet (sharing on, someone home), Strongroom (expiry sharing on, a card ending this month), Deputy (waiting share on, a draft waiting) and Nexus installed, the morning summary or Halo shows 'Ali is home', '1 card expires this month', '1 task is waiting for you', 'N things in Nexus today'. With an app missing, refusing (debug-signed) or its switch off: no line, no crash, at most about 2 s wait. A lookalike app declaring an applink authority gets no query.
6. Package visibility: the `<queries>` entries make Deputy, HomeNet, Strongroom, Nexus and Halo visible to the checks on Android 11+. If they do not, lines silently vanish and Run says 'Deputy isn't installed.'
7. Summary alarm: with 'Morning and evening summary' on, `adb shell dumpsys alarm | grep com.haroon.inflow` shows one RTC_WAKEUP alarm for the next 08:00 or 20:00; off removes it. Restart the phone with it on: the alarm is back after unlock (HyperOS Autostart off may stop the boot receiver, the owner's setting).
8. Summary content: with a bill due tomorrow and a spend today, wait for 20:00 (or move the clock): a quiet 'Evening summary' with 'Spent PKR ... today' and 'Bill due ...'. With only bills and meetings, the lock screen shows 'N things tonight' and the lines after unlock. With a spent, who-is-home or steps line, nothing at all shows on the lock screen, even with 'show sensitive content' on. Nothing due: no notification. Notifications permission off: no notification and no crash. Tap it unlocked: Inflow opens behind the fingerprint prompt. With the health switch off, no medicine or steps line in the morning summary; on, only in the unlocked text.
9. CHANGED ping: with Halo installed (Store-signed), add a suggestion or change a bill: Halo sees `com.haroon.autopilot.CHANGED` once; ten changes inside a minute give two pings (first and one trailing). Debug-signed Halo: no ping. Halo absent: nothing, no error.
10. Nexus shares, switches off (default): fresh install shows a 'Nexus' group with both switches Off; Nexus's readers get zero rows for `ask_items/0`, `ask_ids/0` and `debits/0` and keep nothing from Inflow.
11. Nexus messages on: with no AI key saved in Inflow, Nexus gets nothing; after saving a key, only messages from then on. SMS and Gmail items appear; no WhatsApp or other chat messages, even a chat picked for Autopilot; no one-time code (send yourself an OTP SMS); nothing from an app or sender in 'Kept from AI'; long emails cut at 4000 characters. Turn it off and sync: Nexus drops what it kept.
12. Nexus receipts on: Nexus sees debits from the last 60 days only, own transfers left out, accounts as 'Bank ****1234'; a 16-digit card or IBAN account string in Inflow shows at most four digits in Nexus.
13. Nexus caller rule: from Halo or Deputy (Store-signed) a query of `content://com.haroon.inflow.autopilot/ask_items/0` returns 0 rows with the five columns; a debug-signed or unsigned caller gets SecurityException.
14. Pay with Deputy: with a waiting bill suggestion open Inflow (fingerprint), Home or Suggestions: the bill row shows 'Pay with Deputy'. Tap: Deputy opens its draft screen with 'Help me pay this bill.' and, in the quoted text, the payee and due date and no Amount line. Nothing runs until Start there. Save or start it: back in Inflow 'Sent to Deputy. Finish there.' shows; close it in Deputy instead: no line. Uninstall Deputy or use a debug-signed Deputy: 'Deputy isn't installed on this phone.' and nothing opens. If Deputy says 'not allowed', Inflow shows nothing. Inflow locks while the owner is in Deputy: check the line still shows after unlocking.
15. Ask Deputy on a reply suggestion (Run): Deputy starts; with a debug-signed Deputy it says Deputy isn't installed.
16. After install check `dumpsys notification` for a live InflowListener and logcat for 'Reject service' (HyperOS Autostart), as for any Inflow build.
17. HyperOS and `VISIBILITY_SECRET`: with 'Morning and evening summary' on, a secure lock and the system setting 'show sensitive notification content' on, post a summary with a personal line (spent, steps or who is home): nothing of it may appear on the lock screen (not even the app name or a count). If HyperOS shows it, record it and switch the summary to `setLocalOnly(true)` plus no post while locked. With a Wear OS watch paired, note whether the lines reach the watch.

## E2: AI through AI hub (eco/inflow, 2026-11-24) - SUPERSEDED by 'Hub only' below (own-key fallback, key settings and the own-key health paths are gone)

### What was built
- Inflow's non-health AI calls go to AI hub (`com.haroon.aihub`) first, through the Kotlin `AiHubClient` of `packages/ai-hub-client`, and fall back to the owner's own key. Paths on the hub: the 30-minute batch and the Autopilot fast run (summaries, importance, to-dos, money, Autopilot suggestion drafting all come from that one batch prompt), spending categories (`TxnCategorize`), weekly and monthly reports (`ReportRun`), and Ask AI (plan and answer) when "health in Ask" is off.
- Never on the hub, own key only: the Doctor summary (`DoctorRunner`, unchanged: Groq URL, gpt-oss-120b, Groq keys only), Ask AI when "health in Ask" is on (the whole Ask, the plan call too, because the question itself is likely about health), and the key test in Settings (it tests one own key).
- Pure core `core/HubFirst.kt`: `TextAi` (what `AiRun`, `TxnCategorize` and `ReportRun` now take; `OpenAiCompatProvider` implements it), `HubFirst(hub, own, pause, foreground, record, ids)`, `HubPause` (10 minutes, in memory), `HubChat` (request JSON per the client's contract fixture, reply parsing, error mapping).
- Seam: `AiConfig.provider(readMs, foreground)` returns `HubFirst` over `ownProvider()` when built with a Context (all `AiRunner` call paths), else the own provider. `AiConfig.ownProvider(onlyKeyId, readMs)` is the old `provider()`.
- `ai_source`: `AppHealth.record` writes meta `aiSource` ("hub" or "own") after each successful `HubFirst` call (only when it changes); the health row is `none` without a saved key, else the recorded value, else `own`.
- Gradle: `inflow-core` has `implementation project(':ai-hub-client')`; `apps/inflow/package.json` lists `ai-hub-client: workspace:*` so autolinking includes the project (no duplicate AIDL: only the client compiles it). JS does not import it.
- Manifest (merged, release and debug): `<uses-permission com.haroon.permission.AI_HUB>`, `<permission com.haroon.permission.AI_HUB protectionLevel=signature>`, `<queries><package com.haroon.aihub/>`, all from the client's module manifest; nothing added to Inflow's own manifest.

### Decisions (my call unless marked; owner confirms)
- R44 is unchanged and runs before any provider is chosen: the hub gets the same already-filtered prompt the own key would get. AI stays on only while an own key is saved (`AiConfig.on()`, `aiSince` set by the first key), so without an own key nothing goes to the hub either. Keyless use through the hub alone would need an Inflow-side opt-in that sets `aiSince` (a "Use AI hub" switch); not built.
- The opt-in for the hub path is the hub's own switch for Inflow (default-deny). With it on, Inflow's text may reach Gemini when the hub falls back. That is a provider Inflow did not use when the own key is Groq or a custom address, so the hub's per-app switch is the owner's opt-in for it (Gemini 3.5 Flash-Lite is Inflow's default own-key model only). Health data never takes this path.
- Fallback set: hub-missing, not-allowed, version, no-key (the client's canFallBack) plus too-large (the own key has no 512 KB limit). The own key is tried exactly once per call; once the hub failed, the same `HubFirst` (one run, one Ask, one report) goes straight to the own key for its later calls. not-allowed pauses the hub for 10 minutes for every call in the process; a restart asks again.
- No fallback, the error surfaces as an `AiError`: hub timeout becomes `TIMEOUT` (may be billed; the batch keeps its queue, a report counts a try); busy, provider-error, invalid, cancelled and an unreadable hub reply become `SERVER` (queue kept). An unreadable reply is never sent again to the own key, since the hub already paid for it.
- Model, address, reasoning effort and custom prices apply to the own-key path only. On the hub path the hub picks the model; Inflow asks for at most 8,000 tokens (hub cap 8,192), priority background for runs and reports, foreground for Ask.
- Spend: a hub reply is priced from the `model` it names when Inflow knows that model (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `gemini-3.5-flash-lite` at the `AiModels.KNOWN` prices) and counts toward Inflow's daily limit; a model Inflow does not know is priced at the dearest `AiModels.KNOWN` model, so the daily limit still stops hub calls (`HubFirstTest`). The daily limit still stops hub calls once reached.

### Tests
- `HubFirstTest` (10): hub missing -> own; hub served -> own never called; each fallback kind mid-call -> own exactly once, no second hub call in the same instance; other kinds surface without own; own error after fallback is not retried; unreadable reply is an error; not-allowed remembered 10 minutes across instances; request passes the client's `HubLimits.check` and has exactly the contract keys; pricing.
- `HubRoutingTest` (5, source pins): `AiHubClient(`/`HubFirst(` built only in `AiConfig.kt`; `DoctorRunner.kt`, `DoctorPdf.kt`, `DoctorSummary.kt` and the health files name no hub; Ask picks `ownProvider()` from the same `healthOn` flag that gates `HealthForAsk.context`; the key test uses `ownProvider(keyId)`.
- `AppHealthTest` (+1, one renamed), `VitalsSqlWiringTest.askReachesHealthOnlyThroughTheGate` updated to the two lines (`healthOn`, then `HealthForAsk.context(healthOn, ...)`).

### Gates (2026-11-24)
- Gradle `:inflow-core:testDebugUnitTest :ai-hub-client:testDebugUnitTest :app:assembleDebug :app:processReleaseMainManifest`: BUILD SUCCESSFUL; inflow-core 850 tests, 0 failures (834 before); ai-hub-client 12, 0 failures.
- `pnpm --filter inflow test` 143 pass, `typecheck` exit 0; `pnpm --filter @apps-hub/app-link-contract test` 138 pass; `pnpm --filter ai-hub-client test` 10 pass.
- Metro: `npx expo export --platform android` in apps/inflow exit 0 (one 2.06 MB Hermes bundle).

### Open
- security-engineer review of the hub flow is still due (COMMON rule for a new flow to another app).
- The Store health screen reads `ai_source`; until a hub call succeeds it shows `own` with a key saved.

### Phone checks NOT run (E2)
Install Inflow and AI hub from Store releases (debug builds are signed with the public debug key: the hub refuses them with not-allowed). Save an own key in Inflow (Gemini or Groq) so AI is on.
1. Hub off: uninstall AI hub (or never install it). Settings > Send now: items get summaries; spend today rises at the own model's prices; health row (`content://com.haroon.inflow.autopilot/health` from a same-key sibling) shows `ai_source` own. Ask AI answers.
2. Hub on, Inflow not allowed: install AI hub with a key, leave Inflow off in its Apps list. Send now: Inflow appears in the hub's Apps list as asking; Inflow's items are still summarised through the own key; a second Send now within 10 minutes makes no new hub request (the hub's request count for Inflow does not rise); after 10 minutes, or after force-stopping Inflow, it asks again.
3. Hub on, Inflow allowed: turn Inflow on in AI hub. Send now, Make a report now, and Ask AI with health in Ask off: the hub's usage for Inflow rises, the own key's provider dashboard shows no new requests, `ai_source` becomes hub, Inflow's spend today rises at gpt-oss-120b's prices (or not at all if the hub served a model Inflow does not know). Then remove the hub's Groq and Gemini keys so it answers no-key: the next Send now goes once to the own key (its dashboard shows it) and `ai_source` becomes own.
4. Doctor summary still on the own Groq key: with the hub on and Inflow allowed, Vitals > Doctor summary > Make: the Groq dashboard of the owner's own key shows the request; the hub's usage for Inflow does not rise. Turn "health in Ask" on and ask "How did I sleep last week?": the own key's dashboard shows two requests, the hub none.

## Hub only (hub-only/inflow, 2026-11-24)

Plain words: Inflow no longer has an AI of its own. Every AI call goes to AI hub, and Settings has no key screens. Owner decision, 2026-11-24 (docs/ai-hub/PLAN.md P3).

### What was built
- Deleted: `OpenAiCompatProvider`, `HubFirst`, `HubPause`, `AiHttp`, `AiModels.validate`/`KNOWN` (own models), the own-key paths for Ask with health and the Doctor summary, the key test, and the TS functions `knownModels`, `setAiModel`, `addAiKey`, `removeAiKey`, `testAiKey` with `KeyPanel`/`ModelPanel`/`removeAiKeyConfirm`. R44's 'Inflow AI needs its own key' no longer holds.
- `core/HubAi.kt`: `TextAi`, `HubAi(hub, foreground, answered, ids)` (one chat request, no fallback), `HubChat`, `HubCopy` (the plain words). Hub error kinds map to `AiError.Kind` HUB_MISSING / NOT_ALLOWED / VERSION / NO_KEY (all `waits`: queue and a report's tries are kept), BAD_REQUEST (too-large, invalid), SERVER (busy, provider-error, cancelled, unreadable), TIMEOUT. No hub error text reaches a screen.
- `core/AiSwitch.kt`: 'Use AI' is the opt-in. `aiOn` meta; a phone with a key saved stays on, one without stays off (decided once, written down before any key can be deleted); the first turn-on sets `aiSince`.
- Key cleanup rule (coordinator, 2026-11-24): saved keys (`ai_keys`) are deleted ONLY after the first successful hub chat (a real, readable reply) on the phone. Never on `available()` alone, never after a hub error. `aiHubWorked` meta is the marker; `AiSwitch.cleanup()` runs after the first success and at every start while the marker exists. `AiSwitchTest` covers: nothing but `available()` -> keys stay; each failed call kind -> keys stay; unreadable reply -> keys stay; first success -> deleted and AI stays on; a delete that failed is retried at the next start and never loses the reply. Proven to fail under the old rule by removing the marker check (2 tests failed), then restored. The keys stay in Inflow if the hub has no key (nothing moves them into the hub: it never imports a key).
- `core/AskRun.kt`: the plan and answer calls of Ask AI, moved out of `AiRunner` so a test can drive them. `DoctorRunner(payload, ai, capReached, spend)`.
- `AiPricing`: the hub reply names the model; known models are priced, an unknown one at the dearest known model (daily limit rule kept).
- Health through the hub (PRIVACY-RELEVANT, OWNER TO CONFIRM): the Doctor summary (owner's tap, after the preview and hash check) and Ask AI with 'Include health in Ask AI' on now go to AI hub, so the text goes to Groq through the hub (Gemini if the hub falls back; the hub keeps only counts). Both stay off by default; consent copy: 'Your health text goes to Groq through AI hub; AI hub keeps only counts, never the text.' (`HEALTH_PRIVACY` in `doctor.ts`, shown in both). `AskRunTest` proves health text is in a request only when the switch is on (and then only in the answer request, not the plan); `HubRoutingTest` pins that the batch, categoriser and reports never name health code and that the Doctor summary runs only from its two module functions. The old pins that forbade the hub for health are gone.
- Screens: Settings > AI has 'Use AI' (Off/On), the daily limit, status and Send now. `AiHubNotice.tsx`: 'AI needs AI hub.' + 'Install AI hub' (opens the Store), 'Allow Inflow in AI hub.' and 'Add a key in AI hub.' + 'Open AI hub', 'AI needs a newer AI hub.' + 'Update AI hub' (Store). Shown in Settings, Ask AI, Doctor summary errors, Reports and Send now. `src/aiHub.ts` holds the words; `modules/inflow-core/fixtures/ai-hub-copy.json` is read by `HubCopyTest.kt` and `aiHub.test.ts`. `useHubIssue` calls `aiHub.available()` so Inflow is listed in the hub's Apps.
- Opening the Store: no helper exists and the Store has no page link for one app, so `HubLaunch.openStore` opens its launcher activity (`getLaunchIntentForPackage`) after checking the resolved package is exactly `com.haroon.store` and signed like Inflow (the Store is not in `SiblingPackages`, so `AppLinkTarget.decide` would refuse it; `HubLaunch.storeTrusted` has the same two checks, `HubLaunchTest`). `openAiHub` uses `AppLinkTarget.trustedActivity(requireLinkPermission = false)`. `<queries><package com.haroon.store/>` added. No link scheme invented.
- `ai_source` health row: `hub` while AI is on, `none` while off (`AppHealth.row(listener, aiOn, lastSeen)`, meta `aiSource` no longer written).
- Manifest comment: INTERNET is for Gmail only now.

### Behaviour changes to know
- An offline phone is a hub `provider-error` (the hub cannot tell it apart), so a report try is counted (3 tries then failed, 'Try again' restarts) where before offline waited without a try. Telling them apart needs ACCESS_NETWORK_STATE (not added) or a hub error kind.
- The hub's chat job can fall back to Gemini when Groq has no working key; the mandated consent copy says Groq. Owner to decide whether to reword or to get a Groq-only chat from the hub.
- 'Install AI hub' opens the Store's own list, not the AI hub page.

### Gates (2026-11-24)
- `:inflow-core:testDebugUnitTest :app:assembleDebug`: BUILD SUCCESSFUL, 844 tests, 0 failures (baseline 853: 20 own-provider tests and the 10 HubFirst tests removed, hub-only tests added).
- `pnpm --filter inflow test` 149 pass (baseline 143), typecheck exit 0; app-link-contract 139; autopilot-contract 17; ai-hub-client 10. `npx expo export --platform android` exit 0.

### Phone checks NOT run (Store release builds only)
1. Install Inflow and AI hub from the Store. Hub missing: uninstall AI hub; Settings > AI shows 'AI needs AI hub.' and Install AI hub opens the Store; Ask AI and Send now show the same words.
2. Hub installed, Inflow off in its Apps list: Settings shows 'Allow Inflow in AI hub.' and Inflow is listed as asking; Open AI hub opens it. Allow it.
3. Hub with no key: Send now shows 'Add a key in AI hub.'; add a Groq key in the hub. An old own key saved in Inflow is still there until now (check by an upgrade from the hub-first build).
4. Turn 'Use AI' on, Send now, Make a report now, Ask AI: the hub's usage for Inflow rises; after the first real reply the old own key is gone (it cannot be seen any more; check that no own-key request appears on the provider dashboard).
5. Doctor summary with the hub: preview, Send; the hub's usage rises (counts only). Ask AI with health on: one plan request and one answer request through the hub.
6. Restart the app after step 4 with an old key restored by an upgrade test: it is removed at start.
