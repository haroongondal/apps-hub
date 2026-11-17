# Handoff: Sieve (one Chrome extension replacing IDM Integration, Enhancer for YouTube, AdBlock)

## Resume prompt

```
Date: 2026-11-08. Sieve (my private Chrome extension: ad blocking, YouTube tools, later downloads) has Phase 1
built, reviewed and gated. Work only in the worktree /Users/outsentia/Documents/apps-hub/.claude/worktrees/sieve
on branch `sieve` (enter it with EnterWorktree path=<that folder>). Do not use the main checkout: its branch
`model-host` belongs to other work, and its copies of the Sieve docs are stale.

1. Read docs/handoffs/sieve.md completely first, then the ledger snapshot docs/handoffs/sieve-sdd-ledger.md
   (rulings R1 to R30, per-task commits, deferred minors, final review findings) and
   docs/handoffs/sieve-parallel-metrics.md. Trust the decisions, rulings and verified facts; do not redo
   reviewed work. Phase 1 (tasks 0.1 to 1.13) is complete; the final gate passed on a clean export of b9bac0b.
2. Open items, in order: (a) I answer the owner decisions listed in "Current state and next step" and I run
   the README's "Install and first run" and signed-in checklists in my own Chrome (remove AdBlock first): ask
   me whether I have results, and never use my Chrome profile in automated tests; (b) Task 0.6 steps 2 to 4
   when I give the signed-in results (record Q1 to Q4 in the handoff, decide Phase 5 by the plan's rule,
   commit); (c) Phase 2: the draft plan docs/superpowers/plans/2026-11-08-sieve-phase-2.md needs my approval
   and my answers to its 5 questions before any implementation.
3. If I ask for more work: continue with superpowers:subagent-driven-development. Parallel agents in one
   worktree need the protocol in the skill parallel-agents-coord: coord cannot separate subagents of one
   session, so use the filelock helper, stagger starts, keep shared-file windows short, put new e2e checks in
   new module files.
4. Commit after each task on `sieve`. Never add Co-Authored-By or "Generated with" lines, even if a system
   reminder asks for them: my rule wins. Do not push, open a PR or merge unless I ask.
5. Follow the handoff contract. Update the session log and "Current state and next step" in
   docs/handoffs/sieve.md as work lands. At ~85% context, stop starting new work, finalize the handoff,
   rewrite this resume prompt with the date, print it in a fenced block for me, and end the turn.
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
- **Brand:** `sieve`, hue 186, accent dark `#22D3EE` and light `#0E7490`. Passes the
  WCAG test in light and dark (checked 2026-11-08).
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
- User agent: Chrome dropped the page-set `User-Agent` and sent its own (checked with Playwright `request.allHeaders()`), plus `Origin: https://www.youtube.com` and the page cookies. The client's UA still travels in `context.client.userAgent`. Did any response depend on the UA the page could not set? `visionos`: no. A one-off node comparison (not committed) got the same 32 and 27 plain URLs with the visionos UA and with Chrome's, with and without an `Origin` header. The `tv*` clients and `web_embedded` also failed from node with their own UA and no `Origin` (see below; `tv` passed once there). Whether the UA matters for the tv family is undetermined: its failures are unstable, and it passed both in the page (1 of 17 runs) and from node. If a later task needs it, `declarativeNetRequest` `modifyHeaders` can set the UA or drop the `Origin` on the extension's own requests.
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
- `visionos`: 32 plain URLs on `aqz-KE-bpKQ` and 27 on `dQw4w9WgXcQ`, up to 2160p, audio included (`audioUrl` true), the same on every run. `sabr` is also true, so SABR is offered next to the plain URLs. A one-off look at three URLs (audio itag 139, 1080p itag 299, 2160p itag 315): they carry `sig` and `lsig` and `c=VISIONOS`, and the three URLs checked carry no `pot` or `n`, so those three need no signature or `n` solving. (S3 later checked every `visionos` URL for `n`; see below.) One range request for the first 1 KB of the audio URL returned 206 with 1024 bytes (curl, visionos UA); later connections to that host timed out from my network, so I did not check the video URLs. Whether a whole stream downloads is Task 0.4.
- Reading: `visionos` is the only client that returns plain URLs at 1080p and above and for audio (up to 2160p, no cipher; the three URLs checked carry no `pot` or `n`); `tv`, `tv_downgraded`, `tv_samsung` and `web_embedded` do not, and the tv family is unreliable. Not yet tested: that these URLs download in full (0.4), videos made for kids (yt-dlp says `visionos` cannot play them), signed in (0.6), and HLS (not probed). The probe sends the page's cookies but no `Authorization: SAPISIDHASH`, so the signed-in S2 numbers may differ from what an authenticated call would give.

### S3 (signature and n solving, signed out)

Run 2026-11-06 with `node apps/sieve/spike/run.mjs` (same setup as S1 and S2), S3 being part of **Run all**: 7 complete runs on `dQw4w9WgXcQ` (`VIDEO=dQw4w9WgXcQ`; the control was added from the second, and the last two ran after the review fixes) and 2 on `aqz-KE-bpKQ`. Eight more launches died before the probes, because of this Mac's network: one browser launch timed out, four `page.goto` timeouts, and three `#movie_player` timeouts. One of those page loads took 31.8 s to reach DOMContentLoaded. `run.mjs` now waits 90 s for the page and 60 s for the player. Solver: yt-dlp **ejs `0.8.0`**, vendored in `apps/sieve/spike/vendor/`. The tag, SHA-256 hashes, licences (Unlicense; the bundled meriyah is ISC and astring MIT) and the input/output contract are in `apps/sieve/spike/README.md`. Player `a5c2aafe` (`/s/player/a5c2aafe/player_ias.vflset/en_GB/base.js`, from `ytcfg PLAYER_JS_URL`).

**How.** S1 and S2 store their raw formats in `chrome.storage.session` (memory only) under `streams:<strategy>`, which **Save results**, the summaries and `run.mjs`'s output never read (`run.mjs` fails if a stream URL or cipher shows up in them). After the probes, `spike.js` takes every format with a `signatureCipher` or with an `n` in its URL, fetches the player script, and sends it with the `s` and `n` challenges to the hidden sandboxed `solver.html`. That page solves in a fresh worker. Then `spike.js` builds the final URL (`n` value replaced; `&<sp>=<encoded sig>` appended) and sends one `Range: bytes=0-1023` request for every solved URL, 4 at a time. A class passes only when every one of its formats answers 206. A network error is retried once after 3 s. The control is the same URL with the raw challenges (`n` unchanged, `s` passed as the signature).

- Deviation from the plan: the solving runs in a worker inside `solver.html`, not in the page itself. ejs's setup line `globalThis.location = new URL(...)` (meant for node and deno) navigated a sandbox page away when tried, and in a worker it does nothing. The default sandbox CSP blocks blob workers, so the manifest sets its own: `sandbox allow-scripts; script-src 'self' 'unsafe-eval'; worker-src blob:; default-src 'none'`. That CSP also leaves the player code no network.

Summary lines (`run.mjs`, after the review fixes). The fields:
- `scanned`: how many formats with a URL or cipher were read per strategy.
- `jscMs`: the jsc time (see the table).
- `checked` and `passed`: solved URLs Range-checked and URLs that answered 206.
- `outcomes`: counts of `status (unsolved control status)`.

```json
{"strategy":"S3","videoId":"dQw4w9WgXcQ","signedIn":false,"ejs":"0.8.0","scanned":{"S1":1,"S2:tv":0,"S2:tv_downgraded":0,"S2:tv_samsung":0,"S2:visionos":27,"S2:web_embedded":0},"nothingToSolve":false,"players":[{"jscMs":266,"sigSolved":1,"nSolved":1,"errors":{}}],"classes":{"S1 muxed cipher":{"formats":1,"solved":1,"checked":1,"passed":1,"outcomes":{"206 (unsolved 403)":1},"pass":true},"any n":{"formats":1,"solved":1,"checked":1,"passed":1,"outcomes":{"206 (unsolved 403)":1},"pass":true},"tv-family cipher":{"formats":0,"solved":0,"checked":0,"passed":0,"outcomes":{},"pass":null}}}
{"strategy":"S3","videoId":"aqz-KE-bpKQ","signedIn":false,"ejs":"0.8.0","scanned":{"S1":0,"S2:tv":0,"S2:tv_downgraded":0,"S2:tv_samsung":0,"S2:visionos":32,"S2:web_embedded":0},"nothingToSolve":true,"players":[],"classes":{"S1 muxed cipher":{"formats":0,"solved":0,"checked":0,"passed":0,"outcomes":{},"pass":null},"any n":{"formats":0,"solved":0,"checked":0,"passed":0,"outcomes":{},"pass":null},"tv-family cipher":{"formats":0,"solved":0,"checked":0,"passed":0,"outcomes":{},"pass":null}}}
```

| Format class | Result |
|---|---|
| S1 muxed cipher (itag 18, 360p, `dQw4w9WgXcQ`) | **Pass**, 6 of 7 runs. The signature and `n` were solved. jsc time was 258, 376, 281, 790, 262 and 266 ms; that is the `jsc()` call in the worker, parse of the 3 MB player included, but not worker start, vendor load or the player fetch. Range gave 206 with 1024 bytes. The unsolved control gave 403 in 5 of 5, so the solving is what makes the URL work. In the seventh run the player script fetch failed ("Failed to fetch", network), and the run recorded `pass: false` with that reason. The player fetch now retries once after 3 s. |
| tv-family cipher | **Not reached in the extension.** `tv`, `tv_downgraded` and `tv_samsung` answered `UNPLAYABLE` "The page needs to be reloaded." in all 9 complete runs. In a one-off from node (not committed, no cookies), `tv_samsung` answered OK on 3 tries with 27 formats, all ciphered and all with an `n`, and ejs solved all 27 signatures and both `n` values. But itags 18, 313 (2160p) and 140 (audio) gave **403 solved and 403 unsolved**. That held on each try: two with the web player (`player_es6` en_US, then `player_ias` en_GB; the web player is yt-dlp's default for every client) and one with the TV player (`tv-player-ias`). All three used node `fetch` with the TV UA, and the last also used curl. These URLs are refused for some reason other than the solving, so this test cannot say whether the solving is right for them. The URLs carry no `pot`. **Fail as measured; cause undetermined.** |
| any `n` | **Pass: `n` replaced and URL accepted; speed untested (0.4, 0.5).** In the extension, only S1's itag 18 URL carried an `n` (same row as above). None of `visionos`'s URLs did (every URL, both videos, every run). `aqz-KE-bpKQ` had nothing to solve at all (`nothingToSolve: true`, with `scanned` showing that S1 and every S2 client were read). |

- Reading: ejs 0.8.0 works in the extension (solved web URL 206, raw 403), but signed out it only unlocks the 360p muxed format; the tv family stays unproven, and signed in (0.6), full download and speed (0.4, 0.5) are untested.
- The solved URLs are kept in session storage under `streams:S3` for Task 0.4.

### Downloads (Q1, Q2, signed out)

Run 2026-11-06 with `VIDEO=dQw4w9WgXcQ node apps/sieve/spike/run.mjs` (same setup as above), the last step of **Run all** (`probe:DL`). The default video `aqz-KE-bpKQ` could not be used for the final run: YouTube started answering "Sign in to confirm you're not a bot" for it (every client, `visionos` included, `LOGIN_REQUIRED`; headless and headed; still after a 10 minute wait), after many runs today from this IP. `run.mjs` pauses the video before **Run all**, because a playing video shares the link; the owner should pause theirs too in task 0.6.

Every stream is 10 MiB `Range` requests, one after another (60 s each, one retry on a network error). The streams are `S2:visionos` URLs (no `n`, no cipher). Per ruling R9 the audio and the 1080p video are downloaded in full; 2160p, the top height, only gets its first 100 MiB plus a 1 MiB range at the end. A stream passes Q1 when every byte arrived and the first bytes are `ftyp` at offset 4 or `1A 45 DF A3`, and Q2 when it ran at 5x its `bitrate` (the format's peak rate, so the ratio errs low) or more. Seconds, MB/s and x bitrate count only the attempts that succeeded; a failed attempt and its 3 s pause are in "waited".

Link baseline, taken just before the downloads: 25 MB from `speed.cloudflare.com` in 10.9 s, **2.3 MB/s**. This Mac's link moves a lot (1.17, 2.3, 3.97 and 5.0 MB/s in four runs today).

| itag | height | codec | bytes | seconds | waited s | MB/s | x bitrate | result |
|---|---|---|---|---|---|---|---|---|
| 251 audio | | opus, WebM | 3,433,755 of 3,433,755 | 13.8 | 0 | 0.25 | 14.61 | Q1 pass, Q2 pass |
| 137 video | 1080p | avc1.640028, MP4 | 80,911,999 of 80,911,999 | 163.9 | 63.0 | 0.49 | 0.91 | Q1 pass, **Q2 fail** |
| 313 video | 2160p | vp9, WebM | **partial:** 104,857,600 of 358,608,461 | 179.7 | 0 | 0.58 | 0.26 | partial pass (first 100 MiB, magic `1A 45 DF A3`, last 1 MiB gave 206 with 1,048,576 bytes), **Q2 fail**, Q1 not claimed |

- Checks: on all three streams the first chunk's `Content-Range` total equals the declared `contentLength` (only the first chunk's total is compared); the 1080p stream starts `00 00 00 1C ftyp dash`; no HTTP error.
- The 1080p stream had one retry: the chunk at offset 62,914,560 stalled until the 60 s timeout (recorded as "The user aborted a request.", now worded "timed out after 60 s"), then succeeded after the 3 s pause, which is the 63.0 s waited. That chunk ran at 2.91 MB/s on the new attempt.
- Per chunk (MB/s): 1080p 0.51, 0.48, 0.40, 0.40, 0.26, 0.66, 2.91 (the retried chunk), 0.86; 2160p 0.34 to 0.86 over its 10 chunks. The audio is one chunk, so its Q2 pass says little: 5x of 137 kbps is only 85 KB/s.
- Earlier runs on `aqz-KE-bpKQ`, before the timing fix (their figures include any stalled retry, so they are understated; the second run's 1080p had one, about 60 s of 421 s): baseline 5.0 MB/s, audio 0.26 MB/s, 1080p 257,619,653 bytes at 0.61 MB/s (0.7x, all bytes, `ftyp`), 2160p first 100 MiB at 0.93 MB/s (0.28x) with the last 1 MiB reachable (206). A run before that: baseline 1.17 MB/s, 1080p 0.93 MB/s (1.07x). A run on this video cut short by the old wait: baseline 3.97 MB/s, 1080p 0.59 MB/s.
- Reading: Q1 passes for the 1080p video and the audio, and the end of 2160p is reachable (its middle untested), but Q2 fails: YouTube gave about 0.25 to 0.9 MB/s regardless of bitrate (1080p at 4 to 7 Mbps and 2160p at 18 to 27 Mbps got the same), below the 1.2 to 5 MB/s the neutral host gave on the same runs; a cap, a poor route and the sequential-request design are not told apart yet, so Task 0.5 (split vs plain) and the owner's run (0.6) are the next evidence. A node and `curl` cross-check failed (`LOGIN_REQUIRED` without page cookies).

### Split vs plain (Q4)

Run 2026-11-06 on the same Mac and link as the downloads, in headless Chrome for Testing 149 with a fresh profile. **Speed test** is its own button (`node apps/sieve/spike/run.mjs --speed`, launched with `--disable-quic`); the googlevideo test (R10) is the last step of **Run all** (`VIDEO=dQw4w9WgXcQ`; `aqz-KE-bpKQ` is bot-checked). Each server: 3 runs of plain (`chrome.downloads`, timed from the call to `complete`, then file deleted) alternating with 3 runs of a 6-part split (parallel `Range` fetches, bodies counted and dropped). A run that did not get every byte is a failed run; the median skips failed runs and split runs with a retry, and `n` beside each median is the number of runs it uses. "Plain" is Chrome's default download, which may itself use parallel connections (not checked); it is not one connection. The plain time runs from the `download()` call to the `complete` event, so it includes the download manager's start and the file rename (not measured separately: small against the 160 to 560 s runs here, but 5 to 10% on a fast link). Playwright handles downloads itself in a launched context (`acceptDownloads` is on by default); the timing comes from the extension's `chrome.downloads` events, not from Playwright. A run also fails after 10 min for both methods in the current code (plain still downloading, or a split part's request still open, with no retry after a timeout); the rows below were taken under the earlier rule, where a split part timed out after 5 min and was retried once, while plain was stopped at 10 min.

| server | protocol | plain MB/s | split MB/s | ratio |
|---|---|---|---|---|
| `http://ping.online.net/100Mo.dat` (100,000,000 bytes) | http/1.1 | 0.41 (n=3: 0.41, 0.62, 0.18) | 0.43 (n=3: 0.43, 0.83, 0.43) | 1.05 |
| `https://proof.ovh.net/files/100Mb.dat` (104,857,600 bytes) | h2 | 0.50 (n=3: 0.59, 0.50, 0.44) | **failed in 3 of 3 runs:** 2 of 6 parts got HTTP 429, 69,905,068 of 104,857,600 bytes arrived | none |
| `https://cdn.kernel.org/pub/linux/kernel/v5.x/linux-5.10.tar.xz` (116,606,704 bytes) | h2 | 0.72 (n=2: 0.29, 1.15; run 3 still running after 10 min, so at most 0.19, failed and dropped) | 0.60 (n=2: 0.66, 0.54; run 3 had 3 retries after 300 s timeouts, 0.25, dropped) | 0.83 excluding each side's slowest run; about 1.9 counting them (n=3 each: plain median 0.29, split median 0.54) |

R10, googlevideo (`S2:visionos` itag 137, 1080p, its first 62,914,560 bytes, all bytes arrived in all 4 runs, no retries):

| protocol | sequential MB/s (6 requests of 10 MiB, one after another) | parallel MB/s (the same 6 at once) | ratio |
|---|---|---|---|
| http/1.1 (so 6 connections) | 1.01 (n=2: 0.79, 1.23) | 1.24 (n=2: 0.91, 1.56) | 1.23 (the two ranges overlap) |

- Servers: the brief's `http://proof.ovh.net/files/100Mb.dat` answers `301` to HTTPS, so Chrome reports `h2` for it (not HTTP/1.1). `https://ash-speed.hetzner.com/100MB.bin` answers 206 over HTTP/1.1 to curl, but Chrome got `net::ERR_EMPTY_RESPONSE` (headless for both its `https://` and `http://` forms, headed for `https://`); cause not found. So the HTTP/1.1 row uses `http://ping.online.net/100Mo.dat` (not in the brief: 206, `nextHopProtocol` `http/1.1`, plain HTTP). `https://proof.ovh.net` is the brief's HTTP/2 file and passes both checks (206, `h2`), but it rejects 2 of 6 parallel ranges, so `cdn.kernel.org` (206, `h2`, Fastly) is a second HTTP/2 row. `proof.ovh.net` offers HTTP/3: once Chrome had seen it, a later check reported `h3`, which is why Speed test turns QUIC off.
- `chrome.downloads` worked in the Playwright-launched Chrome for Testing: `onChanged` gave `complete`, `fileSize` matched, `removeFile` then `erase` removed the file (and a download of the wrong expected size is reported as failed, checked on a 1 Mb file). The 1 Mb check is the only test of that path.
- The link moves a lot: plain downloads of the same file ranged 0.18 to 0.62 MB/s (online.net) and 0.29 to 1.15 MB/s (kernel.org), more than any split effect seen, and the Cloudflare baseline in the R10 run was 0.55 MB/s. The Q4 figures were taken before `cache: 'no-store'` was added to the `Range` fetches; no split run was fast enough (shortest 120 s) to have come from Chrome's cache.
- A first R10 run is discarded: its first sequential pass took 0.6 s (110 MB/s) because Chrome's HTTP cache served the 10 MiB ranges the 1080p download had just fetched. Every `Range` fetch is now `no-store` and the R10 above is the rerun. In that run the 1080p download itself was 0.43 MB/s (0.79x bitrate, Q2 still fails) and the 2160p partial passed its 100 MiB at 0.99 MB/s.
- Reading: Q4 is inconclusive on speed: the ratios (1.05; 0.83 excluding each side's slowest run, about 1.9 counting them) straddle 1 on a link whose own speed moved by up to 6x between runs, so keep 1 part per host (Chrome's own download) as the default for both HTTP/1.1 and HTTP/2, because the one firm datum is OVH rejecting 2 of 6 parallel ranges with 429; keep parts configurable and treat a 429 as "use fewer parts". R10 is inconclusive on this link too: single sequential ranges ran at about 1 MB/s here (0.79 and 1.23), so the earlier 0.25 to 0.6 MB/s was not a stable per-request ceiling, and the sequential and parallel runs overlap (n=2 each; the link, about 0.55 to 1.5 MB/s, was below what Q2 needs, so parallel requests could not show a cap); the cause is deferred to the owner's run (0.6) or a rerun with a baseline of 3 MB/s or more.

## Phase 1 live checks

### YouTube ad removal (Task 1.11, signed out)

Run 2026-11-08 with `pnpm --filter sieve test:e2e -- --live` (`apps/sieve/test/yt-live.mjs`), headless Chrome for Testing, fresh signed-out profile, 30 s per video:

| Video | Seconds played | `.ad-showing` | Bot check | Consent page |
|---|---|---|---|---|
| `dQw4w9WgXcQ` | 31 | no | no | no |
| `kJQP7kiw5Fk` | 29 | no | no | no |
| `9bZkp7q19f0` | 25 | no | no | no |
| control, Sieve off, `dQw4w9WgXcQ` | 30 | no | no | no |

- **Reading: inconclusive about ad removal.** YouTube still plays with Sieve on, but the Sieve-off control also showed no ad, so this profile was served no pre-roll at all and the run cannot show that ads are removed. The local fixture e2e (an inline `ytInitialPlayerResponse`, `JSON.parse` and `Response.json`, all stripped; videoDetails and streamingData unchanged) is the evidence for the stripping, not the live run. The task review asked for an honest "inconclusive" label and an extension-free control in `yt-live.mjs` (fix round 1).
- Still unchecked: removal while an ad is actually served; m.youtube.com and music.youtube.com live; signed-in (Task 0.6).

Task 1.11 fix round 1 (`5f2cabd`), same setup with an extension-free control first (`yt-live.mjs`):

| Video | Without Sieve | With Sieve | Result |
|---|---|---|---|
| `dQw4w9WgXcQ` | no ad, played to 29 s | no ad, played to 30 s | inconclusive (no ad was served) |
| `kJQP7kiw5Fk` | an ad showed, played to 15 s | no ad, played to 6 s | removal check passed, but see the stall below |
| `9bZkp7q19f0` | no ad, played to 29 s | no ad, played to 26 s | inconclusive |

- With Sieve off afterwards, `kJQP7kiw5Fk` showed no ad and played to 30 s. The 6 s figure is the anti-goal-4 concern ("YouTube must not feel janky").
- **Measured afterwards** (`docs/handoffs/sieve-yt-measurement.md`: 24 fresh-profile runs on that video, with no extension, Sieve on, stripping only and network rules only (23 usable), plus 25 follow-up runs: 49 in all, 48 usable): Sieve does not hold back playback. Medians of `currentTime` at 30 s were 26.5, 26.0, 26.0 and 26.05 s, every difference under 1 s and inside the noise; neither component alone shows a cost. The earlier 6 s has two candidate explanations the data cannot separate: a network drop (one run window was a network outage) or a self-pause of the player (one unexplained self-pause at 5.5 s in a network-rules-only run, which `yt-live.mjs` would report as exactly "6 s").
- **YouTube served no ad in any of the 15 no-extension measurement runs** (although every response contained `adPlacements`), so the measurement says nothing about the cost or the success of removing an ad. Removal was seen working once (the `kJQP7kiw5Fk` row above).

## File map

- `docs/superpowers/specs/2026-11-06-sieve-design.md`: the design
- `docs/superpowers/plans/2026-11-06-sieve.md`: the plan
- `docs/handoffs/sieve.md`: this file
- `packages/sieve-core/`: pure logic (settings, compiler, hosts, allowlist, plan, page injections)
- `apps/sieve/`: the extension (`build.mjs`, `src/`, `test/`; the throwaway spike is in `apps/sieve/spike/`)
- `docs/handoffs/sieve-sdd-ledger.md`: tracked snapshot of the execution ledger (rulings R1 to R30, per-task commits, deferred minors, final review findings)
- `docs/handoffs/sieve-parallel-metrics.md`: the parallel-agents experiment (tokens, timings, lock waits, findings)
- `docs/handoffs/sieve-yt-measurement.md`: the YouTube playback measurement
- `docs/handoffs/sieve-gate-run-1.md`: the first clean-export gate run (failed on sites and one flaky check; fixed)
- `docs/handoffs/sieve-final-review-1-core.md`, `-2-worker.md`, `-3-ui.md`: the whole-branch review findings
- `docs/handoffs/sieve-task-1.6-fix-findings.md`: historical (the Task 1.6 fix round is done)
- `docs/superpowers/plans/2026-11-08-sieve-phase-2.md`: the Phase 2 plan (draft, needs the owner's approval)
- `sieve-extension-dist/` and `strongroom-extension-dist/` in the main checkout root: built installable copies (untracked there)
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
  - Task 0.2 done (`e1f8651`): S2 results above; only `visionos` gives plain URLs (to 2160p, with audio).
  - Task 0.3 done (`09bb187`, review fixes `11e6e54`): S3 results above; ejs 0.8.0 solves the web
    player's signature and `n`; the tv-family cipher path is unproven. This Mac's network was very
    slow during the runs (many launch timeouts).
  - Task 0.4 done (`e46d867`, review fixes `94ebba9`): Q1 passes (full 1080p + audio), Q2 fails
    (googlevideo about 0.25 to 0.9 MB/s regardless of bitrate). YouTube now bot-checks
    `aqz-KE-bpKQ` from this IP when signed out; automated runs use `dQw4w9WgXcQ`.
  - Task 0.5 done (`ad3a2f6`, review fixes `4a4a89c`): Q4 and R10 results above; both readings are
    inconclusive on this slow link (0.2 to 1.2 MB/s). Speed test button and `run.mjs --speed` added.
  - Task 1.1 done (`93b9b99`): `sieve` brand (WCAG passes, no accent change) and icon.
  - Task 1.2 done (`3b1c566`, review fixes `9ef2419`): `@apps-hub/sieve-core` settings and
    `validateSettings` (a missing `version` is read as 1; trailing dots stripped; userinfo dropped).
  - Task 0.6 step 1 done (`6ace2b3`): owner checklist in `apps/sieve/spike/README.md`; the owner was
    asked to run it.
  - Tasks 1.1 and 1.2 ran in parallel with 0.5 (owner said to keep working while 0.5 measured);
    each agent staged only its own paths.
  - Task 1.3 done (`597fc4f`, review fixes `90e624d`): `compileFilters` + `hostCandidates`. EasyList
    78k lines → 50,215 rules in 0.34 s. Node builds must `await checkRegexesWithRe2()` first
    (`node-regex.ts`, adds `@adguard/re2-wasm`, build-time only). `trusted-*` scriptlets are dropped
    unless `trusted: true` (My filters in Task 1.9 must pass it). `$document` exceptions also turn
    off cosmetics and scriptlets for the host.
  - Task 1.4 done (`bed15d6`, `10b4f5b`, review fixes `55d7712`): `apps/sieve` builds; all five
    default rulesets enable in a fresh profile (115,468 rules; Chrome took them from the shared
    pool, no warning). `minimum_chrome_version` raised to 128 (ruling R15: some rules use
    `responseHeaders`). Wildcard-TLD exception hosts such as `www.google.*` are expanded over
    Google's 187 domains / 26 common suffixes (ruling R14).
  - Task 1.5 done (`bab5df7`, review fixes `e9dd4b6`): blocking plan, allowlist, pause, notification
    blocker. Allow rules are retried alone if Chrome refuses a bad My filters rule.
  - Task 1.6 committed (`1f80fda`: site-specific hiding and scriptlets; unit 85, e2e 46). Review:
    **needs fixes** (one Important: an allowlisted site's frame embedded in another site was still
    filtered; ruling R17 widens the rule). Fix round 1 not applied yet.
- **2026-11-07 (pause):** the owner asked to pause. The Task 1.6 fix agent was stopped one minute in;
  its half-written test was discarded. The ledger and the Task 1.6 findings are snapshotted in
  `docs/handoffs/sieve-sdd-ledger.md` and `docs/handoffs/sieve-task-1.6-fix-findings.md`.
- **2026-11-08 (session 4):**
  - The owner has not run the signed-in checklist (Task 0.6 steps 2 to 4 still pending).
  - Task 1.6 fix round 1 done (`375fee3`, fresh Opus implementer, since the session-3 agent was gone):
    I1 (ruling R17, an allowlisted frame embedded in another site is skipped, with an e2e that failed
    first) and m2 to m6 (including `scriptletArgs` in sieve-core with a `node:vm` test). Sieve-core 86,
    e2e 47, root `pnpm test` 571 pass, typecheck clean. Scoped re-review: all addressed. Deferred
    minor: the duplicate-commit guard reads the worker's in-memory map, so a BFCache restore after
    an idle pause can inject twice (harmless).
  - Task 1.7 done (`19f083a`, review fixes `fd463b9`): counts and badge in `chrome.storage.session`,
    toolbar menu (Blocking tab). Ruling R18: the build writes per-list `modifyIds` to `meta.json`
    (83 header-only rules) and `classifyMatch` skips them, so the menu does not call them "blocked".
    Count changes update the number in place (a full rebuild could swallow a click).
  - Task 1.8 done (`ac01b1c`, review fixes `8b8cfea`): element picker. The worker validates the pick
    (host from `sender.url`, never the message; strict selector grammar), only trusted clicks work,
    writes are serialised. Ruling R19: a pick is saved under the full hostname (`www.` kept).
    Six deferred minors in the ledger; the main one: an item under the bottom-right panel (a chat
    bubble, a toast) cannot be picked, and the README's "scroll it away" advice is wrong for fixed
    items. Picking inside iframes is a follow-up (many ads are iframes).
  - Task 1.9 committed (`3fedd1e`, review fixes `e89814d`): settings page, My filters (compiled in
    `options.js` only, `trusted: true`, atomic check against Chrome's dynamic rules, sources under
    the top-level key `myRuleSources`), allowlist input, `#@#` exceptions, plain-word errors.
    Review found data-loss paths; rulings R20 (one shared `navigator.locks` lock, `lock.ts`, around
    every writer of settings/myFilters/myCosmetic/myRules/myRuleSources) and R21 (`unlimitedStorage`
    plus rollback of the dynamic rules if the storage write fails). Scoped re-review: all addressed. Subagents cannot write report files
    (the harness refuses), so some per-task reports exist only in the ledger.
  - Task 1.9 review fixes (`e89814d`, rulings R20 and R21), Task 1.10 DevTools panel (`9ef8ffc`, fixes `feb24ed`), Task 1.11 YouTube ad removal and channel allowlist (`27a1146`, fixes `5f2cabd`, ruling R26), Task 1.12 AI summaries list (`e401ee2`, fixes `0dab0d5`, ruling R25), Task 1.13 step 1 perf script (`78f6138`, `02bcadf`, `2362c7f`, ruling R23), the picker and settings polish batch (`4aca08e`): all reviewed with fix rounds; costs and timings are in `docs/handoffs/sieve-parallel-metrics.md`.
  - The owner asked for parallel agents (ruling R22): up to six agents ran at once. `coord` turned out to be session-scoped (every subagent shares the parent session id, so it gave no exclusion between them); a `filelock` helper (atomic `mkdir`) replaced it. Whole-file locks on README and e2e.mjs became the bottleneck (a 15-line README edit waited 14.5 minutes); a staggered, short-window protocol worked (the fix wave had no lock waits).
  - Phase 2 plan drafted in parallel (`a12b785`, 19 tasks; draft for the owner).
  - YouTube stall measured (`docs/handoffs/sieve-yt-measurement.md`): not reproduced, no cost from Sieve, no ad was ever served in the controls.
  - Whole-branch final review (four reviewers on HEAD `5f2cabd`, findings in `docs/handoffs/sieve-final-review-{1-core,2-worker,3-ui}.md` and the ledger): two Important code findings (a page-entry pause covered the whole site's generic CSS; the notification blocker denied already-allowed sites) plus a stale list-date copy and a build that could leave no manifest; fix wave `c6be0a6`, `19ee2b2`, `6e3d409`, `9efa40b`, residual `299dc39`, README counts `9194535`, deterministic e2e `2fb48ff`, perf sites `b9bac0b` (rulings R27 to R30).
  - Install folders built at the repo root (`sieve-extension-dist`, `strongroom-extension-dist`).

## Current state and next step

- **State (2026-11-08, end of session 4):** branch `sieve`. Phase 1 is implemented, reviewed (every task, then a four-part whole-branch review, then re-reviews of every fix round) and gated. Commits after `b9bac0b` are docs only (this file, the ledger snapshot, the metrics).
  - **Final gate, clean export of HEAD `b9bac0b`** (no dist, no filter cache, no node_modules before install): `pnpm install` 29 projects; `pnpm test` 667/667 (sieve-core 139, apps/sieve 43); `pnpm typecheck` clean; `pnpm --filter sieve build` with freshly downloaded lists (116,095 default rules: ads 50,847, trackers 56,427, distraction 2,037, cookies 2,111, antiadblock 4,673, ai 0 with 4 hosts); e2e 172/172 on the first run; `yt-live` and `perf` self-checks ok; the dist is complete (every manifest-referenced file exists, 37 MB, `listsAt` present, no source maps, spike or test files). Perf, on the same product build (HEAD `299dc39`, product code unchanged since): local page +6.5 ms against the 20 ms limit; five real sites (guardian, bbc.com/news, npr, nbcnews, wired) every median load with Sieve 0.27x to 0.85x of without, 5 of 5 (need 4); no load failed on either side. The first gate (`docs/handoffs/sieve-gate-run-1.md`) failed on the plan's original sites (dawn.com 403 headless; cnn.com and weather.com did not finish loading without an ad blocker) and one intermittent e2e check; both were fixed (ruling R30; deterministic e2e).
  - **Installable copies**, in the main checkout root `/Users/outsentia/Documents/apps-hub/` (untracked there, branch `model-host`): `sieve-extension-dist` (built from `b9bac0b`) and `strongroom-extension-dist` (built from `origin/main` 93f21a1, Strongroom 0.2.0 with sync; the `strongroom-extension` worktree is stale). Load unpacked in chrome://extensions. Remove AdBlock first (README "Install and first run").
  - **Draft only:** the Phase 2 plan `docs/superpowers/plans/2026-11-08-sieve-phase-2.md` (19 tasks) awaits the owner's approval and answers to its 5 questions.
  - **Waiting on the owner:** the decisions listed next, and the signed-in spike run (Task 0.6 steps 2 to 4, `apps/sieve/spike/README.md`).
  - **Not verified, stated plainly:** ad removal while an ad is actually served (seen once on one video; YouTube served no ad in 15 no-extension control runs); a real DevTools window (only a stubbed `chrome.devtools`); m.youtube.com and music.youtube.com live; allowed channels and embeds live; a real 16 MB My filters save; `updateDynamicRules` time with about 29,000 rules; picking inside iframes (not built); the Google and Bing AI-summary rules (never seen on a live page); the empty-query page-entry pattern in real Chrome (unit tests only). The YouTube stall (6 s of 30 on one video) was measured and not reproduced (`docs/handoffs/sieve-yt-measurement.md`).
  - The untracked copies of this file and the design in the main checkout (`/Users/outsentia/Documents/apps-hub`, branch `model-host`) are stale. The worktree copies are the real ones.
- **Open owner decisions** (also in the ledger, lines `FINAL REVIEW (4)`):
  1. R26: an allowed channel's ad pings stay blocked (Ads list `||youtube.com/pagead/`, `||g.doubleclick.net^`, `||static.doubleclick.net^`; Trackers `||youtube.com/api/stats/ads?`), so the creator is probably not credited (unconfirmed how YouTube credits creators). Build a tab-scoped allow rule while an allowed channel's video is open, or accept?
  2. R25: the AI-summaries list takes 7 of its 8 rules from Stevo's AI Blocklist (MIT, credited and recorded), against the design's "our own code only". Keep, or re-derive from scratch? Google and Bing still need your checklist.
  3. R27: lists refresh only with `pnpm --filter sieve build -- --refresh` (the design said "when rebuilt"). Confirm the amendment.
  4. The settings page shows each list switch twice (Blocking and Filter lists), as the brief said. Keep one or both?
  5. Task 0.6 signed-in checks and the Phase 5 decision; Phase 2 approval and its 5 questions.
  6. Picking inside iframes (many ads are iframes): build as a follow-up?
  7. Budget: about 116,000 default-on rules draw on Chrome's shared pool: remove AdBlock first, or trim the lists?
  8. For information: the Ads list switch also turns off YouTube stripping; "Distraction control" also hides social widgets and age gates; the new `unlimitedStorage` permission; AdBlock's colour themes were never raised in the design.
- **Execution method:** subagent-driven (superpowers:subagent-driven-development); the owner asked for parallel agents in session 4 (ruling R22). `coord` cannot separate subagents of one session (see `docs/handoffs/sieve-parallel-metrics.md`), so the sessions used the atomic `filelock` helper in the SDD workspace; the lessons are written up as the skill `parallel-agents-coord` (user skills folder).
- **Next step:**
  1. Owner: install both folders (README "Install and first run"), run the signed-in YouTube and AI-summaries checklists, answer the decisions above.
  2. When the owner gives the signed-in results: finish Task 0.6 (record Q1 to Q4, decide Phase 5 by the plan's rule).
  3. On the owner's approval: schedule Phase 2 from its plan (independent pairs and shared files are tabled in the plan; start no more than two agents on the shared files at once).
  4. Before merging: `finishing-a-development-branch` (nothing is pushed; branch `sieve` has 62 commits on `ec23cbd`); the final "Rulings I made" list is the ledger lines containing `Ruling:` (R1 to R30).
- **Carry-forward notes** (the full list, with every deferred minor finding for the final review, is
  in the ledger snapshot):
  - 1.7: `blockingError` is stored in `chrome.storage.session`. A tab hostname can end in a dot
    (strip one). IPv6 tabs cannot be allowlisted, so the menu must not offer "Block on this site".
  - 1.8: a My filters `host#@#.sel` exception only reaches another list's generic selectors on
    hosts already in that list's `genericExcept`. Handle it with runtime `genericExcept` additions or
    per-page generic injection. `applyBlocking` removes any registration or dynamic rule that is not
    in `blockingPlan`, so new work must go through the plan.
  - 1.9: call `compileFilters` with `trusted: true` for My filters. Keep rule sources under their
    own key (for example `myRuleSources`), because `myRules` must stay a plain rule array. Check
    rules by applying the unpaused plan's dynamic rules. Strip ports and punycode typed hosts before
    `validateSettings`, and turn parser error text into plain words.
  - 1.11: `www.youtube.com` has per-page CSS and a `json-prune` scriptlet in the built maps. R17
    keeps an allowlisted site's embeds unfiltered.
  - Known limits (also in `apps/sieve/README.md`): cross-origin iframes on an allowlisted page still
    get the registered generic CSS and the notification blocker; the first navigation after the
    worker idles loads about 4 MB of maps, so scriptlets can arrive late.
- **Notes for the next session:**
  - Tooling (run as plain commands; the worktree guard refuses compound shell lines). The scripts
    live in `/Users/outsentia/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.0/skills/subagent-driven-development/scripts/`:
    `task-brief PLAN N` writes the task's brief, `review-package PLAN BASE HEAD` writes the review
    diff, and `sdd-workspace PLAN` prints the workspace folder.
  - The shared constraints file is plan lines 13 to 37:
    `sed -n '13,37p' docs/superpowers/plans/2026-11-06-sieve.md > <workspace>/constraints.md`.
  - Models used: Sonnet for spike tasks and scoped re-reviews; Opus for Tasks 1.3 to 1.6 and their
    task reviews (compiler, build, worker, injection).
  - Implementers stage only their own paths (explicit `git add`). Fix rounds resume the original
    implementer for rounds 1 to 3. Rulings go in the ledger as `Ruling:` lines and in the final
    message.
  - Owner-visible results so far, signed out: Q1 passes (full 1080p and audio arrive intact through
    the `visionos` client), Q2 fails on this slow link (0.25 to 0.9 MB/s), Q4 and R10 are
    inconclusive.

## Phase 3: download engine and take-over (branch `sieve-phase-3`)

This block was added by Task 3.20 (run 3 close, 2026-11-17) and holds everything Phase 3 needs; the sections above it are Phase 1's. Phase 2 (YouTube tools) keeps its own state on branch `sieve-phase-2`; when the branches merge, keep both sides of this file.

### Resume prompt (Phase 3)

```
Date: 2026-11-17. Sieve Phase 3 (download engine and take-over, my private Chrome extension) is built, reviewed
and gated on branch `sieve-phase-3` in /Users/outsentia/Documents/apps-hub/.claude/worktrees/sieve-phase-3.
Work only in that worktree. Do not use the main checkout (its branch `model-host` belongs to other work), and do
not touch the Phase 2 worktree (.claude/worktrees/sieve-phase-2) except to read it.

1. Read docs/handoffs/sieve.md completely first, the section "Phase 3: download engine and take-over" above all
   (the older sections are Phase 1). Trust the decisions, the inspected facts F1 to F17 and the gate numbers; do
   not redo reviewed or measured work. The plan is docs/superpowers/plans/2026-11-10-sieve-phase-3.md.
2. Follow the handoff contract: update the session log and "Current state and next step" as work lands; at about 85%
   of the context stop starting new work, finalize the handoff, rewrite this prompt with today's date, print it
   in a fenced block for me, and end the turn. Do not let auto-compaction happen.
3. Never add Co-Authored-By or "Generated with" lines to a commit. Commit by pathspec; do not push, open a PR
   or merge unless I ask. Never use my own Chrome profile in automated tests.
4. Continue from "Current state and next step" below. The merge order is my decision: Phase 2, then Phase 3
   rebased, then plan Phase 4.
```

### Goal and fixed constraints (Phase 3)

IDM's job inside Chrome as Sieve's own code (design goal 3, without media detection and YouTube): take over Chrome's large downloads of chosen types, resume them after any restart, split them into parts when asked, queue, limit, schedule, sort into folders of Downloads, add by hand and from the right-click menu, list in an IDM-style page, show in the menu's Downloads tab. A taken-over file never vanishes; a large download never restarts from zero. The plan holds the architecture (engine in an offscreen document's Worker, router service worker, pages), the take-over decision table and the finishing protocol; the README's "Downloads" section holds the user-facing description, the known limits and the owner checklist.

Fixed constraints (full text in the plan's Global Constraints and Review Focus):

- Anti-goal 1: no content script and no registered script added; no offscreen document while no work is runnable; the worker starts fast.
- Anti-goal 3 (top acceptance criterion): Chrome's download is cancelled only after the engine persisted and acknowledged the record; any doubt resumes Chrome's download untouched; the private copy is deleted only after Chrome reports the save complete with the right size; records are persisted at checkpoints (4 MiB or 2 s); a worker dying while Chrome's download is paused is repaired by the next worker start.
- Chrome only, Manifest V3, `minimum_chrome_version` 128; no API newer than that (`chrome.offscreen.hasDocument` and `alarms.create({ persistAcrossSessions })` are typed since Chrome 150 and are not used).
- Erasable TypeScript, `.ts` imports, new `*.test.ts` files listed in their package's `test` script, `sieve-core` modules pure and imported by file path, UI from `packages/ui`, every visible string once in `packages/sieve-core/src/dl-text.ts`, no word that promises a speed-up, no telemetry.
- Messages, alarm names and storage keys carry the `dl` prefix because Phase 2 shares the worker.

### Current state and next step (Phase 3)

- **State (2026-11-17, run 3 close, written at HEAD `088c03f`, before this commit):** branch `sieve-phase-3`, base `47c7ea4` (the end of Phase 1; Phase 3's own plan is `2589bf5`). Tasks 3.1 to 3.19 are committed and were reviewed (every task commit once, every fix scoped re-reviewed, controller-checked only where the ledger says so). Run 3 (this close) landed: the minors batch, the plan's as-built deviations (`ae657a3`), `apps/sieve/test/dl-perf.mjs` (`bf015b7`), the test-list check (nothing missing: 20 test files in `sieve-core`, 14 in `apps/sieve`, every one listed), the README's Downloads section with the owner checklist, this block and `manifest.json` version `0.3.0`.
- **Last full gate (run 2, clean export of `911e72b`):** install ok; build ok; `sieve-core` 336/336; `sieve` 175/175; typecheck ok; `pnpm --filter sieve test:e2e` 455/455 under `chrome-live` (about 7 minutes). Attribution lines in commits: 0. The `--big` run saves 3 GB of real bytes with 215 MB of browser memory growth; the torture module passes 49/49 (SIGKILL resumes in 0.7 to 1 s and re-sends 1.4 to 18 MB).
- **Run 3 gate and perf:** see the placeholder subsection "Phase 3 gate and perf (run 3)" below; the controller fills it with the real numbers.
- **Waiting on the owner:** the merge decision and order; the eighteen-item owner checklist in the README ("Owner checklist: downloads", it covers what headless Chrome cannot show: the download bubble, a real restart, a file over 5 GB); the five questions below.
- **Not verified, stated plainly:** alarm persistence and `onStartup` over a real Chrome restart; Chrome's download bubble during a take-over; a real multi-GB file over 3 GB; the real `Downloads/<category>/` folders under Playwright (the harness rewrites the download folder; the raw-CDP Chrome in `test/dl/_raw-chrome.mjs` checks them instead); real-site take-over with the owner's accounts.
- **Next step:** merge order is the owner's decision: Phase 2, then Phase 3 rebased onto it (the shared files and the one known conflict are listed under "Resolved merge notes"), then one integration check from a clean export (`pnpm test`, `pnpm typecheck`, `pnpm --filter sieve build`, `pnpm --filter sieve test:e2e`, `node apps/sieve/test/dl/e2e.mjs`), then the follow-up commit for backup and import of the `downloads` settings, then plan Phase 4 (media detection, HLS and DASH, the muxer, the hover icon).

#### Phase 3 gate and perf (run 3)

> PLACEHOLDER: the controller fills this subsection with the real numbers of the final clean-export gate (build, `sieve-core` and `sieve` unit counts, typecheck, `test:e2e`, `dl/e2e.mjs --big`, `dl-perf.mjs`, `perf.mjs`, the take-over pause latency, the `--big` memory numbers and the torture re-send numbers). Nothing below this line is a measured gate result until it is replaced.

(not yet filled)

### Session log (Phase 3)

- **2026-11-10:** the plan was written (20 tasks, 3.1 to 3.20, probes F1 to F16 in Chrome for Testing 149.0.7827.55), reviewed in two lanes (0 blocking and 2 blocking, all accepted; F17 found by a reviewer), fixed in two rounds, committed `2589bf5`. First run: Tasks 3.1 to 3.10 dispatched at once, contract-first (every contract commit landed in 2 to 8 minutes, no contract change needed). Per-commit reviews found 0 blocking and about ten Important items (retry loop on a throwing engine, idle after a failed save, unread bodies not aborted, probe `Retry-After`, session-rule sync overlap, vacuous tests), all fixed and re-reviewed. Gate on `62e55a9`: build ok, 323/323 and 85/85 unit tests, typecheck clean, e2e 213/213.
- **2026-11-11:** run 2: Tasks 3.11 to 3.19 plus O1 (a resumed record whose part file was lost or truncated was zero-filled and could finish as a complete file with holes; fixed in `d24b3ff` with a `fresh` flag on the file handle, then four more fix commits). Reviews: opus for take-over, resume, OPFS and completeness code (Important findings included "Retry in Chrome removed the only complete copy", an id-reuse guard, and incognito), sonnet for the rest. Infrastructure freeze 16:12 to 17:02 (all workers resumed by message, nothing lost). Final gate on `911e72b`: 336/336, 175/175, typecheck ok, e2e 455/455. Task 3.20 not started (the owner's PAUSE order).
- **2026-11-17 (run 3, close):** the controller split the close into three disjoint owners. `t-minors` (opus) fixed the deferred minors in the engine, router, save and tests (first commit `6c30b58`: strict `Retry-After`, NaN-safe backoff, a second `filename*`, a done after a save timeout finishes the record). `t-plantext` (sonnet) recorded the as-built deviations in the plan (`ae657a3`). `t-320` (sonnet, this block) wrote `dl-perf.mjs` (`bf015b7`), checked the test lists, and wrote the README section, this block and the version line. A first full `dl-perf.mjs` run before the gate (own build of the worktree at that moment, under both locks): Phase 1 worker cold start 4 ms against Phase 3 5 ms (same `pick` message) and 26 ms to a first `dl-do` reply (which also creates the engine document), idle close 60.2 s after a finished 5 MB download, local page DCL +7.1 ms with the extension; all rows PASS. The gate can fail: a tightened start limit, a tightened DCL limit and a missing base build were each run and gave FAIL with exit code 1, and a partial `--only` run exited 3. The authoritative gate numbers are the controller's, in the placeholder above.

### Verified facts (Phase 3)

Run on 2026-11-10 in Chrome for Testing 149.0.7827.55 (`~/Library/Caches/ms-playwright/chromium-1228`), headless, a fresh profile per run, against a local fixture server. The probe scripts are in `.superpowers/phase-3/scratch/probes/` of the Phase 3 worktree (gitignored workspace; run with `node <file>` from that folder, they need no build); F17 is in `.superpowers/phase-3/scratch/review-A/gzip-range2.mjs`. A task that depends on a row re-ran its probe first and records the result in code as `// inspected <date>, Chrome for Testing <version>`.

| # | Fact | Evidence | Probe |
|---|---|---|---|
| F1 | An offscreen document has `chrome.runtime` only (`id`, `onMessage`, `onConnect`, `connect`, `sendMessage`, `getURL`). `chrome.storage`, `chrome.downloads`, `chrome.alarms` and `chrome.tabs` are undefined there and in its Worker (`chrome` itself is undefined in a Worker). | `Object.keys(chrome)` gave `["loadTimes","csi","runtime"]`; `typeof chrome.storage` was `"undefined"` | `p1.mjs` |
| F2 | `createDocument({ reasons: ['WORKERS'] })` and `['WORKERS','BLOBS']` are accepted (both are in `@types/chrome` 0.3.7, line 7908 on). A second `createDocument` fails with the text "Only a single offscreen document may be created." | probe output | `p1.mjs`, `p2.mjs` |
| F3 | A `WORKERS` document stayed alive for 48 s idle (its `performance.now()` advanced 48,031 ms; no close at 30 s). Stopping the service worker with CDP `ServiceWorker.stopAllWorkers` left it running, and a `chrome.runtime.sendMessage` from an extension page woke the stopped worker. | `up` deltas | `p9.mjs` |
| F4 | `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })` lists the document (0 before, 1 after `createDocument`; Chrome 116+). `chrome.offscreen.hasDocument` exists in 149 but is typed "since Chrome 150", so it is not used. | probe output | `p9.mjs` |
| F5 | A classic and a module Worker can be created from the offscreen document. Inside it: `navigator.storage.getDirectory`, `createSyncAccessHandle`, `createWritable`, `navigator.locks` and IndexedDB all exist; a second sync handle on a file already open fails with `NoModificationAllowedError`; `truncate(2.5 GiB)` took 11 ms (sparse). | probe output | `p1.mjs`, `p13.mjs` |
| F6 | `navigator.storage.estimate()` in the document and in its Worker reported a quota of about 112 GB with 105 GB free on the disk (the probe manifest has `unlimitedStorage`, as Sieve's does): the quota follows free disk space. | `quota: 112227264257` | `p1.mjs` |
| F7 | IndexedDB and OPFS are one store for the service worker, the offscreen document, its Worker and extension pages (the worker read a value the document wrote and listed a file the Worker created). Both survived closing the browser and opening it again on the same profile. | `swReadsIdb`, `swOpfs`, restart block | `p1.mjs`, `p9.mjs` |
| F8 | The service worker has no `URL.createObjectURL`; the offscreen document has it. | `typeof` | `p1.mjs` |
| F9 | `chrome.downloads.download({ url: 'blob:chrome-extension://<id>/<uuid>', filename: 'SieveProbe/Video/big.bin' })` from the worker saved a 2,684,354,560-byte OPFS file (8 MiB real data, the rest sparse) in 1.7 s with `fileSize` and `totalBytes` equal to the file. The browser's resident memory read 882 MB before and during. `onCreated` for that save had no `byExtensionId`; a `search` afterwards did. | `p2.mjs`, `p4.mjs` output | `p2.mjs`, `p4.mjs` |
| F10 | Under Playwright, extension downloads land in a temp folder under a GUID name (`playwright-artifacts-*`), so `Downloads/<category>/` cannot be seen; `acceptDownloads: false` makes them `USER_CANCELED`; `downloadsPath` and `connectOverCDP` change nothing. A Chrome started by `child_process` with `--remote-debugging-port=0` and a seeded `<profile>/Default/Preferences` (`{"download":{"default_directory":"<dir>","prompt_for_download":false}}`), driven through raw CDP over Node's `WebSocket`, saved `<dir>/Sieve/Video/own.bin` for `filename: 'Sieve/Video/own.bin'`. That download took 2 to 6 s to reach `complete`. | `p6.mjs`, `p7.mjs`, `p8.mjs` | `p6.mjs`, `p7.mjs`, `p8.mjs` |
| F11 | For a page navigation that downloads: `onCreated` fires with `filename: ''`, `bytesReceived: 0`, `mime`, `totalBytes`, `referrer` (the page URL) and `url` equal to `finalUrl`. `chrome.downloads.pause(id)` inside the listener settled in 2.0 to 2.5 ms and `bytesReceived` was still 0 two seconds later, for a 300 MB file at 20 MB/s and a 1.5 GB file unthrottled. The paused item had `paused: true`, `canResume: true`, `state: 'in_progress'`; the filename arrived through `onChanged` right after; the server saw its connection stay open (26 MB sent into buffers in 1.5 s). `cancel(id)` took 2 to 4 ms (`interrupted`, `USER_CANCELED`, connection closed); `erase({ id })` removed the item from history; `resume(id)` finished a 60 MB download. After `pause`, `search({ id })` returns Chrome's own `filename` (under Playwright a GUID path with no extension; in real Chrome the name Chrome chose). `onDeterminingFilename` never fired under Playwright, with a listener registered (`p5.mjs det`, which loads `ext-det`) or not, so it is not used. | probe output | `p3.mjs`, `p5.mjs`, `p13.mjs` |
| F12 | `fetch(url, { credentials: 'include' })` from the worker, from the offscreen document and from its Worker sends every cookie Chrome's own navigation sent, including `SameSite=Lax` and `SameSite=Strict` ones, with only `<all_urls>` host permission (no `cookies` permission). | cookie header `sid=abc; strict=1; plain=2` | `p4.mjs`, `p10.mjs` |
| F13 | The `referrer` option of `fetch` from the extension origin sends no Referer at all. `chrome.downloads.download({ headers: [{ name: 'Referer' …}] })` and the same for `Cookie` fail with "Unsafe request header name". A `declarativeNetRequest` session rule (`modifyHeaders`, `set` the `referer` header, `condition.initiatorDomains: [<extension id>]`) does set the Referer on fetches from the worker, the offscreen document and the Worker. | probe output | `p4.mjs`, `p10.mjs` |
| F14 | Sieve's own blocking applies to the extension's own fetches: from the worker of the built extension, `fetch` to `pagead2.googlesyndication.com` and `googletagmanager.com` failed ("Failed to fetch"), while a page navigation to the same host loaded. A session rule `{ action: { type: 'allow' }, condition: { initiatorDomains: [<id>], resourceTypes: ['xmlhttprequest', 'other'] } }` at a priority above `meta.maxPriority` (1,000,301 in the current build) made both succeed. When an `allow` rule and a Referer rule both match, the Referer rule must have the higher priority: allow 2,000,000,000 with Referer 2,000,000,001 set the header; the reverse, and equal priorities, did not. | probe output | `p11.mjs`, `p12.mjs` |
| F15 | Alarms in an unpacked extension: a 0.05-minute alarm fired 3,009 ms later (8 ms late). `@types/chrome` says a packaged extension is limited to one firing per 30 s (line 463). With `--load-extension` each launch re-installs the extension (`onInstalled` reason `install` twice, no `onStartup`, no alarms left), so alarm persistence across a browser restart and `onStartup` cannot be checked in the harness. | `alarmSoon`, restart block | `p9.mjs` |
| F16 | A Worker in the offscreen document streamed 1 GB from a local server into an OPFS sync handle in 364 ms (2.7 GB/s) and the browser's resident memory grew 193 MB; `reader.cancel()` after 5 MB aborted cleanly. | `p10.mjs` output | `p10.mjs` |
| F17 | With a `Range` header Chrome sends `Accept-Encoding: identity`. A server that answers the ranged request with `Content-Encoding: gzip` anyway makes `fetch` throw `TypeError: Failed to fetch` (an unranged request gets the gzip body and `Content-Length` 1004 for a 1,000,000-byte file). So the probe never sees an encoded body: it fails as `probe-failed`. | `err: "TypeError: Failed to fetch"` for `bytes=0-` and `bytes=0-0` | `.superpowers/phase-3/scratch/review-A/gzip-range2.mjs` |

**Not found, and how the plan handles it:**
- *Alarm persistence over a real restart and `onStartup`* (F15): every worker start runs `reconcile()` (Task 3.11), which re-creates the alarms and re-creates the engine if work is pending, so correctness does not depend on either. The owner checklist (README) restarts Chrome with a download running and with a scheduled queue pending.
- *How long Chrome lets an idle service worker live:* Playwright keeps it busy, so nobody measured it. No design step depends on it: the worker holds no download state, and the engine document is independent of it (F3).
- *Chrome's download bubble and shelf during a take-over:* headless Chrome shows none. Owner checklist item.
- *A real-data multi-GB save:* F9 used a sparse file. The `--big` run of `test/dl/save.mjs` saves 3 GB of real bytes (passes, 215 MB of browser memory growth); a file over 5 GB is an owner checklist item.
- *`onDeterminingFilename`:* not observable under Playwright (F11); the design needs it only to rename, which this phase does by saving through `chrome.downloads.download` with its own `filename`.

Facts found during implementation (from the controller's ledger; trust them):

- Chrome rejects `chrome.downloads` file names that contain `~` or Cf or Cc characters (Phase 2's sanitiser meets the same class of rule).
- A blob without a MIME type saved as `clip.txt` in raw Chrome; fixed in `c75288d`.
- `tabs.query` never matches an extension page, so the list page is found with `runtime.getContexts` instead.
- The manifest has 10 permissions, sorted and unique; `commands` is a top-level key (Phase 2). Runtime message types and alarm names are all `dl`-prefixed; `newId` collisions: none.
- Every worktree run goes through the shared `apps/sieve/dist`; an e2e run and a build are one holder at a time (the controller's lock key `apps/sieve`), and perf, `--big` and the full e2e also take the machine lock `chrome-live`.

### Phase 3 file map

- Plan: `docs/superpowers/plans/2026-11-10-sieve-phase-3.md` (decisions, questions, merge notes, the as-built deviations recorded in run 3).
- Core, pure (`packages/sieve-core/src/`): `dl-settings.ts`, `dl-record.ts`, `dl-ports.ts`, `dl-plan.ts`, `dl-bucket.ts`, `dl-queue.ts`, `dl-takeover.ts`, `dl-view.ts`, `dl-text.ts`, `dl-engine.ts`, `dl-transfer.ts`, with tests under `src/__tests__/dl-*`.
- Engine: `apps/sieve/src/offscreen/` (`offscreen.html`, `offscreen.ts`, `engine-worker.ts`, `opfs-files.ts`), `apps/sieve/src/dl/idb-store.ts`.
- Service worker: `apps/sieve/src/dl/` (`background-dl.ts`, `engine-link.ts`, `settings-store.ts`, `net-rules.ts`, `router.ts`, `save.ts`, `takeover.ts`, `menus.ts`, `alarms.ts`, `links.ts`).
- Pages: `apps/sieve/src/dl/` (`list.html`, `list.ts`, `list.css`, `add-dialog.ts`, `limit-dialog.ts`, `scheduler-dialog.ts`, `queues-editor.ts`, `popup-downloads.ts`, `options-downloads.ts`); build hook `src/dl/build-dl.mjs`.
- Tests: `apps/sieve/test/dl/` (runner `e2e.mjs`, helpers and fixture `_*.mjs`, modules `boot`, `transfer`, `router`, `save`, `takeover`, `menus`, `list`, `list-dialogs`, `popup`, `settings`, `torture`) and `apps/sieve/test/dl-perf.mjs` (the phase gate, standalone). `apps/sieve/src/__tests__/dl-*.test.ts` are the unit tests of the extension side.
- Ledger and metrics (workspace, gitignored): `.superpowers/phase-3/progress.md`, `merge-notes.md`, `s1-metrics.md`.

### Resolved merge notes (Phase 2 first, then Phase 3 rebased)

- **`manifest.json` permissions:** both phases edit the one line. The resolved line is the sorted union, 10 entries: `alarms`, `contextMenus`, `declarativeNetRequest`, `declarativeNetRequestFeedback`, `downloads`, `offscreen`, `scripting`, `storage`, `unlimitedStorage`, `webNavigation`; `commands` stays a separate top-level key. **`version`: a known conflict.** Phase 2 sets `0.2.0` on its branch and Phase 3's close sets `0.3.0`; after the rebase the resolved value is `0.3.0`.
- **`background.ts`:** Phase 2 adds `onYouTubeMessage` and `chrome.commands.onCommand` lines; Phase 3 adds one import and `initDownloads();` last. Keep both sets.
- **`build.mjs`:** Phase 3's two lines (`import { buildDownloads } from './src/dl/build-dl.mjs';` and `await buildDownloads({ out, root, ui: root('../../packages/ui') });` before `const ui = …`) are separate from Phase 2's `manifest.commands = …` line.
- **`popup.ts`, `popup.css`:** both add a tab; `tabs.splice(1, 0, downloadsTab)` keeps Downloads second (design order: Blocking, Downloads, YouTube). The Phase 1 check text "and no tab bar (one tab)" in `e2e.mjs` is edited by both; the resolved condition is `switchCount === 6 && tab count >= 2`.
- **`options.ts`, `options.css`:** both append sections. After Phase 2's side navigation lands, add a `Downloads` link (`#downloads`) to its list (one line) and put `downloadsSection()` before the YouTube section if the order matters (the design lists Downloads before YouTube).
- **`test/e2e.mjs`, both `package.json` files, `README.md`, this file:** keep both sides; the test lines are a union. Phase 3's README block ("Downloads", with its owner checklist) sits just before "Licences"; this block is appended at the end of this file.
- **`packages/sieve-core/src/index.ts` is not touched** by Phase 3 (deep imports only).
- **Backup and import (post-merge, owner informed):** Phase 2's Task 2.18 backs up only `settings` and `youtube`. After the merge, add one follow-up commit: `Backup` gets an optional `downloads` (`DownloadSettings`), `makeBackup` writes it, `readBackup` validates it with `validateDownloadSettings` (a missing one gives the defaults), and "Replace my settings" writes the `downloads` key in the same `withSettingsLock` write. Until then a backup does not include Downloads settings; the README says so.
- After the merge run once: `pnpm test`, `pnpm typecheck`, `pnpm --filter sieve build`, `pnpm --filter sieve test:e2e` and `node apps/sieve/test/dl/e2e.mjs` from a clean export.

### Decisions (Phase 3, copied from the plan)

Each is a choice the design or the owner leaves open, with why and what it costs if wrong.

1. **The owner's answers are decisions here.** Take over files over 5 MB of the types this plan lists; 1 part per host by default, configurable 1 to 6, a 429 or 503 means fewer parts (rule in Task 3.2); categories are subfolders of Downloads; the speed limit is off by default; the Downloads tool has its own switch, `downloads.on`, default true, stored in the new key `downloads` (the header "Sieve on" keeps meaning blocking; Phase 2 adds `youtube.on` the same way and this plan does not touch its files).
   - Why: the owner's instruction of 2026-11-10. Cost if wrong: none; they are settings.
2. **The default type list is the five category lists (56 extensions) plus 31 MIME types, and the floor is "greater than 5,000,000 bytes".** This is the "default take-over types and minimum size are decided when this phase is planned" item of the outline plan. `application/octet-stream` is on the MIME list so unnamed binaries over 5 MB are caught; `txt`, `csv`, `html` and source-code extensions are left out.
   - Why: IDM-style rules need a list, and the owner named archives, disk images, installers and programs, video, audio and documents. Cost if wrong: a type is missed or taken that should not be; both are one edit in settings.
3. **Take-over requires a 206 answer to the probe.** A server that cannot resume stays with Chrome (`no-range`), although the engine can download such a URL when the owner adds it by hand (in one go, restarting from the start after an interruption, and the list says so).
   - Why: anti-goal 3; taking over a file the engine cannot resume gains nothing and risks a restart from zero. Cost if wrong: such downloads miss the queue and category features. (Question 1.)
4. **The probe is `GET` with `Range: bytes=0-0`, 8 s limit, with the page's cookies and, through a session rule, its referrer.** A `HEAD` request lies on many servers; a one-byte range answers size, type and range support together.
   - Cost if wrong: a few servers answer a one-byte range differently from a download; they fail the comparison and Chrome keeps the download.
5. **429 and 503: halve the connections for that host (never below 1), remember it 30 minutes, back off 2, 4, 8, 16 s, honour `Retry-After` up to 60 s, fail at the fifth in a row.**
   - Why: the only firm data (OVH refusing 2 of 6) says refusals appear above some small number; halving converges in two steps without guessing the number. Cost if wrong: a host that would have accepted 5 gets 3.
6. **Final path is `Downloads/<category>/<name>`, not `Downloads/Sieve/<category>/…`.** The design says `Downloads/<category>/`; Phase 2's screenshots use `Downloads/Sieve/`. Name collisions use Chrome's `uniquify` (`name (1).ext`); file names are sanitised by the exact rule in Task 3.5.
   - Cost if wrong: files land beside the owner's other downloads of the same kind instead of apart. (Question 2.)
7. **The engine's state is owned by one writer: the Worker, in IndexedDB.** Pages read IndexedDB for the first paint and use broadcasts for live numbers; the service worker also reads it (for rules, alarms and the decision to create the engine). `chrome.storage` is not available to the offscreen document (inspected F1).
   - Cost if wrong: a second writer would need a lock; the single writer avoids that.
8. **The service worker holds no download state and needs no keep-alive.** The engine lives in the offscreen document (inspected F3); every worker handler re-reads session storage or IndexedDB; a watchdog alarm and a start-up `reconcile()` repair a dead engine.
   - Cost if wrong: if Chrome ever closes the offscreen document on its own, the watchdog brings it back within a minute.
9. **Referer and the allow rule are declarativeNetRequest session rules,** because `fetch` cannot set Referer and `chrome.downloads` refuses it (inspected F13), and because Sieve's own blocking would otherwise stop the engine's requests (inspected F14). The allow rule is priority 2,000,000,000 and the Referer rules one higher.
   - Cost if wrong: if Phase 1's rule priorities ever exceed 2e9, downloads from blocked hosts fail with a visible status; the constant is one line.
10. **Our own saves are recognised by `blob:` URL, by `byExtensionId` and by a remembered retry-URL set,** not by `byExtensionId` alone, because it is absent in `onCreated` (inspected F9).
    - Cost if wrong: none seen; the three checks overlap.
11. **The private copy is deleted only after Chrome says `complete` with the right size; after a restart a `saving` record saves again.** A duplicate `name (1).ext` is possible; a loss is not.
    - Cost if wrong: an occasional duplicate to delete by hand.
12. **Context menus open the Add dialog with the addresses filled in, instead of adding at once.** There is no content script to show feedback on the page, and "all links" can be hundreds of addresses, so the owner confirms, picks the queue and category, and sees the list. Links for "selected" and "all" are read by `chrome.scripting.executeScript` only when the item is clicked.
    - Cost if wrong: one extra click per right-click download. (Question 3.)
13. **`dl-menu-click` is a message only extension pages may send; it exists so the e2e can click native menus.** It does exactly what a menu click does.
    - Cost if wrong: none; a web page cannot send it.
14. **Six fixed categories (Video, Music, Programs, Archives, Documents, Other); the owner edits folder names and extension lists, not the set.**
    - Cost if wrong: adding a category later needs a settings migration.
15. **Queues: the default is one "Main queue" (3 at once); more can be added (up to 8) with a daily window (start, optional stop, chosen days).** Pressing Resume starts a download now whatever the window or slot count (`force`). A removed queue's records move to the first queue.
    - Cost if wrong: IDM's separate "stop all" button is not here; Pause covers it.
16. **The speed limit is one shared token bucket in KB/s (1 KB = 1000 bytes), burst a quarter second (at least 64 KiB).**
    - Cost if wrong: a few chunks overshoot the limit at the start of a download.
17. **`downloads.on` false:** no take-over, no menus, nothing starts by itself, running non-forced downloads go back to the queue; records stay and Resume on the list still runs them.
    - Cost if wrong: one condition in `schedulePlan`.
18. **The engine document closes itself after 60 s with nothing to do and the worker reopens it for work, so an idle Chrome carries no extra process (anti-goal 1).** A 1-minute watchdog alarm exists only while work is runnable.
    - Cost if wrong: a one-second delay when work arrives after an idle spell.
19. **Parts default to 1 and the settings text says plainly that more parts often change nothing.** Re-splitting runs only when parts is above 1; resume across restarts works with one part (ranges), as the owner asked.
    - Cost if wrong: none; honesty about speed is a requirement.
20. **The engine core and the transfer are in `sieve-core` behind ports (`dl-ports.ts`), not in the extension.** "Pure" here means no `chrome.*` and no DOM; they use web-standard `fetch` types and streams that Node also has. That makes the anti-goal 3 rules testable with `node --test` and fakes.
    - Cost if wrong: none.
21. **The e2e uses Playwright for most checks and a raw-CDP Chrome (Node's `WebSocket`) for real folders and SIGKILL,** because Playwright rewrites the download location and cannot kill the browser (inspected F10). A fixture server (`_fixture.mjs`) provides ranges, 429, redirects, one-time links, throttling and a changing file.
    - Cost if wrong: about 80 lines of helper.
22. **No change to `test/harness.mjs` and no change to Phase 2's files.** The dl e2e runner discovers `test/dl/*.mjs`, so later tasks add files, not edits.
23. **README and handoff are edited once, in Task 3.20.** Each task reports its limits in its hand-back; the controller keeps them in the ledger.
24. **The menu's Downloads tab has no "media found on this page" section in this phase.** It shows the Downloads switch, active downloads with progress, Add URL and Open download list; the media section arrives with media detection in Phase 4 (design: the menu's Downloads tab).
25. **Delete on a finished row removes it from the list only; the saved file stays.** Delete on an unfinished row removes the partly downloaded data too.
    - Cost if wrong: one confirm sentence. (Question 4.)

26. **Connections are budgeted per host, across all downloads, at 6 (`HOST_MAX`),** and a 429 or 503 lowers that host-wide number for 30 minutes. A per-download budget would let `maxParallel` 3 with 6 parts open 18 connections to one server.
    - Cost if wrong: a few lines in `dl-transfer.ts`; a host that would have accepted more gets 6.
27. **A transient outage never fails a download.** Only 429 and 503 count toward five failures; every other failure retries with back-off up to 30 s until 15 minutes pass without a byte (a stalled connection is aborted after 30 s without a byte). This covers running downloads only: a manual add whose probe fetch throws (including on a network blip) fails with `ERRORS.probe` after about 6 s (three attempts, sleeps of 2 s and 4 s), and the row offers Retry in Chrome.
    - Cost if wrong: a broken link retries for 15 minutes before it says so.
28. **Take-over checks free disk space** (`2 * size + 50 MB`) and leaves Chrome's download alone when the disk cannot hold the private copy and the saved file together.
    - Cost if wrong: a large download that would just have fitted stays with Chrome.
29. **Take-over bookkeeping keys are one per entry, and `dlTakeover:<id>` lives in `chrome.storage.local`** (session storage is cleared on extension reload, update or disable, which would orphan a paused Chrome download).
    - Cost if wrong: a stale key is removed by the next worker start.
30. **"Retry in Chrome" removes the record only after Chrome's download has received a byte.** If that is not seen within 10 s the record stays, so the partly downloaded data is never deleted before Chrome has the file coming.
    - Cost if wrong: a leftover failed row to delete by hand.
31. **Chrome's own file name wins when it has an extension** (it already applies a page's `download` attribute), then Content-Disposition, then the URL. Under Playwright Chrome's name is a GUID without an extension, which falls through, so the harness behaves like the URL rule.

### Questions for the owner (Phase 3)

The owner said to proceed with the stated defaults, so the plan proceeds with everything above. These are confirmations only, not blockers:

1. **Servers that cannot resume:** is it right that Chrome keeps those downloads (decision 3)? The alternative is to take them over and accept a restart from zero after an interruption.
2. **Folder:** `Downloads/<category>/` as the design says (decision 6), or `Downloads/Sieve/<category>/` like Phase 2's screenshots?
3. **Right-click downloads open the Add dialog** (decision 12) instead of starting at once. Keep?
4. **Delete on a finished row leaves the file in Downloads** (decision 25). Keep?
5. **Backup:** Phase 2's backup file will not include the Downloads settings until a small follow-up after the merge (Merge notes). Is that acceptable meanwhile?
