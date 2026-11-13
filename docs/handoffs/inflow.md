# Inflow handoff (formerly Notebox)

## Resume prompt (2026-11-14, stages 1-4 built, reviewed and fixed; release on hold)

```
Continue the Inflow work (formerly Notebox), resume prompt dated 2026-11-14. Work only in the
worktree /Users/outsentia/Documents/apps-hub-wt/inflow (branch inflow/stage-4, which holds stages
1-4), never in the main checkout /Users/outsentia/Documents/apps-hub (branch model-host, unrelated
uncommitted work; its untracked docs/handoffs/notebox.md and Notebox design copy are stale
leftovers, delete only after the merge and with the owner's OK). Claim the worktree folder with
coord before you start (~/.claude/plugins/cache/claude-agent-workflow/coord/1.0.0/bin/coord claim
<folder>) and release it when you stop.

1. Read docs/handoffs/inflow.md completely first (especially "Current state and next step"),
   then progress.md (stage 4 ledger, untracked: rulings R23-R34, reviews, fix waves;
   progress-stage-{1,2,3}.md hold the earlier stages). Design:
   docs/superpowers/specs/2026-11-13-inflow-design.md; plans: docs/superpowers/plans/
   2026-11-13-inflow-stage-{1,2,3}.md and 2026-11-14-inflow-stage-4.md. Trust the decisions,
   rulings and verified facts; do not re-ask the owner what they settled; do not re-run reviews
   or fix waves.
2. Release waits for the owner's word (last answer: "Fix both, hold release"). When they say go:
   push, PR, squash-merge with [skip ci], then pnpm release inflow locally from a clean checkout
   of merged main. Install only from the Store; never adb-install on the owner's phone; claim
   device:<ro.serialno> with coord first. Run the phone checks of stages 1-4 (each plan's
   "Controller: close" and Task 9 step 3 of stage 1, plus the extra checks below) and record
   actual observations. No Claude attribution lines.
3. Stage 5 (rules: tags, hide, important, sender and word matching, apply to saved items) is the
   last stage. It inherits: suggested AI tags are stored but inert until rules/tags exist (R26);
   the owner's rules override AI importance (design).
4. Keep this handoff current as milestones land; at ~85% context stop, rewrite this prompt
   with the date and print it for a new chat.
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

State (2026-11-14): stages 1-4 built, reviewed and fixed on `inflow/stage-4` (code HEAD 2ed42e5).
Nothing pushed, merged, released or installed; release waits for the owner's word. Gates at
2ed42e5: Kotlin 228 tests 0 failures, assembleDebug, pnpm test 0, pnpm typecheck 0 (inflow 41/41).

Stage 3 facts: INTERNET in the module manifest; Gmail only to `imap.gmail.com:993` (TLS, identity
checked); Angus Mail 2.0.3 (EPL/GPL+CE/EDL), licence files merged into the APK (R19); exact From
address match, "@domain" for a whole domain (R20).

Stage 4 facts: AI through the owner's OpenAI-compatible https address (Deputy's provider copied
into `core/AiProvider.kt`; kotlinx-serialization-json 1.8.1, Apache-2.0; HttpURLConnection, no
redirects). Keys in SQLCipher `ai_keys`, only the last four reach JS. Only items saved after the
first key are sent (meta `aiSince`); Ask AI money follows the same rule (R31). Daily cap $0.50
default. Batches: at most 40 items and 60,000 characters, `max_tokens` 8,000. AI amounts must
appear in the item text (R27); duplicate ids dropped; AI-only txns count straight away, never pair,
and yield to a later bank pattern on the same item (keeping category and own mark). A refused
batch is dropped only after one retry and only when another batch in the run worked (R34); two
refusals in a row stop the run and keep the queue. Items blocked mid-queue are dropped for good.
Tabs: Home, Money, Ask AI, Settings.

Unproven until the phone check: all SQL under SQLCipher (v2 rebuild, v3, v4, email and AI queries,
tombstones, Ask filters; proven only in desktop sqlite3, no store-level harness, R32), SMS provider
queries and permission grant under a Store install, real IMAP, real model replies (JSON shape,
token usage, timeouts), the 30-minute runners on HyperOS, every screen.

Extra phone checks: a new SMS appears within ~30 s with the app closed; first open imports the
inbox once; stage 3 and stage 4 plans' "Controller: close" lists; a wrong model name shows the
refusal in Settings and keeps the queue.

Next step: resume prompt step 2 (or stage 5 planning if the owner asks for it first).
