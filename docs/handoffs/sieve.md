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

### S2 (alternate clients, signed out)

Run 2026-11-06 with `node apps/sieve/spike/run.mjs` (same setup as S1: headless Chrome for Testing 149, fresh profile). Each client's result is stored as `probe:S2:<yt-dlp client name>` (the yt-dlp name, because three clients share `clientName` TVHTML5).

**Where the client list comes from.** yt-dlp `yt_dlp/extractor/youtube/_base.py` at commit `12ac9aca79671420724227aca37bc888c604a6f8` (2026-10-21, "[ie/youtube] Fix initial data extraction (#17703)"), the latest commit touching that file when I read it. I took every `INNERTUBE_CLIENTS` entry whose `GVS_PO_TOKEN_POLICY` does not require a PO token for HTTPS or DASH streams (no policy at all). Not picked, because the policy requires one for HTTPS and DASH: `web`, `web_safari` (only HLS is exempt, and yt-dlp says HLS formats now need a signed-in or trusted session), `web_music`, `web_creator` (also `REQUIRE_AUTH`), `android`, `android_vr` (its comment says every format is 403 since 2026.08.17), `ios` (HTTPS and HLS required; it has no DASH entry, but its formats are HTTPS), `mweb`, `tv_simply`.

| yt-dlp name | clientName | clientVersion | name no. | user agent (in the request body) | JS player | cookies | notes |
|---|---|---|---|---|---|---|---|
| `web_embedded` | WEB_EMBEDDED_PLAYER | 2.20260708.00.00 | 56 | Safari 15.5 on macOS | yes | yes | `thirdParty.embedUrl` set to a non-YouTube URL; yt-dlp only uses it signed in |
| `visionos` | VISIONOS | 1.02 | 101 | Safari 26.0 on macOS, device Apple RealityDevice17,1, visionOS 26.5 | no | no | no "made for kids" videos |
| `tv` | TVHTML5 | 7.20260707.07.00 | 7 | Cobalt 25 | yes | yes | |
| `tv_downgraded` | TVHTML5 | 5.20260707 | 7 | `Cobalt/Version` | yes | yes | |
| `tv_samsung` | TVHTML5 | 5.20260707 | 7 | Tizen 2.4.0 TV Safari, device Samsung UKS9800 | yes | yes | |

The full strings are in `CLIENTS` in `apps/sieve/spike/probe-main.js`. yt-dlp's own signed-out defaults are `tv_samsung`, `visionos`, `web`.

**Request.** Same-origin `POST /youtubei/v1/player?prettyPrint=false` from the watch page. Headers `X-YouTube-Client-Name`, `X-YouTube-Client-Version`, `X-Goog-Visitor-Id` (ytcfg `VISITOR_DATA`); no API key was needed. Body: yt-dlp's client fields plus `hl: en`, `timeZone: UTC`, `utcOffsetMinutes: 0` and `visitorData`, `playbackContext.contentPlaybackContext` with `html5Preference` and `signatureTimestamp`, `contentCheckOk`, `racyCheckOk`.

- `signatureTimestamp`: `ytcfg.get('STS')` works on the watch page (20760, 20761 after YouTube rolled a new player during my session). The fallback, a regex over the player script at `ytcfg.get('PLAYER_JS_URL')`, gave the same number with STS hidden (checked once; each result records `stsSource` as `ytcfg` or `player-js`). `PLAYER_JS_URL` was `/s/player/a5c2aafe/player_ias.vflset/en_GB/base.js` and is stored as `playerJsUrl` in every result, for Task 0.3.
- User agent: Chrome dropped the page-set `User-Agent` and sent its own (checked with Playwright `request.allHeaders()`), plus `Origin: https://www.youtube.com` and the page cookies. The client's UA still travels in `context.client.userAgent`. Did any response depend on the UA the page could not set? `visionos`: no. A one-off node comparison (not committed) got the same 32 and 27 plain URLs with the visionos UA and with Chrome's, with and without an `Origin` header. The `tv*` clients and `web_embedded` also failed from node with their own UA and no `Origin` (see below; `tv` passed once there), so their failures are not the UA either. If a later task needs it, `declarativeNetRequest` `modifyHeaders` can set the UA or drop the `Origin` on the extension's own requests.
- `web_embedded` also gets no `encryptedHostFlags` in the probe (the watch page's ytcfg has no embedded player config). A one-off run with the value read from `/embed/<id>?html5=1` gave the same "unavailable".

Summary lines (`apps/sieve/spike/spike.js` `summarise`, printed by `run.mjs`; `audioUrl` is whether any `audio/*` adaptive format has a plain `url`):

```json
{"strategy":"S1","videoId":"aqz-KE-bpKQ","signedIn":false,"playability":"OK","sabr":true,"counts":{"url":0,"cipher":0,"none":40},"maxHeight":{"url":null,"cipher":null,"none":2160},"muxed":{"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null}},"audioUrl":false}
{"strategy":"S2:tv","videoId":"aqz-KE-bpKQ","signedIn":false,"playability":"UNPLAYABLE","sabr":false,"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null},"muxed":{"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null}},"audioUrl":false}
{"strategy":"S2:tv_downgraded","videoId":"aqz-KE-bpKQ","signedIn":false,"playability":"UNPLAYABLE","sabr":false,"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null},"muxed":{"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null}},"audioUrl":false}
{"strategy":"S2:tv_samsung","videoId":"aqz-KE-bpKQ","signedIn":false,"playability":"UNPLAYABLE","sabr":false,"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null},"muxed":{"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null}},"audioUrl":false}
{"strategy":"S2:visionos","videoId":"aqz-KE-bpKQ","signedIn":false,"playability":"OK","sabr":true,"counts":{"url":32,"cipher":0,"none":0},"maxHeight":{"url":2160,"cipher":null,"none":null},"muxed":{"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null}},"audioUrl":true}
{"strategy":"S2:web_embedded","videoId":"aqz-KE-bpKQ","signedIn":false,"playability":"ERROR","sabr":false,"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null},"muxed":{"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null}},"audioUrl":false}
{"strategy":"S1","videoId":"dQw4w9WgXcQ","signedIn":false,"playability":"OK","sabr":true,"counts":{"url":0,"cipher":0,"none":26},"maxHeight":{"url":null,"cipher":null,"none":2160},"muxed":{"counts":{"url":0,"cipher":1,"none":0},"maxHeight":{"url":null,"cipher":360,"none":null}},"audioUrl":false}
{"strategy":"S2:tv","videoId":"dQw4w9WgXcQ","signedIn":false,"playability":"UNPLAYABLE","sabr":false,"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null},"muxed":{"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null}},"audioUrl":false}
{"strategy":"S2:tv_downgraded","videoId":"dQw4w9WgXcQ","signedIn":false,"playability":"UNPLAYABLE","sabr":false,"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null},"muxed":{"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null}},"audioUrl":false}
{"strategy":"S2:tv_samsung","videoId":"dQw4w9WgXcQ","signedIn":false,"playability":"UNPLAYABLE","sabr":false,"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null},"muxed":{"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null}},"audioUrl":false}
{"strategy":"S2:visionos","videoId":"dQw4w9WgXcQ","signedIn":false,"playability":"OK","sabr":true,"counts":{"url":27,"cipher":0,"none":0},"maxHeight":{"url":2160,"cipher":null,"none":null},"muxed":{"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null}},"audioUrl":true}
{"strategy":"S2:web_embedded","videoId":"dQw4w9WgXcQ","signedIn":false,"playability":"ERROR","sabr":false,"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null},"muxed":{"counts":{"url":0,"cipher":0,"none":0},"maxHeight":{"url":null,"cipher":null,"none":null}},"audioUrl":false}
```

- The tv family is mostly broken here: `tv`, `tv_downgraded` and `tv_samsung` answered `UNPLAYABLE` "The page needs to be reloaded." in 16 of 17 in-page runs (both videos), and from node on every try but one (a first node call of `tv` returned OK with 41 adaptive formats, none with a plain URL, SABR on). On the one good run (`dQw4w9WgXcQ`): `tv` gave 26 adaptive formats with neither `url` nor cipher and `sabr` true, the same as S1; `tv_downgraded` and `tv_samsung` gave `sabr` false and 26 adaptive formats up to 2160 that all carry a `signatureCipher` (no plain URL), plus the muxed 360p cipher format. So even when they work they give no plain URL; they would need Task 0.3's signature solving.
- `web_embedded` answers `ERROR` "This video is unavailable" (from node: "Video unavailable") for both videos, every time.
- `visionos`: 32 plain URLs on `aqz-KE-bpKQ` and 27 on `dQw4w9WgXcQ`, up to 2160p, audio included (`audioUrl` true), the same on every run. `sabr` is also true, so SABR is offered next to the plain URLs. A one-off look at three URLs (audio itag 139, 1080p itag 299, 2160p itag 315): they carry `sig` and `lsig`, no `n` and no `pot`, `c=VISIONOS`. So they need no signature or `n` solving. One range request for the first 1 KB of the audio URL returned 206 with 1024 bytes (curl, visionos UA); later connections to that host timed out from my network, so I did not check the video URLs. Whether a whole stream downloads is Task 0.4.
- Reading: `visionos` is the only client that returns plain URLs at 1080p and above and for audio (up to 2160p, no PO token, no cipher, no `n`); `tv`, `tv_downgraded`, `tv_samsung` and `web_embedded` do not, and the tv family is unreliable. Not yet tested: that these URLs download in full (0.4), videos made for kids (yt-dlp says `visionos` cannot play them), and signed in (0.6). The probe sends the page's cookies but no `Authorization: SAPISIDHASH`, so the signed-in S2 numbers may differ from what an authenticated call would give.

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
- **2026-11-06 (session 3):** subagent-driven execution. Ledger (gitignored, on disk in the
  worktree): `.superpowers/sdd/2026-11-06-sieve/progress.md`. It holds the pre-flight rulings
  R1 to R8, every task's commits, and the deferred minor findings for the final review.
  - Task 0.1 done (`d1e28e9`, review fixes `ede98e7`): S1 results above.

## Current state and next step

- **State:** implementation in progress (session 3). Tasks done: 0.1. Read the ledger before
  dispatching anything; tasks with a `complete` line there are done.
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
