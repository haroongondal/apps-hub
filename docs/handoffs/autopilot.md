# Autopilot (Inflow + Deputy + Halo + Design Editor) — handoff

## Resume prompt
(2026-11-18) Read this file completely first, then the design
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

## Current state + next step
Design approved; stage 1 plan written, waiting for the owner's review and choice of execution method (use
cd-engineering-tools:parallel-agents-coord, never superpowers:subagent-driven-development). Execution starts after
inflow/post-release merges to main, in a new worktree apps-hub-wt/autopilot-1 on branch autopilot/stage-1. Stage 2
plan (Halo) is written after Halo (incl. stage 5) merges; stage 3 plan after that.
