# Sieve for Chrome

The owner's private ad blocker (Manifest V3, Chrome 127 or later). It is never published: you build it on this Mac and load it unpacked. The filter lists are downloaded and compiled at build time; the extension itself makes no requests of its own.

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

The build prints one row per feature: rules, regex rules, generic selectors, hosts with site-specific filters, errors, and filters dropped by reason (features Chrome or Sieve can't run). It warns when the lists that are on by default have more than 30,000 rules, the number Chrome guarantees; the rest come from a pool shared with other extensions.

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
pnpm --filter sieve test:e2e     # headless Chromium in a fresh temporary profile; build first
```

The filter compiler and the settings logic live in `packages/sieve-core` and are unit-tested there. `test:e2e` needs playwright-core and Chrome for Testing: set `PLAYWRIGHT_CORE` (path to playwright-core's `index.mjs`) and `CHROMIUM_PATH` if yours are not in this Mac's default places. It never uses your own Chrome profile.

## Licences

Sieve's dependencies, read from each package's `package.json`:

| Package | Version | Licence | Used for |
| --- | --- | --- | --- |
| `@adguard/dnr-converter` | 2.0.0 | GPL-3.0-only | turns network filters into Chrome rules (through `@apps-hub/sieve-core`) |
| `@adguard/agtree` | 4.3.0 | MIT | parses filter lines (through `@apps-hub/sieve-core`) |
| `@adguard/scriptlets` | 2.5.1 | GPL-3.0 | the scriptlet functions copied into `dist/scriptlets.js` |
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
