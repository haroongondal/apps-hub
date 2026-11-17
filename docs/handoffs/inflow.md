# Inflow handoff (formerly Notebox)

## Resume prompt (2026-11-17, stages 1-4b merged to main and released; owner has bugs and changes)

```
Continue the Inflow work (Android app, com.haroon.inflow, apps/inflow), resume prompt dated 2026-11-17.
Stages 1-4b are MERGED to main (PR #35, d1b61ea) and RELEASED to the private Store (versionCode 2,
0.1.0). The owner has a list of bugs and changes; they will give it to you in this chat.

Work only in the worktree /Users/outsentia/Documents/apps-hub-wt/inflow, on branch inflow/post-release
(cut from origin/main d1b61ea), never in the main checkout /Users/outsentia/Documents/apps-hub (branch
model-host, unrelated uncommitted work; its untracked docs/handoffs/notebox.md and the Notebox design
copy are stale leftovers: delete only with the owner's OK). Claim the worktree folder with coord before
you start (~/.claude/plugins/cache/claude-agent-workflow/coord/1.0.0/bin/coord claim <folder>) and release
it when you stop. For agent work use cd-engineering-tools:parallel-agents-coord (never
superpowers:subagent-driven-development).

1. Read docs/handoffs/inflow.md completely first, then progress.md (untracked ledger, entries 1-50:
   rulings R35-R46, reviews, fix waves, phone results, the release). progress-stage-{1..4}.md hold earlier
   stages; fix-*-brief.md are old fix briefs (use as a template). Plans: docs/superpowers/plans/; design:
   docs/superpowers/specs/2026-11-13-inflow-design.md; AGENTS.md has the Inflow rules. Trust the decisions
   and verified facts; do not re-run reviews or fix waves already done; do not re-ask what the owner settled.
2. Ask the owner for the bug/change list if it is not in the chat yet. For each item: reproduce or read the
   code, write a failing test where it is logic (Kotlin JVM test in modules/inflow-core, or node --test in
   apps/inflow), fix, keep the gates green. Several items: group by files, and use parallel-agents-coord only
   if they are disjoint (Kotlin under modules/inflow-core/android vs TS under apps/inflow/src and
   modules/inflow-core/src/index.ts; a native function touches the TS contract, the adapter, Kotlin; Inflow is
   Android only).
3. GATES (run before any release): from the worktree root `pnpm test` and `pnpm typecheck`; Kotlin:
   `cd apps/inflow/android && JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
   ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew :inflow-core:testDebugUnitTest
   :app:assembleDebug` (313 tests at last count) and `:app:processReleaseMainManifest` (no new permission,
   no INTERNET in release).
4. PHONE RULES: the owner's phone is reached ONLY with
   `adb -s adb-49kjmnuwonkffqzh-zHnffO._adb-tls-connect._tcp` (emulator-5556 belongs to ANOTHER session:
   never use it, never `adb kill-server`). Claim `device:49kjmnuwonkffqzh` with coord first, release when
   done. The owner unlocks Inflow, ticks HyperOS boxes, enables Autostart/notification access and types
   settings and credentials themselves; never enter their PIN or passwords. Screenshots of lock/secure screens
   are black; describe their messages by structure only. The phone's Inflow today is the DEBUG-SIGNED build
   2b46d9e (cert fac61745...3b9c, installer null): `adb install -r` of a debug-signed APK keeps its data
   (build it with `NODE_ENV=production ./gradlew :app:assembleRelease` in apps/inflow/android WITHOUT the
   release key; check `apksigner verify --print-certs` shows fac61745). Do NOT adb-install the Store-signed
   APK over it (cert mismatch). After any update check `adb logcat -d | grep -E "Reject service|Unable to
   bind"`: HyperOS may reset Autostart and reject the listener; the owner then enables Inflow in Security >
   Background autostart (am start -n com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity)
   and toggles notification access off/on. Never uninstall Inflow.
5. RELEASE (only on the owner's explicit go, never unprompted): push the branch, open a PR to main, squash
   merge with "[skip ci]" in the subject (so CI does not also release), then from a CLEAN worktree of the
   merged commit (git worktree add --detach <dir> <sha>; pnpm install) run
   `NODE_ENV=production pnpm release inflow -m "<what changed>"` with JAVA_HOME/ANDROID_HOME as above (the
   release CLI sets versionCode = manifest + 1, signs with the shared release key, uploads via the
   apps-hub-store Worker to R2, needs no cf login). Remove the temp worktree after. Worker code did not
   change, so no Worker deploy. If main moved, merge origin/main into the branch first (conflicts last time:
   .gitignore, packages/store-manifest, packages/ui tokens.ts + regenerate web/tokens.css with
   `pnpm --filter @apps-hub/ui build:css`, tools/release/src/apps.ts: keep both sides).
6. IMPORTANT, signing: Store build (vc 2, release key e3af4a92...317d) cannot update the phone's debug-signed
   Inflow. To move to the Store build the owner must uninstall Inflow (data lost once: saved notifications,
   ledger, WhatsApp text, Gmail downloads; SMS can be re-imported). The owner has NOT done this yet and was
   warned. Until they do, test fixes on the phone via the debug-signed adb build (rule 4) and release to the
   Store as above. Any later Store release updates the Store copy only after that switch. Ask before
   suggesting the switch; offer a data backup/export idea only if they ask.
7. Known parked minors (R43/R46, no data loss, check if the owner's bugs touch them): media read holds the DB
   write lock (~20 MB read may stall list calls briefly); legacy "You" copy with a twin and a todo stays in
   the "You" thread; captionless unreadable media row shows empty (idea: "File not saved"); mixed-source
   (SMS + push) txn is excluded from Ask money (relax if totals look low); capture rollback also rolls back
   media counters. Still untested on the phone: WhatsApp media (does the listener see any media?), Gmail with
   the owner's app password, a live bank SMS (expect one item + one txn), Ask AI money answer.
8. Keep docs/handoffs/inflow.md (current state, session log) and progress.md current as milestones land; at
   ~85% context stop, rewrite this prompt. No Claude attribution lines in commits or PRs. Never merge, push
   or release without the owner's go (the push/merge/release of stages 1-4b was authorised on 2026-11-16).
   Stage 5 (rules/tags) is the last unbuilt stage; do not start it unless the owner asks.
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
  one owner question open (send push-sourced transaction fields to the AI?). (5) UI/UX: not started; ask what bothers them.

## Current state and next step

State (2026-11-17, post-release session, later): items 1-4 of the owner's list are BUILT on branch inflow/post-release (not pushed; branch is 2 commits behind origin/main, merge before release). Item 1 335f7e2; item 2 04528e2, 3bf8003; items 3+4 (categories + AI reports, approach A, "Send both") 723095a..657d291 + aa70ccb, docs cacb50a; review fixes 6cc1f6c, 70126ad, 3e15ed3. Gates at 3e15ed3: Kotlin 386 tests 0 failures + assembleDebug, release manifest adds only POST_NOTIFICATIONS, inflow 53/53, workspace pnpm test + typecheck 0 (at 70126ad). Ledger: progress.md (this plan; stage 4b ledger renamed progress-stage-4b.md). Nothing installed on the phone yet (adb was unreachable); phone still runs debug-signed 2b46d9e. Parked: Ledger:122 double hand-set category, item-batch timeout resend once per tick.

Next step: (a) when the owner turns on wireless debugging: claim device, build the debug-signed release APK (rule 4), check cert fac61745, install -r, check Autostart/listener, then test with the owner: unlock after minimize (and that cancelling the prompt does not loop on HyperOS), contact lists, People and shops, categories backfill, Make a report now, notification permission. (b) item 5 (UI/UX): the owner has been asked what bothers them; brainstorm from their answer. (c) release only on the owner's go.
