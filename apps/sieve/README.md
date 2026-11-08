# Sieve for Chrome

The owner's private ad blocker (Manifest V3, Chrome 128 or later: some rules in the ads, trackers and anti-adblock lists match on response headers, which Chrome supports from 128). It is never published: you build it on this Mac and load it unpacked. The filter lists are downloaded and compiled at build time; the extension itself makes no requests of its own.

## Install and first run

**Remove AdBlock first, and any other ad blocker.** Sieve turns on about 115,000 to 116,000 rules by default, depending on when the lists were downloaded (the build prints the exact count: 115,468 on the 6 November 2026 download, 116,056 on 8 November 2026). Chrome guarantees only 30,000 enabled static rules to each extension; the rest come from a pool shared with every other extension. With another blocker installed, Chrome may leave one of Sieve's lists off. The automated tests run in a fresh profile with no other extension, so they cannot see this.

```bash
pnpm install
pnpm --filter sieve build      # writes apps/sieve/dist
```

1. Open `chrome://extensions` and turn on Developer mode.
2. Click Load unpacked and pick `apps/sieve/dist`.
3. Check that the Sieve card shows no warning or error.
4. Check that Chrome kept every list on. Open the Sieve menu and look for an error line (Chrome's rule limit shows as "Turn a list off in Settings to make room."), open Settings and read the rule count next to each list (all but AI search summaries, which has none), and in the card's service worker console (Inspect views) run `await chrome.declarativeNetRequest.getEnabledRulesets()`: it should list `ads`, `trackers`, `distraction`, `cookies` and `antiadblock`. The counts in Settings come from the build, so they show what Sieve shipped, not what Chrome enabled; the console answer is the one that shows Chrome's side.

After a rebuild, press the reload arrow on the Sieve card.

### Owner checklist: first run

These need your own Chrome and your own accounts, so no automated test covers them. Tick each one after you have seen it.

- [ ] **Signed-in YouTube, no ads.** On your own account, watch five videos, some of them long: no ad plays before or during any of them.
- [ ] **YouTube does not stall.** On 2026-11-08 one signed-out headless run reached only 6 s of 30 on `kJQP7kiw5Fk` with Sieve on (15 s with no extension, which showed an ad, and 30 s with Sieve off right after). A follow-up measurement (`docs/handoffs/sieve-yt-measurement.md`: 24 fresh-profile runs and 25 more (49 in all, 48 usable: one timed out), signed out, headless, one video, one network) found no cost from Sieve: the median `currentTime` at 30 s was 26.5 s with no extension and 26.0 s with Sieve (with one network-outage round and one self-pausing run set aside; the unfiltered medians are 26.2 s and 25.6 s), within 1 s of each other and inside the noise, and neither the stripping alone nor the network rules alone showed a cost. The 6 s has two possible explanations the data cannot separate: a network drop, or the player pausing itself, which the old gate would have reported as exactly 6 s. YouTube served no ad in any of the 15 no-extension runs, so the measurement says nothing about ad removal itself. In your own browser, watch for a video that freezes or spins in its first 30 seconds with Sieve on and plays once you turn Sieve off for the site in the menu and reload. Note the video and what you saw.
- [ ] **An allowed channel shows ads from its second video on.** On a watch page, turn on "Allow ads on <channel>" in the menu. The video you are on was already loaded without ads; open a second video from that channel and its ads play, while other channels still show none. Turn the switch off again on a video from that channel to undo it (the settings page does not list allowed channels). The ads' view reporting stays blocked: see Known limits.
- [ ] **Members-only and age-restricted pages are unaffected.** A members-only video you can watch and an age-restricted video play the same with Sieve on as with it off. Sieve only deletes the ad fields of YouTube's player data; the stream and the video's own details are left as they are.
- [ ] **The DevTools panel, in a real DevTools window.** Open DevTools (Cmd+Option+I) on a page with ads, pick the Sieve tab and reload the page: the table lists the blocked requests with their list and filter. Then switch DevTools' theme (Settings, Preferences, Appearance, Theme) between light and dark: the panel follows. The automated test stubs `chrome.devtools`, so only this opens the real thing.
- [ ] **AI search summaries.** The four-engine checklist is in its own section below.

## Build

`build.mjs` downloads each list into `filters/cache/` the first time, and reuses that copy afterwards, so a plain rebuild does not update the lists. Only `pnpm --filter sieve build -- --refresh` downloads fresh ones. The build writes the date of the oldest cached list into `dist/meta.json` (`listsAt`), and the settings page shows it with that command. This amends the design's "lists refresh when the extension is rebuilt" to "rebuilt with `--refresh`" (the owner is to confirm it). If a download fails and there is no cached copy, the build stops and names the list. The build writes `dist.next` and swaps it over `dist` at the end, so a failed build leaves the `dist` you have loaded as it was.

The build prints one row per feature: rules, regex rules, generic selectors, hosts with site-specific filters, hosts kept out of the generic CSS ("generic except"), how many of those came from expanding `google.*`-style exceptions into real domains ("from wildcards"), errors, and filters dropped by reason (features Chrome or Sieve can't run). It warns when the lists that are on by default have more than 30,000 rules, the number Chrome guarantees; the rest come from a pool shared with other extensions.

| Feature | List | Default |
| --- | --- | --- |
| `ads` | EasyList | on |
| `trackers` | EasyPrivacy | on |
| `distraction` | Fanboy's Annoyance List, without its cookie sections | on |
| `cookies` | EasyList Cookie List (Fanboy's Cookiemonster) | on |
| `antiadblock` | Adblock Warning Removal List and ABP filters (anti-circumvention) | on |
| `ai` | `filters/ai-summaries.txt`: seven rules from Stevo's AI Blocklist and one of Sieve's own | off |

## Develop

```bash
pnpm --filter sieve typecheck
pnpm --filter sieve test         # the counting code, the pick handler, the My filters save, the shared menu and settings switches, the per-page injection and the DevTools panel's ports and rows against an in-memory `chrome`
pnpm --filter sieve test:e2e     # headless Chromium in a fresh temporary profile; build first
pnpm --filter sieve test:e2e -- --live   # only the YouTube smoke test, against real youtube.com
```

The filter compiler and the settings logic live in `packages/sieve-core` and are unit-tested there. `test:e2e` needs playwright-core and Chrome for Testing: set `PLAYWRIGHT_CORE` (path to playwright-core's `index.mjs`) and `CHROMIUM_PATH` if yours are not in this Mac's default places. It never uses your own Chrome profile.

## Performance run

`node apps/sieve/test/perf.mjs` (build first) compares Sieve with no extension at all, in two fresh profiles that load each page in turn (a real-site load clears the cache and cookies first). It passes when:

- on a local page with no ads, loaded 20 times per profile, the median `domContentLoadedEventEnd` with Sieve is at most 20 ms more than without;
- on real sites (theguardian.com, bbc.com/news, npr.org, nbcnews.com, wired.com), 5 loads per profile, the median load time with Sieve is at most 1.10 times the one without on at least 4 of the 5 sites. The plan first named dawn.com, edition.cnn.com and weather.com; on 2026-11-08 they did not load reliably without an ad blocker in headless Chrome (dawn.com answered HTTP 403 on both sides, CNN and weather.com loaded in 10 to 12 s and about 3 s with Sieve but timed out at 60 s or took up to 9 s without it), so they were replaced by sites that loaded 3 of 3 times without Sieve.

It also prints each site's median DCL, load time and `JSHeapUsedSize`. It judges load times only: the renderer memory and style cost of the generic hiding CSS (about 41,000 selectors registered into every frame) is not measured. A full run takes about 10 minutes (one full run on 2026-11-08 took 9 min 48 s); allow up to 30 minutes, the hard timeout. It needs the machine to itself: other work distorts the times. `node apps/sieve/test/perf.mjs --self-check` runs the verdict logic on made-up numbers and starts no browser.

Environment overrides: `LOCAL_RUNS` (20) and `SITE_RUNS` (5) for the number of loads, `SITES` (comma-separated addresses, replaces the five), `LOAD_TIMEOUT_MS` (60,000), `TOTAL_TIMEOUT_MS` (30 minutes), `SETTLE_MS` (1,000), `HEADLESS=0` to show the windows, and `PLAYWRIGHT_CORE` and `CHROMIUM_PATH` as for `test:e2e`.

**Rerun policy.** The sites are the real internet, so a load now and then fails for reasons that have nothing to do with Sieve.

- A FAIL that says the extension side lost loads is run once more. The same site failing again with the extension is a real break: reproduce it with `HEADLESS=0 SITES=<address>` and open the page by hand.
- A different site failing on the second run is another flake: run again, or reproduce that site by hand.
- A site that blocks only the profile with the extension (a bot page) fails every time. Run with `HEADLESS=0`, or replace the site with `SITES=`.
- The odds are arithmetic, not measured: if each load flakes with a 1% chance, about 20% of runs fail on noise alone, and about 37% at 2%. That is why one rerun is not a cover-up.
- One slow site can still pass: the bar is 4 of 5, so a real slowdown on a single site gives PASS. Read the table, not only the verdict line.

## Toolbar menu

The toolbar button opens a menu with a switch for Sieve, a switch for the current site, the ads and trackers blocked on the page, "Pause on this page" and "Pause everywhere", the Distraction control, Cookie banners, AI search summaries and Site notification requests switches, and a Settings button that opens the settings page. On a www.youtube.com watch page it also has "Allow ads on <channel>" (see YouTube ads). It writes the same `settings` the service worker applies, so every switch goes through the blocking plan. Site notification requests turns down the requests of sites that have not asked yet; a site you already allowed or blocked in Chrome gets Chrome's own answer.

The counts and the badge come from `declarativeNetRequest.onRuleMatchedDebug` (permission `declarativeNetRequestFeedback`), an event Chrome only gives unpacked extensions, which is how Sieve is installed. Each tab's count lives in `chrome.storage.session`, so it survives the service worker stopping. It starts again at zero on each page load and is gone when Chrome quits. A match of a rule that only allows a request, only changes a response header or only strips query parameters (`$removeparam`) is not counted: the build writes those rule ids per list (`allowIds`, `modifyIds`) into `dist/meta.json`, and My filters rules are judged the same way (`blocksRequest` in `sieve-core`). `test:e2e` opens the menu as `popup.html?tab=<id>`, since a script can't click the toolbar button.

## Block an item on this page

"Block an item on this page" in the menu injects `picker.js` into the tab (`scripting.executeScript`, covered by the existing host access, so it adds no permission) and closes the menu. The picker outlines the item under the pointer; a click picks it. The panel shows the selector and "Hides N items on this page", with Less and More to make the selector shorter or longer, Move panel, Block it, and Cancel. Esc also closes it. The selector starts as short as it can be while still finding only that item, and ends at an id, which is already unique. An id or class with three or more digits in it (`ember1234`, `css-1q2w3e`: the kind a page generates and changes on reload) is skipped: the selector uses the item's other classes or its position instead. If no selector finds only that item, it starts at the shortest one that finds the fewest.

Block it sends `{ type: 'pick', host, selector }` to the service worker, which adds `host##selector` to My filters (`settings.blocking.myFilters`), adds the selector to `myCosmetic.hide[host]` (plain data in `chrome.storage.local`), and hides the item in that page at once. The worker does not compile the line, which keeps the filter compiler out of the worker bundle. On later page loads it injects `myCosmetic` with the lists' site-specific hiding, so a pick lasts across reloads and worker restarts. The host is the tab's full hostname, with `www.` and without a trailing dot, so a pick on `www.google.com` is saved as `www.google.com##...` and does not hide anything on `mail.google.com`. Like any host in a filter, it also covers that host's own subdomains. (The menu's "Block on this site" works on the site as a whole and still drops `www.`.)

The picker is code running in a page the owner does not control, so it treats the page as untrusted:

- Its panel and outline sit in an open shadow root, styled from the shared UI tokens through a constructed stylesheet, which a page's Content Security Policy does not block. The fonts cannot load from a page, so the system font stands in.
- Only real input counts: a page that calls `click()` or sends events at the panel changes nothing.
- The worker takes the host from the sender's address, never from the message, and accepts only a selector of the shape the picker builds (`parsePick` in `sieve-core`): compounds of `#id`, `tag.class...` or `tag:nth-of-type(n)`, joined only by ` > `, with CSS escapes allowed, at most 1,000 characters and no control character. Anything else is refused: a bare tag (`div`, `html`, `body`), a descendant or sibling combinator, a comma, an attribute, a pseudo-class such as `:has(` or `:not(`, an unbalanced bracket or quote, `{`, `}`, `;`, `/*`, an at-rule, `url(` and a line break. So one pick cannot hide more than the picker showed, cannot break the stylesheet that holds the picks of that host, and cannot add a line to My filters. A last compound on `html` or `body` is refused too, however it is spelled: CSS reads `\68 tml` and `\62 ody` as html and body, so escapes are decoded for that test.
- If the page removes the picker, the next pointer event or key press ends it for good, so nothing is left to swallow the page's clicks.
- Saves go through one queue, so two picks sent at once are both kept.

The button is off where blocking is off for the page (allowlisted site, paused page, paused everywhere) because a saved pick would not show after a reload there, and on an address Sieve cannot write a filter for (an IPv6 host).

## Settings page

`options.html` (the manifest's `options_page`, so it opens in a tab) has four sections. It needs one more permission, `unlimitedStorage`: without it `chrome.storage.local` holds 10 MB, and about 29,000 My filters lines with typical options take some 16 MB once compiled.

- **Blocking:** the menu's four switches, plus Ad blocker warnings and Trackers.
- **Filter lists:** each list with its rule count from `dist/meta.json` and a switch (the same setting as the Blocking switch of that name), and, under them, "Lists from <date>.", the date of the oldest cached list (not of the build), with the command that updates them: `pnpm --filter sieve build -- --refresh`, then reload Sieve. A plain rebuild reuses the cached lists.
- **My filters:** the owner's own filters, one per line, saved with Save. The page compiles them with the same compiler as the build (a `trusted-*` scriptlet is refused on its line with "<name> isn't available in this build. Remove the line.": the build ships no trusted scriptlet functions). That compiler is bundled into `options.js` only (about 2.3 MB); the worker never loads it. Before anything is stored, the page hands Chrome the rules the unpaused blocking plan would run, allowlist rules included, in one atomic `updateDynamicRules` call. If Chrome refuses them (more than 30,000 dynamic rules, more than 1,000 regex rules counting the allowlist's page entries, a rule it can't run), the earlier rules stay on, nothing is stored, and the page shows Chrome's message. If storage then refuses the write, the page puts the earlier rules back in Chrome. If that restore fails too (rare), the failure is logged in the page's console and the page still says nothing was saved: Chrome keeps running the unsaved rules until the next settings change or a Chrome restart, when Sieve sets them from what is stored, or until the next save, which replaces them with the rules it compiles. On success it stores the text in `settings.blocking.myFilters`, the rules in `myRules` (a plain rule array, which the worker applies), their filter lines in `myRuleSources` (rule id to line, for the DevTools panel) and the hiding and scriptlet data in `myCosmetic`. Bad lines are listed as "Line N: what is wrong and how to fix it", the first 50, then "and N more". A regular expression Chrome refuses (for example `/a(?!b)/`: it has no lookahead) is a bad line too, listed in plain words while the other lines are saved. A line Sieve can't run (an extended selector, `$redirect`, a scriptlet the lists don't use and so the build doesn't ship) counts as a bad line, not a saved filter.
- **Allowlist:** each entry with Remove, and a box that takes a host or a page address. A full URL (with `http://` or `https://`), or an address with a path (`example.com/some/page`, saved as `https://`), becomes a page entry, which covers exactly that page: its path and query, not the pages under it. Its allow rule matches the scheme and port too. Only the hiding CSS and the notification blocker ignore the port, because Chrome can't name a port in the patterns that keep a registered script off a page, so the same path and query on another port of that host also get no generic hiding and no notification blocker. A bare host becomes a site entry, with the port and a leading `www.` dropped (as the menu does) and a Unicode name turned into its `xn--` form. IPv6 addresses and addresses with no host (`mailto:`) can't be allowlisted.

The menu, the worker (a pick) and this page all write `settings`, and My filters' `myRules`, `myRuleSources` and `myCosmetic`. Each of them reads, changes and writes these under one Web Lock (`sieve-settings`, in `lock.ts`), so no writer can undo another's change. A My filters save holds the lock only to check the stored text, hand Chrome the rules and write, not while compiling. If a pick lands during the compile, the save stops and says so, and the next Save keeps both. The page follows changes made elsewhere: switches and the allowlist update in place, and the My filters box takes a pick's new line unless the owner has typed in it. Then the page says that the filters changed, and Save adds the lines saved elsewhere since the page loaded to the end of the owner's text. Text typed while a save runs stays in the box as an unsaved edit.

## DevTools panel

DevTools has a Sieve tab (`devtools_page` in the manifest, which adds no permission). `devtools.html` runs `chrome.devtools.panels.create('Sieve', 'icon-32.png', 'panel.html')`. Open DevTools, pick the Sieve tab and reload the page: the table lists each request Sieve blocked there, with Time, Type, Address, List (the list's name as the menu shows it, or "My filters") and Filter (the filter line that blocked it). With nothing listed it says "Reload the page to see what Sieve blocks."

The panel connects to the worker with `runtime.connect({ name: 'panel:<tab id>' })`, and the tab id comes from `chrome.devtools.inspectedWindow.tabId`, or from `?tab=<id>` outside DevTools. The worker keeps the open ports in memory, by tab (`panels.ts`). `counts.ts` passes each match it counts on to the tab's ports, judged by the same `classifyMatch` as the counts, so a match of an allow rule, a header-only rule or a `$removeparam` rule gets no row. It does nothing when no panel is open for the tab: one `Map` lookup, and a port that can't be written to is dropped without touching the count. A main-frame navigation sends a reset, the same signal that zeroes the counts, and the panel clears its table. Chrome drops the ports when it stops the worker: the panel connects again at once (which wakes the worker) and keeps its rows, and says nothing about it. It says "Sieve is reconnecting" only if it is not back after a second, and after 5 ports in a row that drop right away (the worker can't start) it says "Sieve stopped. Close and reopen DevTools, or reload the extension." and stops trying. New rows are added to the table one at a time, so text selected in it stays selected while rows stream in. The Filter text is read when a row needs it: static lists from `sources/<list>.json` in the build, My filters from `myRuleSources` in `chrome.storage.local`, once per list (My filters again after it changes). Addresses and filter text are set as text, never as HTML. The panel follows DevTools' light or dark theme.

`test:e2e` opens `panel.html?tab=<id>`, and stubs `chrome.devtools` to run the paths only DevTools takes (the tab id, the theme and the `panels.create` call). It doesn't open a real DevTools window.

## AI search summaries

`filters/ai-summaries.txt` is a short list kept in the repo, not downloaded: one to three `##` hide rules per engine for the AI answer on Google, Bing, DuckDuckGo and Brave Search, each scoped to that engine's own host, with no generic rule. The `ai` feature is off by default; the menu and the settings page switch it. Seven of its eight rules are taken from [Stevo's AI Blocklist](https://github.com/Stevoisiak/Stevos-AI-Blocklist) (MIT; see Licences), with the host written as each engine's own (that list says `www.bing.com` where this one says `bing.com`). Only `bing.com###b_genserp_container` is Sieve's own: Bing's page script, in the results page saved on 2026-11-08, looks up that id, so the rule hides the element it names. The selectors prefer stable attributes and ids over generated class names.

The rules were checked on 2026-11-08 from a signed-out Chrome for Testing profile with the query "how do magnets work":

| Engine | What the page showed | Rules |
| --- | --- | --- |
| Google | A robot check on every try, so no results | Not verified on a live page |
| Bing | Results with no AI block, for four different questions | Not verified on a live page |
| DuckDuckGo | A Search Assist answer above the results (a robot check on a headless run) | Selector checked on a live page, except the sidebar rule, which did not appear |
| Brave Search | An AI answer above the results (a robot check when the address is opened directly; typing the question worked) | Selector checked on a live page |

"Checked" means this: with the live results page open, the selector's rule was added to it as CSS (`display: none`), and the AI block went away with no gap left behind. The extension's own path, where the service worker inserts the hiding CSS once the switch is on, is tested only on local stand-in pages (`test:e2e` maps `duckduckgo.com` and `search.brave.com` to its local server: the AI block is hidden with the switch on and shown with it off) and has never run against a real engine. The owner checklist below is the real end-to-end test. The Google rules may leave a blank space where the block was. A search engine can rename any of these, and a rule that stops matching fails silently, so repeat the checklist after a Chrome or site change.

### Owner checklist: AI search summaries

- [ ] With "AI search summaries" on (menu or settings page), search "how do magnets work" on Google, Bing, DuckDuckGo and Brave Search, and check that no AI summary shows on any of them.
- [ ] Search a second question on all four, for example "why is the sky blue": Bing showed no AI block for four questions on the day the rules were written, so one question is not enough.
- [ ] With the switch still on, check that ordinary results, links and the search box still show on all four. The Google and Bing rules were never seen on a real page, so your eyes are the only check that they hide nothing else.
- [ ] Turn it off, reload each page, and check that the summary shows again.

An engine shows a summary only for some questions, signed in or out, and in some regions. If a summary does not show with the switch off, the engine did not make one for you: try another question before you blame a rule. On Google and Bing, say which engine showed nothing, so the rule can be fixed against a real page.

## YouTube ads

Two content scripts from the manifest run on `www.youtube.com`, `m.youtube.com`, `music.youtube.com` and `www.youtube-nocookie.com` at `document_start`, in every frame, so a YouTube player embedded in another site is covered too:

- `yt-main.js` runs in the page's own world (`"world": "MAIN"`), before YouTube's scripts. It wraps `JSON.parse` and `Response.prototype.json`, and puts a getter and setter on `window.ytInitialPlayerResponse`. An object with an ad field (`adPlacements`, `adSlots`, `playerAds`, `adBreakHeartbeatParams`), `playerResponse` or `videoDetails` at its top level goes through `stripAds` (`sieve-core`). That deletes the ad fields from it and from its `playerResponse`, unless the video's channel is allowed, and leaves `videoDetails` and `streamingData` alone. A wrapper with no `videoDetails` of its own is judged by its `playerResponse`'s channel. An array of at most five elements (YouTube's `[{page}, {playerResponse}]` shape) is read element by element with the same rules; a longer one is not walked. Everything else comes back exactly as the browser gave it, bad JSON throws the browser's own `SyntaxError`, and a failure inside the wrapper still returns the value, never an error. The two wrappers pass the usual checks for a native function: the same `name` and `length`, no `prototype`, a `TypeError` when called with `new`, and `toString()` and `String()` give the browser's own text (`function parse() { [native code] }`, from a `toString` bound to the native, so `JSON.parse.toString.toString()` is native too). A page that looks harder can still tell them apart: each wrapper has its own `toString` property, whose name is `bound toString`; `Function.prototype.toString.call(JSON.parse)` gives the wrapper's source; and `JSON.parse` is not another frame's `JSON.parse`. The native look above holds only where Sieve's wrappers are the outer ones; stripping, the errors, `this` handling and revivers behave the same either way. On www.youtube.com, m.youtube.com and music.youtube.com with the anti-adblock list on, that list's `json-prune` scriptlet wraps both again. In practice the scriptlet lands after `yt-main.js` (the worker injects it after the page starts; seen in 10 of 10 probe loads), so it is the outer wrapper, and a page there reads the scriptlet's wrappers (`jsonParseWrapper` and `responseJsonWrapper`, a `prototype`, and the wrapper's source from `Response.prototype.json.toString()`; only `JSON.parse` differs in length, 0 instead of 2, since `Response.prototype.json` has length 0 either way). Each wrapper calls the one inside it, so the order does not matter for stripping and a response goes through both.
- `yt-relay.js` runs in the isolated world. It reads `settings` and sends the main world a `sieve-yt-allow` event with `{ on, ids }`, again on every settings change. `on` is false where Sieve is off, paused everywhere, the Ads list is off, or the page is allowlisted. For an embed, a site entry for any page around it also turns it off, as `inject.ts` leaves an allowlisted site's frames alone. Those pages come from `location.ancestorOrigins`, which gives only their origins, so a page entry (Pause on this page) never matches them. `ids` are the allowed channel ids, nothing else from the settings.
- The main world sends `sieve-yt-channel` with `{ id, name, videoId }` from the response's `videoDetails.channelId`, `author` and `videoId`. The page can send that event too, so the relay keeps only a channel id (`UC` and 22 letters, digits, `-` or `_`) with a name, cut to 100 characters, and an 11-character video id (`ytChannel`), and ignores anything else. It keeps the channel of each of the last 50 videos it heard about, and names the one whose video id is the page address's `?v=` (`watchChannel`), so a hover preview or a video loaded early for autoplay is never the one named.

Everything the main-world script holds can be read and called by the page, so it holds only the allowed channel ids, and the two events are its only link to Sieve.

On a www.youtube.com watch page the menu asks the tab's top frame for the channel (`{ type: 'yt-channel' }`) and shows "Allow ads on <channel>". It asks nowhere else, so other pages open the menu without that wait. On m.youtube.com and music.youtube.com there is no switch: the anti-adblock list strips the same ads there whatever the channel, so the switch would do nothing. The switch saves `{ id, name }` in `settings.blocking.youtubeAllowedChannels` under the settings lock. It is hidden where Sieve doesn't remove YouTube ads anyway.

What "Allow ads on <channel>" does: Sieve stops removing the ad fields from that channel's player data, so the next video from the channel plays its ads. What it does not do: it does not lift the network rules. The Ads list still blocks `||youtube.com/pagead/`, `||g.doubleclick.net^` and `||static.doubleclick.net^`, and the Trackers list `||youtube.com/api/stats/ads?`, on those videos too. Those addresses likely carry the ad's view and impression reporting, so the creator is probably not credited for the ads you watch (unconfirmed: how YouTube credits creators is not public).

The settings reach the main world asynchronously. Until they arrive it strips every player response it sees, even when Sieve is off, paused, the site is allowlisted or the Ads list is off, and its wrappers stay installed in every case. `ytInitialPlayerResponse`, which the page's inline script sets before they arrive, is checked when it is first read instead, by which time they normally have.

The lists' own YouTube rules still run through `inject.ts`. The anti-adblock list has `json-prune` scriptlets that strip the same player fields on m.youtube.com and music.youtube.com, and Shorts ads (`entries.[-]…isAd`) on www.youtube.com, and it hides the ad overlay on youtube.com. The Ads list adds only hiding rules on youtube.com and m.youtube.com. A scriptlet and `yt-main.js` each wrap `JSON.parse`, and each wrapper calls the one inside it (in practice the scriptlet is the outer one, as above), so a response can be stripped twice. That is harmless: the second pass finds nothing to delete. So, by switch:

- **Ads list off:** Sieve's own stripping stops on all four hosts, along with EasyList's network and hiding rules. On www.youtube.com that brings player ads back.
- **Anti-adblock list off:** its `json-prune` scriptlets and overlay hiding stop. On m.youtube.com and music.youtube.com ads come back only with both lists off.
- **Allow ads on <channel>:** Sieve's own stripping stops for that channel on www.youtube.com. The same switch should apply in embeds too (not tested: the end-to-end test covers a site allowlisted around an embed, not an allowed channel).

`test:e2e` checks this on a stand-in watch page (`www.youtube.com` mapped to the local server, serving the spike's saved player response, `spike/fixtures/player-response.json`): the four ways in (the global, `JSON.parse`, `Response.json`, and a `[{page}, {playerResponse}]` array) stay free of ad fields, with the anti-adblock list off the wrappers match the browser's own `name`, `length`, `toString`, `prototype` and `new` behaviour, with it on (the test waits for its scriptlet to wrap them too) the ad fields still go and bad JSON, a wrong `this` and a reviver behave as the browser's own, the channel switch saves and survives a worker stop, an allowed channel keeps its ads, Sieve off, paused, allowlisted or the Ads list off leave the response untouched, an embed on an allowlisted site keeps its ads while a page entry for that site's root does not reach it, and malformed page events and a later preview of another video do not change the channel the menu names.

`test:e2e -- --live` runs only a smoke test against real youtube.com, signed out, in fresh profiles. It first plays three public videos for 30 seconds each with no extension at all, as the control, then the same videos with Sieve, where `#movie_player.ad-showing` must never appear and the video must keep up with the control: where the video is when the 30 seconds end must be at least 60% of the furthest point the control reached. It prints both numbers and the ratio, so a video that stalls early fails even if it got past a few seconds, and says `INCONCLUSIVE` when the control itself did not get past 5 s. Where the control served no ad, it prints `INCONCLUSIVE  <id>: no ad was served, so removal cannot be shown` instead of a pass. If no video showed an ad, or every video was skipped, it exits with status 2 (0 means every check passed, 1 that one failed): it prints `NO EVIDENCE about ad removal (no ad was served); the playback checks above still stand.` when playback checks ran and passed, and `NO EVIDENCE` with what to try next when none ran. Last, it turns Sieve off, waits for the worker to apply that, and plays one video for information only. YouTube may answer a headless browser with "Sign in to confirm you're not a bot"; that video is then reported as skipped, not failed.

## Known limits

- The DevTools panel keeps the newest 500 requests of a page ("Showing the latest 500 requests." says when it dropped older ones) and cuts an address at 2,048 characters. A panel on an idle tab reconnects about every 30 seconds, because Chrome stops the idle worker (an open port doesn't keep it alive); that is silent. A request blocked while it reconnects, a fraction of a second, is not listed, and a page that reloaded in that moment can leave its old rows until the next load. Like the counts, it only works where Chrome gives the debug event, in an unpacked install.

- A My filters `site#@#selector` exception lifts another list's generic hiding only on that site: the site leaves the registered generic stylesheets and gets them per page, without the excepted selectors. A `#@#selector` with no site, or one on a `google.*`-style site, does not lift a list's generic hiding; it still works against site-specific rules and My filters' own. My filters' `$generichide` and `$elemhide` exceptions only turn off My filters' own hiding.

- The picker works in the top frame only. The pointer events over an iframe go to the frame, not to the page, so the picker can neither outline an iframe (many ads are one) nor pick anything inside it. An element inside a page's own shadow DOM is picked as its host.
- A pick hides the item on every page of that host that matches the selector, not only on the current page.
- The panel starts in the bottom-right corner and covers what is under it, such as a chat bubble or a back-to-top button fixed there, which scrolling cannot move out from under it. Move panel puts it in the top-left corner, and a second click puts it back. It moves only on that click (a real one: a page's `click()` does nothing), never when the pointer reaches it. An item fixed in the top-left corner is picked with the panel at the bottom-right.
- A page script that registered a capture listener on `window` before the picker started sees the owner's clicks first. It can tell that an item is being picked, or stop the picker from getting a click, so that item cannot be picked on that page. It still cannot press Block it for the owner. The picker cannot do better, because listeners registered earlier always run first.
- On an allowlisted site, the generic hiding CSS and the notification blocker still run inside iframes from other sites, because Chrome matches a registered script's excluded sites against the iframe's own address, not the tab's. Everything those iframes load still gets through, since the allow rule covers every frame in the page. Site-specific hiding and scriptlets check both the tab's page and the iframe's own address, so they stay out of those iframes, and out of an allowlisted site's iframes on other sites.
- Frames whose address is `about:blank`, `about:srcdoc` or `data:` (a `srcdoc` iframe, a script-written iframe) get no generic hiding CSS, no site-specific hiding and no notification blocker: the registered scripts do not set `matchOriginAsFallback`, and the per-page injection only runs for http and https frames. Usually the parent page's rules hide the frame's container. `matchOriginAsFallback` (Chrome 119 and later) is a possible fix.
- Site-specific hiding and scriptlets are added by the service worker as each page or iframe starts loading. Chrome stops the worker after about 30 seconds without events, so the first page after any pause in browsing, not only the first after Chrome starts, starts a new worker. That worker reads the filter maps again (about 4 MB, a few tens of milliseconds), so a scriptlet can arrive after that page's first scripts have run. Pages loaded while the worker is running usually get it in time, but an inline script at the very top of a page can still run first.
- "Allow ads on <channel>" brings ads back on www.youtube.com, and should in embeds (not tested); nowhere else. On m.youtube.com and music.youtube.com the anti-adblock list's `json-prune` scriptlets strip the same fields whatever the channel, so the menu has no switch there. On youtube.com the anti-adblock list hides `.video-ads .ytp-ad-player-overlay`, so an allowed channel's ad may play without YouTube's ad overlay.
- Allowing a channel brings its ads back but leaves their reporting blocked. The ad plays, but the network rules still block YouTube's ad pings on that video: the Ads list's `||youtube.com/pagead/`, `||g.doubleclick.net^` and `||static.doubleclick.net^`, and the Trackers list's `||youtube.com/api/stats/ads?`. Those likely carry the ad's view and impression reporting, so the creator is probably not credited (unconfirmed: how YouTube credits creators is not public).
- Until the settings reach a YouTube page, Sieve strips the player data it sees there, even when Sieve is off, paused, the site is allowlisted or the Ads list is off, and on an allowed channel. The wrappers stay installed in every case.
- Pausing a page (Pause on this page) does not reach a YouTube embed on it; allowlisting the site does. An embed only learns the origins of the pages around it.
- A page allowlist entry on YouTube is checked against the address the tab loaded (and again on a settings change), not after YouTube's in-app navigation, as with `inject.ts`.
- Player data that YouTube reads with `XMLHttpRequest` as `responseType: 'json'` is not stripped; today it comes through `fetch` and `JSON.parse`.

## Licences

Sieve's dependencies, read from each package's `package.json`:

| Package | Version | Licence | Used for |
| --- | --- | --- | --- |
| `@adguard/dnr-converter` | 2.0.0 | GPL-3.0-only | turns network filters into Chrome rules (through `@apps-hub/sieve-core`) |
| `@adguard/agtree` | 4.3.0 | MIT | parses filter lines (through `@apps-hub/sieve-core`) |
| `@adguard/scriptlets` | 2.5.1 | GPL-3.0 | the scriptlet functions copied into `dist/scriptlets.js` (through `@apps-hub/sieve-core`) |
| `@adguard/re2-wasm` | 1.2.0 | Apache-2.0 | checks regex filters at build time only; not shipped in the extension |
| `esbuild` | 0.28.2 | MIT | bundles the extension scripts (build only) |
| `@types/chrome` | 0.3.7 | MIT | type definitions (build only) |
| `@types/node` | 22.10.10 | MIT | type definitions (build only) |
| `typescript` | 5.9.3 | Apache-2.0 | type checking (build only) |

`options.js` also bundles these packages, which the dependencies above pull in (versions as bundled, from esbuild's notes in `dist/options.js`; licences read from each package's `package.json` and its licence file):

| Package | Version | Licence |
| --- | --- | --- |
| `@adguard/logger` | 2.0.1 | MIT |
| `@adguard/css-tokenizer` | 1.2.0 | MIT |
| `valibot` | 1.5.0 | MIT |
| `zod` | 3.24.4 | MIT |
| `tldts`, `tldts-core` | 5.7.112 | MIT |
| `punycode` | 2.3.1 | MIT |
| `js-yaml` | 3.14.1 | MIT |
| `sprintf-js` | 1.1.3 | BSD-3-Clause |
| `glob-to-regexp` | 0.4.1 | BSD-2-Clause (in `package.json` and the README; the package ships no licence file) |
| `clone-deep`, `is-plain-object`, `isobject`, `kind-of`, `shallow-clone` | 4.0.1, 2.0.4, 3.0.1, 6.0.3, 3.0.1 | MIT |
| `ip-regex`, `is-ip` | 4.3.0, 3.1.0 | MIT |
| `json5` | 2.2.3 | MIT |

Two of the packages in the first table are GPL and are bundled into the extension: `@adguard/dnr-converter` (GPL-3.0-only) and `@adguard/scriptlets` (GPL-3.0). Sieve is private and never published or handed to anyone, so it is never distributed. Publishing it would first need its licence worked out under the GPL.

The Atkinson Hyperlegible fonts copied into `dist/fonts` are under the SIL Open Font License (`OFL.txt` is copied with them).

Filter lists, compiled into `dist/rules`, `dist/cosmetic` and `dist/sources`:

| List | Source | Licence |
| --- | --- | --- |
| EasyList | https://easylist.to/easylist/easylist.txt | GPL-3.0 or later, or CC BY-SA 3.0 ([easylist.to licence](https://easylist.to/pages/licence.html), named in the list header) |
| EasyPrivacy | https://easylist.to/easylist/easyprivacy.txt | GPL-3.0 or later, or CC BY-SA 3.0 (same licence page, named in the list header) |
| Adblock Warning Removal List | https://easylist-downloads.adblockplus.org/antiadblockfilters.txt | GPL-3.0 or later, or CC BY-SA 3.0 (same licence page, named in the list header) |
| Fanboy's Annoyance List | https://secure.fanboy.co.nz/fanboy-annoyance.txt | CC BY 3.0 (list header) |
| EasyList Cookie List | https://secure.fanboy.co.nz/fanboy-cookiemonster.txt | CC BY 3.0 (list header) |
| ABP filters (anti-circumvention) | https://easylist-downloads.adblockplus.org/abp-filters-anti-cv.txt | GPL-3.0 (no licence in the list header; the project's README at https://gitlab.com/eyeo/anti-cv/abp-filters-anti-cv says GPLv3) |
| Stevo's AI Blocklist | https://raw.githubusercontent.com/Stevoisiak/Stevos-AI-Blocklist/main/GenAI-Blocklist.txt (not downloaded by the build; seven of its rules are copied into `filters/ai-summaries.txt`) | MIT, "Copyright (c) 2026 Stevoisiak" (the repository's `LICENSE.txt`, fetched 2026-11-08; the repository is https://github.com/Stevoisiak/Stevos-AI-Blocklist) |
| `filters/ai-summaries.txt` | this repository, the `ai` feature | Seven rules from Stevo's AI Blocklist under its MIT licence (row above); one rule, `bing.com###b_genserp_container`, is Sieve's own |
