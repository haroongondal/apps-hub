# Notebox handoff

## Resume prompt (2026-11-13, stage 1 ready to build)

```
Continue the Notebox work. Work only in the worktree
/Users/outsentia/Documents/apps-hub-wt/notebox (branch notebox/stage-1), never in
the main checkout. Claim that folder with coord before you start.

1. Read docs/handoffs/notebox.md completely first, then the design
   docs/superpowers/specs/2026-11-13-notebox-design.md and the plan
   docs/superpowers/plans/2026-11-13-notebox-stage-1.md. Trust the decisions and
   verified facts in them; do not re-ask the owner what they already settled.
2. The owner asked for stage 1 to be built. Commit the design, handoff and plan as
   the first commit, then execute the plan task by task with
   cd-engineering-tools:parallel-agents-coord (not
   superpowers:subagent-driven-development), following the task order and parallel
   groups at the top of the plan. Stop before Task 9 step 2 (release) and ask the
   owner for the go.
3. Follow the handoff contract in ~/.claude/CLAUDE.md: keep docs/handoffs/notebox.md
   current (session log, current state, next step) as tasks land, and when context
   reaches ~85% stop, rewrite this resume prompt with the date and print it for a
   new chat.
```

## Goal and fixed constraints

Build Notebox (`apps/notebox`, `com.haroon.notebox`, Store id `notebox`): a private
Android app that saves every notification, imports SMS, downloads marked Gmail
emails, builds a spending ledger from bank messages, runs AI over new items in
30-minute batches, and organises it all. Full design and every owner decision:
`docs/superpowers/specs/2026-11-13-notebox-design.md`.

Fixed:
- Five stages, each planned, built, released through the private Store and tested
  on the owner's phone before the next starts (owner's request). Order: 1 capture
  and browse, 2 SMS and money, 3 Gmail, 4 AI, 5 rules.
- Repo rules in AGENTS.md / CLAUDE.md apply: Kotlin owns capture, storage, parsing,
  Gmail and AI; RN only renders with `@apps-hub/ui` (new `notebox` brand); no
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
  design, deputy, strongroom. Adding `notebox` needs `pnpm --filter @apps-hub/ui build:css`.
- Owner's real bank SMS formats (Alfalah credit, Alfalah debit card, UBL Raast) and a
  Jazz Roman Urdu sample are quoted verbatim in the design; use them as test fixtures.
- Not yet checked: whether the Store's installer lets Notebox be granted READ_SMS
  (hard-restricted permission). Stage 2 starts with that check.

## File map

- Design: `docs/superpowers/specs/2026-11-13-notebox-design.md`
- This handoff: `docs/handoffs/notebox.md`
- Closest existing apps to copy structure from: `apps/deputy`, `apps/strongroom`
- Store / release: `docs/app-store.md`, `tools/release`

## Session log

- 2026-11-13: brainstorm with the owner, design written, builder check run and its
  four questions folded in (three settled as my calls, one left open: see design
  "Open question"). Nothing built. Design and handoff are untracked files in the
  main checkout, which was on branch `model-host` with unrelated uncommitted work.
- 2026-11-13 (same day): worktree `/Users/outsentia/Documents/apps-hub-wt/notebox` on branch
  `notebox/stage-1` (from main 226a947) holds copies of the design and this handoff. Stage 1
  plan written there: `docs/superpowers/plans/2026-11-13-notebox-stage-1.md` (9 tasks).
  Nothing committed yet.

- 2026-11-13 (build session 1): design, plan and handoff committed (bbe0e5c). Controller ledger
  is `progress.md` in the worktree root (untracked on purpose; it holds the conflict scan,
  rulings and per-task status). coord claim on the worktree needs
  `CLAUDE_CODE_SESSION_ID` set by hand in this harness. Task 1 done (588e74f): app shell,
  `notebox` brand, backup rules, Store registration; Gradle gate green. Plan gaps found and fixed:
  `ANDROID_PACKAGES` in `packages/store-manifest/src/index.ts` needs the new app, `.gitignore`
  entries per app, INTERNET only in debug manifests plus a release `tools:node="remove"` overlay.
  Ruling: Tasks 2 and 3 run one after the other (a red test file breaks the other agent's Gradle
  compile); Task 7 (TS only) runs alongside the Kotlin chain.

- 2026-11-13 (session 3): coord claim on the worktree needs `CLAUDE_CODE_SESSION_ID` set by hand
  (harness does not export it; any unique string works, none held the folder). The batched review of
  the risky commits was finished by reading the code myself (opus and sonnet reviewers had timed out):
  OTP detector, ingest, listener, store key paths and tombstones, no Important findings. Task 9 step 1
  gates run from the repo root: `pnpm test` exit 0 (notebox 16/16), `pnpm typecheck` exit 0, Gradle
  `:notebox-core:testDebugUnitTest :app:assembleDebug` BUILD SUCCESSFUL. `expo-doctor` run from
  `apps/notebox` (Notebox has no doctor script, like Strongroom and Deputy): 16/18, the two failures
  are the usual prebuild-app warnings (gitignored `modules/*/android/build`, app.json fields with a
  committed `android/`); module sources are tracked (27 files).

  Final reviewers on `226a947..HEAD`: invariant-reviewer "no findings" (merged release manifest
  re-checked by hand: no INTERNET, no QUERY_ALL_PACKAGES, allowBackup false); code-reviewer "approve
  with comments", fixed: list paging skipped items sharing a `posted_at` (now pages on time and id,
  `listItems(filter, before, limit, beforeId)`), and `raw.fill(0)` on the SQLCipher key array removed
  because the connection config re-reads it. Gates re-run green after the fixes.

## Current state and next step

State: Tasks 1-8 complete, Task 9 step 1 (gates and final reviewers) complete and fixes committed.
Kotlin 45 JVM tests, Gradle gate green; TS 16 tests, typecheck clean. Release (Task 9 step 2) NOT
done. SQL is unproven on a JVM (no SQLCipher): the device check in Task 9 step 3 is the proof.
Deferred minors (progress.md): no `PRAGMA secure_delete`; expired OTP rows are purged only on the next
notification or when Home opens (hidden from every read meanwhile; a scheduled purge would make the 5
minutes strict); `settingFor` stores the package name as label for a never-seen app.

Next step: ask the owner for the go to release (Task 9 step 2: merge with `[skip ci]`, then
`pnpm release notebox` locally). Then the phone check (step 3, claim `device:<serial>`, install from
the Store only), step 4 handoff update, step 5 commit `Notebox stage 1: handoff`.

Next step:
1. Work only in `/Users/outsentia/Documents/apps-hub-wt/notebox` (branch `notebox/stage-1`).
   Claim the folder with coord first (`CLAUDE_CODE_SESSION_ID=<this session id> coord claim <folder>`).
2. Read `progress.md`; tasks with a `Task <N>: complete` line are done. Continue the plan order:
   Task 3 after Task 2, Task 4 after 3, Task 5 after 4, Task 6 after 5, Task 8 after 6 and 7.
   Stop before Task 9 step 2 (release) and ask the owner for the go.
3. Before planning stage 4, ask the owner the design's open question (do AI-only
   transactions count straight away or wait in "to check").
