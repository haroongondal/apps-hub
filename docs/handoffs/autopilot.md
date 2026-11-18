# Autopilot (Inflow + Deputy + Halo + Design Editor) — handoff

## Resume prompt
(2026-11-19) Read this file completely first, then the design
docs/superpowers/specs/2026-11-18-autopilot-design.md. Trust the verified facts below; do not redo that research.
Follow the handoff contract in ~/.claude/CLAUDE.md (update the session log and current state at milestones; hand off
at ~85% context). Continue from "Current state + next step".

## Goal and fixed constraints
- The owner's own apps work together: Inflow spots something to do, Autopilot prepares it, one tap starts it; Halo
  shows it (edge, AOD, bubble), a creature grows with done chores, Design Editor makes cards.
- Nothing starts without the owner's tap. Deputy's gate and Inflow's AI rules stay as they are.
- Private Store installs only; phone via coord device queue; Halo releases pre-approved, others need the owner's go.

## Decisions made (owner, 2026-11-18, via multiple-choice)
- Direction: Autopilot first. Catches: bills/due dates, chat requests, meetings/to-dos, money surprises (all four).
- Surfaces: edge pulse + AOD, notification card, floating bubble, daily digest (all four).
- Fun: edge/AOD, shareable cards, wallpaper recolour, creature (all four). Creature feeds on done chores and
  no-spend days.
- Sharing between own apps: full text. Deputy: suggest, owner taps.
- Build all four apps (shipped in three Store stages, my call). Brain in Inflow (approach A). Chats reach the AI
  within a minute; the rest stays on the 30-minute batch.

## Verified facts (2026-11-18)
- All nine Android apps are signed with the one apps-hub key (cert e3af4a92…; tools/release/src/main.ts:83-84
  refuses any other). No app declares a custom permission, exported provider, sharedUserId or SEND target.
- Deputy: `startRun(task, allowedApps)` is in-process only (DeputyAgentModule.kt:80); no external start. Schedules
  and notification rules (SPEC §11) are not built.
- Inflow AI: per-item JSON (kind, summary, importance, money, todos with due, tags) in core/Ai.kt; batch every
  30 min (android/AiRunner.kt PERIOD_MIN). Tables include todos, reports, ai_results, txns.
- Halo: notification flash with reminder repeat, AOD faces, no INTERNET in release, no exported hooks, stores no
  notification text. Has SYSTEM_ALERT_WINDOW.
- Design Editor mobile: scheme `designeditor`, on-device CLIP photo search, shares via ACTION_SEND.
- Branches: Inflow newest on inflow/post-release (unreleased), Halo on halo; main checkout is on model-host (stale).
- Research (web): Rewind/Limitless capture shut down after Meta acquisition (Dec 2025, per vendor blogs); Android 16
  ProgressStyle live updates; WallpaperManager.setBitmap needs SET_WALLPAPER, re-theming must be checked on phone.

## File map
- Design: docs/superpowers/specs/2026-11-18-autopilot-design.md (approved by the owner 2026-11-18).
- Worktree: ~/Documents/apps-hub-wt/autopilot, branch `autopilot`, from origin/main df22cc60.
- Standing rule: root CLAUDE.md "Apps working together (Autopilot)" tells every session to check this design when
  planning a new app or feature (owner request, 2026-11-18).

## Session log
- 2026-11-18 S1: read specs/handoffs of all four apps, app inventory, web research; owner answered two MCQ rounds
  and picked approach A; design written; builder check dispatched.

- 2026-11-18 S1 (cont.): builder check found R44 conflict (verified in Inflow fix-4c-brief.md and AiChannels.kt);
  owner amended R44 to "chats from people I pick" (Autopilot only, Ask AI unchanged) and chose "phone lock is
  enough" for Run/Skip. My calls folded in: code-built titles, untrusted block for Deputy, branch timing.
  Root CLAUDE.md got the standing "Apps working together" rule.

- 2026-11-18 S1 (end): PR #46 opened (design). Stage 1 plan written: docs/superpowers/plans/2026-11-18-autopilot-stage-1.md
  (12 tasks: contract package, Inflow core + provider + notifications + screens, Deputy untrusted block and
  RunSuggestionActivity, gates/phone checks). Wallpaper probe moved to stage 3 (needs Halo).

- 2026-11-19 S2: stage 1 execution started with cd-engineering-tools:parallel-agents-coord. Worktree
  ~/Documents/apps-hub-wt/autopilot-1, branch `autopilot-stage-1` (git refuses `autopilot/stage-1` while branch
  `autopilot` exists), from origin/main 18937ec4 + merge of `autopilot`. Run ledger (untracked, local):
  ~/Documents/apps-hub-wt/autopilot-1/.sdd/progress.md with briefs and rulings R1-R11. Done and controller-checked:
  T1 contract (90f76a27), T2 model (770cb596), T3 AI field (3710fd98), T4 rules (c55b5dc2), T5 store (726ddddb),
  T9 Deputy (b2cd8172, opus review: 0 Important). T6 running. Spec deviation: the sender name travels in Deputy's
  untrusted block, not the task text (spec §8.1 to be corrected in T12).

- 2026-11-19 S2 (stage 1 built), one line per task, branch `autopilot-stage-1`:
  - T1 contract package (8b690301, 90f76a27). T2 suggestion model and code-built titles (770cb596). T3 AI `suggest`
    field (3710fd98). T4 suggestion rules, settings, money surprise (c55b5dc2).
  - T5 suggestion store, schema v8, AI run wiring (56adcc78, 726ddddb: money-in wording).
  - T6 picked chats, R44 exception, fast path (6df7a57f); opus review fix round (9947feb0: picks are `pkg|conversationKey`,
    no ledger from picked-only items, no stale reply); follow-up (7d221078: ledger takes only SMS and Gmail, reply keys carry
    the package).
  - T7 signature-guarded provider and item access rule (662c029c, 4b6eea0f: expire before a move).
  - T8 run plan, notification cards, Skip receiver (0631a4b6). T9 Deputy untrusted block and RunSuggestionActivity
    (f32b86c6, b2cd8172: name moved into the untrusted block). T10 Inflow module API (33d6bbad). T11 Waiting block,
    Suggestions and Autopilot settings screens (0cc1a324).
  - T12 closing: Run activity always finishes, any start failure becomes a message, a late done still lands (b0944ff4);
    docs (AGENTS.md, Deputy SPEC §10 and §11, the Autopilot design's Build decisions); this handoff.
  - Rulings R1 to R18 are in the local run ledger `.sdd/progress.md` (untracked). Those that matter to the owner are in the
    design's "Build decisions" section.
  - T12 ruling on STARTED expiry: `SuggestionMoves.move` sweeps expired rows only when the move is to STARTED, so a late
    Deputy `done` or a skip still lands. List and read paths still sweep STARTED rows past `expires_at`, so a read
    between expiry and a late `done` can still flip the row to expired. Cost if wrong: an event suggestion whose Deputy run
    ends after the event time can read as expired instead of done (a label only; replies expire after 24 h).
  - Not done in T12: `ref` in `SuggestionTask.begin` is unused but is part of the tested signature, left alone. Whole-branch
    review (invariant-reviewer, code-reviewer): not run in T12; the controller owns it.

## Current state + next step
Stage 1 is built on `autopilot-stage-1`, not pushed (pushing, the PR and the releases need the owner's go). JVM tests,
typecheck and the Gradle build gates were run in T12 (results in the T12 report). Nothing has run on the phone.
Next step: (1) whole-branch review, opus, focused on the R44 exception, the untrusted block and provider access; (2) the
owner's go to push, open the PR into `main` and release Inflow and Deputy (`pnpm release inflow`, `pnpm release deputy`,
locally, merge with `[skip ci]`); (3) the phone checks below from the Store build; (4) stage 2 (Halo edge pulse, AOD Waiting
row, bubble, daily digest) and stage 3 (creature, wallpaper probe, cards).

## Phone checks (the owner's list; every one not run)
Install only through the Store. Claim `device:<serialno>` with coord first.
1. A real bill SMS gives one "Bill due" suggestion and one reminder. Not run.
2. The same bill by email adds no second suggestion. Not run.
3. A Roman Urdu "kal meeting 11 baje" in a picked chat gives "Meeting 11:00 tomorrow", and Run opens the calendar filled in. Not run.
4. A request from a picked contact gives "Reply to <name>" with one heads-up, and Run opens Deputy, which shows the drafted reply and asks before sending. Not run.
5. A debit above PKR 50,000 gives "Large debit at ...". Not run.
6. An unpicked WhatsApp chat produces nothing. Not run.
7. Ask AI cannot answer about the picked chat. Not run.
8. With Deputy's accessibility service off, Run shows the setup message and the suggestion stays waiting. Not run.
Unknowns the JVM tests cannot settle (from the ledger), also not run:
9. The Run button on the notification works on HyperOS and starts Deputy's activity from it.
10. `startForegroundService` from Deputy's no-display activity is not refused on Android 12 and later (the call is wrapped, so the run would go on without its foreground service).
11. The calendar insert intent and its alarm extra; package visibility for the four app-category lookups and for Deputy.
12. The exact queued-items SELECT (column indices 9 and 10) on SQLCipher; the bill reminder's delay (inexact alarm).
13. The provider answers while Inflow is locked and not running (R12).


## Final state, 2026-11-19 (stage 1 code-complete on autopilot-stage-1)
- Built and checked: T1 to T12, plus the whole-branch reviews and their fixes. Reviews: code (not ready, then fixed), privacy (a blocker: item text served without a suggestion; fixed in a812f1cb, re-reviewed privacy-clean).
- Gates on the final HEAD: `pnpm test` exit 0, `pnpm typecheck` exit 0, `pnpm --filter @apps-hub/ui test` 21/21, Inflow `:inflow-core:testDebugUnitTest :app:assembleDebug :app:processReleaseMainManifest` 554 tests 0 failures, Deputy 267 tests 0 failures, Inflow TS 86/86, typecheck 0.
- Owner decisions taken this session: R17 (bank parsing and ledger take only SMS and Gmail), R22 (event titles carry the absolute date: "Meeting 11:00 on 19 Nov"; the design example "tomorrow" is superseded), R12 (the provider answers while locked; a signature holder can read live reply text), R18 (old WhatsApp transactions kept; say if you want them removed), the chat key format pkg|conversationKey.
- Not pushed. Nothing released. The design PR #46 holds the design and the plan; stage 1 needs its own branch PR when the owner says.
- Open minors (recorded in .sdd/progress.md): the B1 SQL has no real-SQLite test (JVM tests run on the in-memory twin); a bankApp saved before the package check is not re-validated on read; a contact-named SMS sender gets no reply suggestion unless picked; the suggestion list still shows titles to any holder; blocked senders do not sweep existing cards (R20); the bill key uses the largest number in the text (shortcut).
- Phone checks (13, see above): NOT RUN. Needs the owner's phone, coord device claim and a Store release for Inflow and Deputy (owner's go).
- Next step: owner review of the branch; then the owner's go to push and open the stage 1 PR, and to release Inflow and Deputy; then the phone checks; then stage 2 (Halo) after Halo's branch merges.
