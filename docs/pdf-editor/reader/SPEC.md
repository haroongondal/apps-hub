# Technical specification: Reader

Written 2026-10-30.

- **Requirements:** `docs/pdf-editor/reader/PRD.md`, referred to below as FR-n,
  NFR-n and AC-n.
- **Evidence:** `docs/pdf-editor/reader/RESEARCH.md`, referred to below as R§n.
- **Prerequisite:** the shared Library from Scan Phase 1
  (`docs/pdf-editor/scan/SPEC.md`, `docs/pdf-editor/scan/PROMPTS.md` Phase 1).
  This spec doesn't change the Library's contract (§5).

## 1. Stack

### 1.1 What is already there

| Layer         | Choice                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App           | `apps/pdf-editor-mobile`: Expo SDK 54, React Native 0.81.5 (Hermes, new architecture), expo-router, TypeScript 5.9 (erasable syntax only, `.ts` import extensions)                                           |
| UI            | `@apps-hub/ui`, `<ThemeProvider brand="pdf">` in `app/_layout.tsx`, Ionicons from `@expo/vector-icons` as in `app/editor.tsx`                                                                                  |
| Web content   | react-native-webview 13.15.0                                                                                                                                                                                 |
| Files, sharing | expo-file-system ~19.0.24 (`File`, `Directory`, `File.downloadFileAsync`), expo-sharing ~14.0, expo-document-picker, expo-asset                                                                              |
| Database      | expo-sqlite 16.0.10 (SQLite 3.50.3, FTS5 on), opened by the Library (Scan Phase 1)                                                                                                                             |
| Domain logic  | Pure TypeScript in `packages/*`, behind injected ports, tested with `node --test`                                                                                                                             |
| Native        | An Expo local module in `apps/pdf-editor-mobile/modules/*`. Kotlin now, Swift in Phase 8. Pure Kotlin core tested with Gradle JVM tests, following Deputy's layout (`apps/deputy/modules/deputy-agent`) |
| PDF           | PDF.js 3.11.174 + pdf-lib 1.17.1 in `packages/pdf-editor-engine`                                                                                                                                              |

### 1.2 New dependency proposals (approved by the owner on 2026-10-31, PRD Q6)

Licences were checked in each package's repo or tarball on 2026-10-30
(R§3, R§5, R§7, R§8).

| Name                         | Version | Licence                  | Size impact                                                                                                   | Where and why                                                                                    | Alternatives considered                                                                                                                 |
| ---------------------------- | ------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `@mozilla/readability`       | 0.6.0   | Apache-2.0               | 90 KB raw, inlined into the capture script asset                                                               | `packages/reader-core`, build input. Article extraction, F1 0.947 (R§3.1)                         | Defuddle 0.19.6 (MIT, 3.7× larger, no benchmark); Readability4J (stale)                                                                |
| `dompurify`                  | 3.4.17  | MPL-2.0 OR Apache-2.0    | 30 KB minified, inlined into the capture and reader scripts                                                    | `packages/reader-core`, build input. Sanitising in the WebView (R§5.2)                            | Our own allowlist (riskier); sanitize-html (Node-only parser)                                                                           |
| `fflate`                     | 0.8.3   | MIT                      | 33 KB minified (12.6 KB gzipped) in the JS bundle                                                             | `packages/reader-core`, runtime. EPUB zip (`zipSync`) and import unzip (R§7.2)                     | JSZip (2.3× larger); zip.js (adds an extra field to `mimetype`); client-zip (needs Streams)                                               |
| `expo-print`                 | ~15.0.8 | MIT                      | Small Expo module (about 0.1 MB, assumed)                                                                     | App. HTML to PDF for "Save as PDF" (R§7.3)                                                        | A Kotlin print function in our module (about 150 lines; the fallback); pdf-lib with our own layout (weeks)                              |
| `androidx.media:media`       | 1.7.0   | Apache-2.0               | 344 KB AAR, no Guava                                                                                          | `modules/reader-speech`. `MediaSessionCompat` and `MediaStyle` for lock-screen and headset controls (R§8.4) | Media3 1.11.1 (about +4 MB with Guava; Kotlin 2.2 stdlib against RN's 2.1.20)                                                     |
| `playwright-core` (dev only) | 1.49.1  | Apache-2.0               | None in the APK; already in the lockfile through `apps/pdf-editor-desktop`                                    | `packages/reader-core` devDependency for `test:web`                                               | None; reuses the desktop app's pattern                                                                                                  |

**Dev tool, not a dependency:** epubcheck 5.x (BSD-3-Clause, assumed), run with
the JDK 21 already installed for Android builds. It is downloaded to a scratch
directory and never committed.

**Rejected:**

- `expo-speech`: no Android pause, no background, no offline-voice flag (R§8.1).
- `expo-share-intent`: an intent filter and 15 lines of Kotlin do the same job
  (R§4.2).
- linkedom: DOMPurify can't run on it in Hermes (R§3.3).
- Media3: size (R§8.4).
- Any consent-rule list: licences, and no need in v1 (R§3.4).

**Size:** about +0.7 MB, measured against the 82.9 MB universal APK (R§10,
NFR-5); the app is arm64 only from Scan Phase 2.

## 2. Repository layout

```
packages/reader-core/                 @apps-hub/reader-core: pure TS, no React/RN imports
  package.json                        test (lists files), test:web, typecheck, build
  build.mjs                           writes apps/pdf-editor-mobile/assets/reader/* (gitignored)
  src/
    index.ts
    url.ts                            canonicalUrl, parseShared, isFetchableUrl            (P1)
    schema.ts                         READER_STEPS: the 'reader' migration track            (P1)
    store.ts                          ArticleStore over the Library's SQL port              (P1)
    capture.ts                        CaptureResult type, validateCaptureResult, saveCapture (P1)
    images.ts                         sniffImage, planDownloads, dropImages, renameToken    (P1)
    text.ts                           wordCount, readingMinutes, textHash                   (P1)
    queue.ts                          CaptureQueue: pending → ready/partial/failed          (P3)
    shell.ts                          buildReaderHtml, readerCsp, jsonForScript             (P2)
    settings.ts                       ReaderSettings, SpeechSettings, defaults, clamps      (P2)
    highlights.ts                     HighlightStore, reanchor (P2b); markHighlights, highlightsSection (P4)
    epub.ts                           buildEpub                                             (P4)
    print.ts                          buildPrintHtml                                        (P4)
    speech.ts                         splitSentences, buildUtterances                       (P5)
    pdftext.ts                        pdfItemsToBlocks                                      (P6)
    import/csv.ts pocket.ts instapaper.ts netscape.ts                                       (P7)
    __tests__/*.test.ts
  web/
    capture.js                        classic script for the capture WebView                (P1)
    reader.js                         classic script for the reader page                    (P2)
    pdftext.js                        PDF.js text extraction page script                    (P6)
  test/
    web.mjs                           Chrome smoke over fixtures; skips without Chrome
    epubcheck.mjs                     runs epubcheck on built samples; skips without $EPUBCHECK_JAR
    fixtures/                         article.html lazy.html spa.html hostile.html amp.html rtl.html

apps/pdf-editor-mobile/
  app/_layout.tsx                     + <CaptureHost/>, + routes save and read/[id]
  app/save.tsx                        Save a web page                                       (P1)
  app/read/[id].tsx                   reader + player                                        (P2, P5)
  src/reader/
    adapters.ts                       expo-file-system and downloader ports for reader-core (P1)
    CaptureHost.tsx                   the one capture WebView, mounted while there is work  (P1)
    useArticle.ts, useReaderSettings.ts, useSpeech.ts, exportEpub.ts, savePdf.ts
  modules/reader-speech/              Expo local module "ReaderSpeech"                      (P5)
    package.json, expo-module.config.json, src/index.ts
    android/build.gradle
    android/src/main/AndroidManifest.xml
    android/src/main/java/expo/modules/readerspeech/
      ReaderSpeechModule.kt
      android/SpeechService.kt        foreground service, TextToSpeech, session, focus
      android/SpeechHub.kt            process singleton between module and service
      core/SpeechQueue.kt             pure Kotlin, JVM-tested
      core/VoicePicker.kt             pure Kotlin, JVM-tested
    android/src/test/java/expo/modules/readerspeech/core/SpeechQueueTest.kt, VoicePickerTest.kt
    ios/ (Phase 8)
  android/app/src/main/AndroidManifest.xml                 + SEND text/plain filter         (P1)
  android/app/src/main/java/com/haroon/pdfeditor/MainActivity.kt  + share rewrite           (P1)
  assets/reader/                      generated by reader-core/build.mjs, gitignored

packages/ui/src/tokens.ts             + readerPalette('sepia'), covered by the token test     (P2)
tools/release/src/apps.ts             pdf-editor prepare: + reader-core build                  (P1)
.gitignore                            + /apps/pdf-editor-mobile/assets/reader/                 (P1)
```

The app loads the generated asset with an untyped `require(...)`, the way
`app/editor.tsx` loads `editor.html`. `pnpm typecheck` and `pnpm test`
therefore work without running the build first.

## 3. Data model

### 3.1 Library tables we use (owned by Scan, unchanged)

`items` (kind `'article'`), `folders`, `tags`, `item_tags` and `items_fts` (title
plus body text). An article's files live under the app's document directory at
`library/<id>/`.

### 3.2 Reader tables

Every row is keyed by `items.id`, with the same column type the Library uses.

```sql
-- 'reader' track, step 1
CREATE TABLE IF NOT EXISTS articles (
  item_id        TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,                 -- as shared, typed or imported
  canonical_url  TEXT NOT NULL,                 -- dedupe key, url.ts canonicalUrl()
  final_url      TEXT,                          -- after redirects
  site           TEXT,
  byline         TEXT,
  lang           TEXT,                          -- BCP 47, or NULL
  dir            TEXT CHECK (dir IN ('ltr', 'rtl')),
  excerpt        TEXT,
  published_at   INTEGER,                       -- unix ms
  word_count     INTEGER NOT NULL DEFAULT 0,
  image_count    INTEGER NOT NULL DEFAULT 0,
  images_dropped INTEGER NOT NULL DEFAULT 0,    -- over a cap or failed (NFR-4)
  status         TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'partial', 'failed')),
  attempts       INTEGER NOT NULL DEFAULT 0,    -- failed attempts; offline doesn't count
  error          TEXT,                          -- last failure, in plain words
  extractor      TEXT,                          -- e.g. 'readability@0.6.0'
  saved_at       INTEGER NOT NULL,              -- first save, unix ms
  fetched_at     INTEGER,                       -- last good extraction
  finished_at    INTEGER                        -- FR-8
);
CREATE UNIQUE INDEX IF NOT EXISTS articles_canonical ON articles(canonical_url);
CREATE INDEX IF NOT EXISTS articles_status ON articles(status);

-- reading and listening position, for any item kind (FR-7, FR-14, FR-15)
CREATE TABLE IF NOT EXISTS reading_state (
  item_id      TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  block        INTEGER NOT NULL DEFAULT 0,       -- first visible block
  ratio        REAL NOT NULL DEFAULT 0,          -- 0..1 of the scroll height
  listen_index INTEGER,                          -- utterance index
  listen_hash  TEXT,                             -- textHash of the text the index refers to
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reader_prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL); -- JSON values
```

```sql
-- 'reader' track, step 2 (Phase 2b): highlights and notes on articles (FR-18, §8.5)
CREATE TABLE IF NOT EXISTS highlights (
  id           TEXT PRIMARY KEY,                -- ITEM_ID shape
  item_id      TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  start_block  INTEGER NOT NULL,                -- data-b where it starts
  start_offset INTEGER NOT NULL,                -- in that block's collapsed text (text.json)
  end_block    INTEGER NOT NULL,                -- data-b where it ends, >= start_block
  end_offset   INTEGER NOT NULL,                -- exclusive
  quote        TEXT NOT NULL,                   -- the text covered, blocks joined by "\n"; at most 5,000 chars
  note         TEXT,                            -- plain text, at most 2,000 chars
  orphaned     INTEGER NOT NULL DEFAULT 0,      -- 1 when a Refresh couldn't find the quote
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS highlights_item ON highlights(item_id, start_block, start_offset);
```

**Migrations.**

- The Reader uses the Library's migration tracks (Scan SPEC §4.4).
  `schema.ts` exports `READER_STEPS`, an append-only list of SQL strings, and
  the app runs `migrate(library.db, 'reader', READER_STEPS)` after
  `Library.open()` has run the `library` track.
- The version lives in `schema_tracks` (track `reader`), so there is no
  `reader_meta` table. Never edit or reorder a shipped step.
- Each step is idempotent (`IF NOT EXISTS`).

**Deletes.** Deleting an item is the Library's job. The Reader's rows go with it
through `ON DELETE CASCADE`. The Library sets `PRAGMA foreign_keys = ON` on its
single connection and never uses `withExclusiveTransactionAsync`, which opens a
second connection with foreign keys off (Scan SPEC §4.1). Reader writes go
through the same `SqlPort` (`library.db`), never through a connection of its own.

### 3.3 Files

```
library/<id>/content.xhtml    sanitised article: one <article xmlns="http://www.w3.org/1999/xhtml">,
                              blocks tagged data-b="0..n-1", images as src="img/0001.jpg"
library/<id>/text.json        { "version": 1, "lang": "en" | null, "blocks": [{ "text": "…", "page"?: 1 }] }
library/<id>/img/0001.jpg     …up to 0060, extension from the sniffed bytes
```

- `content.xhtml` is the only stored copy of the article. The reader renders it
  as HTML, and EPUB and PDF export reuse it (R§7.2).
- `text.json` is the read-aloud source for articles. Its block `i` is the text
  of the element tagged `data-b="i"`, with whitespace collapsed. The Reader also
  writes it as a cache in PDF items, never in scans (§11).
- `size_bytes` on the item is the sum of these files.
- A refresh writes into `library/<id>/.next/` and then swaps it into place, so a
  crash leaves the old copy whole.

### 3.4 Preferences

- `reader_prefs['reader']` = `ReaderSettings`
- `reader_prefs['speech']` = `SpeechSettings`

```ts
export type ReaderFont = 'atkinson' | 'serif' | 'sans' | 'mono';
export type ReaderTheme = 'system' | 'light' | 'dark' | 'sepia';
export interface ReaderSettings {
  font: ReaderFont;              // default 'atkinson'
  size: number;                  // 14..28, step 2, default 18
  spacing: 'compact' | 'normal' | 'loose';   // line-height 1.45 / 1.6 / 1.8
  margins: 'narrow' | 'normal' | 'wide';     // 12 / 20 / 32 px
  theme: ReaderTheme;            // default 'system'
}
export interface SpeechSettings {
  rate: number;                  // 0.5..3.0, step 0.1, default 1.0
  pitch: number;                 // 0.5..2.0, step 0.1, default 1.0
  voiceId: string | null;        // null = best eligible voice for the language
  engine: string | null;         // null = system default engine
  allowNetworkVoices: boolean;   // default false (safety rule 5)
}
```

## 4. Capture pipeline

```
typed URL (FR-1) ─┐
share intent (FR-2) ─┤→ parseShared / canonicalUrl → dedupe? ──yes──→ open existing (FR-5)
import (FR-17) ─────┘                                 │no
                                                      ▼
                       Library item (kind article) + articles row, status 'pending'   ← within 1 s (AC-3)
                                                      ▼
                     CaptureQueue (P3; in P1 the Save screen drives one item directly)
                                                      ▼
                CaptureHost WebView loads the URL → onLoadEnd → inject CAPTURE_JS + nonce
                                                      ▼
   capture.js: lazy-load scroll → fix img src → quiet wait → Readability → DOMPurify
               → clean DOM → tag blocks → tokens for images → XMLSerializer → self-check
                                                      ▼  postMessage(JSON) — untrusted
            validateCaptureResult (nonce, shape, sizes, http(s) image URLs)   (safety rule 3)
                                                      ▼
   download images (4 parallel, 20 s, 5 MB each, 25 MB total, Referer, no-AVIF Accept)
   → sniff bytes → rename tokens → dropImages for failures and overflow
                                                      ▼
   write .next/ (content.xhtml, text.json, img/) → swap → update item (title, size)
   → Library search text = blocks joined by "\n" → articles row 'ready' or 'partial'
```

### 4.1 Steps in the app (reader-core `saveCapture`, ports injected)

1. **Input.** `parseShared(text, title)` returns the last `http(s)` URL in the
   text, with trailing `).,;:!?]"'` trimmed, plus a title. The title comes from
   `EXTRA_TITLE`, then `EXTRA_SUBJECT`, and is dropped if it equals the URL.
   - Typed input goes through `isFetchableUrl`, which allows only `http:` and
     `https:` with a host (safety rule 4).
2. **Dedupe.** `canonicalUrl(url)` (§6) is looked up in `articles_canonical`.
   - On a hit, the Save screen shows the existing item (FR-5).
3. **Pending item.** Create the Library item with kind `article`, title = shared
   title or host, size 0, page_count NULL. Insert the `articles` row with status
   `pending`. This happens before any network work (FR-4).
4. **Capture.** The `CaptureHost` (§4.3) loads `url` and injects `CAPTURE_JS`
   with a fresh 128-bit nonce after `onLoadEnd`.
   - Hard limits: a 30 s page load and 45 s in total (NFR-1). Hitting one counts
     as a failed attempt.
   - Network errors (`net::ERR_INTERNET_DISCONNECTED`,
     `net::ERR_NAME_NOT_RESOLVED`, `ERR_ADDRESS_UNREACHABLE`) leave the item
     pending and don't count (FR-4).
   - `onRenderProcessGone` counts as a failed attempt.
5. **Validate.** `validateCaptureResult(msg, nonce)` rejects anything that breaks
   one of these limits:

   | Field           | Limit                                                                       |
   | --------------- | --------------------------------------------------------------------------- |
   | `xhtml`         | ≤ 5 MB                                                                      |
   | `blocks`        | ≤ 20,000 entries, each ≤ 50,000 chars                                       |
   | `images`        | ≤ 60 entries                                                                |
   | Image tokens    | must match `^img/\d{4}\.(jpg\|png\|gif\|webp\|svg\|avif)$`                   |
   | Image URLs      | `http(s)` only                                                              |
   | `title`         | ≤ 1,000 chars                                                               |
   | `lang`          | must match `^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$` (otherwise null)           |
   | `dir`           | `ltr`, `rtl` or null                                                        |

   A message without the nonce is ignored.
6. **Images.** `planDownloads(images, caps)` keeps at most 60. The `Downloader`
   port then fetches them:
   - 4 at a time, each with a 20 s timeout;
   - headers `Referer: finalUrl` and
     `Accept: image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.8,*/*;q=0.5`
     (no AVIF, so the EPUB doesn't need conversion);
   - after each download, check the size, and delete files over 5 MB or past
     25 MB in total.

   `sniffImage(bytes)` reads the magic bytes for JPEG, PNG, GIF, WebP, AVIF and
   SVG (`<svg` or `<?xml` within the first 1 KB). A mismatched extension is
   fixed with `renameToken(xhtml, from, to)`, which replaces the exact quoted
   string `"img/0003.jpg"`. Failed, unknown and over-cap images go through
   `dropImages(xhtml, tokens)`, which removes their `<img …/>` elements. Both
   functions rely on the attribute form XMLSerializer emits (`src="…"`, double
   quotes) and are tested on its output.
7. **Store.**
   - Write `content.xhtml`, `text.json` and `img/` into `.next/`, then swap.
   - Update the item's title and `size_bytes`, and set the Library search text to
     `blocks.join('\n')`.
   - Set the `articles` row:
     - status `partial` if `!readerable || textLength < 500`, otherwise `ready`;
     - `word_count`, `site`, `byline`, `lang`, `dir`, `excerpt`, `published_at`;
     - `extractor = 'readability@0.6.0'`, and `fetched_at`.
8. **Canonical after extraction.**
   - If the page's own canonical (same host, ignoring `www.`) gives a different
     `canonicalUrl` and that one is already saved, delete the new item and open
     the existing one (FR-5).
   - Otherwise store the page's canonical.

### 4.2 The capture script (`web/capture.js`, runs in the page)

It is a classic script. `build.mjs` concatenates Readability.js 0.6.0,
`isProbablyReaderable`, DOMPurify 3.4.17 and this file, inside one IIFE so the
nonce stays in a closure. The steps, in order:

1. Run once per nonce. Keep a reference to `window.ReactNativeWebView.postMessage`
   taken at injection time.
2. **Lazy loading.** Scroll by one viewport height every 150 ms to the bottom
   (at most 40 steps), then back to the top.
3. **Fix images.**
   - `data-src`, `data-lazy-src`, `data-original` and `data-srcset` (first URL)
     become `src` when `src` is empty or a placeholder.
   - Otherwise set `src = img.currentSrc` when that is non-empty.
   - Remove `srcset`, `sizes` and `loading`. Unwrap `<picture>` to its `<img>`.
4. **Quiet wait.** Wait until a `MutationObserver` sees no change for 1,000 ms,
   with a cap of 8 s.
5. **Canonical.** Take `link[rel=canonical]`, or else `meta[property="og:url"]`,
   resolved against `location.href`.
6. **Extract.**
   - `readerable = isProbablyReaderable(document)`.
   - `article = new Readability(document.cloneNode(true), { charThreshold: 500 }).parse()`.
   - `null` posts `{ ok: false, reason: 'empty' }`.
7. **Sanitise.** `DOMPurify.sanitize(article.content, CAPTURE_PURIFY)` returns a
   string; never use `RETURN_DOM` or `IN_PLACE` (R§5.2).

   ```js
   const CAPTURE_PURIFY = {
     USE_PROFILES: { html: true },
     FORBID_TAGS: ['style', 'form', 'input', 'button', 'select', 'textarea', 'template',
                   'dialog', 'video', 'audio', 'source', 'picture', 'iframe', 'object', 'embed'],
     FORBID_ATTR: ['style', 'srcset', 'sizes', 'class', 'id', 'target', 'loading'],
     ALLOW_DATA_ATTR: false,
     ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
   };
   ```

   Ids are forbidden, so footnote links (`href="#fn1"`) lose their targets.
   The script unwraps those `<a>` elements, which keeps their text and avoids
   epubcheck RSC-012. Phase 1 can relax this to keep `id` with a per-article
   prefix if footnotes matter in practice.
8. **Clean the DOM.** Parse the string into
   `document.implementation.createHTMLDocument('')`, then:
   - remove comments;
   - remove control characters U+0000–U+0008, U+000B, U+000C and U+000E–U+001F
     from text and attributes;
   - drop attributes whose names aren't XML names;
   - drop `<img>` elements whose `src` isn't `http(s)`, including `data:`;
   - give the first 60 `<img>` elements the tokens `img/0001.<ext>` …, with the
     extension taken from the URL path (default `jpg`), recording `{token, url}`;
   - drop the rest of the images and count them.
9. **Tag blocks.**
   - Walk elements in document order. Every `p, h1–h6, li, blockquote, pre,
     figcaption, dt, dd, td, th` that has non-empty text and no block-level
     descendant gets `data-b="<i>"`.
   - Its text, with whitespace collapsed to single spaces, becomes `blocks[i]`.
10. **Serialise.**
    - Wrap the result in `<article lang dir>` and run it through
      `new XMLSerializer().serializeToString(article)`.
    - Reparse the output with `DOMParser(…, 'application/xhtml+xml')`. If that
      gives a `parsererror`, post `{ ok: false, reason: 'xhtml' }`.
11. **Post** `{ type: 'captured', nonce, ok: true, result }` with
    `CaptureResult`:

    ```ts
    export interface CaptureResult {
      title: string; byline: string | null; siteName: string | null;
      lang: string | null; dir: 'ltr' | 'rtl' | null; excerpt: string | null;
      publishedTime: string | null; canonical: string | null; finalUrl: string;
      readerable: boolean; textLength: number; droppedImages: number;
      xhtml: string;                               // <article xmlns=…>…</article>
      blocks: string[];                            // blocks[i] = text of data-b="i"
      images: { token: string; url: string }[];
    }
    ```

### 4.3 CaptureHost

There is one capture WebView for the whole app, rendered by `<CaptureHost/>` in
`app/_layout.tsx` while there is work. A React context exposes
`capture(url): Promise<CaptureOutcome>` and `show(visible)`.

**WebView props:**

| Prop                                          | Value / behaviour                                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `source`                                      | `{ uri }`                                                                                                  |
| `javaScriptEnabled`                           | default on                                                                                                 |
| `setSupportMultipleWindows`                   | `false`                                                                                                    |
| `mixedContentMode`                            | `'never'`                                                                                                  |
| `allowFileAccess`                             | `false`                                                                                                    |
| `injectedJavaScriptForMainFrameOnly`          | `true`                                                                                                     |
| `onShouldStartLoadWithRequest`                | Allows only `http:` and `https:`. Refuses `intent:`, `market:`, `file:`, `content:` and `javascript:`.     |
| `onRenderProcessGone`                         | Counts as a failed attempt                                                                                 |
| `onPermissionRequest` (media capture)         | Denied. react-native-webview 13.15.0 grants the camera at once when the app holds CAMERA (`RNCWebChromeClient.onPermissionRequest`), and Scan Phase 2 grants it first. Phase 1 patches that method (`pnpm patch react-native-webview`, then `pnpm patch-commit <dir>`) to deny audio and video capture; no WebView in the workspace uses them. Phase 1 also sets `mediaCapturePermissionGrantType="deny"`, which iOS honours and Android ignores. |
| `onMessage`                                   | Parses JSON, ignores anything without the nonce                                                            |

**Placement:**

- The WebView fills the screen behind the navigator (`StyleSheet.absoluteFill`,
  `zIndex: -1`). Lazy loaders need a real viewport (R§3.3), so it isn't sized
  to 0×0.
- `show(true)` brings it to the front with a bar holding "Save now" and
  "Cancel". "Save now" injects the capture script into the page as it is
  (FR-3).
- Phase 1 checks on the phone that a WebView behind the stack still loads and
  lays out. If it doesn't, the fallback is to keep it in front under an opaque
  progress card.

The app must stay in the foreground while capturing, because the WebView dies
with the activity (R§3.3). Pending items make leaving early safe.

### 4.4 CaptureQueue (Phase 3)

- When the app comes to the foreground (`AppState` becomes `active`) and after
  each save, the queue takes the oldest `pending` item and captures it.
- It processes one item at a time.
- A failed attempt increments `attempts`. At 3 the status becomes `failed`, with
  `error`.
- Offline errors don't count.
- "Try again" resets `attempts` to 0 and sets the status back to `pending`.
- Refresh (FR-5) captures the existing item again into `.next/`. It keeps
  `reading_state.block`; the listen index resets when `textHash` changes.

## 5. What the Reader needs from the Library

These are capabilities, not schema changes, mapped to the Library API in Scan
SPEC §4.6–§4.7 (reconciled 2026-10-31). Follow Scan SPEC §4.7's rules: never
write the Library tables directly. A missing capability is added to
`packages/library-core` as a function, with its test, without touching the
tables.

| Need                                         | Library API (Scan SPEC)                                        | Used by                     |
| -------------------------------------------- | -------------------------------------------------------------- | --------------------------- |
| The SQL port and a migration hook             | `library.db` (`SqlPort`); `migrate(library.db, 'reader', READER_STEPS)` after `Library.open` (§4.4) | §3.2 |
| Create an item of kind `article`              | `newId()`, then `createItem({ id, kind: 'article', title, folderId })`; files in `library/<id>/` (§4.5) | §4.1 step 3 |
| Update an item's title and `size_bytes`       | `updateItem(id, { title, sizeBytes })`                          | §4.1 step 7                 |
| Set an item's search body text (`items_fts`)  | `setBody(id, text)` (whole text, replaced each time)            | §4.1 step 7                 |
| Delete an item (files + rows)                 | `deleteItem(id)`, then remove `library/<id>/` (§4.5 delete order) | FR-9, §4.1 step 8         |
| List by kind, folder or tag; search with a snippet | `list({ kind: 'article', … })`, `search(text, { kind })`  | FR-9, AC-17                 |
| Add a PDF file as an item of kind `pdf`       | App helper `addPdf(uri, folderId)` in `src/library/files.ts`    | §10.2                       |
| Read a scan's OCR text and page count         | `Item.pageCount`; `ScanStore.pageTexts(itemId)` (string[] in page order, Scan Phase 3) | §11 |
| "+" sheet and filter extension points         | `src/library/add-actions.ts` (`{ key, label, icon, run }`), `src/library/open-item.ts` (route by kind) | §13 |

### 5.1 Search recommendations for the Library (from R§9.1)

The Library owns these choices. The Reader only supplies clean text. Scan SPEC
§4.3 adopted the tokenizer, the quoted-token builder, the `bm25` weights and
no prefix index. The owner put the Arabic and Urdu normalisation below in v1
(2026-10-31): Scan Phase 1 builds it as `normalizeForSearch` in `ftsQuery`,
`setBody` and the FTS title (Scan SPEC §4.3), so the Reader passes raw text.

- Tokenizer `unicode61 remove_diacritics 2`. No porter, no trigram in v1.
- Normalise indexed text and queries the same way:
  - apply NFKC;
  - strip harakat U+064B–U+065F, U+0670 and tatweel U+0640;
  - strip U+200C and U+200D;
  - map ي→ی and ك→ک.
- Build MATCH from quoted tokens: `"tok"` with any inner `"` doubled, plus `*`
  after the last token. Bind it as a parameter, and treat `fts5: syntax error`
  as "no results".
- Rank with `bm25(items_fts, 10.0, 1.0)` (title, body). Use
  `snippet(items_fts, 1, '\u0002', '\u0003', '…', 12)` and render the markers as
  `Text` spans.
- No prefix index; measure on 2,000 articles for AC-17.

## 6. URL canonicalisation (`url.ts`)

Don't rely on `URL` here: RN 0.81's `URL` has no setters, and Node's does, so
tests would lie (R§4.3). A small regex parser
`^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$` splits the parts, and
`canonicalUrl` rebuilds the string:

- **Scheme and host:** lowercase both. Drop `:80` for http and `:443` for https.
  Keep `www.` (dropping it can merge different sites); the same-site check in
  §4.1 step 8 ignores it.
- **Path:** keep its case. An empty path becomes `/`. Drop one trailing slash
  unless the path is `/`.
- **Query:**
  - Remove `utm_*`.
  - Remove the click IDs `fbclid`, `gclid`, `dclid`, `msclkid`, `wbraid`,
    `yclid`, `ttclid`, `twclid` and `srsltid`.
  - Remove the marketing parameters `mc_eid`, `_hsenc`, `__hs*`, `_gl`,
    `mtm_cid`, `pk_cid`, `oly_*`, `vero_*`, `sfmc_*` and `s_cid`.
  - Remove `igsh` and `igshid` on instagram.com, `ref_src` and `ref_url` on
    x.com and twitter.com, and `si` on youtube.com and youtu.be.
  - Sort the rest by key, keeping values as given. An empty query is dropped.
- **Fragment:** dropped, including `#:~:text=`.

Tests cover each rule plus round-trips. The test runs with `globalThis.URL`
deleted, so nothing depends on it.

## 7. Library integration

- Article rows use the Library's list row:
  - **Title:** the article title.
  - **Subtitle:** `site · 8 min · 40%`.
  - **Trailing pill** by status:

    | Status     | Pill                                             |
    | ---------- | ------------------------------------------------ |
    | pending    | `warn` "Waiting" ("Waiting for a connection" when offline) |
    | failed     | `danger` "Failed"                                 |
    | partial    | `neutral` "Partial"                               |
    | finished   | `ok` "Finished"                                   |

- The articles filter adds a `Segmented` with "To read" and "Finished" (FR-8):
  - To read: `finished_at IS NULL`, ordered by `saved_at DESC`.
  - Finished: ordered by `finished_at DESC`.
- Tapping a ready or partial article opens `/read/[id]`. A pending or failed one
  opens `/save?item=<id>`, which shows its state and "Try again".

## 8. Reader rendering

### 8.1 The page

`buildReaderHtml(input)` in `shell.ts` is pure, and its tests check every rule
below.

```ts
export interface ReaderPageInput {
  xhtml: string;                 // content.xhtml as stored
  title: string; site: string | null; byline: string | null; minutes: number; savedAt: number;
  lang: string | null; dir: 'ltr' | 'rtl' | null;
  settings: ReaderSettings; scheme: 'light' | 'dark';   // scheme resolves 'system'
  restoreBlock: number;
  nonce: string;                 // fresh per render, 128 bits
  web: { readerJs: string; purifyJs: string; fontsCss: string };  // from assets/reader/web.json
}
```

The output looks like this:

```html
<!doctype html>
<html lang="…" dir="…">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src file: data:; style-src 'unsafe-inline'; font-src data:; script-src 'nonce-N'; base-uri 'none'; form-action 'none'">
<style>/* fontsCss (Atkinson 400/600 + Mono as data: URIs) + reader CSS with variables */</style>
</head>
<body>
  <header><h1>…</h1><p class="meta">site · byline · 8 min</p></header>
  <main id="content"></main>
  <script nonce="N">/* purifyJs + readerJs; content passed as jsonForScript(xhtml) */</script>
</body>
</html>
```

- **Escaping.** Every interpolated string is HTML-escaped, except the content.
  The content goes into the script as `jsonForScript(xhtml)`: JSON with `<`,
  `>`, `&`, U+2028 and U+2029 escaped as `\uXXXX`, so `</script>` can't close
  the tag.
- **Theme variables** come from `@apps-hub/ui` tokens only: `bg`, `text`,
  `muted`, `line` and `accent` for links.
  - System uses `palette('pdf', scheme)`.
  - Light and Dark use `palette('pdf', 'light' | 'dark')`.
  - Sepia uses the new `readerPalette('sepia')` in `packages/ui/src/tokens.ts`.
    Its exact hex values are set in Phase 2 and must pass the AA test. Phase 2
    extends the `ui` token test to cover reader palettes.
- **Typography:**

  | Setting         | Values                                                                                       |
  | --------------- | -------------------------------------------------------------------------------------------- |
  | Font family     | `'Atkinson Hyperlegible Next'`, `serif`, `sans-serif` or `'Atkinson Hyperlegible Mono'`        |
  | Size            | `--fs`: 14–28 px                                                                             |
  | Line height     | `--lh`: 1.45, 1.6 or 1.8                                                                     |
  | Side margins    | `--pad`: 12, 20 or 32 px                                                                     |
  | Column width    | `max-width: 40em`, centred                                                                   |

  Images get `max-width: 100%; height: auto`. `pre` scrolls sideways in the mono
  font. Figures keep their captions.

### 8.2 The reader script (`web/reader.js`)

1. **Insert content.** Run the content through
   `DOMPurify.sanitize(content, RENDER_PURIFY)`: the capture config plus
   `ADD_ATTR: ['data-b']`, with the URI rule widened to the local image tokens
   (`/^(?:https?:|mailto:|#|img\/\d{4}\.[a-z]{3,4}$)/i`). Without that, the
   relative `img/0001.jpg` paths would be stripped. Insert the result into
   `#content`. This second pass is safety rule 1.
2. **Broken images.** An image that fails to load is hidden through
   `addEventListener('error')`. Inline handlers can't run under the CSP.
3. **Restore.** Scroll `[data-b="restoreBlock"]` to the top, then post
   `{ type: 'ready', nonce }`.
4. **Progress.** On scroll, throttled to 500 ms, find the first visible block
   by binary search over the cached block tops, which are re-measured after
   settings change. Post `{ type: 'progress', nonce, block, ratio }` at most
   once a second.
5. **Links.** A click on `a[href^="http"]` is prevented and posted as
   `{ type: 'link', nonce, url }`. `#` links scroll in the page.
6. **Highlights (Phase 2b).** Selection messages, `setHighlights` and tap
   hit-testing, as §8.5 describes.
7. **Taps while listening.** A tap on a block posts
   `{ type: 'tapBlock', nonce, block }`.
8. **Control API**, called with `injectJavaScript`:

   ```js
   window.__reader = { apply(settings), scrollToBlock(b), setListening(on),
                       highlight(block, start, end), highlightWord(block, start, end), clear(),
                       setHighlights(list), clearSelection() }   // the last two: Phase 2b, §8.5
   ```

   - `highlight` maps offsets in the block's collapsed text to DOM text nodes,
     walking text nodes with the same whitespace collapse used at capture.
   - It marks the sentence with `CSS.highlights.set('tts', new Highlight(range))`.
     If `CSS.highlights` is missing, it wraps the range in `<mark>`.
   - It scrolls the sentence into view unless the user scrolled in the last
     5 s.

### 8.3 The WebView

`app/read/[id].tsx`:

| Prop / behaviour                                          | Value                                                                                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`                                                  | `{ html, baseUrl: <file:// URI of library/<id>/> }`                                                                                            |
| `allowFileAccess`                                         | on                                                                                                                                            |
| `allowFileAccessFromFileURLs`, `allowUniversalAccessFromFileURLs` | off                                                                                                                                   |
| `setSupportMultipleWindows`                               | `false`                                                                                                                                       |
| `textZoom`                                                | `100`, as in the editor                                                                                                                       |
| `onShouldStartLoadWithRequest`                            | Allows the initial load (`baseUrl`, `about:blank`) and same-document `baseUrl#…`. Opens `http(s)` in the system browser with `Linking.openURL` and returns false. Refuses everything else (safety rule 2). |
| `onMessage`                                               | Parses JSON, requires the render nonce, then switches on `type`. Unknown types are dropped.                                                   |

- **Progress** upserts `reading_state` (block, ratio, `updated_at`). The first
  `ratio ≥ 0.97` sets `articles.finished_at` (FR-8).

### 8.4 Settings changes

- **Normal path.** A settings change calls `__reader.apply(…)`, which sets the
  CSS variables in place (AC-7, under 300 ms).
- **Fallback.** Phase 2 checks with `chrome://inspect` that `injectJavaScript`
  works under this CSP (R§5.3). If it doesn't, a change rebuilds the page with
  `restoreBlock` set to the current block. That costs one render, about 1 s.
  Every other `__reader` call would need the same treatment, so Phase 2 must
  settle this before Phase 2b (`setHighlights`, `clearSelection`) and Phase 5
  (`highlight`) rely on it.

### 8.5 Highlights and notes (Phase 2b, FR-18)

The owner put these in v1 on 2026-10-31. Articles only.

**Anchors.** A highlight is two points, (block, offset), in the collapsed block
text that `text.json` stores: the same coordinates the TTS `highlight` uses.
`content.xhtml` changes only through Refresh, so anchors hold between refreshes.

**In the page (`reader.js`):**

- On `selectionchange`, debounced 250 ms, a non-empty selection inside
  `#content` is turned into anchors by walking text nodes with the capture's
  whitespace collapse (the inverse of `highlight`'s mapping). It is posted as
  `{ type: 'selection', nonce, startBlock, startOffset, endBlock, endOffset, quote }`.
  An empty selection posts `{ type: 'selection', nonce, clear: true }`. An end
  outside any `data-b` block snaps inward to the nearest block.
- `setHighlights(list)` takes
  `{ id, startBlock, startOffset, endBlock, endOffset, noted }[]`, builds one
  `Range` each, and registers them as `CSS.highlights.set('user', …)`, with noted
  ones in `'user-note'`. Without `CSS.highlights` it wraps each text node in
  `<mark data-h="id">`, as the TTS fallback does. `clearSelection()` empties the
  selection after "Highlight".
- A tap while not listening runs `caretPositionFromPoint` (or
  `caretRangeFromPoint`) and tests each highlight's range with `isPointInRange`.
  A hit posts `{ type: 'tapHighlight', nonce, id }`. While listening, taps stay
  `tapBlock`.
- CSS: `::highlight(user) { background: var(--hl) }` and
  `::highlight(user-note) { background: var(--hl); text-decoration: underline var(--accent) }`.
  `--hl` is the theme's `warnSoft` token. Phase 2b adds an AA check of `text` on
  `warnSoft` (blended over `bg`) for every reader theme to the ui token test.

**In the app** (`app/read/[id].tsx`; store functions and pure helpers in
`reader-core/src/highlights.ts`):

```ts
export interface HighlightAnchor {
  id: string; startBlock: number; startOffset: number; endBlock: number; endOffset: number;
  quote: string; note: string | null; orphaned: boolean;
}
```

- A `selection` message shows the selection bar (§13). "Highlight" stores the
  anchors and quote; "Add note" does the same and opens the highlight sheet. A
  quote over 5,000 characters is refused (error copy in §13).
- Highlights load with the article and go to `setHighlights` after `ready`, and
  again after every change.
- **Refresh (FR-5).** After the new copy is swapped in,
  `reanchor(highlights, blocks)` (pure) looks for each quote in the new
  `text.json` blocks, joined with `"\n"`: first an exact match starting within
  20 blocks of the old `start_block`, nearest first, then anywhere. Found: new
  anchors and `orphaned = 0`. Not found: `orphaned = 1`, with the note kept.
  Orphaned highlights aren't drawn; the Highlights sheet lists them under "Not
  found after refresh".
- Deleting the article deletes its highlights (`ON DELETE CASCADE`).

**In exports (Phase 4):**

- `markHighlights(xhtml, highlights)` (pure, no DOM) walks the stored XHTML
  string. It counts collapsed text characters per `data-b` block exactly as
  `text.json` does, with an entity counting as one character, and inserts
  `<mark>` and `</mark>`. A highlight that crosses an element boundary is closed
  before the tag and reopened after it, so the XML stays well formed. Orphaned
  highlights are skipped.
- `highlightsSection(highlights)` returns
  `<section class="highlights"><h2>Highlights</h2><ol>…</ol></section>`, with
  one `<li>` per highlight in reading order: the quote in a `<blockquote>`, then
  the note in a `<p>` if there is one. Everything goes through `escapeXml`.
- EPUB chapters and the PDF page both use them (§10.1, §10.2). `mark` uses the
  light palette's `warnSoft`.

## 9. Text-to-speech

### 9.1 Text model (`speech.ts`, pure)

```ts
export interface SpeechText { lang: string | null; blocks: { text: string; page?: number }[] }   // text.json
export interface Utterance { block: number; start: number; end: number; text: string }          // UTF-16 offsets in the block
export function splitSentences(text: string, lang: string | null): [number, number][];
export function buildUtterances(t: SpeechText): Utterance[];
export function textHash(t: SpeechText): string;   // FNV-1a 32-bit over the block texts, hex
```

- **`splitSentences` is rule-based, with no `Intl.Segmenter`** (R§8.5).
  - **Terminators:** `. ! ? …` and `。 ！ ？`, plus `۔` and `؟` for Urdu and
    Arabic. Closing quotes and brackets may follow, then whitespace or the end
    of the block.
  - **No break after:** a known abbreviation (Mr, Mrs, Ms, Dr, Prof, St, Jr, Sr,
    vs, etc, e.g, i.e, U.S, U.K, No, Fig), a single capital initial, a decimal
    (`3.14`), or an ellipsis followed by a lowercase letter.
  - Its test deletes `Intl.Segmenter` before importing the module.
- **`buildUtterances` sizes:**
  - Merge a sentence shorter than 40 chars with the next one in the same block,
    up to 300 chars.
  - Split a sentence over 1,000 chars at the last `,`, `;`, `:` or space before
    1,000.
  - No utterance is ever over 3,900 chars, below Android's 4,000 limit.
- **Paragraph skips:** an utterance's `block` tells native code where the next
  and previous paragraphs start.

### 9.2 Native module contract (`modules/reader-speech`)

**TypeScript** (`src/index.ts`, a thin adapter over `requireNativeModule('ReaderSpeech')`):

```ts
export interface EngineInfo { packageName: string; label: string; isDefault: boolean }
export interface VoiceInfo { id: string; name: string; language: string; quality: number; offline: boolean; installed: boolean }
export interface SpeechDocument {
  docId: string; title: string; subtitle: string | null; lang: string | null;
  texts: string[];                 // utterance texts, in order
  blockOf: number[];               // utterance → block, for paragraph skips
  pageOf: (number | null)[] | null;
  startAt: number;                 // utterance index
}
export type PlaybackState = 'idle' | 'playing' | 'paused' | 'ended' | 'error';
export type SpeechErrorCode = 'no-engine' | 'no-voice' | 'network-voice-blocked' | 'engine-error' | 'focus-denied';
export interface SpeechStatus { docId: string | null; index: number; state: PlaybackState }

export interface ReaderSpeech {
  getEngines(): Promise<EngineInfo[]>;
  getVoices(engine: string | null): Promise<VoiceInfo[]>;            // initialises the engine if needed
  play(doc: SpeechDocument, settings: SpeechSettings): Promise<void>; // starts the service; resolves when speaking starts
  pause(): void;
  resume(): void;
  stop(): void;
  seek(index: number): void;
  setSettings(settings: SpeechSettings): void;                        // takes effect from the next utterance
  getStatus(): SpeechStatus;
  getSavedIndex(docId: string): number | null;
  openTtsSettings(): void;                                            // com.android.settings.TTS_SETTINGS
}

// Events (EventEmitter on the module):
//   onUtteranceStart { docId: string; index: number }
//   onRange          { docId: string; index: number; start: number; end: number }   // inside texts[index]
//   onStateChange    { docId: string | null; state: PlaybackState; index: number; error: { code: SpeechErrorCode; message: string } | null }
```

**Kotlin** (`expo.modules.readerspeech`):

```kotlin
class ReaderSpeechModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ReaderSpeech")
    Events("onUtteranceStart", "onRange", "onStateChange")
    AsyncFunction("getEngines") { -> List<Map<String, Any>> }
    AsyncFunction("getVoices") { engine: String? -> List<Map<String, Any>> }
    AsyncFunction("play") { doc: SpeechDocumentRecord, settings: SpeechSettingsRecord -> Unit }
    Function("pause") { }
    Function("resume") { }
    Function("stop") { }
    Function("seek") { index: Int -> }
    Function("setSettings") { settings: SpeechSettingsRecord -> }
    Function("getStatus") { -> Map<String, Any?> }
    Function("getSavedIndex") { docId: String -> Int? }
    Function("openTtsSettings") { }
    OnCreate { SpeechHub.listener = ::emit }   // emit = sendEvent(...)
    OnDestroy { SpeechHub.listener = null }    // the service keeps playing
  }
}

class SpeechDocumentRecord : Record {
  @Field val docId = ""; @Field val title = ""; @Field val subtitle: String? = null
  @Field val lang: String? = null; @Field val texts = listOf<String>(); @Field val blockOf = listOf<Int>()
  @Field val pageOf: List<Int?>? = null; @Field val startAt = 0
}
class SpeechSettingsRecord : Record {
  @Field val rate = 1.0; @Field val pitch = 1.0; @Field val voiceId: String? = null
  @Field val engine: String? = null; @Field val allowNetworkVoices = false
}

// core/: pure Kotlin, no android.* imports, JVM-tested
class SpeechQueue(texts: Int, blockOf: List<Int>, startAt: Int, lookahead: Int = 3) {
  val generation: Int                                     // bumped by seek/stop/pause
  fun start(): List<Int>                                  // indexes to enqueue now
  fun onDone(utteranceId: String): List<Int>              // next indexes to enqueue; stale ids ignored
  fun onStart(utteranceId: String): Int?                  // current index, or null if stale
  fun pause(): Int; fun seek(index: Int): List<Int>
  fun nextBlockStart(): Int?; fun prevBlockStart(): Int?
  companion object { fun id(generation: Int, index: Int): String; fun parse(id: String): Pair<Int, Int>? }
}
data class VoiceSpec(val id: String, val locale: String, val quality: Int, val networkRequired: Boolean, val notInstalled: Boolean)
object VoicePicker {
  fun eligible(all: List<VoiceSpec>, allowNetwork: Boolean): List<VoiceSpec>
  fun pick(all: List<VoiceSpec>, lang: String?, preferredId: String?, allowNetwork: Boolean): VoiceSpec?
}
fun clampRate(r: Double): Float      // 0.5..3.0
fun clampPitch(p: Double): Float     // 0.5..2.0
```

**Swift** (Phase 8; same names, events and record shapes):

```swift
public class ReaderSpeechModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ReaderSpeech")
    Events("onUtteranceStart", "onRange", "onStateChange")
    AsyncFunction("getEngines") { () -> [[String: Any]] in … }        // one entry: "system"
    AsyncFunction("getVoices") { (engine: String?) -> [[String: Any]] in … }
    AsyncFunction("play") { (doc: SpeechDocumentRecord, settings: SpeechSettingsRecord) in … }
    Function("pause") { }; Function("resume") { }; Function("stop") { }
    Function("seek") { (index: Int) in }
    Function("setSettings") { (settings: SpeechSettingsRecord) in }
    Function("getStatus") { () -> [String: Any?] in … }
    Function("getSavedIndex") { (docId: String) -> Int? in … }
    Function("openTtsSettings") { }                                     // opens app settings
  }
}
```

The iOS side uses `AVSpeechSynthesizer` with `willSpeakRangeOfSpeechString`
(which drives `onRange`) and an `AVAudioSession` of `.playback` / `.spokenAudio`.
`MPRemoteCommandCenter` handles play, pause and next/previous, and
`MPNowPlayingInfoCenter` shows the title. iOS voices are on-device, so `offline`
is true. The rate is `AVSpeechUtteranceDefaultSpeechRate × rate`, clamped to the
platform's min and max (R§8.5).

### 9.3 SpeechService (Android)

- **Declaration:**
  - `Service`, `exported=false`, `foregroundServiceType="mediaPlayback"`.
  - Started with `startForegroundService` from `play` or `resume`, which only run
    in response to the user, or from a media button while the service is already
    in the foreground.
  - Calls `startForeground(id, notification, FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)`.
- **Engine:**
  - `TextToSpeech(context, onInit, engine)`; `engine` null means the default.
  - `setAudioAttributes(USAGE_MEDIA, CONTENT_TYPE_SPEECH)`;
    `setSpeechRate(clampRate)` and `setPitch(clampPitch)`.
  - **Always an explicit voice.** It is
    `VoicePicker.pick(getVoices(), doc.lang, voiceId, allowNetwork)`. If there is
    none, the error is `no-voice`. The engine's default voice is never trusted,
    because it may be a network voice (safety rule 5).
- **Queue:**
  - `SpeechQueue` keeps 3 utterances queued with `QUEUE_ADD`, using ids
    `"<generation>:<index>"`.
  - `UtteranceProgressListener`:

    | Callback       | Action                                                                 |
    | -------------- | ---------------------------------------------------------------------- |
    | `onStart`      | Emits `onUtteranceStart`, saves `idx:<docId>` in SharedPreferences     |
    | `onRangeStart` | Emits `onRange` (API 26+)                                              |
    | `onDone`       | Enqueues the next utterances                                           |
    | `onError`      | `engine-error`                                                         |

  - Callbacks with a stale generation are ignored.
- **Pause and resume.** Pause is `tts.stop()`, then the generation is bumped.
  Resume re-speaks the current utterance from its start with `QUEUE_FLUSH`
  (R§8.5).
- **Audio focus.** One `AudioFocusRequest` with the same attributes is requested
  from inside the service, so it works on Android 15+.

  | Event                                                    | Response                          |
  | -------------------------------------------------------- | --------------------------------- |
  | Request denied                                           | `focus-denied`                    |
  | `AUDIOFOCUS_LOSS`                                        | Pause, abandon focus              |
  | `AUDIOFOCUS_LOSS_TRANSIENT`                              | Pause; resume on gain             |
  | Ducking                                                  | Pause (speech shouldn't duck)     |
  | `ACTION_AUDIO_BECOMING_NOISY` (receiver while playing)   | Pause, and don't auto-resume (AC-13) |

- **Wake lock.** A `PARTIAL_WAKE_LOCK` is acquired with a 10-minute timeout,
  renewed at each utterance start, and released on pause, stop or end.
- **Media session:**
  - `MediaSessionCompat`, active while playing or paused.
  - Metadata: title, and site as artist.
  - The playback state has no position.
  - Actions: play, pause, skip to next and previous (next and previous block),
    stop.
  - Notification: `NotificationCompat` + `androidx.media.app.NotificationCompat.MediaStyle(sessionToken)`,
    with previous, play/pause and next. Channel "Listening", importance low.
    Media-session notifications don't need `POST_NOTIFICATIONS` (R§8.4).
- **Lifecycle:**
  - Paused for 10 minutes: stop the foreground, keep the session paused, release
    the engine.
  - End of document: `ended`, then stop the foreground and `stopSelf()`.
  - `onTaskRemoved` keeps playing.
- **`SpeechHub`** is a process singleton that holds the listener and the
  current status, so the module can attach and detach as JS reloads.

### 9.4 The app side (`useSpeech`)

1. **Text.** `getSpeechText(item)` (§11), then `buildUtterances`.
2. **Start point.** `startAt` comes from `reading_state.listen_index` when
   `listen_hash == textHash`. Otherwise `getSavedIndex`, with the same hash
   check. Otherwise the first utterance in `reading_state.block`.
3. **Events:**
   - `onUtteranceStart`: `__reader.highlight(u.block, u.start, u.end)`, and
     persist `listen_index` (throttled to 2 s, and always on pause and stop).
   - `onRange`: `highlightWord(u.block, u.start + start, u.start + end)`.
4. **Back in the foreground.** On `AppState` active, call `getStatus()` and
   resynchronise the highlight.
5. **Tap a paragraph** (`tapBlock`): `seek` to the first utterance of that block.
6. **Voices.** The voice sheet lists `getVoices(engine)` filtered with the same
   rules as `VoicePicker`, mirrored in TS for display. Language match: the exact
   tag first, then the base language.

## 10. Export

### 10.1 EPUB (`epub.ts`, pure; runs in Hermes)

```ts
export interface EpubImage { href: string; bytes: Uint8Array }         // href as in content.xhtml: "img/0001.jpg"
export interface EpubChapter {
  title: string; byline: string | null; site: string | null; url: string; savedAt: number;
  lang: string | null; dir: 'ltr' | 'rtl' | null; xhtml: string; images: EpubImage[];
  highlights: HighlightAnchor[];   // §8.5; empty for none
}
export interface EpubBook { id: string; title: string; lang: string; modified: Date; tags: string[]; chapters: EpubChapter[] }
export function buildEpub(book: EpubBook): Uint8Array;   // fflate zipSync
```

**Layout:**

```
mimetype                              first entry, level 0 (stored), no extra field
META-INF/container.xml                → OEBPS/content.opf
OEBPS/content.opf                     metadata, manifest, spine (toc="ncx")
OEBPS/nav.xhtml                       <nav epub:type="toc"><ol> one <li> per chapter
OEBPS/toc.ncx                         same entries; dtb:uid = book id
OEBPS/style.css                       simple reading CSS; no fonts
OEBPS/text/c001.xhtml …               header block + article
OEBPS/img/c001/0001.jpg …
```

**Metadata:**

| Element                     | Value                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `dc:identifier id="uid"`    | Single article: `urn:pdfeditor:article:<itemId>`. Bundle: `urn:pdfeditor:collection:<folderOrTagId>:<yyyymmdd>`. Not marked as a UUID (OPF-085). |
| `dc:title`                  | Single article: its title. Bundle: "<folder or tag name>, <date>".                                                          |
| `dc:language`               | The article's language, or the most common one in a bundle, or `und`.                                                      |
| `dc:creator`                | The byline (single article only).                                                                                           |
| `dc:publisher`              | The site.                                                                                                                   |
| `dc:source`                 | The URL (single article only).                                                                                              |
| `dc:subject`                | One per tag.                                                                                                                |
| `meta property="dcterms:modified"` | `modified.toISOString().replace(/\.\d{3}Z$/, 'Z')`                                                                  |

**Chapters:**

- The skeleton is `<?xml …?>`, `<!DOCTYPE html>`, then
  `<html xmlns xmlns:epub lang xml:lang dir>`, a `<head>` with the title and
  stylesheet, and a `<body>`.
- The body has a `<header>` (title, byline, site, date saved, source link),
  then the stored `xhtml`.
- `src="img/` becomes `src="../img/c001/`.
- Highlights (§8.5): `markHighlights` runs on the xhtml first, and
  `highlightsSection` follows the article when there is at least one.

**Images:**

- The media type comes from `sniffImage`.
- AVIF, unknown types and missing files are removed with `dropImages` first
  (R§7.1, MED-003, RSC-007).
- The manifest is built from the files actually written (OPF-003).

**Escaping and limits:**

- Template strings go through `escapeXml` (`& < > " '`) with numeric references
  only (RSC-016).
- At most 50 chapters and 100 MB of images. Over that, refuse with "This is too
  big for one book. Export at most 50 articles at a time."

**Output and checks:**

- The file is `cache/exports/<slug>.epub`, shared with `Sharing.shareAsync(uri,
  { mimeType: 'application/epub+zip' })`.
- **Tests** (`epub.test.ts`): unzip with fflate and assert:
  - `mimetype` is first, stored, with no extra field, and has exact content;
  - `container.xml` points to the OPF;
  - the OPF has its required metadata and exactly one `dcterms:modified`;
  - the nav has one entry per chapter;
  - every manifest href exists, and every file is in the manifest;
  - no `&nbsp;`-style entities;
  - the output is deterministic for a fixed `modified`.
- `test/epubcheck.mjs` runs epubcheck on a single-article book (with 3
  highlights, one noted, AC-21) and a 20-chapter
  book built from the fixtures (AC-9, AC-10).

### 10.2 PDF (`print.ts` + expo-print)

`buildPrintHtml(chapters, fontsCss, images)` is pure. `images` maps a token to a
`data:` URI read as base64 with expo-file-system, because expo-print can't load
`file://` (R§7.3). The page has:

- the light palette always, and Atkinson as `data:` fonts;
- the article through `markHighlights`, then `highlightsSection` (§8.5);
- `@page { size: A4; margin: 18mm 16mm }` (margins only work through CSS on
  Android);
- `img { max-width: 100%; break-inside: avoid }` and
  `h1, h2, h3 { break-after: avoid }`;
- `break-before: page` between chapters;
- no `filter` or `backdrop-filter`, which could force rasterising.

`Print.printToFileAsync({ html, width: 595, height: 842 })` produces the file
(A4, PRD Q8). The file is added to the Library as a kind `pdf` item titled after
the article, through the same path "Open a PDF" uses. "Open in editor" then
pushes `/editor` with that file's `uri` and `name`, which `app/editor.tsx`
already accepts.

**Limit:** inline images up to 15 MB in total; the rest are replaced by their
alt text, with a notice saying how many. Phase 4 measures a 20 MB article on the
phone. If expo-print stalls or produces rasterised text, the fallback is a
`printToPdf(htmlPath, outPath, widthPt, heightPt)` function in `reader-speech`,
renamed to `reader-native`. It uses `WebView.createPrintDocumentAdapter` with a
`file://` base URL (R§7.3, verified in android.jar).

## 11. Read-aloud for PDFs and scans (FR-15)

`getSpeechText(item)` resolves the text by kind:

1. **Kind `article`:** `library/<id>/text.json`, written at capture (§3.3).
2. **Kind `scan`:** `ScanStore.pageTexts(itemId)` (Scan SPEC §4.7), one block
   per paragraph (split on blank lines), each tagged with its 1-based page.
   Nothing is written back: the scan's page rows are the one copy, and OCR can
   run again.
3. **Kind `pdf`:** `library/<id>/text.json` if present with `version` 1. This
   cache is safe because `document.pdf` is never changed in place (Scan SPEC
   §4.5; an edit saves a new item). Otherwise extract with PDF.js. Scan's
   `docInfo` bridge event (Scan SPEC §5.1) already gives the search body, but
   it has no positions, so read-aloud runs its own layout-aware pass:
   - A hidden WebView loads `assets/reader/pdftext.html`. `build.mjs` builds it
     from `packages/pdf-editor-engine/vendor` with the same PDF.js inlining the
     editor's `build.mjs` uses, and loads documents with
     `isEvalSupported: false`.
   - The PDF goes in as base64, the editor's path, with the same 40 MB limit.
     Over that, the message is "This PDF is too large to read aloud (over 40 MB)."
   - The page posts `getTextContent()` items per page:
     `{ str, x: transform[4], y: transform[5], w: width, h: height, eol: hasEOL }`.
   - `pdfItemsToBlocks(pages)` in `pdftext.ts` turns them into blocks:
     - group items into lines by y, within half the line height;
     - order lines top to bottom, and items left to right;
     - split into columns when the x gaps cluster;
     - join lines, de-hyphenating at a line-end `-`;
     - break paragraphs on a vertical gap above 1.3× the line height;
     - drop lines that repeat in the same position on 3 or more pages (running
       headers and footers).

     Fixture tests come from PDFs generated with pdf-lib in the test.
   - The result is written as `text.json`, and the Library search text is left
     to the Library.

## 12. Import (Phase 7; FR-17)

`import/*.ts` is pure and runs in Hermes.

- **Input:** the file comes from `expo-document-picker`.
- **Unzipping:** fflate `unzipSync` with a filter. The compressed file is capped
  at 50 MB and the uncompressed total at 200 MB, which stops zip bombs.
- **CSV:** `csv.ts`, an RFC 4180 parser with quoted fields and CRLF.
- **Mapping** (R§9.2):

  | Source     | Columns used                                                       | Mapping                                                                                                                    |
  | ---------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
  | Pocket     | `title,url,time_added[,cursor],tags,status`                        | Tags split on `\|`; `status=archive` → finished; `time_added` (Unix seconds) → `saved_at`                                  |
  | Instapaper | `URL,Title,Selection,Folder[,Timestamp,Tags]`                      | `Folder=Archive` → finished; other folder names → Library folders; `Tags` is a JSON array string                           |
  | Netscape   | `<A HREF ADD_DATE TAGS TOREAD>` (regex over the tags, no DOM)       | `TOREAD="0"` → finished                                                                                                     |

- **Each row:**
  - Skip it unless `isFetchableUrl`.
  - Skip it if it's a duplicate by `canonicalUrl`.
  - Otherwise create a pending article (no fetch) with its tags.
- The summary says what was added and what was skipped. "Download all"
  enqueues every pending article.

## 13. UI

Every screen is built from `@apps-hub/ui` components, with no hand-rolled
colours or fonts. Copy is sentence case. Errors say what happened and what to
do.

| Screen or part                            | Built from                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library "+" sheet (Scan's)                | Add a `Row` "Save a web page" → `/save`                                                                                                                                                                                                                                          |
| Library filter (Scan's)                   | Add "Articles"; inside it a `Segmented` "To read" / "Finished"; article rows as in §7 with a `Pill` for the status                                                                                                                                                                |
| Folder or tag screen (Scan's)             | Add a header action "Export articles as EPUB"                                                                                                                                                                                                                                    |
| Save (`app/save.tsx`)                     | **Entry:** `Screen`, `Header` "Save a web page", `Field` "Web address" (URL keyboard, no autocapitalise, `error` for bad input), `Button` "Save".<br>**While capturing:** `Progress` (indeterminate) with the host in `Text variant="meta"`.<br>**Partial:** `Notice tone="warn"` with "Show page".<br>**Done:** `Notice tone="ok"` "Saved" with `Button` "Read now" and `Button variant="secondary"` "Done".<br>**Duplicate:** `Notice` "Already saved on 30 Oct" with "Open" and "Refresh". |
| Show page                                 | The `CaptureHost` WebView in front, under a bar with `Button` "Save now" and `Button variant="ghost"` "Cancel"                                                                                                                                                                   |
| Reader (`app/read/[id].tsx`)              | **Top bar** in the editor's style (`app/editor.tsx`): Back, the title, then "Text settings", "Listen" and "More".<br>**Body:** the WebView. A partial article shows a `Notice tone="warn"` above it: "This page may be incomplete. Open the original or save it again with the page shown."<br>**Bottom:** a mini player while listening, with previous paragraph, play/pause, next paragraph and "Paragraph 4 of 60" (or "Page 2 of 12"). |
| More (`Sheet`)                            | `Row`s: Highlights (n) (Phase 2b), Refresh, Open original, Mark as finished / Mark as unread, Export as EPUB, Save as PDF, Delete (danger tone)                                                                                                                                    |
| Selection bar (Phase 2b)                  | While text is selected: a bar above the bottom edge with `Button` "Highlight" and `Button variant="secondary"` "Add note"                                                                                                                                                          |
| Highlight sheet (Phase 2b)                | `Sheet` with the quote in `Text variant="meta"`, `Field` "Note" (multiline, up to 2,000 characters), `Button` "Save" and a danger `Button` "Delete highlight"                                                                                                                     |
| Highlights (`Sheet`, Phase 2b)            | One `Row` per highlight in reading order (quote on two lines, note below); a tap scrolls to it. A `Group` "Not found after refresh" holds orphaned ones                                                                                                                           |
| Text settings (`Sheet`)                   | `Group` "Theme" with `Segmented` System / Light / Dark / Sepia; "Font" Atkinson / Serif / Sans / Mono; "Size" a `Row` with two small `Button`s and "18 px"; "Line spacing" Compact / Normal / Loose; "Margins" Narrow / Normal / Wide                                                  |
| Listen settings (`Sheet`)                 | "Speed" and "Pitch" `Row`s with − / + and the value ("1.2×"); "Voice" `Row` per eligible voice (name, language, "Offline") with a check; `Segmented` "Allow online voices" Off / On, with a `Notice tone="warn"` when on; `Row` "Text-to-speech settings" → `openTtsSettings()`      |
| First listen                              | `Notice`: "To keep listening with the screen off, let PDF Editor run in the background: Autostart on, Battery saver set to No restrictions." `Button` "Open settings" → `Linking.openSettings()`                                                                                     |
| Import (`app/import.tsx`, P7)             | `Header` "Import", `Group` of `Row`s (Pocket export, Instapaper CSV, Bookmarks file), `Progress`, then a summary `Notice`                                                                                                                                                        |

Icons are Ionicons, as in the editor. There are no emoji. Every `Pressable`
icon has an `accessibilityLabel`.

**Error copy:**

- "Select less text to highlight. A highlight can cover up to 5,000
  characters."
- "That isn't a web address. Paste a link that starts with http or https."
- "Couldn't reach the page. Check the connection, then tap Try again."
- "This page has little readable text. Tap Show page, close any banner, then
  Save now."
- "No offline voice for Urdu is installed. Install one in Text-to-speech
  settings."
- "Online voices are off, so this voice can't be used. Pick an offline voice or
  turn online voices on."

## 14. Manifest and permissions

**App manifest** (hand edit, because `android/` is a committed prebuild). A
second intent filter goes on `.MainActivity`, which is already `singleTask`:

```xml
<intent-filter>
  <action android:name="android.intent.action.SEND"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <data android:mimeType="text/plain"/>
</intent-filter>
```

**`MainActivity.kt`** turns a share into the deep link `pdfeditor://save?share=<id>`,
which expo-router routes to `app/save.tsx`. That routing is assumed and is
checked in Phase 1. The original intent is replaced, so React Native's
`Linking` sees an ordinary `VIEW` URL.

`pdfeditor://` is also an exported, browsable `VIEW` filter, so any web page or
app can open `pdfeditor://save`, and expo-router 6 decodes query values more
than once, so nothing in that URL can be trusted. The share travels in an
app-private file instead (owner, 2026-10-31):

- `rewriteShare` writes `{ id, text, title }`, with `id` a random UUID, to
  `filesDir/pending-share.json` (expo-file-system's `Paths.document`) through a
  `.tmp` file and a rename, then opens `pdfeditor://save?share=<id>`. A share
  without a title writes no `title` key. If the file can't be written (storage
  full), the link carries no id and Save opens empty for a paste.
- `app/save.tsx` runs an effect keyed on the `share` param. It reads the file,
  deletes it, and starts at once only when the file's `id` equals `share`.
  Otherwise it waits for Save. It never reads text from the URL.
- Every share has a new id, so the param changes and the effect runs again even
  while the Save screen is open. A forged link can't know the id, so neither a
  pending nor a stale file starts from one.
- Android re-delivers the original share when it rebuilds the activity after
  the process died (`savedInstanceState` is set) or relaunches it from Recents
  (`FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY`). Neither is rewritten, so the Library
  opens.
- `onNewIntent` calls `setIntent`, so a share that arrives before React is
  ready is the one `Linking` reads at start-up. If two shares land in that
  window, the later one wins. Android also rebuilds the activity with that
  intent, so a config change after a share (font size, split screen, language)
  reopens an empty Save screen instead of the Library; nothing restarts.

```kotlin
import android.content.Intent
import android.net.Uri
import java.io.File
import java.util.UUID
import org.json.JSONObject

override fun onCreate(savedInstanceState: Bundle?) {
  if (savedInstanceState == null) rewriteShare(intent)
  SplashScreenManager.registerOnActivity(this)
  super.onCreate(null)
}
override fun onNewIntent(intent: Intent) { rewriteShare(intent); setIntent(intent); super.onNewIntent(intent) }
// The share travels in an app-private file under a fresh id; the URL carries only the id (§15).
private fun rewriteShare(i: Intent?) {
  if (i?.action != Intent.ACTION_SEND || i.type != "text/plain") return
  if ((i.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return
  val text = i.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.take(8192) ?: return
  val title = (i.getCharSequenceExtra(Intent.EXTRA_TITLE) ?: i.getCharSequenceExtra(Intent.EXTRA_SUBJECT))?.toString()?.take(1000)
  val id = UUID.randomUUID().toString()
  val saved = runCatching {
    val tmp = File(filesDir, "pending-share.json.tmp")
    tmp.writeText(JSONObject().put("id", id).put("text", text).put("title", title).toString())
    tmp.renameTo(File(filesDir, "pending-share.json"))
  }.getOrDefault(false)
  i.action = Intent.ACTION_VIEW
  i.data = Uri.Builder().scheme("pdfeditor").authority("save")
    .apply { if (saved) appendQueryParameter("share", id) }.build()
}
```

**Module manifest** (`modules/reader-speech/android/src/main/AndroidManifest.xml`,
merged into the app):

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"/>
<uses-permission android:name="android.permission.WAKE_LOCK"/>
<queries><intent><action android:name="android.intent.action.TTS_SERVICE"/></intent></queries>
<application>
  <service android:name="expo.modules.readerspeech.android.SpeechService"
           android:exported="false" android:foregroundServiceType="mediaPlayback"/>
</application>
```

All three permissions are normal permissions, so there are no prompts.
`INTERNET` is already declared. No new runtime permission is needed:
media-session notifications are exempt from `POST_NOTIFICATIONS` (R§8.4).

## 15. Security

| Threat                                                         | Where              | Control                                                                                                                                                                                                 |
| -------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A saved page runs script later (stored XSS)                    | Reader             | Sanitised at capture and again at render; the CSP allows only the nonce'd script, so inline handlers and `javascript:` URLs are blocked; `allowFileAccessFromFileURLs` and `allowUniversalAccessFromFileURLs` stay off (safety rule 1) |
| A saved page phones home (tracking pixels, remote CSS, fonts)  | Reader, exports    | CSP `default-src 'none'`, images only from `file:` and `data:`, remote `<img>` removed at capture, navigation cancelled (safety rule 2)                                                                  |
| The capture page forges or alters the result                   | Capture            | Per-run nonce in a closure; `validateCaptureResult` limits; the result treated as untrusted and re-sanitised at render (safety rule 3)                                                                    |
| The capture page navigates to `intent:` or `file:`, or opens windows | Capture      | `onShouldStartLoadWithRequest` allows `http(s)` only; `setSupportMultipleWindows={false}`; `allowFileAccess={false}`                                                                                     |
| The capture page opens the camera (`getUserMedia`)             | Capture            | `onPermissionRequest` denies audio and video capture (patched react-native-webview on Android, `mediaCapturePermissionGrantType="deny"` on iOS; §4.3); RECORD_AUDIO is removed (Scan Phase 2) |
| A crafted image URL reads local files into an export           | Images             | `http(s)` image URLs only; downloads go only into `library/<id>/img/`                                                                                                                                    |
| A share or import carries `file:`, `content:` or `javascript:` | Input              | `isFetchableUrl` (safety rule 4); share text capped at 8 KB                                                                                                                                             |
| A web page or another app opens `pdfeditor://save` to start a capture | Input       | The share travels only in `filesDir/pending-share.json` under a fresh UUID and the URL carries only that id; `app/save.tsx` deletes the file and starts only when its id equals `share`, and never reads text from the URL (§14) |
| A huge page or image fills storage                             | Images, content    | NFR-4 caps, enforced after each download                                                                                                                                                                 |
| A zip bomb on import                                           | Import             | 50 MB compressed, 200 MB uncompressed caps                                                                                                                                                              |
| Article text sent to a cloud voice                             | TTS                | Explicit offline voice by default; network voices only by opt-in (safety rule 5)                                                                                                                         |
| PDF.js font CVE-2024-4367                                      | PDF read-aloud     | `isEvalSupported: false`, as in the editor                                                                                                                                                              |
| DOMPurify bypasses                                             | Capture, reader    | Pin ≥ 3.4.17, avoid the risky modes, CSP as a second wall                                                                                                                                               |

The capture WebView keeps its own cookies, so logins and consent choices persist
between saves. It never shares cookies with Chrome. Clearing them is out of v1.

## 16. Testing

### 16.1 `node --test` (packages/reader-core; every file listed in its `test` script)

| File                   | Covers                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `url.test.ts`          | Every §6 rule; `parseShared` on Chrome text, quote + `#:~:text=` text, and title + URL text; `isFetchableUrl` refusing `file:`, `content:`, `intent:`, `javascript:` and `data:`; runs with `globalThis.URL` deleted |
| `schema.test.ts`       | `migrate(db, 'reader', READER_STEPS)` on the `node:sqlite` test driver after `Library.open`: a fresh install and a re-run both end at the last step (2 from Phase 2b), idempotently; deleting an item cascades to `articles`, `reading_state` and `highlights` |
| `highlights.test.ts`   | Store: add, note, delete, the 5,000-character cap. `reanchor`: exact, moved block, repeated quote picks the nearest, gone → orphaned. `markHighlights` (Phase 4): one block, across inline tags, across blocks, entities count as one, the output reparses as XML, its block texts equal `text.json` for every fixture; `highlightsSection` escaping |
| `store.test.ts`        | Pending creation, dedupe on the canonical, status transitions, attempts and offline handling, `reading_state` upsert, `finished_at` at 0.97                                                                    |
| `capture.test.ts`      | `validateCaptureResult` accept and reject cases (nonce, sizes, tokens, URLs, lang); `saveCapture` with fake ports (files written to `.next/` then swapped; partial rule)                                     |
| `images.test.ts`       | `sniffImage` on real magic bytes; `planDownloads` caps; `renameToken` and `dropImages` on XMLSerializer-shaped strings                                                                                       |
| `text.test.ts`         | `wordCount`, `readingMinutes`, a stable `textHash`                                                                                                                                                           |
| `shell.test.ts`        | The CSP is present and exact; the nonce on the script; `jsonForScript` escapes `</script>`, U+2028 and U+2029; theme variables come from tokens; escaped metadata                                             |
| `queue.test.ts`        | Oldest-first; retries up to 3; offline doesn't count; Try again resets                                                                                                                                       |
| `epub.test.ts`         | §10.1 assertions                                                                                                                                                                                             |
| `print.test.ts`        | `@page` CSS, `data:` images, the 15 MB cap with alt-text fallback                                                                                                                                            |
| `speech.test.ts`       | Splitter cases (abbreviations, decimals, quotes, Urdu `۔`, CJK); utterance merge and split bounds; run with `Intl.Segmenter` deleted                                                                          |
| `pdftext.test.ts`      | Columns, de-hyphenation, paragraph gaps, running headers                                                                                                                                                     |
| `import.test.ts`       | Pocket zip and CSV with and without `cursor`; Instapaper old and new; Netscape; zip-bomb guard                                                                                                               |

**Also:** `packages/ui` tests cover the sepia palette (AA for `text` and `muted`
on `bg`).

### 16.2 `test:web` (packages/reader-core, Chrome via playwright-core; skips without Chrome)

This mirrors `apps/pdf-editor-desktop/test/mobile.mjs`. Fixtures are served from
`file://`, so there is no network.

- **`article.html`:** the capture gives a title, byline, blocks and image tokens.
  The XHTML reparses as XML.
- **`lazy.html`:** `data-src` and `srcset` images come out with tokens (AC-6).
- **`spa.html`:** content inserted 600 ms after load is captured (AC-6).
- **`hostile.html`:**
  - After capture and render, `window.__pwned` stays unset.
  - No `<script>`, `iframe` or `on*` attribute survives.
  - The reader page makes 0 requests that aren't `file:` or `data:` (AC-5).
- **`rtl.html`:** `dir="rtl"` and `lang` survive.
- **Reader page:**
  - A selection across inline markup and across two blocks posts the expected
    anchors and quote; `setHighlights` marks exactly that text; a tap on a
    highlight posts its id (Phase 2b).
  - `apply()` changes the computed font size within one frame.
  - `highlight(block, start, end)` covers exactly the expected text across
    inline markup.
  - Progress messages carry the nonce.

### 16.3 epubcheck

`node packages/reader-core/test/epubcheck.mjs` builds a single-article book and
a 20-chapter book from the fixtures. It runs
`java -jar $EPUBCHECK_JAR` on both and expects 0 errors. It skips when
`EPUBCHECK_JAR` is unset.

### 16.4 Gradle JVM tests (`:reader-speech:testDebugUnitTest`)

- **`SpeechQueueTest`:**
  - lookahead of 3;
  - `onDone` advances;
  - stale-generation callbacks after seek, pause and stop are ignored;
  - pause returns the current index and resume restarts it;
  - next and previous block starts at the edges;
  - id round-trip.
- **`VoicePickerTest`:**
  - network and not-installed voices are excluded unless allowed;
  - exact-tag beats base-language beats any;
  - a preferred id wins only if eligible;
  - higher quality wins;
  - an empty list gives null.
- **Clamps:** `clampRate` and `clampPitch` at both bounds.

### 16.5 Device checks (owner's phone, Store install)

Each phase lists its own. They cover every unverified item in R§11:

- the HyperOS browser share;
- `file://` images under `loadDataWithBaseURL`;
- `injectJavaScript` under the CSP;
- a capture WebView behind the stack;
- the default engine and `onRangeStart`;
- 30 minutes with the screen off;
- selectable text in expo-print output;
- AC-17 timing.

## 17. Build and release

- `packages/reader-core/build.mjs` writes
  `apps/pdf-editor-mobile/assets/reader/web.json`, which contains
  `{ capture, reader, purify, fontsCss }`, and, from Phase 6,
  `assets/reader/pdftext.html`.
  - It keeps the licence headers of Readability (Apache-2.0) and DOMPurify
    (MPL-2.0 / Apache-2.0).
  - It throws on a `</script` inside inlined code, like the engine's build.
  - It throws on a missing input.
- The app's `prestart` runs both builds:
  `node ../../packages/pdf-editor-engine/build.mjs && node ../../packages/reader-core/build.mjs`.
- `tools/release/src/apps.ts` adds
  `['node', '../../packages/reader-core/build.mjs']` to `pdf-editor.prepare`.
- `.gitignore` adds `/apps/pdf-editor-mobile/assets/reader/`.
- Release with `pnpm release pdf-editor -m "<what changed>"` and install through
  the Store (`docs/app-store.md`). Never `adb install` on the phone; debug
  builds go on the emulator.
- A push to `main` triggers CI releases, so merge only when the owner says so.

## 18. Phases

**Prerequisite for all of them:** Scan Phase 1 (Library) has landed
(`docs/pdf-editor/scan/PROMPTS.md` Phase 1). The owner's order (S0) also runs
Scan Phases 2–4 first (`docs/build-sessions.md`). The full prompts are in
`PROMPTS.md`.

| Phase                         | Delivers                                                                                                                                                                                         | Requirements                       | Release?          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ----------------- |
| 1. Capture                    | reader-core basics (url, schema, store, capture, images, text), build.mjs, capture.js, CaptureHost, Save screen, share target, "Save a web page" in the "+" sheet, article rows, `test:web` capture fixtures | FR-1–3, FR-5 (dedupe), FR-9; AC-1, 2, 4, 6 | No (no reader yet) |
| 2. Reader                     | shell.ts, reader.js, sepia tokens, reader screen, text settings, progress and restore, links, finished state, More sheet (Refresh, Open original, Delete)                                          | FR-6–8, FR-5 (refresh); AC-5, 7, 8 | Yes               |
| 2b. Highlights and notes      | 'reader' step 2, highlights.ts (store, reanchor), selection and tap handling in reader.js, `::highlight` CSS and its AA check, selection bar, highlight sheet, Highlights sheet, Refresh re-anchoring (§8.5). Added by the owner, 2026-10-31 | FR-18; AC-19, 20                   | Yes               |
| 3. Pending and offline        | CaptureQueue, offline handling, retries, Try again, articles filter "To read" / "Finished", AC-17 timing check with the Library                                                                   | FR-4, FR-8, FR-9; AC-3, 17         | Yes               |
| 4. Export                     | epub.ts (+ folder and tag bundles), print.ts + expo-print, Save as PDF into the Library and Open in editor, epubcheck script, highlights in exports (`markHighlights`, `highlightsSection`, §8.5) | FR-10, 11, 18 (export); AC-9, 10, 11, 21 | Yes               |
| 5. Listen (Android)           | speech.ts; the reader-speech module (queue, voices, service with a basic notification); mini player; sentence and word highlight; listen settings                                               | FR-12, FR-16; AC-15                | No                |
| 6. Listen everywhere          | Media session, lock-screen and headset controls, focus and noisy handling, wake lock, resume position, PDF and scan read-aloud (pdftext), HyperOS notice. Scan read-aloud needs Scan Phase 4 (OCR text) | FR-13–15; AC-12–14, 16             | Yes               |
| 7. Import                     | Pocket, Instapaper and Netscape import; Download all                                                                                                                                             | FR-17; AC-18                       | Yes               |
| 8. iOS (optional)             | Bundle id fix, Swift ReaderSpeech, iOS reader WebView file access, share extension decision, simulator build                                                                                     | Parity where possible              | No (no iOS Store) |
