# Handoff: Sieve (one Chrome extension replacing IDM Integration, Enhancer for YouTube, AdBlock)

## Resume prompt

```
Date: 2026-11-06. Read docs/handoffs/sieve.md in /Users/outsentia/Documents/apps-hub completely
first, then the design it points to. Trust its verified facts and decisions; do not redo that
work. Follow the same handoff contract (update the session log and current state as milestones
land; at ~85% context, finalize and print a new resume prompt). Continue from "Next step".
```

## Goal and fixed constraints

One private, unpacked Chrome (MV3) extension for the owner's Mac that does everything the three
extensions do, paid tiers included, minus Image Swap, the custom JS runner, and the pop-up and
mini players. Our own code only: the packages were read to list features, and nothing is copied.
Full design: `docs/superpowers/specs/2026-11-06-sieve-design.md`.

## Decisions (with why)

The design file's "decided by the owner" sections are authoritative. In short:

- **Downloads:** grab media on pages, faster resumable split downloads, take over all downloads,
  and keep IDM-app extras (queue, speed limit, scheduler, categories). IDM itself does not run on
  macOS.
- **YouTube downloads:** in. The owner accepts regular breakage. If the spike only partly passes,
  ship whatever quality works.
- **No helper program on the Mac.** The owner chose everything inside Chrome. They were told that
  splitting mostly buys resume, not speed (Chrome's connection limits).
- **Browser and use:** Chrome only, for the owner alone (never published).
- **Location:** a new app in apps-hub (Strongroom extension pattern).
- **Screens:**
  - toolbar menu with three tabs (Blocking, Downloads, YouTube)
  - IDM-style table for the download list
  - a hover-only download icon on videos
  - an Enhancer-style button row under the YouTube player
- **Anti-goals (all four chosen):** do not slow browsing, do not break sites, never lose a
  download, YouTube must not feel janky.
- **Name:** Sieve (my pick; the owner said "pick one for me").

## Verified facts

- **Recon (2026-11-06):** the three packages are unpacked in this session's scratchpad (may be
  cleaned up). The feature inventory is in the design file's "Recon" section, so there is no need
  to unpack them again.
- **Strongroom extension pattern:** it is on branch `strongroom-extension` (commit `c3da09c`) and
  is not on `main`. See `apps/strongroom-extension/build.mjs` and `test/e2e.mjs` there.
- **Brand list:** `packages/ui/src/tokens.ts` line 4 (`BrandKey`). Sieve needs a new key.

## File map

- `docs/superpowers/specs/2026-11-06-sieve-design.md`: the design
- `docs/handoffs/sieve.md`: this file
- `.superpowers/brainstorm/87424-1793907956/content/`: the mockups (gitignored)

## Session log

- **2026-11-06:** brainstorm with the owner; recon of the three packages; design written. Builder
  check returned 6 questions. The helper question went to the owner (everything in Chrome). My
  calls, recorded in the design:
  - one per-site blocking switch
  - MP4 output only for H.264/HEVC with AAC, otherwise WebM/MKV
  - signed-in YouTube checks are an owner checklist
  - no importers

## Current state and next step

- **State:** the owner approved the design on 2026-11-06. No code yet, and nothing is committed.
  This file and the design are untracked files in the main checkout
  (`/Users/outsentia/Documents/apps-hub`), whose branch `model-host` belongs to other work. Do not
  commit Sieve there.
- **Next step:**
  1. Create a worktree on a new branch `sieve` from `main` (superpowers:using-git-worktrees).
  2. Copy this file and `docs/superpowers/specs/2026-11-06-sieve-design.md` from the main
     checkout into the worktree, and commit them as the branch's first commit (the owner asked for
     the work to start). No Claude attribution lines in commits (see memory).
  3. Write the implementation plan with superpowers:writing-plans, saved to
     `docs/superpowers/plans/2026-11-06-sieve.md`. Plan phase 0 (the YouTube download spike) and
     phase 1 (the shell and blocking) in full task-level detail. List phases 2 to 5 as outlines
     only, to be planned after the spike, because its results change phases 3 to 5.
  4. Show the owner the plan, then execute it.
