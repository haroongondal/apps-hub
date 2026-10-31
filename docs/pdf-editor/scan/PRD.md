# Product requirements: Scan and Library in PDF Editor

Written 2026-10-30. Inputs: `docs/pdf-editor/scan/RESEARCH.md` (feasibility, sourced) and
the owner's brief ("PocketCam OCR & Document Scanner", merged into PDF Editor). Architecture
and contracts are in `docs/pdf-editor/scan/SPEC.md`; phases in `docs/pdf-editor/scan/PROMPTS.md`.

Scope of this document: the **Scan** feature and the shared **Library** it builds on. The
**Reader** feature (read-later web archiver) is specified separately and builds on the same
Library contract (SPEC §4).

## 1. Product vision

PDF Editor becomes a private document app for the phone: scan paper, keep PDFs and saved
articles in one searchable library, and edit any of them. Everything happens on the device.
There is no account, no upload and no subscription.

Scan turns the camera into a document scanner. It finds the page's edges, takes the picture
when the page is steady, flattens the perspective, cleans up the contrast, reads the text,
and saves a PDF whose text can be searched, selected and copied.

> Stack: React Native + Expo (UI), a Kotlin Expo local module (camera, image processing,
> OCR), pure TypeScript packages (library, PDF writer). Requirements here don't depend on the
> stack; the SPEC carries it.

## 2. Problem statement

**Who:** the owner, on a Redmi Note 14 Pro 4G (8 GB RAM, Android 16, HyperOS). Receipts,
letters, forms, contracts, notes and book pages come in on paper and need to end up as
searchable PDFs.

**Problem:**
- The good scanners cost $5–$10 a month and put OCR, Office export or editing behind the
  paywall (RESEARCH §7).
- CamScanner and Adobe Scan push OCR or storage through their clouds; CamScanner shares
  device IDs for advertising and shipped a malicious ad library in 2019 (RESEARCH §7).
- Microsoft Lens, the free option, was retired in 2026.
- PDF Editor today opens one PDF at a time from the file picker. Nothing is kept, so there is
  nothing to search.

**Why it hurts:** private papers (bank letters, IDs, medical forms) are exactly what the
owner shouldn't hand to an ad-funded cloud, and a scan that can't be searched is hard to find
later.

**Evidence:** RESEARCH §2–§5 show each step works offline with FOSS parts on this phone class:
CameraX for capture, a Kotlin detector with a platform warp, Tesseract at about 3–5 s per page
with under 0.2% character errors on warped phone photos (one third-party benchmark), and a
small PDF writer for the text layer.

## 3. Users and jobs

**Primary user: the owner.** Technical, sideloads through the private Store, wants no
telemetry, reads and writes English first.

| Job                                | Example                                                    | What matters                                   |
| ---------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| Scan a multi-page document         | A 6-page contract, page after page                         | Auto-capture, no taps per page, page order     |
| Keep a receipt                     | Lunch receipt for expenses                                 | Fast capture, readable text, find it by amount |
| Find something later               | "That letter from the council about parking"               | Search inside the text, not only titles        |
| Send a clean PDF                   | Signed form back by email                                  | Small file, straight edges, share sheet        |
| Mark up a scan                     | Sign or annotate a scanned form                            | Open in the existing editor                    |
| Organise                           | Folders per year or topic, tags like "tax" or "medical"    | Folders, tags, filters                         |

There is no secondary user. Sharing a library between people is out of scope (§8).

## 4. Decisions

| Decision                   | Choice                                                                                                                       | Source                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Host                       | The Scan feature of PDF Editor, not a new app                                                                                 | Owner (merge preference); RESEARCH §10   |
| Shared library             | One `library.db` and `library/<id>/` folder layout, shared with Reader; Library ships first (Phase 1)                          | Brief; SPEC §4                           |
| Platform order             | Android first; iOS last and optional (no paid Apple developer account)                                                        | Owner; AGENTS.md                         |
| Distribution               | Private Store only (`pnpm release pdf-editor`); never Play, never `adb install` on the phone                                   | AGENTS.md; memory                        |
| Camera                     | CameraX 1.6.2 inside our own Expo module                                                                                      | RESEARCH §4                              |
| Edge detection and warp    | Pure Kotlin detector and filters; the platform's 4-point perspective warp. No OpenCV in v1                                    | RESEARCH §2; owner, 2026-10-31 (Q1)      |
| OCR                        | Tesseract4Android 4.9.0, English `tessdata_fast` in the APK, behind a port so the engine can change                            | RESEARCH §3; owner, 2026-10-31 (Q2)      |
| Excluded                   | ML Kit (text and document scanner), Google Play services, Firebase, vision-camera, expo-camera, any GPL model                 | RESEARCH §2–§4; AGENTS.md rule 5         |
| Searchable PDF             | Written by a TypeScript writer outside the WebView: JPEG pages untouched plus an invisible text layer                          | RESEARCH §5                              |
| ABIs                       | arm64-v8a only for the whole app (82.9 MB → about 32 MB before Scan)                                                          | RESEARCH §9; owner, 2026-10-31 (Q3)      |
| Permissions                | CAMERA added; RECORD_AUDIO, SYSTEM_ALERT_WINDOW, READ and WRITE_EXTERNAL_STORAGE removed                                       | RESEARCH §8                              |
| Export                     | Through the system share sheet (covers Files, Drive, email, other apps)                                                       | RESEARCH §8                              |
| Editor saves               | An edited PDF is saved to the Library as a new item, then the share sheet opens as today. The original is never changed       | This PRD; owner, 2026-10-31 (Q4)         |

## 5. Scope and requirements

### Functional requirements: Library (Phase 1, shared with Reader)

- **FR-1: Library home.** The home screen lists the library: folders first, then items,
  newest first. Each item shows a thumbnail, title, kind (PDF, scan, article), page count,
  date and size. Tapping opens it: PDFs in the editor, scans in the scan view. Sort by
  recent or by title.
- **FR-2: Add.** A "+" button opens a sheet with "Scan a document", "Import photos" and
  "Open a PDF". Reader adds "Save a web page". "Open a PDF" copies the picked file into the
  library, then opens it in the editor.
- **FR-3: Folders.** Create, rename, move (into another folder or the top level) and delete
  folders. Folders nest. Folder names are unique within their parent, ignoring case. Deleting
  a folder moves its items and subfolders up one level; it never deletes items.
- **FR-4: Tags.** Add and remove tags on any item. Tags are created on first use and removed
  when no item uses them. The list can be filtered by one tag.
- **FR-5: Search.** One search box finds items by title and by body text: OCR text for
  scans, extracted text for PDFs, article text for Reader. Results rank title matches above
  body matches and show a short snippet with the matched words highlighted. Prefix matching
  ("invo" finds "invoice"); accents ignored. Arabic and Urdu are normalised from v1
  (harakat, tatweel and the ي/ی and ك/ک variants ignored; owner, 2026-10-31).
- **FR-6: Item actions.** Rename, move to a folder, edit tags, share as PDF, delete (with a
  confirmation naming the item). Deleting removes the item's files.
- **FR-7: Editor round trip.** When the editor saves, the edited PDF is added to the library
  as a new item next to the original ("<title> (edited)") and the share sheet opens as
  today. The editor reports each page's text so PDFs become searchable (FR-5).

### Functional requirements: Scan

- **FR-8: Capture.** A full-screen camera shows a live outline of the detected page. With
  auto-capture on (the default), the picture is taken when the page is steady and sharp; a
  ring shows the countdown. The shutter button always works. Torch toggle. Haptic and a
  count on each capture.
- **FR-9: Batch.** Capture continues page after page until "Done". After an auto-capture,
  the next one waits until the page changes (turned or replaced), so the same page isn't
  taken twice. The last capture's thumbnail and the page count stay visible.
- **FR-10: Import photos.** Pick one or more photos with the system photo picker; each goes
  through the same detection and review as a camera capture.
- **FR-11: Review and edit pages.** For each page: drag the four corners to correct the
  crop, rotate by 90°, choose a filter, retake or delete. Reorder pages. "Apply to all pages"
  for the filter. Filters: Original, Auto (even lighting and contrast, colour kept; the
  default), Grayscale, Black and white.
- **FR-12: Save.** "Save" creates a library item of kind scan, titled "Scan
  2026-10-31 14:05" until renamed, in the folder the owner was in. An unsaved capture session
  survives the app being closed; the Library offers to resume or discard it.
- **FR-13: Text recognition.** After saving, each page's text is recognised on the device,
  in the background, one page at a time. The scan view shows progress ("Reading text: 3 of
  12"). Recognised text feeds search (FR-5). If the app is closed, recognition resumes where
  it stopped the next time the app starts. A page that fails is marked and skipped; the
  owner can retry it.
- **FR-14: Searchable PDF.** "Share PDF" builds a PDF of the scan: one page per scanned
  page, the cleaned image, and an invisible text layer placed over each word, so the text can
  be searched, selected and copied in any PDF viewer. Pages without recognised text have no
  text layer.
- **FR-15: Scan view.** Shows the pages, recognition progress, and the actions: Share PDF,
  Open in editor, Add pages, Copy text (whole document), and per page: view image or text,
  edit (FR-11).
- **FR-16: Open in editor.** Opens the scan's PDF in the existing editor. Saving there
  follows FR-7.
- **FR-17: Add pages.** Capture or import more pages into an existing scan; they go to the
  end and are recognised like the others.

### Non-functional requirements

- **NFR-1 (Speed, on the owner's phone):**
  - Live outline updates at 10 frames a second or more; detection takes ≤ 60 ms a frame.
  - Auto-capture fires within 1.5 s of the page being held steady.
  - A captured page appears in review within 1.5 s.
  - Text recognition takes ≤ 6 s a page (median, English, A4).
  - Share PDF for 20 pages is ready in ≤ 3 s once text is recognised.
  - Search returns in ≤ 300 ms on a library of 500 items and 10,000 recognised pages.
- **NFR-2 (Size):** the arm64-only release APK is ≤ 50 MB (estimate about 47 MB, RESEARCH
  §9). A page is stored at about 0.5 MB in colour (200 dpi JPEG, quality 80) plus its
  original (≤ 3,000 px long side); a 20-page colour scan's PDF is ≤ 14 MB.
- **NFR-3 (Memory):** at most one full-resolution page is held in memory at a time in
  processing, recognition and PDF writing. Peak memory during recognition ≤ 600 MB; a
  30-page batch completes without running out of memory.
- **NFR-4 (Privacy):**
  - The Scan and Library features make no network request.
  - No telemetry, no crash reporting, no analytics, no third-party SDK that collects data.
  - Files stay in app-private storage; they leave the phone only when the owner shares them.
  - New dependencies are FOSS with their licence checked (AGENTS.md rule 5); notices required
    by those licences (for example libjpeg's IJG notice) are shown in the app.
- **NFR-5 (Permissions):** CAMERA is the only runtime permission. It is asked for the first
  time the owner opens the camera, not at app start. Import uses the photo picker (no
  permission); export uses the share sheet (no permission).
- **NFR-6 (No data loss):**
  - Writes are atomic (write to a temporary file, then rename).
  - Library rows and files are kept consistent; files without a row are removed at start-up.
  - An interrupted recognition resumes; it never duplicates text.
  - Deleting a folder never deletes items.
- **NFR-7 (Accessibility):** every control has a label; the shutter, auto-capture state and
  capture count are announced; touch targets are ≥ 44 points; colours and fonts come only from
  `@apps-hub/ui`, which enforces WCAG AA contrast.
- **NFR-8 (Compatibility):** Android 13 and later (the phone runs 16), arm64 only. iOS later
  (Phase 6), with the same TypeScript code and native contract.

### Invariants (NEVER VIOLATE; each has a test or a phase check, SPEC §12)

1. **No network in Scan or Library.** No code in `packages/library-core`,
   `packages/scan-core` or the `pdf-scan` module opens a socket or calls `fetch`.
2. **No Google services.** No dependency on ML Kit, Play services, Firebase or LiteRT 2.x.
3. **Only library-core writes the Library tables** (`items`, `folders`, `tags`,
   `item_tags`, `items_fts`). Feature tables (`scan_pages`, Reader's) reference `items(id)`
   and cascade on delete.
4. **Folders never delete items.** Deleting a folder moves its content up.
5. **The original is never overwritten.** Editing a PDF or scan creates new files; an
   original PDF's bytes are never changed in place.
6. **One page in memory.** Processing, recognition and PDF writing handle one page at a
   time.

## 6. Acceptance criteria

Measured on the owner's phone with a Store-installed release build unless a test is named.

- **AC-1 (Library search):** Given three imported PDFs and one recognised scan, when the
  owner types a word that appears only inside the second PDF, then that PDF is the first
  result, its snippet shows the word highlighted, and the list updates within 300 ms.
- **AC-2 (Folders):** Given folder "Work" containing two items and a subfolder, when the
  owner deletes "Work", then both items and the subfolder appear at the level above and
  the item count is unchanged (`library-core` test and on the phone).
- **AC-3 (Tags):** Given items tagged "tax", when the owner picks the "tax" filter, then
  only those items show; when the last "tax" item loses the tag, the tag disappears from the
  filter list.
- **AC-4 (Detection):** Given 20 different pages (A4 and receipts; on wood, a desk, fabric
  and a light table; straight and tilted), when the owner points the camera at each, the
  outline sits on the page edges by eye within 2 s for at least 18 of 20. On the JVM,
  synthetic pages are found with every corner within 2% of the frame diagonal. On
  white-on-white surfaces detection may fail, and the crop then defaults to the full frame
  for manual adjustment.
- **AC-5 (Auto-capture):** Given an A4 page on a desk under room light, when the owner holds
  the phone steady over it, then the outline appears within 0.5 s, the page is captured
  within 1.5 s of holding steady, and the count goes up by one. Holding the phone over the
  same page for another 5 s captures nothing more.
- **AC-6 (Batch):** Given a 20-page stack, when the owner captures page after page, turning
  each page, then review shows 20 pages in capture order with no duplicates and no misses.
- **AC-7 (Perspective):** Given a page shot at about 30° from vertical, the output has
  straight edges: on the JVM test with a synthetic quad, each warped corner lands within 2 px
  of the target rectangle's corner; on the phone, a printed grid's lines deviate by ≤ 1% of
  the page width from straight.
- **AC-8 (Recognition):** Given the five-page English fixture set (printed, 10–12 pt,
  photographed on the phone), recognition reaches ≤ 3% word error rate and ≤ 6 s a page
  (median).
- **AC-9 (Searchable PDF):** Given a recognised 3-page scan, when its shared PDF is opened in
  Chrome on the Mac, then Ctrl+F finds a word from page 3, the highlight covers the printed
  word (at least 80% overlap by eye), and copy and paste gives the recognised text. The same
  works in the app's own editor (PDF.js).
- **AC-10 (Resume):** Given recognition running on page 4 of 10, when the owner force-stops
  the app and opens it again, then recognition continues from page 4, all 10 pages end up
  recognised, and searching a word from page 2 returns the scan once.
- **AC-11 (Offline):** Given airplane mode, the whole flow (capture, review, save,
  recognise, search, share PDF) works.
- **AC-12 (Permissions):** Given a fresh install, the camera permission is requested only on
  the first "Scan a document"; denying it shows a notice with "Open settings". `aapt dump
  permissions` on the release APK lists CAMERA, INTERNET and VIBRATE and none of
  RECORD_AUDIO, SYSTEM_ALERT_WINDOW, READ_EXTERNAL_STORAGE or WRITE_EXTERNAL_STORAGE.
- **AC-13 (Size):** The release APK is ≤ 50 MB and contains only `lib/arm64-v8a`.
  `zipalign -c -P 16` passes.
- **AC-14 (Editor round trip):** Given a 10-page scan, when the owner taps "Open in editor",
  adds a text note and saves, then a new item "<title> (edited)" appears in the library, the
  scan itself is unchanged, and the share sheet opens.
- **AC-15 (Unsaved session):** Given 5 captured pages not yet saved, when the app is closed
  and reopened, the Library offers "Resume" with 5 pages, and "Discard" removes them.

## 7. Success metrics

No telemetry: the owner measures these on the phone and records them in
`docs/handoffs/pdf-editor-scan.md`.

| Kind      | Metric                                                        | Target                         |
| --------- | ------------------------------------------------------------- | ------------------------------ |
| Primary   | Share of real scans the owner keeps without re-taking a page  | ≥ 90% over the first 30 scans  |
| Secondary | Detection hit rate (AC-4), word error rate (AC-8)             | ≥ 90%; ≤ 3%                    |
| Secondary | Seconds per page: capture to review, recognition              | ≤ 1.5 s; ≤ 6 s                 |
| Secondary | APK size                                                      | ≤ 50 MB                        |
| Guardrail | Network requests made by Scan or Library                      | **0**                          |
| Guardrail | Items lost by a folder delete, crash or interrupted recognition | **0**                        |

## 8. Out of scope

- Cloud sync, backup service, accounts, sharing a library between people.
- OCR languages other than English in v1 (Arabic and Urdu search is in v1, FR-5). The
  engine, storage and settings allow more later (Q6). Next: Urdu and Arabic, downloaded from the Tesseract repository when the owner asks
  (owner, 2026-10-31).
- Handwriting recognition, tables to Excel, export to Word, fax, ID-card and QR modes.
- Page-curve dewarping (book spines); multi-column reading order beyond what Tesseract does.
- PDF passwords and signing (the editor may add them later; not part of Scan).
- A folder-picking export through the Storage Access Framework; the share sheet covers
  "Save to Files" and Drive.
- A desktop scanner (the Electron editor is unchanged except for the bridge event in FR-7).
- Learned corner detectors and OpenCV, unless the Phase 2 measurements fail AC-4 (Q1).

## 9. Dependencies and risks

| Risk or dependency                                   | Effect                                              | Mitigation                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Kotlin detector misses low-contrast pages            | Manual crop needed more often                       | Full-frame default crop; AC-4 measured in Phase 2; upgrade path in Q1                                          |
| Tesseract slower or less accurate on this phone than on the benchmark's | Recognition over 6 s a page or WER over 3% | Spike first in Phase 4; OpenMP flavour; PP-OCR fallback (Q2)                                                    |
| Tesseract4Android is on JitPack only and lags upstream (5.5.1 vs 5.5.4) | Build breaks if JitPack is down; slower fixes | Pin the exact version; restrict JitPack to that group; vendoring the AAR is the fallback                         |
| Multi-column pages read in the wrong order          | Copied text out of order                            | Search and the PDF layer still work word by word; known limit                                                   |
| Scans over 28 MB                                     | The editor's base64 bridge stalls near 40 MB        | Warn before "Open in editor"; 200 dpi default keeps 20 pages near 10 MB                                       |
| arm64-only build                                     | A 32-bit or x86 phone can't install the app         | Owner has one arm64 phone; the emulator is arm64 (Q3)                                                           |
| `allowBackup="true"`                                 | Android may copy private scans to Google Drive      | Set to `false` (owner, Q5, 2026-10-31); scans are lost with the phone unless shared or exported                 |
| Reader and Scan change the same database in parallel | Migration conflicts                                 | Per-feature migration tracks (SPEC §4.4)                                                                        |
| Camera behaviour on HyperOS                          | Capture size or focus differs from Pixel docs       | Phase 2 spikes on the phone                                                                                    |

## 10. Open questions for the owner

Answered on 2026-10-31 (session S0). The answers are under "Decisions made" in
`docs/handoffs/pdf-editor-scan.md`.

1. **Q1, edge detection.** Pure Kotlin detector (recommended: 0 MB, testable, about 600
   lines), an opencv-mobile static build of core + imgproc (about 3–5 MB, adds a C++ build),
   or the stock OpenCV SDK you suggested (+24.7 MB)? The Kotlin version can be replaced later
   behind the same interface.
2. **Q2, OCR engine.** Tesseract4Android with English fast data (recommended: +11.6 MB) or
   PaddleOCR PP-OCRv6 on ONNX Runtime (+about 40 MB, line boxes only, possibly better on hard
   photos)? Also: is JitPack acceptable as the source of the Tesseract AAR, or should it be
   vendored in the repo (12.85 MB file)?
3. **Q3, arm64 only.** Ship the whole app for arm64-v8a only? Saves about 51 MB.
4. **Q4, editor saves.** Should saving in the editor add the edited PDF to the library as a
   new item (recommended, FR-7), or only open the share sheet as today?
5. **Q5, Android backup.** Keep `allowBackup="true"` (Android may copy app data, up to
   25 MB, to Google Drive) or set it to false (scans stay only on the phone and are lost with
   it)?
6. **Q6, more languages.** Which languages after English, and how should their 1.5–4 MB data
   files arrive: bundled in the APK, or downloaded on request from the Tesseract GitHub
   repository (a network request the owner starts)?
7. **Q7, originals.** Keep each page's original photo (about 1.5 MB a page) so the crop can
   be redone at any time (recommended), or delete originals once text is recognised?
8. **Q8, app name.** With a library, scanner and reader, does "PDF Editor" still fit, or
   should the app be renamed (package `com.haroon.pdfeditor` stays either way)?
