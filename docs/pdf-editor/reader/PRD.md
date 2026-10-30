# Product requirements: Reader (save, read and listen, inside PDF Editor)

Written 2026-10-30. Inputs: `docs/pdf-editor/reader/RESEARCH.md` (sourced
findings) and the owner's brief ("ZenRead Reader & Web Archiver", merged into
PDF Editor). Architecture and contracts are in `docs/pdf-editor/reader/SPEC.md`.
Phase prompts are in `docs/pdf-editor/reader/PROMPTS.md`.

This feature builds on the shared Library that the Scan feature defines
(`docs/pdf-editor/scan/SPEC.md`, Scan Phase 1). The Reader doesn't redefine
the Library; it adds its own tables and a package next to it.

## 1. Product vision

PDF Editor becomes an offline documents app: capture (open a PDF, scan, save a
web page), read and listen, edit, export. The Reader is the "save a web page"
and "listen" part.

Share a page from Chrome and the app keeps a clean copy on the phone: text,
images and metadata, with no ads, no scripts and no account. Read it later in a
quiet layout with your choice of font, size and theme, or listen to it with the
screen off through the phone's own voices. Export one article or a whole folder
as an EPUB for an e-reader, or as a PDF that opens in the editor.

It is built for one owner, on one phone, installed only through the private
Store (`com.haroon.pdfeditor`). It never talks to a server of ours, because
there isn't one.

## 2. Problem statement

**Who:** the phone's owner. They read articles on the phone and want to keep
some for later, read them without clutter, and listen while doing something
else.

**Problem:** the tools that do this either died, cost a subscription, or need a
server.

- Pocket shut down on 8 Jul 2025 and deleted everyone's saves on 8 Oct 2025.
  Omnivore's hosted service ended in November 2024 (RESEARCH §2.1).
- Instapaper Premium costs $59.99 a year and Readwise Reader $7.99 a month
  billed yearly. They put TTS and full-text search behind the paywall. Matter
  has no Android app (RESEARCH §2.2).
- FOSS options (wallabag, Readeck, Karakeep) all need a server. The one
  standalone Android app is a year old (RESEARCH §2.3).
- Instapaper's newer voices are cloud voices, so the article text goes to a
  server (RESEARCH §2.2).

**Why it hurts:** a library that lives on someone else's server disappears when
the service does. Paying $60–$120 a year to listen to articles with a voice the
phone already has is poor value.

**Evidence:** RESEARCH §3 to §8 show that every part can run on the phone:

- Readability.js scores F1 0.947 on the Zyte benchmark.
- Android's TextToSpeech has the timing callbacks and offline voices we need.
- EPUB and PDF can be built locally.

## 3. User and jobs

**Primary user: the owner.** Redmi Note 14 Pro 4G (8 GB RAM, Android 16,
HyperOS), browsers Chrome and the HyperOS browser. Sideloads through the Store.
Wants no telemetry and no accounts.

| Job                               | Example                                                        | Done when                                                         |
| --------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| Keep a page for later             | Share a long article from Chrome while commuting               | It's in the library, offline, with its images                     |
| Read without clutter              | Open it at night in dark or sepia, larger text                 | Text only, chosen font and size, position remembered              |
| Listen while doing something else | Walk with the screen off                                       | It reads on, and the lock screen and headset controls work        |
| Take it to an e-reader            | Send a folder of saved articles to KOReader                    | One valid EPUB with a chapter per article                         |
| Keep or mark up a copy            | Turn an article into a PDF and annotate it                     | A PDF in the library that opens in the editor                     |
| Find something again              | Search a word remembered from an article                       | The article shows up with a snippet                               |
| Listen to a PDF or a scan         | Have a scanned letter or a report read aloud                   | It reads the text in page order                                   |

## 4. Decisions already made

| Decision         | Choice                                                                                                                                  | Source                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Host             | The Reader feature of PDF Editor (`apps/pdf-editor-mobile`, `com.haroon.pdfeditor`, brand `pdf`), not a new app                          | Owner, 2026-10-30              |
| Library          | Builds on the shared Library from Scan Phase 1 (`library.db`, `items` with kind `article`, `items_fts`); adds its own tables only         | Owner's brief                  |
| Platform         | Android first. iOS is the last phase and optional (no paid Apple account)                                                              | Owner, AGENTS.md               |
| Distribution     | Private Store only; never Play, never `adb install` on the phone                                                                       | AGENTS.md, memory              |
| Extraction       | `@mozilla/readability` 0.6.0 run inside a react-native-webview that loads the live page                                                | RESEARCH §3                    |
| Sanitising       | DOMPurify at capture and again at render, plus a CSP that allows only our own script. JavaScript stays on in the reader                 | RESEARCH §5 (contradicts the brief's "JS off") |
| Share target     | Own `SEND text/plain` intent filter, rewritten to a `pdfeditor://save` deep link. No dependency                                        | RESEARCH §4.2                  |
| Storage          | One `content.xhtml` per article, plus `text.json` and `img/`, under `library/<id>/`                                                     | RESEARCH §7.2                  |
| Text-to-speech   | Our own Expo module over Android TextToSpeech, in a `mediaPlayback` foreground service with a media session. Not expo-speech             | RESEARCH §8.1                  |
| Voices           | Offline voices only by default; network voices are an opt-in                                                                          | NFR-3                          |
| EPUB             | EPUB 3 with an NCX, built in TypeScript with fflate                                                                                    | RESEARCH §7.1, §7.2            |
| PDF              | expo-print; the PDF is saved into the Library and can open in the editor                                                              | RESEARCH §7.3                  |
| Fonts and themes | Atkinson Hyperlegible Next (default), system serif, system sans, Atkinson Mono. Themes: System, Light, Dark, Sepia (new reader tokens) | RESEARCH §6                    |
| Highlights       | Highlights and notes on articles, in v1 (Phase 2b, FR-18). Exports carry them                                                        | Owner, 2026-10-31 (Q2; RESEARCH §6 had them out) |
| Audio export     | Not in v1                                                                                                                             | RESEARCH §8.6, Q5              |
| Import           | Late phase (7): Pocket, Instapaper, Netscape bookmarks. The owner has all three                                                       | RESEARCH §9.2; owner, 2026-10-31 (Q3) |

## 5. Scope and requirements

### Functional requirements (FR)

- **FR-1: Save a web page from the app.**
  - The Library's "+" sheet gets "Save a web page". It opens a screen with one
    URL field (the system paste works) and a Save button.
  - Only `http` and `https` URLs are accepted. Anything else gets an error that
    says what was wrong.
- **FR-2: Save from a browser's share sheet.**
  - PDF Editor appears as a share target for text.
  - The app takes the last `http(s)` URL in the shared text and the shared
    title, opens the Save screen and starts at once.
  - Works with Chrome and the HyperOS browser.
- **FR-3: Clean extraction.**
  - The app loads the page, waits for it to settle, and keeps the article only.
    That covers the title, byline, site name, publish date, language, text
    direction, body and the images inside the body.
  - Images are downloaded into the item's folder, within the caps in NFR-4.
  - A page with little readable text (under 500 characters, or Readability
    calls it not readerable) is saved as **partial** and says so.
  - "Show page" reveals the live page, so the owner can close a cookie banner or
    log in, then tap "Save now".
- **FR-4: Pending and offline saves.**
  - A shared or typed URL is stored at once as a pending item, before
    extraction starts, so leaving the app early never loses it.
  - Pending items are processed one at a time while the app is in the
    foreground.
  - With no connection an item stays "Waiting for a connection" and doesn't use
    up a retry.
  - After 3 failed attempts it shows as failed, with the reason and "Try
    again".
- **FR-5: Duplicates and refresh.**
  - URLs are compared in canonical form: tracking parameters and the fragment
    stripped, and the page's own canonical URL used when it is on the same site.
  - Saving a URL that is already saved opens the existing item, with "Saved on
    <date>" and a Refresh action.
  - Refresh re-extracts the page, replaces the stored copy and keeps the reading
    position.
- **FR-6: Reader view.**
  - **Settings:** font (Atkinson, Serif, Sans, Mono), size (14–28 px in 2 px
    steps), line spacing (compact, normal, loose), margins (narrow, normal,
    wide) and theme (System, Light, Dark, Sepia).
  - Settings apply at once and are remembered for every article.
  - The header shows the title, site, byline, date saved and minutes to read
    (word count / 230 words a minute).
  - Links open in the system browser. "Open original" opens the source URL.
  - The page never loads anything from the network.
- **FR-7: Reading progress.**
  - The app saves the position (the block in view and the percentage) and
    restores it on open, also after a restart.
  - Library rows show the percentage read.
- **FR-8: To read and finished.**
  - An article is finished when the owner reaches 97% or marks it finished.
  - The Library's articles filter shows "To read" and "Finished".
- **FR-9: Library integration.**
  - Articles are Library items of kind `article`, with folders, tags, delete and
    search.
  - The Library's filter gets "Articles".
  - Rows show the site, minutes to read, progress and a status for pending,
    partial or failed items.
  - The article's plain text is indexed for full-text search.
- **FR-10: Export as EPUB.**
  - One article, or every article in a folder or tag (up to 50), as one EPUB 3
    book.
  - The book has a title page per article (title, byline, site, date saved,
    source URL) and its images.
  - The book is handed to the share sheet.
- **FR-11: Save as PDF.**
  - One article becomes an A4 PDF with selectable text. The PDF is added to the
    Library as a new `pdf` item next to the article.
  - It offers "Open in editor" and "Share".
- **FR-12: Listen.**
  - Read the article aloud with the phone's TTS engine.
  - **Controls:** play, pause and resume; previous and next paragraph; rate
    0.5×–3.0× and pitch 0.5–2.0 in 0.1 steps; voice choice.
  - The sentence being read is highlighted and kept in view. Tapping a paragraph
    while listening reads from there.
  - Rate, pitch and voice are remembered.
- **FR-13: Listen in the background.**
  - Speech continues with the screen off or the app in the background.
  - The lock screen, the notification and a headset button control play and
    pause and skip paragraphs.
  - It pauses when headphones are unplugged and when another app takes audio
    focus (a call, a video). It doesn't resume on its own after an unplug.
- **FR-14: Resume listening.**
  - Stopping or pausing saves the sentence position.
  - Listen on the same item later resumes there, also after the app was killed.
- **FR-15: Listen to PDFs and scans.**
  - Listen works on Library items of kind `pdf` and `scan` from their text. A
    PDF's text is rebuilt in reading order; a scan uses its OCR text.
  - The player shows the page being read. There is no in-page highlight for
    these in v1.
- **FR-16: Voices.**
  - The voice list shows only voices that are installed and work offline,
    preferring the article's language.
  - If none fits, the app says so and opens Android's text-to-speech settings.
  - A switch "Allow online voices" adds network voices, after a notice that the
    text goes to the voice's provider.
- **FR-17: Import.**
  - Import a Pocket export (zip or CSV), an Instapaper CSV or a Netscape
    bookmarks HTML file.
  - Each link becomes a pending article, with its tags and its read or archived
    state as finished.
  - Nothing is fetched until the owner opens the item or taps "Download all".
- **FR-18: Highlights and notes** (owner, 2026-10-31; Phase 2b).
  - Select text in an article, within one paragraph or across several, and tap
    "Highlight". It is marked at once and kept.
  - Tap a highlight to add, edit or delete its note, or to delete the highlight.
  - "Highlights" in the More sheet lists the article's highlights in reading
    order with their notes. Tapping one scrolls to it.
  - Highlights survive a restart and settings changes. After a Refresh each one
    moves to the same text in the new copy. One whose text is gone stays in the
    list under "Not found after refresh", with its note.
  - EPUB and PDF exports mark the highlighted text and end each article with its
    highlights and notes.
  - Articles only: PDFs and scans are marked up in the editor.

### Non-functional requirements (NFR)

- **NFR-1 (Speed):**
  - Median time from share to "Saved" is under 10 s on Wi-Fi for a typical news
    article (under 5,000 words, under 15 images). Hard timeout: 45 s.
  - A 10,000-word article renders its first screen in under 1 s.
  - Settings changes apply in under 300 ms.
- **NFR-2 (Offline):** a saved article looks the same in airplane mode, with its
  images. The reader and both exports make zero network requests.
- **NFR-3 (Privacy):**
  - No telemetry, no crash reporting, no third-party SDKs, no accounts.
  - While saving, network traffic goes only to the saved page (as any browser
    would load it) and to its image hosts.
  - TTS uses offline voices unless the owner opts in (FR-16).
  - All dependencies are FOSS (AGENTS.md rule 5).
- **NFR-4 (Storage caps):**
  - 5 MB per image, 25 MB of images per article, 60 images per article.
  - 5 MB of article markup.
  - EPUB bundles of up to 50 articles and 100 MB of images.
  - Over a cap, the extra images are left out and the article says how many.
- **NFR-5 (App size):** the APK grows by at most 1.5 MB (estimate 0.7 MB,
  RESEARCH §10).
- **NFR-6 (Listening):**
  - Gaps between sentences under 300 ms.
  - Play or resume starts speaking within 500 ms.
  - At least 60 minutes with the screen off on the owner's phone, once the
    HyperOS battery settings from the first-listen notice (SPEC §13) are set.
- **NFR-7 (Accessibility):**
  - Every reader theme passes WCAG AA for body and muted text (the
    `packages/ui` token test).
  - Every control has a TalkBack label.
  - Reader text follows the size setting, not the system font scale (the
    WebView uses `textZoom={100}` like the editor).
- **NFR-8 (Compatibility):**
  - The app's existing minimum SDK (24) holds.
  - The word-level highlight needs API 26 and an engine that reports ranges.
    The sentence highlight works everywhere.

### Safety rules (NEVER VIOLATE; each has a test)

1. **Saved content never runs script.** The reader page carries a CSP whose only
   allowed script is ours, by a per-render nonce. Stored markup is sanitised
   again at render.
2. **The reader never touches the network.** The CSP sets `default-src 'none'`.
   Images and fonts come only from `file:` and `data:`. Navigation away from
   the page is cancelled, and `http(s)` links go to the system browser.
3. **Capture results are untrusted data.** The app checks the per-run nonce,
   the message shape and size, and that every image URL is `http(s)`, before
   storing anything.
4. **Only `http(s)` is fetched.** `file:`, `content:`, `intent:`, `data:` and
   `javascript:` URLs are refused, whether shared, typed, imported or found in
   a page.
5. **Network voices are opt-in.** The default voice list never includes a voice
   that needs a connection.
6. **Caps are enforced in code** (NFR-4). A page can't fill the phone.

## 6. Acceptance criteria (AC)

- **AC-1:** Given Chrome on the phone showing a news article, when the owner
  shares it to PDF Editor, then the Save screen opens. Within 15 s on Wi-Fi the
  article is in the Library with its title, site and minutes to read. In
  airplane mode it opens with all its images.
- **AC-2:** Given the same flow from the HyperOS browser, when the owner shares a
  page, then the URL and title are picked up and the article is saved.
- **AC-3:** Given the phone is offline, when the owner shares a URL, then a
  pending item appears within 1 s, marked "Waiting for a connection". When the
  phone is back online and the app is in the foreground, the item is saved
  without another tap.
- **AC-4:** Given an article that is already saved, when the same URL is shared
  with `utm_source`, `fbclid` and a `#:~:text=` fragment added, then no new item
  is created and the existing one opens with "Saved on <date>" and Refresh.
- **AC-5:** Given the fixture page `hostile.html` (a `<script>`, an `onerror`
  handler, a `javascript:` link, a remote `<iframe>`, a remote CSS background),
  when it is saved and opened, then no fixture script runs and the reader makes
  0 network requests (both checked by `test:web`). The article text is intact.
- **AC-6:** Given the fixture pages `lazy.html` (images in `data-src` and
  `srcset`) and `spa.html` (content rendered by script after load), when they
  are saved, then all body images and all body text are present.
- **AC-7:** Given an open article, when the owner switches to Sepia and 22 px,
  then the page updates within 300 ms, the same paragraph stays in view, and the
  next article opens with the same settings.
- **AC-8:** Given an article read to 40%, when it is reopened, including after
  the app is force-stopped, then it opens with the same block in view (±1
  block).
- **AC-9:** Given an article with 10 images, when it is exported as EPUB, then
  epubcheck 5 reports 0 errors and KOReader on the phone opens it with the title
  page and the images.
- **AC-10:** Given a folder of 20 saved articles, when the folder is exported as
  EPUB, then the book has 20 chapters in its table of contents, and epubcheck
  reports 0 errors.
- **AC-11:** Given a 5,000-word article with 5 images, when the owner taps "Save
  as PDF", then a `pdf` item appears in the Library within 10 s. Opening it in
  the editor shows the text as editable lines.
- **AC-12:** Given Listen has started, when the screen is off for 30 minutes,
  then speech continues with no gap over 1 s. The lock screen shows the title
  with working play/pause and next/previous paragraph.
- **AC-13:** Given playback through headphones, when they are unplugged or a
  phone call starts, then speech pauses within 1 s. After an unplug it stays
  paused.
- **AC-14:** Given Listen stopped at sentence 120 and the app was then
  force-stopped, when the owner taps Listen on the same article, then it resumes
  at sentence 120.
- **AC-15:** Given the only installed voices for the article's language need a
  network, when Listen starts with "Allow online voices" off, then no network
  voice is used. The app explains how to install an offline voice and opens the
  TTS settings.
- **AC-16:** Given a 12-page text PDF in the Library, when the owner taps Listen,
  then it reads page 1 first, in reading order, without repeating running
  headers. The player shows "Page n of 12".
- **AC-17:** Given a Library of 2,000 articles, when the owner searches a word
  that appears only in one article's body, then that article is listed with a
  snippet within 100 ms of the last keystroke.
- **AC-18 (FR-17):** Given a Pocket `pocket.zip` with 500 rows, when it
  is imported, then 500 pending articles exist with their tags. Rows marked
  `archive` are finished. Nothing is downloaded until asked.
- **AC-19 (FR-18):** Given an open article, when the owner selects text across
  two paragraphs and taps Highlight, then it is marked within 300 ms. After the
  app is force-stopped and the article reopened, the same text is marked.
- **AC-20 (FR-18):** Given an article with a highlighted passage that has a
  note, when the article is refreshed and the passage is still on the page, then
  the highlight and note sit on the same text. When the passage is gone, the note
  is listed under "Not found after refresh".
- **AC-21 (FR-18):** Given an article with 3 highlights, one with a note, when it
  is exported as EPUB and saved as PDF, then both mark the three passages and end
  with the highlights and the note, and epubcheck reports 0 errors.

## 7. Success metrics

There's no telemetry, so the owner measures these on the phone.

| Kind      | Metric                                                                                     | Target                         |
| --------- | ------------------------------------------------------------------------------------------ | ------------------------------ |
| Primary   | Share-to-saved success on the first 20 different sites the owner shares from after Phase 2 ships (no fixed list: Q7 skipped, 2026-10-31) | 18 of 20 saved, not partial    |
| Secondary | Median share-to-saved time on those saves                                                  | Under 10 s on Wi-Fi            |
| Secondary | A 30-minute screen-off listen without a stop                                               | Passes on the Redmi            |
| Guardrail | Network requests made by the reader page                                                   | **0**                          |
| Guardrail | Scripts from saved content that execute                                                    | **0**                          |
| Guardrail | Network voices used while "Allow online voices" is off                                     | **0**                          |

## 8. Out of scope

- **Highlights on PDFs and scans** (the editor marks up PDFs), searching note
  text, and exporting notes on their own. Article highlights and notes are in
  v1 (FR-18).
- **Audio export** to WAV or AAC (Q5).
- **Sync, accounts, a server, a browser extension.**
- **RSS, newsletters, Kindle sending, AI summaries, translation.**
- **Multi-page articles.** Page one is saved, and the article says it may
  continue.
- **Cookie-banner rule lists, ad blocking, paywall bypass.** "Show page" is the
  fallback.
- **Listening queues across articles and a sleep timer.** A queue is a cheap
  follow-up once FR-13 works.
- **Reader on the Electron desktop app.** `apps/pdf-editor-desktop` is
  unchanged.
- **iOS** before the last phase. It is optional (no paid Apple account; the
  Store is Android-only).

## 9. Dependencies and risks

| Risk or dependency                                    | Effect                                                         | Mitigation                                                                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Scan Phase 1 (Library) not landed                     | Nothing to build on                                            | Reader Phase 1 starts only after it; SPEC §5 lists what the Reader needs from it                                              |
| A site blocks or breaks in a WebView                  | Partial or failed save                                         | "Show page" and "Save now"; a user-agent override is the next step (RESEARCH §3.3)                                           |
| Capture page tampers with our script                  | Bad markup reaches storage                                     | Safety rules 1 to 3: nonce, validation, re-sanitising and the CSP at render                                                  |
| `evaluateJavascript` blocked by the page's CSP        | Live settings changes fail                                     | Fallback: re-render with the new settings at the same block (SPEC §8.4); checked in Phase 2                                   |
| expo-print output rasterised or stalls on big articles | PDF text not editable; slow export                            | Check in Phase 4; fallback is a small Kotlin print function in our module (RESEARCH §7.3)                                      |
| HyperOS kills the speech service                      | Listening stops with the screen off                            | Foreground service and onboarding notice (Autostart, battery "No restrictions"); measured in Phase 6                         |
| Default engine has no offline voice or no word timing | Silence offline; no word highlight                             | Offline filter and a settings link (FR-16); sentence highlight is the baseline                                               |
| DOMPurify advisories                                  | A bypass in a new version                                      | Pin ≥ 3.4.17; avoid risky modes; CSP stops scripts even if sanitising fails                                                  |
| Google developer verification (Store-wide)            | Certified phones may refuse sideloaded packages                | Store-level task already noted in the Deputy research; not specific to the Reader                                            |
| App name                                              | "PDF Editor" no longer describes the app                       | Q1                                                                                                                            |

## 10. Open questions for the owner

Answered on 2026-10-31 (session S0). The answers are under "Decisions made" in
`docs/handoffs/pdf-editor-reader.md`.

1. **Q1, name.** The app saves web pages, scans, reads aloud and edits PDFs, but
   its name and brand name are "PDF Editor". Rename only the display name and
   keep `com.haroon.pdfeditor`? The Scan docs ask the same question, so one
   answer covers both. Recommendation: decide before the first Reader release.
2. **Q2, highlights.** Leave highlights and notes out of v1? Recommendation:
   yes, out, and revisit after a month of use.
3. **Q3, import.** Do you have a Pocket export from before Oct 2025, an
   Instapaper CSV or a bookmarks file you want in? If not, Phase 7 is skipped.
4. **Q4, online voices.** Keep network voices off unless switched on, with a
   notice? Recommendation: yes.
5. **Q5, audio export.** Leave "save as audio" out of v1? Recommendation: yes.
   WAV is about 173 MB an hour and needs encoding work.
6. **Q6, dependencies.** Approve the proposals in SPEC §1.2:
   - `@mozilla/readability` 0.6.0
   - `dompurify` 3.4.17
   - `fflate` 0.8.3
   - `expo-print` ~15.0.8
   - `androidx.media:media` 1.7.0
   - the `sepia` reader palette added to `packages/ui/src/tokens.ts`
7. **Q7, eval sites.** List the 20 sites you read most. They become the save
   checklist for Phase 1 and Phase 3.
8. **Q8, PDF page size.** A4 or US Letter for "Save as PDF"? Recommendation: A4.
