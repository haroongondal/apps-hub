# Handoff: Sieve (one Chrome extension replacing IDM Integration, Enhancer for YouTube, AdBlock)

## Resume prompt

```
Date: 2026-11-06. Start implementing Sieve, my private Chrome extension (ad blocking, YouTube
tools, downloads). Work only in the worktree /Users/outsentia/Documents/apps-hub/.claude/worktrees/sieve
on branch `sieve` (enter it with EnterWorktree path=<that folder>). Do not use the main checkout:
its branch `model-host` belongs to other work, and its copies of the Sieve docs are stale.

1. Read docs/handoffs/sieve.md in the worktree completely first. Then read the plan
   docs/superpowers/plans/2026-11-06-sieve.md and the design
   docs/superpowers/specs/2026-11-06-sieve-design.md.
2. Trust the handoff's decisions and verified facts; do not redo that work. Examples: the
   converter is @adguard/dnr-converter, the filter-list URLs are checked, and the baseline tests
   pass.
3. I approved the plan on 2026-11-06. Execute it with superpowers:subagent-driven-development,
   task by task, starting at phase 0 Task 0.1 (the YouTube download spike). Give each implementer
   subagent the plan's Global Constraints, Review Focus, and its task's Interfaces block.
4. Task 0.6 needs me to run a signed-in checklist in my own Chrome. Ask me when you get there,
   and never use my Chrome profile in automated tests. While waiting, continue with Tasks 1.1 to
   1.10, which do not depend on the spike.
5. Commit after each task on `sieve`. Never add Co-Authored-By or "Generated with" lines. Do not
   push, open a PR or merge unless I ask.
6. Follow the handoff contract. Update the session log and "Current state and next step" in
   docs/handoffs/sieve.md as each task lands. At ~85% context, stop starting new work, finalize
   the handoff, rewrite this resume prompt with the date, print it in a fenced block for me, and
   end the turn.
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

## Spike results

### S1 (page data, signed out)

Run 2026-11-06 with `node apps/sieve/spike/run.mjs` (headless Chrome for Testing 149, fresh profile, no consent page or bot check). `counts` and `maxHeight` cover `adaptiveFormats`; `muxed` covers `streamingData.formats`:

```json
{"strategy":"S1","videoId":"aqz-KE-bpKQ","signedIn":false,"playability":"OK","sabr":true,"counts":{"url":0,"cipher":0,"none":40},"maxHeight":{"url":null,"cipher":null,"none":2160},"muxed":{"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null}}}
{"strategy":"S1","videoId":"dQw4w9WgXcQ","signedIn":false,"playability":"OK","sabr":true,"counts":{"url":0,"cipher":0,"none":26},"maxHeight":{"url":null,"cipher":null,"none":2160},"muxed":{"counts":{"url":0,"cipher":1,"none":0},"maxHeight":{"url":null,"cipher":360,"none":null}}}
```

- Reading: S1 gives 0 plain URLs on both videos. SABR is on, and every adaptive format (40 and 26, up to 2160p) carries neither `url` nor `signatureCipher`. The only direct candidate is the single muxed 360p format on `dQw4w9WgXcQ` (itag 18), which has a `signatureCipher`; `aqz-KE-bpKQ` has no muxed formats. So anything above 360p needs SABR or another client (Task 0.2), and the 360p one needs signature solving (Task 0.3).
- Fixture: `apps/sieve/spike/fixtures/player-response.json` comes from `dQw4w9WgXcQ` (one `adPlacements`). The test video has no ad placements, so `run.mjs` only writes the fixture when the response has some (`VIDEO=<id>` picks the video). Every URL and every key matching `servingdata|trackingparams|baseurl|url$|token$|signaturecipher` holds `https://example.invalid/stream`, and `run.mjs` refuses to write a fixture that fails the same check.

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
  - Baseline: `pnpm test` is clean.
  - The owner approved the plan; implementation starts in session 3.

## Current state and next step

- **State:** the owner approved the plan on 2026-11-06 and asked to start implementation in a new
  chat. No code yet. Branch `sieve` is at the handoff-baseline commit, and the worktree is clean.
  The untracked copies of this file and the design in the main checkout
  (`/Users/outsentia/Documents/apps-hub`, branch `model-host`) are stale. The worktree copies are
  the real ones.
- **Execution method:** subagent-driven (superpowers:subagent-driven-development), as recommended
  in session 2. The owner approved without naming a method. Switch to native
  (superpowers:executing-plans) only if the owner says so.
- **Next step:**
  1. Execute phase 0 (Tasks 0.1 to 0.6). Task 0.6 needs the owner to run the signed-in checklist.
     Phase 1 (Tasks 1.1 to 1.13) does not depend on the spike except Task 1.11's fixture, so
     Tasks 1.1 to 1.10 may start while waiting for the owner.
