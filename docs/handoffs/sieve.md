# Handoff: Sieve (one Chrome extension replacing IDM Integration, Enhancer for YouTube, AdBlock)

## Resume prompt

```
Date: 2026-11-06. Work in the worktree /Users/outsentia/Documents/apps-hub/.claude/worktrees/sieve
(branch `sieve`). Read docs/handoffs/sieve.md there completely first, then the design and the plan
it points to. Trust its verified facts and decisions; do not redo that work. Follow the same
handoff contract (update the session log and current state as milestones land; at ~85% context,
finalize and print a new resume prompt). Continue from "Next step".
```

## Goal and fixed constraints

One private, unpacked Chrome (MV3) extension for the owner's Mac that does everything the three
extensions do, paid tiers included, minus Image Swap, the custom JS runner, and the pop-up and
mini players. Our own code only: the packages were read to list features, and nothing is copied.

- Design: `docs/superpowers/specs/2026-11-06-sieve-design.md`
- Plan: `docs/superpowers/plans/2026-11-06-sieve.md`. Phases 0 and 1 are in task detail; phases 2 to 5 are outlines, to be planned after the spike.

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

My calls this session, recorded in the plan:

- **Converter: `@adguard/dnr-converter` 2.0.0** (GPL-3.0-only, pure JS). eyeo's `@eyeo/abp2dnr`
  was rejected: it needs a native build (node-gyp) and pulls in `@sentry/browser` through
  `@eyeo/webext-ad-filtering-solution`, which breaks the no-telemetry rule.
- **Parsing: `@adguard/agtree` 4.3.0** (MIT). It parses cosmetic and scriptlet filters, with
  `RuleConverter.convertToAdg` for ABP and uBO syntax.
- **Scriptlets: `@adguard/scriptlets` 2.5.1** (GPL-3.0). `scriptlets.getScriptletFunction(name)`
  returns self-contained functions for `scripting.executeScript({ world: 'MAIN' })`.
- **Cosmetic delivery:**
  - Generic CSS goes into registered content scripts, one per feature, with `excludeMatches` for allowlisted hosts and exception hosts.
  - Site-specific CSS and scriptlets are injected by the service worker on `webNavigation.onCommitted` (CSS with `insertCSS` at user origin).
  - The converter stays out of the worker bundle. Only the settings page compiles My filters.
- **Distraction list:** Fanboy's Annoyance list with its `easylist_cookie_*` sections stripped
  (the list is a concatenation with `! <file>.txt` section headers).
- **Brand:** `sieve`, hue 186, accent dark `#22D3EE` and light `#0E7490`. Not yet run through
  the WCAG test.
- **Chrome types:** `@types/chrome` (MIT, types only) instead of hand-typing the large API surface.

## Verified facts

- **Recon (2026-11-06):** the feature inventory is in the design file's "Recon" section, so there is no need to unpack the three packages again.
- **Strongroom extension pattern:** it is on branch `strongroom-extension` (commit `c3da09c`),
  not on `main`, with a worktree at `.claude/worktrees/strongroom-extension`. See `apps/strongroom-extension/build.mjs`,
  `test/e2e.mjs` (playwright-core from `~/Documents/browser-automation`, Chrome for Testing
  `chromium-1228` in `~/Library/Caches/ms-playwright`; both exist) and `src/popup.ts`, which has the `h()` helper.
- **Brand list:** `packages/ui/src/tokens.ts` line 4 (`BrandKey`) and the `brands` record. The
  WCAG tests loop over every brand automatically.
- **Converter behaviour (checked in the scratchpad, 2026-11-06):**
  - `new FilterConverter().convert([new Filter(1, text)])` returns DNR rules with hashed ids. Allow rules get priority 100001, so ids must be renumbered.
  - The library build does not import `@adguard/re2-wasm`; only its command-line tool does.
  - agtree classifies `##`, `#@#`, `#?#`, `#$#` and `##+js(...)` correctly.
- **Filter list addresses (HTTP 200 with an Adblock header, 2026-11-06):**
  - EasyList `https://easylist.to/easylist/easylist.txt`
  - EasyPrivacy `https://easylist.to/easylist/easyprivacy.txt`
  - Fanboy's Annoyance `https://secure.fanboy.co.nz/fanboy-annoyance.txt`
  - EasyList Cookie `https://secure.fanboy.co.nz/fanboy-cookiemonster.txt`
  - Adblock Warning Removal `https://easylist-downloads.adblockplus.org/antiadblockfilters.txt` (slow: timed out once at 60 s, then fetched over HTTP/1.1)
  - ABP anti-circumvention `https://easylist-downloads.adblockplus.org/abp-filters-anti-cv.txt`
  - `easylist-newsletters.txt`, `easylist-notifications.txt` and `easylist-annoyances.txt` on `easylist-downloads` return 404.
- **Worktree baseline:** `pnpm install --frozen-lockfile` in the worktree succeeded (2.7 s).
  `pnpm test` exited 0 with 0 failures (about 485 tests).

## File map

- `docs/superpowers/specs/2026-11-06-sieve-design.md`: the design
- `docs/superpowers/plans/2026-11-06-sieve.md`: the plan
- `docs/handoffs/sieve.md`: this file
- Planned: `packages/sieve-core/` (pure logic) and `apps/sieve/` (the extension; the spike is in `apps/sieve/spike/`)
- `.superpowers/brainstorm/87424-1793907956/content/` in the main checkout: the mockups (gitignored)

## Session log

- **2026-11-06 (session 1):** brainstorm with the owner; recon of the three packages; design written. Builder
  check returned 6 questions. The helper question went to the owner (everything in Chrome). My
  calls, recorded in the design:
  - one per-site blocking switch
  - MP4 output only for H.264/HEVC with AAC, otherwise WebM/MKV
  - signed-in YouTube checks are an owner checklist
  - no importers
- **2026-11-06 (session 2):**
  - Created the worktree `.claude/worktrees/sieve` on branch `sieve` from `main` (`ec23cbd`).
  - Committed the design and this file (`bedb6d2`).
  - Chose the converter and checked the list addresses.
  - Wrote the plan.

## Current state and next step

- **State:** the plan is written and committed on branch `sieve`. No code yet. The owner has not
  yet reviewed the plan or chosen an execution method.
- **Next step:**
  1. Get the owner's review of the plan and their choice: subagent-driven or native execution.
  2. Execute phase 0 (Tasks 0.1 to 0.6). Task 0.6 needs the owner to run the signed-in checklist.
     Phase 1 (Tasks 1.1 to 1.13) does not depend on the spike except Task 1.11's fixture, so
     Tasks 1.1 to 1.10 may start while waiting for the owner.
