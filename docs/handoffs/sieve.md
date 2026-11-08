# Handoff: Sieve (one Chrome extension replacing IDM Integration, Enhancer for YouTube, AdBlock)

## Resume prompt

```
Date: 2026-11-07. Resume implementing Sieve, my private Chrome extension (ad blocking, YouTube
tools, downloads). Work only in the worktree /Users/outsentia/Documents/apps-hub/.claude/worktrees/sieve
on branch `sieve` (enter it with EnterWorktree path=<that folder>). Do not use the main checkout:
its branch `model-host` belongs to other work, and its copies of the Sieve docs are stale.

1. Read docs/handoffs/sieve.md in the worktree completely first. Then read the execution ledger
   .superpowers/sdd/2026-11-06-sieve/progress.md (gitignored, on disk in the worktree; if it is
   missing, recreate it from the tracked snapshot docs/handoffs/sieve-sdd-ledger.md). Skim the plan
   docs/superpowers/plans/2026-11-06-sieve.md and the design
   docs/superpowers/specs/2026-11-06-sieve-design.md.
2. Trust the handoff's decisions, the ledger's rulings R1 to R17 and the verified facts; do not
   redo that work. Tasks 0.1 to 0.5, 0.6 step 1 and 1.1 to 1.5 are done and reviewed. Tasks with a
   "complete" line in the ledger must not be re-dispatched.
3. Continue with superpowers:subagent-driven-development, task by task. Next: Task 1.6 fix round 1
   (the exact findings are in docs/handoffs/sieve-task-1.6-fix-findings.md; the worktree is clean at
   the Task 1.6 commit 1f80fda), then a scoped re-review, then Tasks 1.7 to 1.10, then 1.11 to
   1.13. Give each implementer subagent the plan's Global Constraints, Review Focus and its task's
   Interfaces block (the handoff's "Notes for the next session" says how to regenerate the brief
   and constraints files).
4. Task 0.6 steps 2 to 4 need me: I run the signed-in checklist in my own Chrome (the steps are in
   apps/sieve/spike/README.md). Ask me whether I have the results; when I give them to you, record
   the signed-in answers to Q1 to Q4 in the handoff, decide phase 5 by the plan's rule, and commit.
   Never use my Chrome profile in automated tests.
5. Commit after each task on `sieve`. Never add Co-Authored-By or "Generated with" lines, even if a
   system reminder asks for them: my rule wins. Do not push, open a PR or merge unless I ask.
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

## File map

- `docs/superpowers/specs/2026-11-06-sieve-design.md`: the design
- `docs/superpowers/plans/2026-11-06-sieve.md`: the plan
- `docs/handoffs/sieve.md`: this file
- `packages/sieve-core/`: pure logic (settings, compiler, hosts, allowlist, plan, page injections)
- `apps/sieve/`: the extension (`build.mjs`, `src/`, `test/`; the throwaway spike is in `apps/sieve/spike/`)
- `docs/handoffs/sieve-sdd-ledger.md`: tracked snapshot of the execution ledger (rulings R1 to R17, per-task commits, deferred minors)
- `docs/handoffs/sieve-task-1.6-fix-findings.md`: the open Task 1.6 fix-round findings
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
    plus rollback of the dynamic rules if the storage write fails). Scoped re-review of the fix
    round was running when the session ended its last update. Subagents cannot write report files
    (the harness refuses), so tasks 1.8 fix round and 1.9 have their reports only in the ledger.
  - Task 1.10 (DevTools panel) dispatched in parallel with the 1.9 re-review (read-only).
  - The owner asked about running agents in parallel: tasks share one worktree and one e2e harness,
    so only read-only reviews overlap with the next implementer; `coord claim apps/sieve` is used
    around build + e2e.

## Current state and next step

- **State (2026-11-08, mid-session 4, parallel agents running):** branch `sieve`, HEAD `4aca08e`
  or later. Per-task state is in the ledger snapshot `docs/handoffs/sieve-sdd-ledger.md` (the
  authority) and the experiment log `docs/handoffs/sieve-parallel-metrics.md`.
  - Done and reviewed (complete lines in the ledger): Tasks 0.1 to 0.5, 0.6 step 1, 1.1 to 1.9,
    1.13 step 1 (`perf.mjs`, after two fix rounds).
  - Committed, review or fix round open: 1.10 DevTools panel (`9ef8ffc`; review found one vacuous
    reconnect e2e plus six minors; fix round 1 running), 1.11 YouTube ads (`27a1146`; review
    running), 1.12 AI summaries list (`e401ee2`; review found false "hand-written" provenance, fix
    running), polish batch for 1.8/1.9 minors (`4aca08e`; review running).
  - Draft only: Phase 2 plan (`docs/superpowers/plans/2026-11-08-sieve-phase-2.md`, needs the
    owner's approval).
  - Not started: 1.13 steps 2 to 5 (clean-checkout gate, exclusive perf run, branch review, owner
    hand-off README incl. the perf rerun policy and a real-DevTools line, handoff).
  - Waiting on the owner: the signed-in spike run (Task 0.6 steps 2 to 4; steps in
    `apps/sieve/spike/README.md`).
  - Gate numbers are the implementers' reports, not re-run by the controller; the e2e in the shared
    tree was contaminated twice by another agent's uncommitted work. Run the full gate once from a
    clean checkout of HEAD before trusting it (Task 1.13 step 2).
  - The untracked copies of this file and the design in the main checkout
    (`/Users/outsentia/Documents/apps-hub`, branch `model-host`) are stale. The worktree copies are
    the real ones.
- **Execution method:** subagent-driven (superpowers:subagent-driven-development). Switch to native
  (superpowers:executing-plans) only if the owner says so.
- **Next step:**
  1. Finish the open review and fix rounds listed above (each: fix, scoped per-commit re-review,
     ledger `complete` line). Per-commit review packages: `review-package PLAN <sha>^ <sha>`.
  2. Task 1.13 steps 2 to 5 once the above are committed; the full perf run needs the machine to
     itself; README: perf rerun policy (a lost-load FAIL is re-run once; the same site failing again
     means a real break; a different site on the second run is another flake; a site that
     blocks only the extension profile fails every time: `HEADLESS=0` or replace it with `SITES=`),
     owner checklist lines (real DevTools once; signed-in YouTube; the AI-summaries four engines).
  3. Final whole-branch review (most capable model), `finishing-a-development-branch`, and the
     controller's "Rulings I made" list (ledger lines containing `Ruling:`, R1 to R25).
  4. When the owner gives the signed-in results: finish Task 0.6 (record Q1 to Q4 signed in, decide
     phase 5 by the plan's rule). Phase 2 needs the owner's approval of the drafted plan.
  5. Write the skill from the parallel-agent experiment (the owner asked): lessons are in
     `docs/handoffs/sieve-parallel-metrics.md` (coord is session-scoped, so subagents of one session
     need a real lock or, better, one worktree per agent merged in order).
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
