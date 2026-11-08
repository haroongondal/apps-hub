# Sieve for Chrome

The owner's private ad blocker (Manifest V3, Chrome 128 or later: some rules in the ads, trackers and anti-adblock lists match on response headers, which Chrome supports from 128). It is never published: you build it on this Mac and load it unpacked. The filter lists are downloaded and compiled at build time; the extension itself makes no requests of its own.

## Install (unpacked)

```bash
pnpm install
pnpm --filter sieve build      # writes apps/sieve/dist
```

1. Open `chrome://extensions` and turn on Developer mode.
2. Click Load unpacked and pick `apps/sieve/dist`.
3. Check that the Sieve card shows no warning or error.

After a rebuild, press the reload arrow on the Sieve card.

## Build

`build.mjs` downloads each list into `filters/cache/` the first time, and reuses that copy afterwards. Run `pnpm --filter sieve build -- --refresh` to download fresh lists. If a download fails and there is no cached copy, the build stops and names the list.

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
pnpm --filter sieve test         # the counting code, the pick handler, the My filters save and the DevTools panel's ports and rows against an in-memory `chrome`
pnpm --filter sieve test:e2e     # headless Chromium in a fresh temporary profile; build first
pnpm --filter sieve test:e2e -- --live   # only the YouTube smoke test, against real youtube.com
```

The filter compiler and the settings logic live in `packages/sieve-core` and are unit-tested there. `test:e2e` needs playwright-core and Chrome for Testing: set `PLAYWRIGHT_CORE` (path to playwright-core's `index.mjs`) and `CHROMIUM_PATH` if yours are not in this Mac's default places. It never uses your own Chrome profile.

## Toolbar menu

The toolbar button opens a menu with a switch for Sieve, a switch for the current site, the ads and trackers blocked on the page, "Pause on this page" and "Pause everywhere", the Distraction control, Cookie banners, AI search summaries and Site notification requests switches, and a Settings button that opens the settings page. On a YouTube watch page it also has "Allow ads on <channel>" (see YouTube ads). It writes the same `settings` the service worker applies, so every switch goes through the blocking plan.

The counts and the badge come from `declarativeNetRequest.onRuleMatchedDebug` (permission `declarativeNetRequestFeedback`), an event Chrome only gives unpacked extensions, which is how Sieve is installed. Each tab's count lives in `chrome.storage.session`, so it survives the service worker stopping. It starts again at zero on each page load and is gone when Chrome quits. A match of a rule that only allows a request, only changes a response header or only strips query parameters (`$removeparam`) is not counted: the build writes those rule ids per list (`allowIds`, `modifyIds`) into `dist/meta.json`, and My filters rules are judged the same way (`blocksRequest` in `sieve-core`). `test:e2e` opens the menu as `popup.html?tab=<id>`, since a script can't click the toolbar button.

## Block an item on this page

"Block an item on this page" in the menu injects `picker.js` into the tab (`scripting.executeScript`, covered by the existing host access, so it adds no permission) and closes the menu. The picker outlines the item under the pointer; a click picks it. The panel shows the selector and "Hides N items on this page", with Less and More to make the selector shorter or longer, Move panel, Block it, and Cancel. Esc also closes it. The selector starts as short as it can be while still finding only that item, and ends at an id, which is already unique. If no selector finds only that item, it starts at the shortest one that finds the fewest.

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
- **Filter lists:** each list with its rule count from `dist/meta.json` and a switch (the same setting as the Blocking switch of that name), and the date the lists were built. Rebuilding Sieve is the only way to update them.
- **My filters:** the owner's own filters, one per line, saved with Save. The page compiles them with the same compiler as the build (`trusted: true`, so `trusted-*` scriptlets are allowed). That compiler is bundled into `options.js` only (about 2.3 MB); the worker never loads it. Before anything is stored, the page hands Chrome the rules the unpaused blocking plan would run, allowlist rules included, in one atomic `updateDynamicRules` call. If Chrome refuses them (more than 30,000 dynamic rules, more than 1,000 regex rules counting the allowlist's page entries, a rule it can't run), the earlier rules stay on, nothing is stored, and the page shows Chrome's message. If storage then refuses the write, the page puts the earlier rules back in Chrome, so the rules Chrome runs always match what is stored. On success it stores the text in `settings.blocking.myFilters`, the rules in `myRules` (a plain rule array, which the worker applies), their filter lines in `myRuleSources` (rule id to line, for the DevTools panel) and the hiding and scriptlet data in `myCosmetic`. Bad lines are listed as "Line N: what is wrong and how to fix it", the first 50, then "and N more". A line Sieve can't run (an extended selector, `$redirect`, a scriptlet the lists don't use and so the build doesn't ship) counts as a bad line, not a saved filter.
- **Allowlist:** each entry with Remove, and a box that takes a host or a page address. A full URL (with `http://` or `https://`), or an address with a path (`example.com/some/page`, saved as `https://`), becomes a page entry. A bare host becomes a site entry, with the port and a leading `www.` dropped (as the menu does) and a Unicode name turned into its `xn--` form. IPv6 addresses and addresses with no host (`mailto:`) can't be allowlisted.

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

"Checked" means this: with the live results page open, the selector's rule was added to it as CSS (`display: none`), and the AI block went away with no gap left behind. The extension's own path, where the service worker inserts the hiding CSS once the switch is on, has never run against a real engine. The owner checklist below is the real end-to-end test. The Google rules may leave a blank space where the block was. A search engine can rename any of these, and a rule that stops matching fails silently, so repeat the checklist after a Chrome or site change.

### Owner checklist: AI search summaries

- [ ] With "AI search summaries" on (menu or settings page), search "how do magnets work" on Google, Bing, DuckDuckGo and Brave Search, and check that no AI summary shows on any of them.
- [ ] Search a second question on all four, for example "why is the sky blue": Bing showed no AI block for four questions on the day the rules were written, so one question is not enough.
- [ ] With the switch still on, check that ordinary results, links and the search box still show on all four. The Google and Bing rules were never seen on a real page, so your eyes are the only check that they hide nothing else.
- [ ] Turn it off, reload each page, and check that the summary shows again.

An engine shows a summary only for some questions, signed in or out, and in some regions. If a summary does not show with the switch off, the engine did not make one for you: try another question before you blame a rule. On Google and Bing, say which engine showed nothing, so the rule can be fixed against a real page.

## YouTube ads

Two content scripts from the manifest run on `www.youtube.com`, `m.youtube.com`, `music.youtube.com` and `www.youtube-nocookie.com` at `document_start`, in every frame, so a YouTube player embedded in another site is covered too:

- `yt-main.js` runs in the page's own world (`"world": "MAIN"`), before YouTube's scripts. It wraps `JSON.parse` and `Response.prototype.json`, and puts a getter and setter on `window.ytInitialPlayerResponse`. An object with an ad field (`adPlacements`, `adSlots`, `playerAds`, `adBreakHeartbeatParams`), `playerResponse` or `videoDetails` at its top level goes through `stripAds` (`sieve-core`). That deletes the ad fields from it and from its `playerResponse`, unless the video's channel is allowed, and leaves `videoDetails` and `streamingData` alone. Everything else comes back exactly as the browser gave it, bad JSON throws the browser's own `SyntaxError`, and a failure inside the wrapper still returns the value, never an error.
- `yt-relay.js` runs in the isolated world. It reads `settings` and sends the main world a `sieve-yt-allow` event with `{ on, ids }`, again on every settings change. `on` is false where Sieve is off, paused everywhere, the Ads list is off, or the page is allowlisted (for an embed, also the pages around it, from `location.ancestorOrigins`, as `inject.ts` leaves an allowlisted site's frames alone). `ids` are the allowed channel ids, nothing else from the settings.
- The main world sends `sieve-yt-channel` with `{ id, name }` from the response's `videoDetails.channelId` and `author`. The page can send that event too, so the relay keeps only a channel id (`UC` and 22 letters, digits, `-` or `_`) with a name, cut to 100 characters (`ytChannel`), and ignores anything else.

Everything the main-world script holds can be read and called by the page, so it holds only the allowed channel ids, and the two events are its only link to Sieve.

On a watch page the menu asks the tab's top frame for the channel (`{ type: 'yt-channel' }`) and shows "Allow ads on <channel>". The switch saves `{ id, name }` in `settings.blocking.youtubeAllowedChannels` under the settings lock, and that channel's next video keeps its ads. The switch is hidden where Sieve doesn't remove YouTube ads anyway.

The settings reach the main world asynchronously, so until they arrive it strips everything. `ytInitialPlayerResponse`, which the page's inline script sets before they arrive, is checked when it is first read instead, by which time they normally have. A response YouTube parses before that is stripped even on an allowed channel.

The ads list's own YouTube rules still run through `inject.ts`: hiding rules on youtube.com, a `json-prune` for Shorts ads on www.youtube.com, and `json-prune` scriptlets for the same player fields on m.youtube.com and music.youtube.com. Each wraps `JSON.parse` around whichever came first, so a response can be stripped twice. That is harmless: the second pass finds nothing to delete.

`test:e2e` checks this on a stand-in watch page (`www.youtube.com` mapped to the local server, serving the spike's saved player response, `spike/fixtures/player-response.json`): the three ways in stay free of ad fields, other JSON behaves as the browser's own, the channel switch saves and survives a worker stop, an allowed channel keeps its ads, Sieve off, paused, allowlisted or the Ads list off leave the response untouched, an embed on an allowlisted site keeps its ads, and malformed page events are ignored. `test:e2e -- --live` runs only a smoke test against real youtube.com in a fresh, signed-out profile: three public videos for 30 seconds each, where `#movie_player.ad-showing` must never appear and the video must play, then one video with Sieve off as a control. YouTube may answer a headless browser with "Sign in to confirm you're not a bot"; that video is then reported as skipped, not failed.

## Known limits

- The DevTools panel keeps the newest 500 requests of a page ("Showing the latest 500 requests." says when it dropped older ones) and cuts an address at 2,048 characters. A panel on an idle tab reconnects about every 30 seconds, because Chrome stops the idle worker (an open port doesn't keep it alive); that is silent. A request blocked while it reconnects, a fraction of a second, is not listed, and a page that reloaded in that moment can leave its old rows until the next load. Like the counts, it only works where Chrome gives the debug event, in an unpacked install.

- A My filters `site#@#selector` exception lifts another list's generic hiding only on that site: the site leaves the registered generic stylesheets and gets them per page, without the excepted selectors. A `#@#selector` with no site, or one on a `google.*`-style site, does not lift a list's generic hiding; it still works against site-specific rules and My filters' own. My filters' `$generichide` and `$elemhide` exceptions only turn off My filters' own hiding.

- The picker works in the top frame only. The pointer events over an iframe go to the frame, not to the page, so the picker can neither outline an iframe (many ads are one) nor pick anything inside it. An element inside a page's own shadow DOM is picked as its host.
- A pick hides the item on every page of that host that matches the selector, not only on the current page.
- The panel starts in the bottom-right corner and covers what is under it, such as a chat bubble or a back-to-top button fixed there, which scrolling cannot move out from under it. Move panel puts it in the top-left corner, and a second click puts it back. It moves only on that click (a real one: a page's `click()` does nothing), never when the pointer reaches it. An item fixed in the top-left corner is picked with the panel at the bottom-right.
- A page script that registered a capture listener on `window` before the picker started sees the owner's clicks first. It can tell that an item is being picked, or stop the picker from getting a click, so that item cannot be picked on that page. It still cannot press Block it for the owner. The picker cannot do better, because listeners registered earlier always run first.
- On an allowlisted site, the generic hiding CSS and the notification blocker still run inside iframes from other sites, because Chrome matches a registered script's excluded sites against the iframe's own address, not the tab's. Everything those iframes load still gets through, since the allow rule covers every frame in the page. Site-specific hiding and scriptlets check both the tab's page and the iframe's own address, so they stay out of those iframes, and out of an allowlisted site's iframes on other sites.
- Site-specific hiding and scriptlets are added by the service worker as each page or iframe starts loading. Chrome stops the worker after about 30 seconds without events, so the first page after any pause in browsing, not only the first after Chrome starts, starts a new worker. That worker reads the filter maps again (about 4 MB, a few tens of milliseconds), so a scriptlet can arrive after that page's first scripts have run. Pages loaded while the worker is running usually get it in time, but an inline script at the very top of a page can still run first.
- "Allow ads on <channel>" brings ads back on www.youtube.com and in embeds only. On m.youtube.com and music.youtube.com the ads list's `json-prune` scriptlets strip the same fields whatever the channel. On youtube.com the anti-adblock list hides `.video-ads .ytp-ad-player-overlay`, so an allowed channel's ad may play without YouTube's ad overlay.
- The channel the menu names is the last player response the page read. Near the end of a video YouTube may load the next one for autoplay, and the switch then names that video's channel.
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
