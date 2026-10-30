# Reader: research for offline read-later in PDF Editor

Researched 2026-10-30. This covers the Reader feature of PDF Editor
(`apps/pdf-editor-mobile`, `com.haroon.pdfeditor`): save a web page, read it
clean, listen to it, and export it as EPUB or PDF, all on the phone.

**Verified** means checked on a primary source: the vendor's page, the
project's repo or source code, the spec, or the SDKs and packages installed in
this repo. **Assumed** means a secondary source or our own inference. Keys in
square brackets point to the sources list in §11. Every source was accessed on
2026-10-30.

---

## 1. Verdicts at a glance

| Question                  | Verdict                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Market (§2)               | Pocket and Omnivore are gone. Paid apps charge $60–$120 a year for TTS, search and export. Every mature FOSS option needs a server. An offline, no-account Android reader has a real gap to fill.          |
| Extraction (§3)           | Run `@mozilla/readability` 0.6.0 and DOMPurify 3.4.17 inside a react-native-webview that loads the live page. A DOM shim in Hermes does not work, because DOMPurify cannot run there.                      |
| Capture (§4)              | Hand-add an Android `SEND text/plain` intent filter and turn the share into a deep link in `MainActivity` (about 15 lines). No dependency. Canonicalise URLs with about 40 lines of our own TypeScript.          |
| Offline and safety (§5)   | Download images into `library/<id>/img/`, cap them, sanitise twice, and render with a strict CSP that allows only our own script by nonce. JavaScript must stay on, because progress and highlighting need it. |
| Reader view (§6)          | Use the brand's light and dark tokens, add a sepia reader palette to `packages/ui/src/tokens.ts`, and use Atkinson Hyperlegible plus the system serif. Highlights wait until after v1.                      |
| Export (§7)               | Build EPUB 3 in pure TypeScript with fflate 0.8.3 (`zipSync`). Make PDFs with expo-print ~15.0.8, with images inlined as `data:` URIs. Both can reuse the XHTML stored at save time.                     |
| Text-to-speech (§8)       | expo-speech is not enough on Android. Build a small local module: TextToSpeech owned by a `mediaPlayback` foreground service, a legacy `androidx.media` session, and sentence chunking in TypeScript.          |
| Search and import (§9)    | Feed plain article text to the Library's `items_fts`. Recommend `unicode61 remove_diacritics 2` and a quoted-token MATCH builder to the Library. Pocket exports can no longer be downloaded; import is an optional late phase. |
| Host (§10)                | PDF Editor is a good host. It reuses the WebView, file system, sharing, the Library and the PDF engine. It adds about 0.7 MB and three normal permissions. The display name is the main issue.                 |

---

## 2. Market reality

**Verdict:** cloud read-later services die and take their users' libraries with
them. Paid tiers lock TTS and search behind subscriptions. FOSS tools need a
server. A local-only Android reader is the gap.

### 2.1 Shutdowns

- **Pocket.** Mozilla announced the shutdown on 22 May 2025 and switched the
  service off on 8 Jul 2025. Users could export until 8 Oct 2025; after that the
  data was "permanently deleted" and the API stopped [1] (verified). The
  farewell page is still up but has no export link [2] (verified). **Pocket
  exports can no longer be downloaded.** Only files people saved earlier exist.
- **Pocket's final export** is `pocket.zip` with sharded `part_000000.csv` files.
  The header is `title,url,time_added,cursor,tags,status`. Tags are separated by
  `|`, `time_added` is Unix seconds, and `status` is `unread` or `archive` [3]
  (verified from Readeck's importer and fixtures). An earlier CSV has no
  `cursor` column [4] (verified). The legacy `ril_export.html` lists links under
  "Unread" and "Read Archive" headings [4] (verified).
- **Omnivore.** ElevenLabs hired the team on 29 Oct 2024 [5] (verified). The
  hosted service ended in November 2024 (TechCrunch says export until 16 Nov,
  heise says 15 Nov) [6] (assumed). The code is AGPL-3.0 and lives on as a
  self-hosted app [7] (verified). Its export zip holds
  `metadata_*.json` (`id, slug, title, author, url, state, readingProgress,
  labels[], savedAt, publishedAt, …`), `content/<slug>.html` and
  `highlights/<slug>.md` [7] (verified).

### 2.2 Paid apps today

| App             | Price                                                                 | Behind the paywall                                                                                        | Source           |
| --------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------- |
| Instapaper      | $5.99/month or $59.99/year                                            | Full-text search, permanent archive, Kindle, AI voices and TTS playlists, speed reading                    | [8] verified     |
| Matter          | $8/month or $60/year on its site; $79.99/year on the US App Store      | HD TTS, highlights and notes, integrations. **No Android app.**                                            | [9] verified, inconsistent |
| Readwise Reader | $7.99/month billed yearly (Reader only); no free tier, 30-day trial    | Everything; includes TTS, full-text search, PDFs and EPUBs                                                 | [10] verified    |

Instapaper moved TTS to cloud "AI voices" in Dec 2025 and on Android in Jul 2026
[17] (verified). Cloud TTS sends the article to a server. On-device TTS is the
privacy point here.

### 2.3 FOSS prior art

| Project            | Licence and state                       | How it works                                                                                                                                                                   | Copy                                                                     | Avoid                                       |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------- |
| wallabag           | MIT server; GPL-3.0 Android client      | Server-side graby + php-readability + about 2,050 ftr-site-config rules (CC0). Exports EPUB, PDF, CSV, JSON. The Android app caches offline and uses Android TextToSpeech [4, 11]. | Many export formats; TTS from the platform engine                        | Needs a server                              |
| Readeck            | AGPL-3.0, Go, 0.23.5                    | One immutable zip per bookmark with text and images stored at save time. Highlights, labels, saved searches, full-text search, EPUB per article or per collection [12].        | Local images per article; a collection as one EPUB                       | Server required; AGPL, so copy ideas not code |
| Karakeep           | AGPL-3.0                                | Playwright + `@mozilla/readability`; one `parsers.ts` maps Pocket, Omnivore, Instapaper, Matter, Readwise and Netscape exports [13].                                            | The import field maps                                                    | Heavy: Chrome, search engine, LLM tagging   |
| Shiori, linkding   | MIT                                     | go-readability + EPUB per bookmark; Netscape HTML with `TAGS` and `TOREAD` [14].                                                                                               | Netscape HTML import                                                     | Not readers                                 |
| Read Later (sak96) | MIT, Tauri, F-Droid, created Nov 2025   | Standalone on Android: save, read, TTS with pitch and speed [15].                                                                                                              | Closest to this idea                                                     | Young; no import or export                  |

All verified from the repos. The only standalone Android FOSS reader is about a
year old with 80 stars [15] (verified).

---

## 3. Extraction

**Verdict:** `@mozilla/readability` 0.6.0 plus DOMPurify 3.4.17, injected into a
react-native-webview that loads the live page.

### 3.1 Readability

- 0.6.0 (2025-03-03), Apache-2.0, 89,980 B raw, 25,070 B gzipped [18]
  (verified).
- It needs a real `Document`. `parse()` mutates it, so pass
  `document.cloneNode(true)` [18] (verified).
- It returns `title, content, textContent, length, excerpt, byline, dir,
  siteName, lang, publishedTime`. JSON-LD wins over meta tags [18] (verified).
- `isProbablyReaderable(doc)` is a quick check that can be wrong both ways [18]
  (verified).
- **It has no multi-page support.** No next-page code exists [18] (verified);
  the Firefox bug is still open [65] (assumed).
- **It does not sanitise.** Its README says to use DOMPurify and a CSP [18]
  (verified).
- **Quality:** on the Zyte article-extraction benchmark, readability_js 0.6.0
  scores F1 0.947 (precision 0.914, recall 0.982). Trafilatura scores 0.958 and
  readability-lxml 0.922 [20] (verified). Trafilatura is Python and can't run
  here.

### 3.2 Alternatives

| Option                         | Facts                                                                                                                                                                 | Verdict                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Defuddle 0.19.6 (MIT)          | 92 KB gzipped, 3.7× Readability. Better metadata, footnotes, code and math. No published F1. `parseAsync()` calls YouTube, X and Reddit APIs by default [19] (verified). | Keep as a later swap; not v1              |
| @extractus/article-extractor   | Wraps Readability + linkedom; its maintainer points RN users to Readability [22] (verified).                                                                          | No                                        |
| Postlight Parser               | Last published 2022 [19] (verified).                                                                                                                                   | Dead                                      |
| Readability4J (Kotlin, Apache) | Last pushed 2021, tracks the 2017–18 algorithm, static HTML only [23] (verified).                                                                                      | Only for a future background retry        |

### 3.3 Where to run it

| Option                                         | Result                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) react-native-webview loads the page**    | **Chosen.** Gets JS-rendered pages, lazy images and `img.currentSrc`. Cookies come from the app's own WebView jar, not from Chrome [27] (verified).                                                                                                              |
| (b) `fetch` + linkedom in Hermes               | **Fails.** DOMPurify needs `window.document`. Without it `sanitize` is undefined; with a partial DOM it returns its input unchanged, which fails open [25] (verified). linkedom 0.18.14 probably breaks Metro through `@acemir/cssom`'s `browser` field [24] (assumed). SPAs come back empty. |
| (c) Native Kotlin                              | Static HTML only and an old algorithm [23] (verified).                                                                                                                                                                                                          |

Risks of (a), all verified in react-native-webview 13.15.0's source [26]:

- **The message bridge can be spoofed.** It accepts messages from any origin
  and never checks `isMainFrame`, so the page or its iframes can post a fake
  result. Use a per-run nonce, and treat the result as untrusted (§5.3).
- **The WebView dies with the activity.** `onHostDestroy` destroys it, so the
  app must stay in the foreground while it extracts. A share that is closed at
  once must still leave the URL saved as pending.
- **A crash or OOM in the renderer** arrives through `onRenderProcessGone`.
- **Hangs.** SingleFile waits at most 1.5 s of network idle [29] (verified).
  Use a 30 s page timeout.
- **Sites can detect WebView** by the `wv` token in its user agent [28]
  (verified). This can be overridden with the `userAgent` prop if a site
  blocks it.

### 3.4 Messy pages

- **Consent walls.** Readability already drops `aria-modal` dialogs and scores
  "gdpr" classes down [18] (verified). The rule lists differ by licence:
  Consent-O-Matic is MIT, I-Still-Don't-Care-About-Cookies is GPL-3.0, and
  EasyList is GPL-3.0 or CC BY-SA [37] (verified). **v1 ships no rules.** The
  fallback is "Show page": the user dismisses the banner, then saves again.
- **Paywalls.** Never bypass them. Save what renders. Mark the item partial when
  the text is under 500 characters or `isProbablyReaderable` is false.
- **AMP.** An AMP page links to the original with `rel=canonical` [assumed].
  Store the canonical URL.
- **Lazy images.** Readability copies `data-*` URLs only when `src` is missing or
  the class contains "lazy", and only for .jpg, .png and .webp [18] (verified).
  So before extracting: scroll the page in steps, set `img.src = img.currentSrc`,
  copy `data-src`, then drop `srcset` and `<source>`.
- **Figures and captions survive** the image-ratio and "too short" removals [18]
  (verified).
- **Pagination.** Not supported; we save page one and say so.
- **Offline at save time.** Store the URL as pending and extract later. The
  wallabag Android app queues an `ADD_LINK` item the same way [35] (verified).

---

## 4. Capture paths

**Verdict:** add the share target by hand and rewrite it to a deep link. Paste a
URL into a field. Use canonical URLs for duplicates and refresh.

### 4.1 What browsers send

- **Chrome** sends `ACTION_SEND`, `text/plain`. `EXTRA_TEXT` is `text + " " +
  url`: either the bare URL, or a highlighted quote plus a URL ending in
  `#:~:text=`. `EXTRA_TITLE` is the page title. `EXTRA_SUBJECT` is the title, but
  only when it differs from `EXTRA_TEXT` [30] (verified).
- **Xiaomi/HyperOS browser:** undocumented [assumed]. Parse the last `http(s)`
  URL out of `EXTRA_TEXT`, and test on the phone in Phase 1.

### 4.2 Receiving it in Expo SDK 54

| Option                                  | Facts                                                                                                                                                                                         | Verdict      |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Own intent filter + `MainActivity` rewrite | RN `Linking` only exposes `ACTION_VIEW` data [32] (verified). Rewriting `ACTION_SEND` to `ACTION_VIEW pdfeditor://save?url=…&title=…` before `super.onCreate`/`onNewIntent` lets expo-router route it. About 15 lines of Kotlin plus a manifest entry. | **Chosen**   |
| expo-share-intent 5.1.1 (MIT)           | 5.x is the SDK 54 line; 9.0.0 targets SDK 58. Its plugin only adds `SEND` filters; it reads `EXTRA_TEXT` and `EXTRA_TITLE`. iOS needs a share extension [31] (verified).                     | Fallback     |
| react-native-share-menu, react-native-receive-sharing-intent | Last published 2022-05 and 2021-05 [31] (verified).                                                                                                        | No           |

`android/` is a committed prebuild, so a hand edit is the house style.

### 4.3 Canonical URLs and duplicates

- **Don't rely on `URL` for this.** RN 0.81's `URL` has regex getters and no
  setters [32] (verified), and normalize-url 10.0.0 needs setters [33]
  (verified). Node's `URL` does have setters, so `node --test` would pass on code
  that breaks on the phone. Write a small parser with no `URL` dependency.
- **Strip these parameters:**
  - `utm_*`
  - Click IDs: `fbclid`, `gclid`, `dclid`, `msclkid`, `wbraid`, `yclid`,
    `ttclid`, `twclid`, `srsltid`
  - Marketing: `mc_eid`, `_hsenc`, `__hs*`, `_gl`, `mtm_cid`, `pk_cid`, `oly_*`,
    `vero_*`, `sfmc_*`, `s_cid`
  - Host-scoped: `igsh` and `igshid` (Instagram), `ref_src` and `ref_url` (X),
    `si` (YouTube)

  The list comes from Brave's query filter plus `utm_*` [33] (verified). Don't
  strip a bare `ref` everywhere.
- **Rules [assumed]:**
  - Lowercase the scheme and host, drop the default port and the fragment
    (including `#:~:text=`), and sort the parameters.
  - After extraction, prefer a same-site `rel=canonical`, then `og:url`, then
    the cleaned final URL. Keep the original URL too.

---

## 5. Offline assets and safety

**Verdict:** download images at save time, sanitise at save and again at
render, and render under a CSP that blocks every network request and every
script except our own. JavaScript stays on.

### 5.1 Images

- expo-file-system 19.0.24 `File.downloadFileAsync` [34] (verified):
  - rejects non-2xx responses;
  - builds a new OkHttp client per call;
  - has no size cap, progress or cancel;
  - leaves a partial file on failure.

  So check `file.size` afterwards, delete files over the cap, and wrap each call
  in a timeout.
- Android WebView renders JPEG, PNG, GIF, WebP, SVG-in-`<img>` (scripts don't
  run) and AVIF (Chrome 89 and later on Android) [assumed].
- **Prior art:**
  - SingleFile's optional per-resource cap is 10 MB [29] (verified).
  - wallabag allows jpeg, gif, png, webp and svg, re-encodes at quality 80, and
    has no size cap [35] (verified).
- **Our caps (design):** 5 MB per image, 25 MB per article, 60 images, 4
  downloads at a time, 20 s each.

### 5.2 Sanitising

- DOMPurify 3.4.17 (2026-10-12) is MPL-2.0 OR Apache-2.0, 29,828 B minified
  (11.7 KB gzipped). It runs in a WebView but not in Hermes [25] (verified).
- **Its default allowlist keeps more than we want:** form, input, button,
  textarea, style, template, dialog, video and audio [25] (verified). Forbid
  those, plus `style`, `srcset` and `sizes` attributes and `data-*`.
- **Advisories:** about 25 in 2026, almost all in modes we won't use (`IN_PLACE`,
  `RETURN_DOM`, `SAFE_FOR_TEMPLATES`, custom element handling, function-form
  `ADD_TAGS`). These include CVE-2026-41240 (a `FORBID_TAGS` bypass) and a
  critical fix in 3.4.17 [25] (verified). Pin 3.4.17 or later.

### 5.3 Rendering saved HTML

Verified in react-native-webview 13.15.0 [26] and AOSP [27]:

- `source={{ html, baseUrl }}` calls
  `loadDataWithBaseURL(baseUrl, html, "text/html", "UTF-8", null)`.
- **`file://` images load** when `baseUrl` is a `file://` directory and
  `allowFileAccess` is true. The library and the platform (from SDK 30) default
  it to false. `<img>` doesn't need the file-origin flags, so those stay false.
- **`setBlockNetworkLoads` isn't exposed** by react-native-webview. A CSP meta
  tag covers the same need.
- **`javaScriptEnabled={false}` kills `onMessage` and `injectJavaScript`.** That
  rules out progress saving, scroll restore, live setting changes and TTS
  highlighting.
- **Decision (contradicts the brief's "JavaScript off").** JavaScript stays on,
  and the CSP allows only our own inline script by nonce:

  ```
  default-src 'none'; img-src file: data:; style-src 'unsafe-inline';
  font-src data:; script-src 'nonce-<random>'
  ```

  Stored content can't run scripts, inline handlers or `javascript:` URLs. It
  can't reach the network either.
- **Not settled:** whether `evaluateJavascript` (behind `injectJavaScript`)
  obeys the page's CSP. No primary source found [36] (assumed: it runs). If it
  is blocked, settings changes fall back to re-rendering the page. Phase 2
  checks this with `chrome://inspect`.
- **Trust boundary.** The page can tamper with anything our capture script sees
  in its realm, including the DOMPurify instance and `postMessage`. So the
  capture result is untrusted data, and the reader shell sanitises it again
  before inserting it.

---

## 6. Reader view

**Verdict:** typography from `@apps-hub/ui` tokens and fonts, four themes,
progress by block index, no highlights in v1.

- **Tokens that exist** in `packages/ui/src/tokens.ts` (verified, read in repo):
  - per-brand light and dark palettes (`bg, surface, raised, line, text, muted,
    faint, accent, …`) with the `pdf` brand at hue 345;
  - type sizes and spacing;
  - the fonts Atkinson Hyperlegible Next (400, 600, 800) and Mono (400, 600) as
    48 KB and 34 KB TTF files;
  - `web/tokens.css` switching on `data-brand` and `data-theme`.

  **There is no sepia.** Add a reader palette to `tokens.ts` so the WCAG AA test
  covers it.
- **Fonts:**
  - Atkinson Hyperlegible Next is the default (OFL, already vendored).
  - "Serif" uses the system `serif` (Noto Serif on Android), and "Sans" the
    system sans.
  - "Mono" uses Atkinson Mono.

  No new font files. The fonts are inlined as `data:` URIs, about 64 KB base64
  each, the same way `packages/pdf-editor-engine/build.mjs` inlines them for the
  editor (verified, read in repo).
- **Measure:** 60–75 characters a line is the usual target [assumed]. On a phone
  the screen width already limits it; cap the column at 40em for tablets.
- **Progress:** tag each block with `data-b` at save time, post the first visible
  block and the scroll ratio, and restore by block. Restoring by block survives
  font and size changes.
- **Highlights: out of v1.** The owner's key features don't include them.
  Anchoring breaks when an article is refreshed. Text selection inside an RN
  WebView on Android needs custom menus. Block anchors make them possible later
  (PRD Q2).
- **TTS sentence highlight:** the CSS Custom Highlight API (Chrome 105+) marks a
  `Range` without changing the DOM [assumed]. Android System WebView updates
  with Chrome, so the phone has it. Fall back to wrapping text in `<mark>`.

---

## 7. Export

**Verdict:** EPUB 3 by hand with fflate. PDF through expo-print. Both start from
the XHTML stored at save time.

### 7.1 EPUB 3.3 rules worth honouring

All verified from W3C EPUB 3.3 [51] and epubcheck's message bundle [52].

- **`mimetype`:** the first entry, stored (not compressed), no extra field,
  exactly `application/epub+zip` with no newline. Errors PKG-005, PKG-006 and
  PKG-007.
- **`META-INF/container.xml`** points to the OPF.
- **The OPF needs:**
  - `dc:identifier` (referenced by `unique-identifier`), `dc:title` and
    `dc:language`;
  - exactly one `meta property="dcterms:modified"` as `YYYY-MM-DDThh:mm:ssZ`.
- **Nav:** exactly one manifest item has `properties="nav"`, holding one
  `<nav epub:type="toc">`.
- **Content documents** are XHTML (XML syntax). Named entities such as `&nbsp;`
  are fatal (RSC-016). Emit the literal character or `&#160;`.
- **Core image types** are JPEG, PNG, GIF, WebP and SVG. **AVIF is not one**
  (MED-003).
- **Remote resources:** all images and CSS must be inside the container
  (RSC-006). Plain `<a href="https://…">` links are fine.
- **Common generated-EPUB errors to avoid:**
  - **RSC-012:** a fragment link to an id that sanitising removed. Drop those
    links.
  - **OPF-029:** a file's bytes don't match its declared type. Sniff the magic
    bytes.
  - **PKG-010 and PKG-012:** spaces or non-ASCII characters in file names.
  - **RSC-005:** duplicate ids, or obsolete elements such as `center` or `font`.
- **NCX:** EPUB 3 readers ignore it, but a few Android readers still read it.
  KOReader's engine only gained nav parsing late [51] (verified spec); [assumed
  reader quirks]. Include a 40-line `toc.ncx` whose `dtb:uid` equals the OPF id
  (NCX-001).
- **Reader apps to test with:** KOReader (AGPL, F-Droid) and Librera (F-Droid).
  Google Play Books needs an upload to a Google account, so it's out [assumed].

### 7.2 Zip and XHTML

- **fflate 0.8.3 (MIT)** [53] (verified):
  - 12.6 KB gzipped for the full build.
  - `zipSync({ mimetype: [bytes, { level: 0 }], … })` gives a stored entry with
    no extra field, and keeps keys in insertion order.
  - Its async API needs Workers, which Hermes doesn't have, so use `zipSync`.
  - It needs no TextEncoder, and Hermes in RN 0.81 has one anyway.
- **Alternatives** [54] (verified):
  - JSZip is 28.5 KB gzipped, with dependencies.
  - zip.js adds an extra field to `mimetype` by default, which causes PKG-005.
  - client-zip needs the Streams API, which Hermes doesn't have.
- **EPUB generators** [54] (verified): `epub-gen`, `html-to-epub` and `nodepub`
  are Node-only. `epub-gen-memory` is 67 KB gzipped and fetches images itself.
  Our sanitised XHTML plus templates is about 250 lines of TypeScript instead.
- **XHTML:** in the WebView, `new XMLSerializer().serializeToString(node)`
  produces well-formed XHTML from an HTML DOM [55] (verified):
  - It declares the namespace and writes void elements as `<br />`.
  - It escapes only `& < >` in text, so `&nbsp;` arrives as U+00A0.
  - It doesn't check well-formedness, so control characters, illegal attribute
    names and `--` in comments pass through. Strip those first, then reparse as
    `application/xhtml+xml` and check for `parsererror`.
- **Decision:** store the article once, as `content.xhtml`. The reader renders it
  as HTML, and EPUB and PDF export reuse it. That means no DOM is needed at
  export time, so the EPUB builder is pure TypeScript and tested under
  `node --test`.

### 7.3 PDF

| Option                                     | Facts                                                                                                                                                                                                                                                                                                                       | Verdict                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **expo-print ~15.0.8 (MIT)**               | On Android: an offscreen WebView, `loadDataWithBaseURL(null, html)`, then `createPrintDocumentAdapter`. Size from `width`/`height` in points (595×842 is A4). Margins are fixed at none and `margins` is iOS-only, so use CSS `@page`. JavaScript is off. **`file://` images don't load**, because the base URL is `about:blank`. iOS comes free [56] (verified). | **Chosen.** Inline images and fonts as `data:` URIs; one article per PDF in v1. |
| Custom Kotlin print module                 | The same adapter with a `file://` base URL and real margins, without the bridge cost. About 150 lines plus a later Swift version [56, 27] (verified API; size assumed).                                                                                                                                                       | Fallback if large articles stall                                                |
| pdf-lib with our own layout                | No line breaking, bidi, pagination or image flow [58] (verified).                                                                                                                                                                                                                                                             | No                                                                              |
| `printAsync` (system dialog)               | Resolves when the dialog opens, not when the file is saved [56] (verified).                                                                                                                                                                                                                                                    | No                                                                              |

**Selectable text is assumed, not verified.** Chromium prints through Skia's PDF
backend, which keeps text as text unless effects such as `filter` force
rasterising [57] (assumed). Phase 4 checks this by opening the output in the PDF
editor and editing a line.

---

## 8. Text-to-speech

**Verdict:** a small local Expo module. TextToSpeech is owned by a foreground
service of type `mediaPlayback`, with a legacy `androidx.media` session for lock
screen and headset controls. Sentences come from a TypeScript splitter.

### 8.1 expo-speech is not enough

Version ~14.0.8 for SDK 54, MIT [38, 63] (verified). Read in its sdk-54 source
[38] (verified):

| Need                         | expo-speech on Android                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Word timing                  | Yes: `onBoundary` from `onRangeStart` (API 26+, only if the engine sends ranges)           |
| Pause and resume             | **No.** Android has no `pause`; the JS throws `UnavailabilityError`                         |
| Text over 4,000 chars        | **Throws** `SpeechInputIsToLongException`; no chunking                                     |
| Background, screen off       | **No service.** It calls `shutdown()` when the activity is destroyed                       |
| Lock screen, audio focus     | None; no audio attributes either                                                          |
| Offline voice filter         | **No.** It doesn't expose `isNetworkConnectionRequired`, so an online voice is silent offline |
| Engine choice                | No                                                                                        |

### 8.2 Android APIs (checked in `platforms;android-36/android.jar`)

All verified in [39], plus the AOSP sources [40]:

- **`TextToSpeech.getMaxSpeechInputLength()`** returns the constant 4000.
- **`synthesizeToFile`** comes as `(CharSequence, Bundle, File, String)` (API 21)
  and `(…, ParcelFileDescriptor, …)` (API 30). The output is WAV.
- **`UtteranceProgressListener`:**
  - `onRangeStart(String,int,int,int)` is API 26, and fires only when the engine
    supplies timing.
  - `onStop` is API 23 and `onError(String,int)` is API 21.
- **`Voice`:**
  - `isNetworkConnectionRequired()`;
  - `getFeatures()` keys `notInstalled`, `networkTts` and `embeddedTts`;
  - quality 100–500.
- **Rate and pitch:** any value above 0 is accepted, with 1.0 as normal.
- **Engines:** `getEngines()`, and the constructor
  `TextToSpeech(ctx, listener, enginePackage)`.
- **The engine's own process plays the audio.** The framework never requests
  audio focus, so focus, the session and the service are all our job.
- **Package visibility:** Android 11+ needs
  `<queries><intent><action android:name="android.intent.action.TTS_SERVICE"/></intent></queries>`,
  or no engine is found. The module's own manifest can declare it, as
  expo-speech does [38, 40] (verified).

### 8.3 Engines on the phone

- **HyperOS default engine: unknown.** Global ROMs probably ship Google's
  `com.google.android.tts` [assumed]. Check in Phase 5 with `getEngines()`.
- **Offline filter:** only show voices where `!isNetworkConnectionRequired` and
  the features don't include `notInstalled`. A network voice sends the article to
  the engine's vendor, which breaks the zero-telemetry rule unless the owner opts
  in.
- **FOSS engines the owner can install from F-Droid** [44, 45] (verified):

  | Engine              | Licence           | Word timing | Notes                                                                                       |
  | ------------------- | ----------------- | ----------- | ------------------------------------------------------------------------------------------- |
  | RHVoice 1.18.4      | GPL-3.0-or-later  | Yes         | Some voices are non-commercial licences                                                     |
  | eSpeak NG 1.52.0    | GPL-3.0           | No          | In 1.52.0                                                                                   |
  | SherpaTTS 3.4       | GPL-3.0           | No          | Uses Piper voices; warns about Google's developer verification                              |

  The design must work without word timing, so the sentence highlight is the
  baseline.

### 8.4 Background playback

- **Queued utterances keep playing** in the engine's process, but our app must
  stay alive to queue the next ones [40] (verified).
- **Foreground service type `mediaPlayback`** needs
  `FOREGROUND_SERVICE_MEDIA_PLAYBACK` (API 34). It has no time limit. Android 15
  forbids starting it from `BOOT_COMPLETED`; Android 16 changes nothing here
  [42] (verified).
- **Audio focus on Android 15+** needs the app on top or running a foreground
  service, so request focus from the service [42] (verified).
- **Notifications:** media-session notifications are exempt from
  `POST_NOTIFICATIONS` [42] (verified).
- **Media3 vs legacy** [41, 64] (verified):
  - Media3 1.11.1 (Apache-2.0) is Google's current library, but it pulls in Guava
    (a 2.9 MB jar) and kotlin-stdlib 2.2.10. RN 0.81.5 uses Kotlin 2.1.20, and
    this app ships without minify.
  - Legacy `androidx.media` 1.7.0 is 344 KB with no Guava.
  - **Choice: legacy `MediaSessionCompat` + `NotificationCompat.MediaStyle`**,
    as Librera and Readest do [46] (verified).
- **Prior art to copy** [46] (verified):
  - Readium's `AndroidTtsEngine` (BSD-3): `QUEUE_ADD` and `onRangeStart`.
  - Librera: a `TTSService` with `foregroundServiceType="mediaPlayback"`,
    `AudioFocusRequest`, a `PARTIAL_WAKE_LOCK` and `QUEUE_ADD` chunks.
- **HyperOS:** dontkillmyapp rates Xiaomi 5/5, the worst [43] (verified). Tell the
  owner to turn on Autostart, set battery to "No restrictions" and lock the app
  in Recents.

### 8.5 Chunking, highlight, resume

- **`Intl.Segmenter` is not in Hermes** for RN 0.81.5. Its `Intl` has only
  Collator, DateTimeFormat and NumberFormat [47] (verified). Node does have it,
  so a `node --test` would pass on code that crashes on the phone. Use a
  rule-based TypeScript splitter, and run its test with `Intl.Segmenter`
  deleted.
- **One utterance per sentence:**
  - Merge sentences shorter than 40 characters up to 300.
  - Split anything over 1,000 characters at a comma or space.
  - Keep 3 utterances queued with `QUEUE_ADD` so there are no gaps (Readium and
    Readest do this [46], verified).
- **Offsets:** `onRangeStart` offsets are UTF-16, relative to the utterance, and
  map directly onto JS string indices [40] (verified).
- **Pause on Android is `stop()`.** Resume re-speaks the current sentence.
- **iOS later:** `AVSpeechSynthesizer` with `willSpeakRangeOfSpeechString`, the
  `.playback` session, `UIBackgroundModes: audio`, and
  `MPRemoteCommandCenter` [48] (verified API).

### 8.6 Audio export

**Out of v1.** WAV at 24 kHz, 16-bit mono is about 173 MB an hour, and each
`synthesizeToFile` call is capped at 4,000 characters, so a long article needs
15+ files stitched together [40] (verified). Encoding to AAC or Opus with
`MediaCodec` [49] (verified) is a phase of its own.

### 8.7 PDFs and scans

PDF.js 3.11.174 `getTextContent()` returns items with `str, transform, width,
hasEOL`; PDF.js joins `str` and adds a newline on `hasEOL` [50] (verified).
Reading-order heuristics (sort by y then x, de-hyphenate, break paragraphs on
gaps, drop repeated headers) are assumed and tested on fixtures.

---

## 9. Search and import

**Verdict:** the Library owns `items_fts`. The Reader writes clean plain text
into it. Import is optional and late.

### 9.1 FTS5 facts

- expo-sqlite 16.0.10 bundles SQLite **3.50.3** with FTS5 on [59] (verified,
  `vendor/sqlite3/sqlite3.h:149`).
- **Tokenizers** [60] (verified):
  - `unicode61` with `remove_diacritics 2` folds Latin diacritics only.
  - `porter` rewrites ASCII suffixes only.
  - `trigram` matches substrings, gives nothing for queries under 3 characters,
    and makes indexes 2–3× larger [assumed].
- **For a mixed English and Urdu library**, normalise in JS on both index and
  query [assumed]:
  - apply NFKC;
  - strip harakat U+064B–U+065F, U+0670, tatweel U+0640 and ZWNJ/ZWJ;
  - map ي→ی and ك→ک.
- **Ranking and snippets:** `bm25()` takes column weights (lower is better), and
  `snippet()` takes at most 64 tokens [60] (verified).
- **Safe MATCH:** quote each token and double any embedded `"`, then add `*` to
  the last token for search-as-you-type [60] (verified).
- **Prefix indexes:** Mozilla measured 10,000 items and chose no prefix index,
  with a worst-case query of about 1 ms [61] (verified).
- **Index size:** about 45% of the text at `detail=full` [60] (verified).

These go to the Library as recommendations (SPEC §5.1). They are not a change to
its contract.

### 9.2 Import formats

All verified from importer code and fixtures [3, 4, 13, 16]:

- **Pocket:** a zip or CSV with `title,url,time_added[,cursor],tags,status`.
- **Instapaper CSV:** `URL,Title,Selection,Folder,Timestamp,Tags`. Older files
  have only `URL,Title,Selection,Folder`.
- **Netscape HTML:** `<DT><A HREF ADD_DATE TAGS TOREAD>`.
- **wallabag JSON:** entries with `title, url, content, tags, is_archived,
  created_at, …`.
- **Omnivore zip:** see §2.1.

**Recommendation:** Pocket, Instapaper and Netscape first. They carry URLs only,
so imports become pending items fetched on demand.

---

## 10. Host fit: PDF Editor

**Verdict:** a good host. The Reader reuses most of what the app already has.

| Reused                                                                                                  | Verified in repo                         |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| react-native-webview 13.15.0, expo-file-system ~19.0.24, expo-sharing, expo-document-picker, expo-asset | `apps/pdf-editor-mobile/package.json`    |
| `INTERNET` permission, `pdfeditor://` scheme, `singleTask` activity                                     | `android/app/src/main/AndroidManifest.xml` |
| PDF.js 3.11.174 (PDF read-aloud), the editor ("Save as PDF" opens there)                                | `packages/pdf-editor-engine`             |
| The Library and `items_fts` (Scan Phase 1)                                                              | Scan docs (in progress)                  |
| `pdf` brand tokens and the Atkinson fonts                                                               | `packages/ui`                            |

**APK size** (assumed: sums of package sizes; the current universal APK is
82.9 MB with four ABIs):

| Part                           | Size                                 |
| ------------------------------ | ------------------------------------ |
| Readability, DOMPurify, fflate | about 150 KB of JS                   |
| expo-print                     | about 0.1 MB native                  |
| androidx.media                 | 344 KB                               |
| Our module                     | about 0.1 MB                         |
| **Total**                      | **about +0.7 MB (under 1%)**         |

Media3 instead would add roughly 4 MB.

**Permissions added:** `FOREGROUND_SERVICE` and
`FOREGROUND_SERVICE_MEDIA_PLAYBACK` (normal), `WAKE_LOCK` (normal, held only
while speaking), a `<queries>` entry for `TTS_SERVICE`, and a `SEND text/plain`
intent filter. No runtime prompts.

**Identity issues:**

- The display name and brand name are both "PDF Editor", which no longer
  describes an app that saves web pages and reads aloud (PRD Q1).
- The iOS bundle id is `com.anonymous.pdf-editor` (`app.json`) and must become
  `com.haroon.pdfeditor` before any iOS build.
- The Android package `com.haroon.pdfeditor` must not change, or the Store
  treats the app as a new one and the Library is lost.

---

## 11. Sources

1. https://blog.mozilla.org/en/mozilla/building-whats-next/
2. https://getpocket.com/farewell
3. https://codeberg.org/readeck/readeck/src/branch/main/internal/bookmarks/importer/pocket_file.go (and `fixtures/`)
4. https://github.com/wallabag/wallabag (`tests/fixtures/Import/*`, `src/Entity/Entry.php`, `src/Helper/EntriesExport.php`)
5. https://elevenlabs.io/blog/omnivore-joins-elevenlabs
6. https://techcrunch.com/2024/10/29/elevenlabs-has-hired-the-team-behind-omnivore-a-reader-app/ ; https://heise.de/-9998733
7. https://github.com/omnivore-app/omnivore (README, `packages/api/src/jobs/export.ts`)
8. https://www.instapaper.com/premium
9. https://www.getmatter.com/patron ; https://www.getmatter.com/pocket ; https://apps.apple.com/us/app/matter-reader/id1501592184
10. https://readwise.io/pricing ; https://docs.readwise.io/reader/docs/faqs/exporting
11. https://github.com/fivefilters/ftr-site-config (LICENSE)
12. https://codeberg.org/readeck/readeck (README, docs, `internal/bookmarks/converter/epub.go`, `pkg/epub/epub.go`)
13. https://github.com/karakeep-app/karakeep (`packages/shared/import-export/parsers.ts`)
14. https://github.com/go-shiori/shiori ; https://github.com/sissbruecker/linkding (`bookmarks/services/exporter.py`)
15. https://github.com/sak96/read_later ; https://search.f-droid.org/?q=read+it+later
16. https://learn.microsoft.com/en-us/previous-versions/windows/internet-explorer/ie-developer/platform-apis/aa753582(v=vs.85)
17. https://blog.instapaper.com/
18. https://github.com/mozilla/readability (README, CHANGELOG, `Readability.js` 0.6.0 tarball)
19. https://github.com/kepano/defuddle (0.19.6 tarball) ; https://github.com/postlight/parser
20. https://github.com/scrapinghub/article-extraction-benchmark
21. https://trafilatura.readthedocs.io/en/latest/evaluation.html
22. https://github.com/extractus/article-extractor/issues/131
23. https://github.com/dankito/Readability4J
24. https://github.com/WebReflection/linkedom/issues/352
25. https://github.com/cure53/DOMPurify (3.4.17 tarball, security advisories)
26. `node_modules/.pnpm/react-native-webview@13.15.0*/…/RNCWebView.java`, `RNCWebViewManagerImpl.kt`, `RNCWebViewClient.java` (local)
27. https://github.com/aosp-mirror/platform_frameworks_base (`core/java/android/webkit/WebView.java`, `WebSettings.java`, `CookieManager.java`)
28. https://android-developers.googleblog.com/2024/12/user-agent-reduction-on-android-webview.html
29. https://github.com/gildas-lormeau/SingleFile (`config.js`)
30. https://chromium.googlesource.com/chromium/src/+/HEAD/components/browser_ui/share/android/java/src/org/chromium/components/browser_ui/share/ShareHelper.java (and `ShareParams.java`)
31. https://github.com/achorein/expo-share-intent (5.1.1 tarball) ; `npm view react-native-share-menu`, `react-native-receive-sharing-intent`
32. `node_modules/.pnpm/react-native@0.81.5*/…/IntentModule.kt`, `Libraries/Blob/URL.js` (local)
33. https://github.com/sindresorhus/normalize-url ; https://github.com/brave/brave-core/blob/master/components/query_filter/browser/test_support/query_filter_test_helper.cc
34. `node_modules/.pnpm/expo-file-system@19.0.24*/…/ExpoFileSystem.types.ts`, `FileSystemModule.kt` (local)
35. https://github.com/wallabag/wallabag (`DownloadImages.php`) ; https://github.com/wallabag/android-app (`QueueHelper.java`)
36. https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/http-equiv
37. https://raw.githubusercontent.com/cavi-au/Consent-O-Matic/master/LICENSE ; https://easylist.to/pages/licence.html
38. https://github.com/expo/expo/blob/sdk-54/packages/expo-speech/android/src/main/java/expo/modules/speech/SpeechModule.kt (and the 14.0.8 tarball)
39. `/opt/homebrew/share/android-commandlinetools/platforms/android-36/android.jar` and `data/api-versions.xml` (local; `javap` run for this doc)
40. https://github.com/aosp-mirror/platform_frameworks_base/tree/main/core/java/android/speech/tts
41. https://dl.google.com/android/maven2/androidx/media3/media3-session/maven-metadata.xml ; https://developer.android.com/media/media3/session/background-playback
42. https://developer.android.com/develop/background-work/services/fgs/service-types ; https://developer.android.com/about/versions/15/behavior-changes-15 ; https://developer.android.com/about/versions/16/behavior-changes-all ; https://developer.android.com/develop/ui/views/notifications/notification-permission
43. https://dontkillmyapp.com/xiaomi
44. https://gitlab.com/fdroid/fdroiddata/-/tree/master/metadata ; https://f-droid.org/en/categories/text-to-speech/
45. https://github.com/woheller69/ttsEngine ; https://github.com/espeak-ng/espeak-ng ; https://github.com/RHVoice/RHVoice
46. https://github.com/readium/kotlin-toolkit ; https://github.com/foobnix/LibreraReader ; https://github.com/readest/readest
47. https://github.com/facebook/hermes/tree/e0fc67142ec0763c6b6153ca2bf96df815539782 (`lib/Platform/Intl`, `doc/IntlAPIs.md`)
48. https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer ; https://developer.apple.com/forums/thread/849627
49. https://developer.android.com/media/platform/supported-formats
50. `node_modules/.pnpm/pdfjs-dist@3.11.174*/` (local)
51. https://www.w3.org/TR/epub-33/
52. https://raw.githubusercontent.com/w3c/epubcheck/main/src/main/resources/com/adobe/epubcheck/messages/MessageBundle.properties
53. fflate 0.8.3 tarball (`esm/browser.js`, README) ; https://github.com/facebook/hermes/issues/948
54. `npm view` for jszip 3.10.2, client-zip 2.5.1, @zip.js/zip.js 2.24.0, epub-gen 0.1.0, epub-gen-memory 1.1.2, @lesjoursfr/html-to-epub 6.2.2, nodepub 5.1.1
55. https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html ; https://w3c.github.io/DOM-Parsing/
56. expo-print 15.0.8 tarball (`android/src/main/java/expo/modules/print/*.kt`, `build/Print.types.d.ts`) ; https://docs.expo.dev/versions/v54.0.0/sdk/print/
57. https://chromium.googlesource.com/chromium/src/+/61.0.3118.2/printing/pdf_metafile_skia.cc ; https://skia.org/docs/user/sample/pdf/
58. `node_modules/.pnpm/pdf-lib@1.17.1/…/CustomFontEmbedder.js` (local)
59. `node_modules/.pnpm/expo-sqlite@16.0.10*/node_modules/expo-sqlite/vendor/sqlite3/sqlite3.h`, `android/build.gradle`, `ios/ExpoSQLite.podspec` (local)
60. https://www.sqlite.org/fts5.html
61. https://searchfox.org/mozilla-mobile/source/application-services/docs/adr/0008-fts-prefix-config.md
62. https://raw.githubusercontent.com/wallabag/wallabag/master/src/Helper/EntriesExport.php
63. `node_modules/.pnpm/expo@54.0.38*/node_modules/expo/bundledNativeModules.json` (local)
64. `node_modules/.pnpm/react-native@0.81.5*/node_modules/react-native/gradle/libs.versions.toml` (local)
65. https://bugzilla.mozilla.org/show_bug.cgi?id=1153024

**Not checked on the phone:** any of the following:

- the Xiaomi browser's share payload;
- `file://` images under `loadDataWithBaseURL`;
- whether the page's CSP applies to `evaluateJavascript`;
- the default TTS engine, and whether it fires `onRangeStart`;
- HyperOS survival of the foreground service;
- selectable text in expo-print output;
- FTS speed on 10,000 articles.

Each one is a named check in the phase that first depends on it (SPEC §16).
