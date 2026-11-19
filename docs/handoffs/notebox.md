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

## Current state and next step

State: design and stage 1 plan written in the `notebox/stage-1` worktree, uncommitted; no code.

Next step:
1. Work only in `/Users/outsentia/Documents/apps-hub-wt/notebox` (branch `notebox/stage-1`).
   Claim the folder with coord first.
2. The owner asked for stage 1 to be built (2026-11-13). Commit the design, this handoff
   and the plan as the first commit, then execute the plan with `cd-engineering-tools:parallel-agents-coord`
   (task order and parallel groups are at the top of the plan).
3. Before planning stage 4, ask the owner the design's open question (do AI-only
   transactions count straight away or wait in "to check").
