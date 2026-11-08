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
| `ai` | `filters/ai-summaries.txt`, written for Sieve | off |

## Develop

```bash
pnpm --filter sieve typecheck
pnpm --filter sieve test         # the counting code and the pick handler against an in-memory `chrome`
pnpm --filter sieve test:e2e     # headless Chromium in a fresh temporary profile; build first
```

The filter compiler and the settings logic live in `packages/sieve-core` and are unit-tested there. `test:e2e` needs playwright-core and Chrome for Testing: set `PLAYWRIGHT_CORE` (path to playwright-core's `index.mjs`) and `CHROMIUM_PATH` if yours are not in this Mac's default places. It never uses your own Chrome profile.

## Toolbar menu

The toolbar button opens a menu with a switch for Sieve, a switch for the current site, the ads and trackers blocked on the page, "Pause on this page" and "Pause everywhere", and the Distraction control, Cookie banners, AI search summaries and Site notification requests switches. It writes the same `settings` the service worker applies, so every switch goes through the blocking plan.

The counts and the badge come from `declarativeNetRequest.onRuleMatchedDebug` (permission `declarativeNetRequestFeedback`), an event Chrome only gives unpacked extensions, which is how Sieve is installed. Each tab's count lives in `chrome.storage.session`, so it survives the service worker stopping. It starts again at zero on each page load and is gone when Chrome quits. A match of a rule that only allows a request or only changes a response header is not counted: the build writes those rule ids per list (`allowIds`, `modifyIds`) into `dist/meta.json`. `test:e2e` opens the menu as `popup.html?tab=<id>`, since a script can't click the toolbar button.

## Block an item on this page

"Block an item on this page" in the menu injects `picker.js` into the tab (`scripting.executeScript`, covered by the existing host access, so it adds no permission) and closes the menu. The picker outlines the item under the pointer; a click picks it. The panel shows the selector and "Hides N items on this page", with Less and More to make the selector shorter or longer, Block it, and Cancel. Esc also closes it. The selector starts as short as it can be while still finding only that item, and ends at an id, which is already unique.

Block it sends `{ type: 'pick', host, selector }` to the service worker, which adds `host##selector` to My filters (`settings.blocking.myFilters`), adds the selector to `myCosmetic.hide[host]` (plain data in `chrome.storage.local`), and hides the item in that page at once. The worker does not compile the line, which keeps the filter compiler out of the worker bundle. On later page loads it injects `myCosmetic` with the lists' site-specific hiding, so a pick lasts across reloads and worker restarts. The host is the tab's address without `www.`, so it also covers that site's subdomains.

The picker is code running in a page the owner does not control, so it treats the page as untrusted:

- Its panel and outline sit in an open shadow root, styled from the shared UI tokens through a constructed stylesheet, which a page's Content Security Policy does not block. The fonts cannot load from a page, so the system font stands in.
- Only real input counts: a page that calls `click()` or sends events at the panel changes nothing.
- The worker takes the host from the sender's address, never from the message, and accepts only a selector of the shape the picker builds (`parsePick` in `sieve-core`: names, `#`, `.`, `:nth-of-type()`, spaces and `>`, at most 1,000 characters, no line break). One that could hide more than it showed, or add a line to My filters, is refused.
- Saves go through one queue, so two picks sent at once are both kept.

The button is off where blocking is off for the page (allowlisted site, paused page, paused everywhere) because a saved pick would not show after a reload there, and on an address Sieve cannot write a filter for (an IPv6 host).

## Known limits

- The picker works in the top frame only. The pointer events over an iframe go to the frame, not to the page, so the picker can neither outline an iframe (many ads are one) nor pick anything inside it. An element inside a page's own shadow DOM is picked as its host.
- A pick hides the item on every page of that site that matches the selector, not only on the current page.

- On an allowlisted site, the generic hiding CSS and the notification blocker still run inside iframes from other sites, because Chrome matches a registered script's excluded sites against the iframe's own address, not the tab's. Everything those iframes load still gets through, since the allow rule covers every frame in the page. Site-specific hiding and scriptlets check both the tab's page and the iframe's own address, so they stay out of those iframes, and out of an allowlisted site's iframes on other sites.
- Site-specific hiding and scriptlets are added by the service worker as each page or iframe starts loading. Chrome stops the worker after about 30 seconds without events, so the first page after any pause in browsing, not only the first after Chrome starts, starts a new worker. That worker reads the filter maps again (about 4 MB, a few tens of milliseconds), so a scriptlet can arrive after that page's first scripts have run. Pages loaded while the worker is running usually get it in time, but an inline script at the very top of a page can still run first.

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
