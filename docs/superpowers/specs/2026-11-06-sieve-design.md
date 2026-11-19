# Sieve: one Chrome extension for ad blocking, downloads and YouTube

Date: 2026-11-06. Status: design for approval.
Working name **Sieve** (the builder's call; the owner may rename it).

## Intent

The owner runs three extensions: IDM Integration Module (downloads),
Enhancer for YouTube, and AdBlock. They want one extension of their own that
does what all three do, paid features included. It is for the owner alone, in
their own Chrome on a Mac. It will never be published.

IDM's extension is only a bridge to the Windows IDM app, which does not run
on macOS. So the download manager is built from scratch inside the extension.
The owner was offered a small helper program on the Mac (aria2, yt-dlp,
ffmpeg) and chose **everything inside Chrome**, with no install.

We read the three published packages to learn what they do (see "Recon"). We
copy no code from them: Enhancer and IDM are closed source, and AdBlock is
GPL. We do not unlock or reuse their paid tiers. Every feature is our own
implementation.

## Goals

1. **Blocking (AdBlock, free and Premium):**
   - ads and trackers blocked from filter lists, plus the owner's own filters
   - "Block an item on this page" (point at an element to hide it)
   - pause on a page, a site or everywhere, and an allowlist
   - YouTube ad removal, with a per-channel allowlist
   - counts of ads and trackers blocked
   - hiding "turn off your ad blocker" messages
   - a DevTools panel listing blocked requests
   - Distraction Control: newsletter pop-ups, floating videos, survey and
     notification prompts
   - Cookie Consent Cutter (hides cookie banners)
   - auto-declining sites' "allow notifications" requests
   - extra tracker blocking (EasyPrivacy level)
   - hiding AI summaries in search results
2. **YouTube (all of Enhancer):**
   - **Speed:** a default speed, changing speed with the mouse wheel, and
     overriding YouTube's speed steps.
   - **Quality:** automatic quality per context (videos, playlists, embeds,
     each with its own full-screen choice), plus forcing H.264 and forcing
     30 fps.
   - **Volume:** a default volume, a volume booster (multiplier), and changing
     volume with the mouse wheel, optionally only with the right button held.
     The wheel direction can be reversed.
   - **Player tools:** loop (whole video or start/end points), stop, reversed
     playlist, cinema mode (backdrop colour and opacity), expanding the player
     to the viewport, auto theater mode, flip horizontally and vertically,
     colour filters (blur, brightness, contrast, grayscale, hue, invert,
     saturation, sepia), screenshot, and Picture-in-Picture.
   - **Autoplay:** stop autoplay in background tabs (optionally in the
     foreground tab too, with a playlist exception), and pause other tabs when
     a video starts.
   - **Page tidying:** hide or convert Shorts, hide related videos, comments
     or live chat, sort comments newest first, set videos per row (home,
     channel, Shorts, posts), expand descriptions, hide info cards and end
     screens.
   - **Themes:** a dark YouTube theme with selectable accent colours, and the
     owner's own CSS.
   - **Experiments manager:** block YouTube test features such as the "modern
     player".
   - **Shortcuts and backup:** keyboard shortcuts for every action, and
     settings backup and import.
3. **Downloads (IDM's job, plus the IDM app's paid features):**
   - Take over Chrome downloads of chosen types or sizes.
   - Split each file into parts fetched in parallel. The owner was told this
     mostly buys resume. It is faster only on servers that limit each
     connection's speed. Chrome allows at most 6 connections per host on
     HTTP/1.1, and only one shared connection on HTTP/2 and HTTP/3.
   - Pause, and resume even after a browser restart.
   - A queue, a speed limit, a scheduler, and categories that save files into
     subfolders by type.
   - "Add URL" by hand.
   - Right-click "Download link / all links / selected links".
   - Detect video and audio as pages load them: plain files, HLS (`.m3u8`) and
     DASH (`.mpd`). Save each as one file, joining separate video and audio
     into one MP4.
   - YouTube video downloads, at every quality offered.

## Non-goals (decided by the owner)

- **Image Swap** (AdBlock Premium: replacing ads with photos).
- **Custom JavaScript runner** (Enhancer).
- **Pop-up player and mini player** (Enhancer).
- **Other browsers.** Chrome only. It may happen to work in Edge, Brave or
  Arc; nobody tests that.
- **A helper program on the Mac.** Everything runs inside Chrome.
- **Chrome Web Store publication.** It is installed privately, unpacked.

## Non-goals (our call, not raised with the owner)

- **Vendor features:** Acceptable Ads, data collection, rating prompts, the
  AdBlock VPN upsell, settings sync through a vendor account, and IDM's site
  registration.
- **DRM-protected video** (Netflix and similar). It cannot be saved and is
  never attempted.
- **Saving outside the Downloads folder.** Chrome only lets extensions write
  inside it, so categories become subfolders of Downloads.
- **IDM-app extras not listed above,** such as clipboard watching, shutting
  down the Mac when downloads finish, and a site grabber.
- **AdBlock's colour themes for its own menus.** apps-hub UI takes colours
  only from `packages/ui` tokens, and light and dark follow the system. Flag
  this to the owner if it matters.
- **Importers for the old extensions' settings.** "My filters" accepts
  AdBlock (ABP) filter syntax, so AdBlock's custom filters and allowlist can be
  pasted in as text. There is no Enhancer backup importer. IDM's settings live
  in the Windows app.
- **Converting video.** Re-encoding is too slow in a browser. Files keep the
  codecs the site sent.

## Anti-goals (the owner chose all four)

The extension fails, even if every feature works, when any of these happen:

1. **It slows browsing.** Pages load visibly slower, or Chrome uses much more
   memory. Content scripts must do almost nothing on ordinary pages.
2. **It breaks sites.** Blocking hides real content, or logins and checkouts
   stop working. Blocking must be easy to switch off per site. My call: one
   switch per site turns off all blocking there, as AdBlock does and as the
   chosen menu shows. Per-feature per-site switches are out: a fixed
   rule-set allow rule covers every list at once.
3. **It loses downloads.** A taken-over file never arrives, or a large
   download restarts from zero. The rule that prevents this is under "Taking
   over Chrome's downloads".
4. **YouTube feels janky.** Buttons flicker in, settings forget themselves,
   or the player misbehaves. Settings apply before the first paint, and the
   buttons survive YouTube's page changes without blinking.

## Screens (chosen by the owner from mockups)

The mockups are in `.superpowers/brainstorm/87424-1793907956/content/`
(gitignored, kept on this machine only). The descriptions below are what
counts.

### Toolbar menu: three tabs

Layout "A": a header with the name and a global on/off switch, then three
tabs: **Blocking**, **Downloads**, **YouTube**.

- **Blocking:** the current site with its on/off switch, and counts of ads
  and trackers blocked on this page. Buttons: "Block an item on this page" and
  "Pause everywhere". Switches: Distraction control, Cookie banners, AI search
  summaries, Site notification requests.
- **Downloads** (builder fills in the detail): media found on this page with
  a Download button each, active downloads with progress, and "Open download
  list".
- **YouTube** (builder fills in the detail): speed, quality, and the player
  tools for the active YouTube tab.
- My guess, not confirmed: the menu opens on the tab that fits the current
  site (YouTube on youtube.com, Downloads when media was found, otherwise
  Blocking).

### Download list page: IDM-style table

Layout "A", a full extension page.

- **Left side:** All downloads, Unfinished, Finished; then categories (Video,
  Music, Programs, Archives, Documents); then queues (for example "Main
  queue" and a scheduled one).
- **Toolbar:** Add URL, Resume, Pause, Delete, Speed limit, Scheduler.
- **Table** (sortable): Name, Size, Progress (bar and %), Speed, Time left.

### On videos: a quiet hover icon

Option "B". A small download icon sits in the video's top corner, shown only
while the mouse is over the video. Clicking it lists the formats found (for
example "1080p MP4 · 412 MB", "Audio M4A · 9 MB"). This applies on YouTube
too.

### On YouTube: a button row under the player

Option "A", Enhancer-style labelled buttons under the video: Loop, Speed − /
value / +, Boost volume, Cinema, Expand, Filters, Flip, Screenshot, Download,
and a settings cog. Every action also has a keyboard shortcut.

### Settings page (my proposal; the owner hasn't seen it)

One page with sections down the side: Blocking, Filter lists and my filters,
Allowlist, Downloads (take-over rules, parts per file, categories, queues,
scheduler, speed limit), YouTube (every Enhancer option), Shortcuts (links to
`chrome://extensions/shortcuts`), and Backup and import (the whole
extension's settings as one JSON file).

## Constraints

- **Platform:** Chrome, Manifest V3, on macOS. The extension is loaded
  unpacked from `dist/`. That allows debug-only APIs such as
  `declarativeNetRequest.onRuleMatchedDebug`, which we use for the blocked
  counts and the DevTools panel.
- **Repo layout:** a new app in apps-hub, following the Strongroom extension's
  pattern. That pattern is on branch `strongroom-extension` and is not on
  `main` yet: `apps/strongroom-extension/` has `build.mjs` (esbuild bundling,
  then copying static files and `packages/ui/web` tokens and fonts),
  `src/manifest.json`, and `test/e2e.mjs` (playwright-core driving real
  Chromium with the built extension).
- **Logic placement:** pure logic goes in a `packages/sieve-core` package,
  tested with `node --test`. That covers filter-list compiling helpers, the
  segment planner, the HLS and DASH parsers, the muxer, take-over rules,
  settings validation and the backup format. Repo rules apply: erasable
  TypeScript only, `.ts` imports, and every test file listed in the package's
  `test` script.
- **UI:** the shared `packages/ui` web tokens with a new brand key `sieve`
  (hue and accent taken from the new icon; the WCAG test must pass). Copy
  rules: sentence case, active voice, no emoji icons.
- **Privacy:** no telemetry or remote calls of our own. The only network
  traffic is the pages the owner visits and the files they download.
- **Licences:** dependencies may be GPL, because the extension is never
  distributed. Audit and record each licence anyway. If the owner ever
  publishes it, GPL dependencies would make the whole extension GPL.

## How it works (my calls unless marked)

### Blocking

- **Network blocking: compile filter lists to `declarativeNetRequest`
  static rulesets at build time,** one ruleset per feature so the switches
  map to `updateEnabledRulesets`:
  - ads: EasyList
  - trackers: EasyPrivacy
  - distraction: Fanboy's Annoyance lists, without cookies
  - cookies: EasyList Cookie
  - anti-adblock: the anti-circumvention list

  Use an existing ABP-to-DNR converter (for example AdGuard's
  tsurlfilter/tswebextension converter or eyeo's abp2dnr); the builder picks
  one. Chrome guarantees 30,000 enabled static rules per extension, with a
  larger shared pool. Choosing the lists to fit is the builder's job.
- **List updates.** Lists refresh when the extension is rebuilt with
  `--refresh` (ruling R27, the owner to confirm: a plain build reuses the
  cached lists). That is a known limit; a scheduled rebuild is a later option.
- **The owner's filters and allowlist** go into dynamic rules: per-site and
  per-page `allowAllRequests` rules at high priority, and "pause everywhere"
  disables all rulesets.
- **Element hiding and scriptlets** (cosmetic `##` and `+js` filters) run in
  content scripts. Generic hiding is pre-built CSS, inserted once.
  Site-specific rules come from a per-host map built at build time. Nothing
  heavy runs on page load (anti-goal 1).
- **YouTube ad removal** runs as main-world scriptlets that strip ad fields
  from YouTube's player data, including its `fetch`/`XHR` responses. It is
  turned off for allowlisted channels. Expect upkeep as YouTube changes.
- **Notification requests** are declined by a main-world script:
  `Notification.requestPermission` resolves `'denied'`.
- **AI summaries** are hidden by a small cosmetic list for the main search
  engines: rules taken from Stevo's AI Blocklist (MIT; see the README) plus
  one of Sieve's own. Off by default.
- **Defaults:** everything else is on by default.
- **Counts and the DevTools panel** use `onRuleMatchedDebug`, grouped by the
  ruleset that matched (ads or trackers).

### YouTube enhancements

- **Where the code runs.** A main-world script uses YouTube's player API for
  speed, quality, loop, volume and the experiment flags. An isolated-world
  script handles settings and the button row. Settings go in
  `chrome.storage.local` and are applied at `document_start`. The button row
  re-attaches on YouTube's page-navigation events without being rebuilt
  (anti-goal 4).
- **Volume booster:** a Web Audio gain node on the video.
- **Forcing H.264 or 30 fps:** override `MediaSource.isTypeSupported`.
- **Screenshot:** draw the frame to a canvas, then save it as a PNG.
- **Shortcuts:** `chrome.commands`, with no default keys; the owner binds them.

### Download engine

- **Where it runs: an offscreen document with a worker,** not the service
  worker. A service worker can be stopped mid-download. Partial data goes in
  the Origin Private File System. Download records (URL, headers, parts done,
  category, queue) are persisted so that everything resumes after a restart.
- **Splitting.** Probe the server for range support and size. If both are
  available, split into parts (default 6, matching Chrome's per-host limit;
  configurable), and re-split the largest remaining part whenever a
  connection frees up, as IDM does. If not, fall back to one stream. The list
  must never promise a speed-up: on HTTP/2 and HTTP/3 the parts share one
  connection.
- **Finishing.** Hand the finished file to `chrome.downloads.download` from an
  object URL, into `Downloads/<category>/`. Then delete the private copy. The
  file briefly takes twice the disk space. Our own saves must never be taken
  over again.
- **Queue, speed limit, scheduler.** Each queue has its own maximum number of
  parallel downloads. The speed limit is a shared token bucket. The scheduler
  uses `chrome.alarms` to start a queue at a set time.

### Taking over Chrome's downloads (anti-goal 3)

When Chrome starts a download that matches the take-over rules (file types
and a minimum size, IDM-style; defaults are the builder's call), follow this
order:

1. Pause Chrome's download.
2. Probe the same URL ourselves, with the page's cookies and referrer.
3. Only if the probe returns the same file (same size and type, success
   status) do we cancel Chrome's download and continue in our engine.
4. Otherwise resume Chrome's download untouched. This covers form posts,
   one-time links, and anything else we can't fetch again.

If our engine later fails for good, the list offers "Retry in Chrome".

### Media detection

- **Finding media.** A non-blocking `webRequest.onHeadersReceived` observer
  matches media content types (IDM watches about 60 video, audio and stream
  types) and URL patterns (`.m3u8`, `.mpd`). Results are kept per tab, and
  `<video>`/`<audio>` sources are read from the page. The hover icon and the
  menu's Downloads tab both read this list.
- **HLS:** parse the master playlist into qualities, fetch segments in
  parallel, decrypt AES-128 with WebCrypto, and remux to MP4.
- **DASH, and YouTube's separate video and audio streams:** join them into one
  file. The builder chooses the muxer (a streaming JS muxer, or ffmpeg.wasm in
  the offscreen document). Files over a few GB must still work.
- **Output format (my call).** If the streams are H.264 or HEVC video with AAC
  audio, write MP4, which plays in QuickTime and Finder. Otherwise (VP9, AV1,
  Opus: YouTube's 1440p and 4K are only offered that way), write WebM or MKV
  and label it "plays in VLC or IINA". The quality list shows MP4 choices
  first.

### YouTube downloads (highest risk)

- **Its own module.** It lives in a separate module with a single entry point,
  so that when YouTube breaks it, nothing else is affected.
- **What makes it hard.** It reads YouTube's stream data from inside the
  logged-in page. YouTube scrambles stream URLs (signature and "n"
  challenges), increasingly requires proof-of-origin tokens, and is moving the
  web player to a streaming protocol (SABR) that exposes no plain URLs. yt-dlp
  solves the scrambling by running YouTube's own player JavaScript, and its
  `ejs` solver scripts are worth evaluating. The owner accepted that this
  needs regular fixing.
- **My call: a feasibility spike comes first,** before the main build, so a
  dead end is found early. The spike must answer three questions. Can we get
  1080p and above, plus audio? Is it at full speed (not throttled)? Does it
  work signed in as the owner? Signed in is a check, not a requirement. Also
  measure split-download speed against a plain Chrome download on one HTTP/1.1
  and one HTTP/2 server. Record the answers in the handoff file.
- **If the spike only partly passes (the owner's rule):** ship whatever
  quality and speed works, and say what is missing in the quality list. If
  nothing works at all, phase 5 is dropped and the owner is told. YouTube
  then falls back to the generic media detection (phase 4), if it catches
  anything.

## Build order (my call)

0. **Spike:** YouTube download feasibility (throwaway).
1. **The shell, then blocking:** the shell is the manifest, toolbar menu, settings page,
   brand, icon, build and e2e harness. Then blocking: filter-list compile,
   switches, allowlist, element picker, counts, DevTools panel, YouTube ad
   removal and the premium features.
2. **YouTube enhancements:** the button row, every Enhancer option, shortcuts,
   and backup and import.
3. **Download engine and take-over:** the engine, the list page, the queue,
   speed limit, scheduler, categories and context menus.
4. **Media detection:** plain files, HLS and DASH with muxing, and the hover
   icon.
5. **YouTube downloads,** built on what the spike learned.

Each phase ends with:
- `pnpm test` and `pnpm typecheck` passing
- an e2e pass in real Chromium against local test pages, using the existing
  playwright-core harness
- a short check of the anti-goals: a page-load timing comparison with the
  extension on and off, and a take-over that falls back cleanly

YouTube testing (my call):
- Parsers and the player-data stripping are tested with `node --test`
  against saved YouTube responses kept as fixtures.
- A live smoke test runs against youtube.com in a fresh, signed-out
  Chromium profile.
- Signed-in checks (ads on the owner's account, members-only or
  age-restricted videos, the owner's real settings) are a short written
  checklist the owner runs in their own Chrome. Automated tests never use
  the owner's profile.

## Left to the builder

- the ABP-to-DNR converter and how cosmetic rules are packed
- the default take-over rules and minimum size
- the muxer
- the icon and brand hue
- the settings page's internal layout
- the Downloads and YouTube tabs' detail
- which Fanboy lists fit within the rule budget
- the experiments manager's list of flags

## Recon (verified 2026-11-06, not to be redone)

Packages were downloaded from Chrome's public update endpoint and unpacked.
They are kept on this machine only, in the session scratchpad
(`/private/tmp/claude-501/-Users-outsentia-Documents-apps-hub/e41ce90b-8288-48f4-b4db-4b9d5b73600e/scratchpad/re/`):

- **IDM Integration Module 6.43.1** (MV3):
  - It catches downloads through `downloads.onDeterminingFilename`.
  - It spots media through `webRequest.onHeadersReceived`, against about 60
    media and archive MIME types.
  - It adds right-click menus: download link, all links, selected links.
  - It passes cookies through `cookies.getAll` and hands everything to the
    native app with `connectNative`.
  - The floating video panel is `document.js`. Every real download feature
    lives in the Windows app.
- **Enhancer for YouTube 3.0.19** (MV3):
  - Free, with no paid tier.
  - Its full settings list is `js/config.js`: speed, quality, volume and
    booster, cinema mode, filters, autoplay, layout and grid, themes with 55
    accent colours, custom CSS and script, the experiments manager, and
    backup.
  - It no longer removes ads.
  - It uses main-world and isolated-world content scripts on youtube.com,
    embeds and live chat.
- **AdBlock** (MV3, eyeo engine):
  - The Premium ("MAB") features are Distraction Control, Cookie Consent
    Cutter, notification-request blocking, EasyPrivacy, Image Swap and colour
    themes.
  - The free features are listed under Goals.
  - AI-summary hiding and "allow ads on this YouTube channel" are in the
    current build.
