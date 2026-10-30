# Handoff: Reader feature of PDF Editor (save, read, listen, export)

## Resume prompt

Dated 2026-10-31.

1. Read `docs/handoffs/pdf-editor-reader.md` completely first.
2. Then read `docs/pdf-editor/reader/PRD.md`, `SPEC.md` and `PROMPTS.md`, plus
   `docs/pdf-editor/scan/SPEC.md` for the shared Library.
3. Trust the decisions and the verified facts below; don't re-research or
   re-derive them.
4. Follow the handoff contract in `~/.claude/CLAUDE.md`: keep this file's session
   log and current state up to date as milestones land. Near the context limit,
   stop, finalise the next step and print a new resume prompt.
5. Read "Current state + exact next step" before doing anything, and continue
   from there.

Commit, push or release only when the owner says so.

## Goal and fixed constraints

**Goal.** The owner's "ZenRead Reader & Web Archiver" idea, merged into PDF
Editor as its Reader feature. Save web pages (typed, or shared from Chrome or
the HyperOS browser) as clean offline copies. Read them with font, size,
spacing, margin and theme settings. Listen with the phone's own TTS, with the
screen off. Export as EPUB or PDF. Read PDFs and scans aloud too. It replaces
Pocket, Instapaper and Matter at $5–$8/month.

**Constraints:**

- **Host:** `apps/pdf-editor-mobile`, release id `pdf-editor`, package
  `com.haroon.pdfeditor`, brand `pdf`.
- **Library:** the shared Library comes from Scan Phase 1. Its contract is fixed
  by `docs/pdf-editor/scan/SPEC.md`: `packages/library-core`, `library.db`,
  `items` (kind `'pdf' | 'scan' | 'article'`), `folders`, `tags`,
  `item_tags`, `items_fts`, and files at `library/<id>/`. The Reader adds its
  own tables and its own package only.
- **Platform:** Android first; the owner's phone is a Redmi Note 14 Pro 4G
  (Android 16, HyperOS). iOS is the last phase and optional (no paid Apple
  account).
- **Install:** through the private Store only (`pnpm release pdf-editor`).
  Never `adb install` on the phone; use the emulator for debug.
- **Licensing and data:** FOSS only, zero telemetry, no accounts, no servers.
  New dependencies need the owner's approval.
- **Stack:** Expo SDK 54, RN 0.81.5 (Hermes), TS 5.9 (erasable, `.ts`
  imports). Pure TS in `packages/*` behind ports; native code in Expo local
  modules. UI only from `@apps-hub/ui`.

## Decisions made (with why)

**Owner answers, 2026-10-31 (session S0).** Shared answers are also in
`docs/pdf-editor/MERGE.md` ("Owner decisions").

- **Q1 app name (shared A1):** decide before the first Reader release, which is
  session A6 (Reader Phase 2). "PDF Editor" stays until then. A6 asks the owner.
- **Q2 highlights and notes: in v1.** This departs from the recommendation. They
  become **Reader Phase 2b** (session A7), right after the reader view, and EPUB
  and PDF exports carry them (marked text plus a list at the end). Articles only.
  The owner picked both the placement and the export behaviour. Changed: PRD §4,
  FR-18, AC-19–21, §8; SPEC §2, §3.2 (step 2), §8.2, new §8.5, §10.1, §10.2, §13,
  §16, §18; PROMPTS header, new Phase 2b, Phase 4.
- **Q3 import:** the owner has a bookmarks file, an Instapaper CSV and a Pocket
  export from before Oct 2025, so Phase 7 runs (session A13; no longer optional).
  Never commit the files.
- **Q4 online voices:** off unless switched on, with a notice, as recommended.
- **Q5 audio export:** not in v1, as recommended.
- **Q6 dependencies:** all approved: `@mozilla/readability` 0.6.0, `dompurify`
  3.4.17, `fflate` 0.8.3, `expo-print` ~15.0.8, `androidx.media:media` 1.7.0,
  the sepia palette in `packages/ui/src/tokens.ts`, and `playwright-core` 1.49.1
  as a dev-only test tool (already in the lockfile).
- **Q7 eval sites:** skipped; no list. The primary metric is now the first 20
  different sites shared after Phase 2 ships (PRD §7). The Phase 2 prompt no
  longer mentions a list.
- **Q8 page size:** A4, as recommended (SPEC §10.2 already used it).
- **Order (shared A3): the scanner first.** This departs from the recommendation.
  Reader Phase 1 starts after Scan Phases 2–4 (sessions A2–A4), at A5, and must
  keep the manifest as Scan Phase 2 left it (CAMERA, the `tools:node="remove"`
  entries, `allowBackup="false"`, arm64 only).
- **Arabic and Urdu search (shared A4): from v1,** built by Scan Phase 1. The
  Reader passes raw text to `setBody` (SPEC §5.1).
- **Android backup (Scan Q5):** off for the whole app, so articles stay only on
  the phone too.

The Reader agent made these calls on 2026-10-30 from research. The owner can
override any of them.

| Decision | Why |
| -------- | --- |
| **PDF Editor is the right host** | It reuses the WebView, file system, sharing, the Library, the PDF engine (read-aloud on PDFs; "Save as PDF" opens in the editor) and the `pdf` brand. It adds about 0.7 MB to an 82.9 MB APK. The only problem is the name (PRD Q1). |
| **Extract with `@mozilla/readability` 0.6.0 + DOMPurify 3.4.17 inside a react-native-webview loading the live page** | linkedom in Hermes fails because DOMPurify can't run without a real DOM and fails open. Native Readability4J is stale. |
| **Store each article once as `content.xhtml`** (XMLSerializer output, blocks tagged `data-b`), plus `text.json` and `img/` | One copy serves the reader, EPUB and PDF, and the EPUB builder needs no DOM. |
| **The reader keeps JavaScript on**, with a CSP that allows only our nonce'd script, and sanitises again at render | This contradicts the brief's "JS off": JS off kills `onMessage` and `injectJavaScript`, so no progress, scroll restore or TTS highlight. |
| **Share target is our own `SEND text/plain` intent filter plus a 15-line `MainActivity` rewrite** to `pdfeditor://save` | No dependency. expo-share-intent 5.1.1 is the fallback. |
| **Write our own `canonicalUrl` without `URL`** | RN 0.81's `URL` has no setters while Node's does, so tests would lie. |
| **TTS is our own Expo module `reader-speech`**: TextToSpeech in a `mediaPlayback` foreground service, legacy `androidx.media` 1.7.0 session, explicit offline voice | expo-speech has no Android pause or background, throws over 4,000 chars and hides network voices. Media3 drags in Guava (about +4 MB) and a Kotlin 2.2 stdlib. |
| **Sentence splitting is a rule-based TS splitter**, tested with `Intl.Segmenter` deleted | Hermes has no `Intl.Segmenter`. |
| **EPUB 3 + NCX built in TS with fflate 0.8.3 `zipSync`** | Generator libraries are Node-only or 67 KB and refetch images. |
| **PDF through expo-print ~15.0.8** with `data:` images and CSS `@page`, saved into the Library as a `pdf` item | It can't load `file://` and its margins are iOS-only. The fallback is a Kotlin `createPrintDocumentAdapter` function. |
| **Out of v1:** audio export, consent rule lists, multi-page articles, cross-article listening queue, sleep timer, the desktop Reader | Not in the owner's key features, or a large cost for little gain. |
| **Themes:** System, Light, Dark (brand tokens) plus a new Sepia reader palette in `packages/ui/src/tokens.ts` under the AA test | Tokens live only in `tokens.ts`. |
| **Fonts:** Atkinson Hyperlegible Next (default), system serif, system sans, Atkinson Mono | No new font files. |

## Evidence / facts verified

Sources are in `docs/pdf-editor/reader/RESEARCH.md` §11. Don't redo these.

**Market:**

- Pocket shut down on 8 Jul 2025 and deleted data on 8 Oct 2025. Exports are
  no longer obtainable. The export format is `title,url,time_added[,cursor],tags,status`.
- Omnivore's hosted service ended in Nov 2024. Its code is AGPL-3.0.
- Prices: Instapaper $59.99/yr; Matter $60/yr with no Android app; Readwise
  Reader $7.99/mo billed yearly.

**Extraction and capture:**

- Readability 0.6.0: Apache-2.0, F1 0.947 on the Zyte benchmark, no multi-page
  support.
- DOMPurify 3.4.17: MPL-2.0 OR Apache-2.0. It fails in Hermes.
- react-native-webview 13.15.0:
  - it accepts messages from any frame, so a nonce is needed;
  - `source.html` goes through `loadDataWithBaseURL`;
  - `file://` images need `allowFileAccess`;
  - there is no `setBlockNetworkLoads`;
  - it destroys the WebView with the activity.
- Chrome shares `EXTRA_TEXT` as text plus the URL, with `EXTRA_TITLE` set.

**Speech:**

- expo-speech 14.0.8 (SDK 54): Android has `onBoundary`, but no pause, no
  chunking and no service. It shuts down with the activity.
- android.jar (checked with `javap` for this doc):
  - `synthesizeToFile` (File and ParcelFileDescriptor) and
    `getMaxSpeechInputLength()` (4000);
  - `UtteranceProgressListener.onRangeStart` (API 26) and
    `WebView.createPrintDocumentAdapter` exist.
- Android 11+ needs a `<queries>` entry for `android.intent.action.TTS_SERVICE`.
- Media-session notifications are exempt from `POST_NOTIFICATIONS`.
- Hermes for RN 0.81.5 has no `Intl.Segmenter`.

**Export and storage:**

- expo-print 15.0.8 on Android: offscreen WebView with base URL `about:blank`
  (no `file://`), no margins, JS off, Letter by default.
- EPUB 3.3: `mimetype` first, stored, no extra field. AVIF isn't a core media
  type.
- fflate 0.8.3: `zipSync` with `{level:0}` works in Hermes.
- expo-sqlite 16.0.10 bundles SQLite 3.50.3 with FTS5 on.

**In the repo:**

- The app has `INTERNET` and a `singleTask` `MainActivity`
  (`android/app/src/main/java/com/haroon/pdfeditor/MainActivity.kt`).
- The iOS bundle id is `com.anonymous.pdf-editor`.
- `reactNativeArchitectures` covers all 4 ABIs, and the release APK is 82.9 MB.
- `apps/pdf-editor-desktop/test/mobile.mjs` is the Chrome smoke pattern.
- `tools/release/src/apps.ts` holds the pdf-editor `prepare` step.
- `packages/ui` has light and dark brand palettes only, and no sepia.

## File map

| File | Contents |
| ---- | -------- |
| `docs/pdf-editor/reader/RESEARCH.md` | Sourced findings, a verdict per question, verified-vs-assumed marks |
| `docs/pdf-editor/reader/PRD.md` | Vision, problem, decisions, FR-1–17, NFR-1–8, safety rules, AC-1–18, owner questions Q1–Q8 |
| `docs/pdf-editor/reader/SPEC.md` | Stack, dependency proposals (§1.2), layout, schema and migrations, capture pipeline, Library needs, URL rules, reader rendering and CSP, the TTS module contract (TS, Kotlin, Swift), EPUB and PDF, PDF and scan read-aloud, import, UI, manifest, security, testing, phases |
| `docs/pdf-editor/reader/PROMPTS.md` | Prelude plus 8 phase prompts with verification commands |
| `docs/pdf-editor/scan/` | Owned by the Scan feature (Library = Scan Phase 1); being written in parallel |

**Code to create later:** `packages/reader-core`,
`apps/pdf-editor-mobile/modules/reader-speech`, `app/save.tsx`,
`app/read/[id].tsx`, `src/reader/*`. **Code to edit later:** the app's
manifest and `MainActivity.kt`, `packages/ui/src/tokens.ts`,
`tools/release/src/apps.ts` and `.gitignore`.

**Scratch, not in the repo:** the research tarballs are under the session
scratchpad. They can be deleted.

## Coordination with Scan (resolved 2026-10-31)

Reconciled against the final Scan SPEC (§4.4–§4.7, §5.1). Reader SPEC §3.2,
§3.3, §5, §9.4, §11 and §16.1 and PROMPTS Phase 1 were updated to match:

- **Library API:** every Reader need maps to a named function (Reader SPEC §5
  table). Nothing in the Library contract changed.
- **Migrations:** the Reader uses Scan's migration tracks, as
  `migrate(library.db, 'reader', READER_STEPS)`. `reader_meta` and
  `migrateReader` are gone.
- **One connection:** the Library uses one connection with foreign keys on,
  writes through a queue, and never calls `withExclusiveTransactionAsync`.
  Reader writes use the same `SqlPort`.
- **Scan read-aloud:** comes from `ScanStore.pageTexts(itemId)`. Scan declined
  to write `text.json`. The Reader writes `text.json` only for articles, and as a
  cache for PDFs, whose `document.pdf` never changes in place.
- **Search:** Scan adopted the tokenizer, quoted-token builder, `bm25` weights
  and no prefix index. Arabic/Urdu normalisation is in v1 (owner, 2026-10-31),
  built by Scan Phase 1.
- **One name decision covers both features** (PRD Q1).

## Session log

- **2026-10-30:** Research in four parallel tracks: market and imports;
  extraction, capture and sanitising; TTS and background playback; EPUB, PDF
  and FTS5. Repo files read. Android APIs checked in android.jar.
- **2026-10-30 to 31:** Wrote RESEARCH, PRD, SPEC, PROMPTS and this handoff. No
  code, no installs, no commits.
- **2026-10-31:** The coordinating session reconciled the Reader docs with the
  final Scan SPEC (see "Coordination with Scan") and wrote
  `docs/pdf-editor/MERGE.md`.
- **2026-10-31 (session S0):** The owner answered PRD Q1–Q8, the shared questions
  and the dependencies (see "Decisions made"). Docs updated for highlights and
  notes (Phase 2b), the scanner-first order, import running and no site list.
  The docs went to `main` through a PR from branch `docs-offline-tools`.

## Current state + exact next step

Docs are written, the owner's answers are recorded (S0, 2026-10-31), and nothing
is built. The owner chose the scanner first, so the Reader waits:

1. **Scan Phases 1–4 must land first** (sessions A1–A4 in
   `docs/build-sessions.md`). The Library API mapping is already done (SPEC §5);
   Phase 1 step 1 only checks that the shipped names match.
2. **Then run session A5** (Reader Phase 1, Capture) on branch
   `reader-phase-1-2`. Phase 1 has no release, so A6 (Phase 2) continues on the
   same branch and asks the owner for the app name before it releases. A7 is
   Phase 2b (highlights and notes).
