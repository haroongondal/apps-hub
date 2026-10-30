# Merge plan: three app ideas into PDF Editor and Design Editor

Written 2026-10-31. The owner prefers adding new ideas to existing apps
(2026-10-30). This page records where each idea went, why, and the rules for the
two features that now share the PDF Editor. Each feature's own docs hold the detail.

## Where each idea went

| Idea                         | Host                                       | Docs                                         | Handoff                                   |
| ---------------------------- | ------------------------------------------ | -------------------------------------------- | ----------------------------------------- |
| PocketCam (scanner + OCR)    | PDF Editor, as **Scan**, plus the shared **Library** | `docs/pdf-editor/scan/`                      | `docs/handoffs/pdf-editor-scan.md`         |
| ZenRead (read-later + TTS)   | PDF Editor, as **Reader**                  | `docs/pdf-editor/reader/`                    | `docs/handoffs/pdf-editor-reader.md`       |
| SnapCompress (media tools)   | Design Editor, on the Mac and in a new Android Design Editor (owner's choice, 2026-10-30) | `docs/design-editor/` | `docs/handoffs/design-editor-media.md` |

Each folder has RESEARCH.md (sourced findings), PRD.md (requirements and owner
questions), SPEC.md (design and contracts) and PROMPTS.md (one prompt per phase).

## Why these hosts

- **Scan → PDF Editor.** The output of a scan is a PDF. The editor opens scans
  for markup, and PDF.js gives imported PDFs a search body. The only new runtime
  permission is CAMERA. (Scan RESEARCH Q8, SPEC §5.)
- **Reader → PDF Editor.** It reuses the WebView, file system, sharing, the
  Library and PDF.js, which also gives read-aloud for PDFs. "Save as PDF" opens
  in the editor. It adds about 0.7 MB. (Reader RESEARCH, SPEC §11.)
- **Media → Design Editor.** The research favoured a standalone app; the owner
  chose the Design Editor. It is cheap on the Mac, where FFmpeg runs from the
  main process. On Android it costs one extra phase: extracting the editor into
  `packages/design-editor-engine` and making the canvas usable by touch.
  (Design Editor RESEARCH, host verdict.)
- **Not one app for all three.** Media work shares no domain code with
  documents. It needs its own foreground service and native engine, and would
  bloat a documents app. Its only shared piece, the size budget in
  `packages/media-core`, can be reused by any app later.

## What the PDF Editor becomes

An offline documents app: open a PDF, scan pages or save a web page; find it
with full-text search, folders and tags; read it or listen to it; edit it; export
it as PDF or EPUB. Nothing leaves the phone except the pages the owner saves.

| | Today | After Scan and Reader |
| --- | --- | --- |
| Home | One "Open a PDF" button | Library: search, folders, tags, "+" (Open a PDF, Scan, Save a web page) |
| APK | 82.9 MB, four ABIs | About 48 MB, arm64 only (about 32 MB base + 15 MB Scan + 0.7 MB Reader; arm64 chosen 2026-10-31) |
| Runtime permissions | none prompted | CAMERA |
| Other manifest changes | RECORD_AUDIO, SYSTEM_ALERT_WINDOW and both storage permissions merged in by libraries | Those four removed; `allowBackup="false"` (owner, 2026-10-31); FOREGROUND_SERVICE, FOREGROUND_SERVICE_MEDIA_PLAYBACK, WAKE_LOCK (normal, no prompt), a TTS `<queries>` entry and a `text/plain` share target added |

## Shared touch points inside the PDF Editor

| Touch point | Owner | Rule for the other feature |
| --- | --- | --- |
| `packages/library-core`, `library.db`, one connection, write queue | Scan Phase 1 | Reach the database only through `library.db`. Never write the Library tables directly (Scan SPEC §4.7). |
| Migrations | Scan Phase 1 (`schema_tracks`) | Each feature gets its own track: `library`, `scan`, `reader`. Steps are append-only. |
| Files under `library/<id>/` | Scan SPEC §4.5 | Reader owns `content.xhtml`, `img/` and `text.json` (articles, plus a cache for PDFs, never for scans). |
| Home screen, add sheet, open-by-kind | Scan Phase 1 | Reader registers entries in `src/library/add-actions.ts` and `open-item.ts`. |
| `src/editor/bridge.ts` | Scan Phase 1 adds `docInfo` | Reader adds no bridge message. Its layout-aware PDF text pass runs in its own hidden WebView. |
| App manifest and `app.json` | Scan Phase 2 (permission removals, CAMERA, `allowBackup="false"`, arm64) | Reader adds its permissions in its module manifest, and the share filter in the app manifest plus `MainActivity.kt`. |
| `packages/ui/src/tokens.ts` | Reader Phase 2 (sepia palette) | A token change affects every app. Rebuild the CSS; the ui test checks contrast. |
| `tools/release/src/apps.ts`, `pdf-editor` `prepare` | Both | The engine build, then the reader-core build. |
| App version | Whoever releases | Version numbers in the phase tables are indicative. Each release bumps the version already shipped. |

**Releases.** CI releases every changed app when a branch merges to `main`
(`.github/workflows/ci.yml`). So each Scan or Reader phase lives on its own
branch and merges to `main` only when it is ready to reach the phone. Merge one
feature phase at a time.

## Order (owner's choice, 2026-10-31)

1. **Scan Phase 1: Library.** Required first by both features.
2. **Scan Phases 2–4: camera, pages, OCR.** The owner wants the scanner first. These bring
   the native module, CAMERA, backup off and arm64 only.
3. **Reader Phases 1, 2 and 2b: save, read, highlight.** No new native code. Reader Phase 1
   keeps the manifest as Scan Phase 2 left it.
4. **Reader Phases 3–6: offline queue, export, listening.** Scan read-aloud needs Scan
   Phase 4, which is already in.
5. **Scan Phase 5 and Reader Phase 7: hardening and import.** Then iOS, which is optional for both.

The research recommended Reader Phases 1–2 before the scanner (no native code, useful every
day); the owner chose the scanner first (question A3). Paste-ready prompts for every session,
in this order, are in `docs/build-sessions.md`. The Design Editor runs on its own track
(`docs/design-editor/SPEC.md` §17), with the phone encoder spike first.

## Owner decisions (session S0, 2026-10-31)

Every question below was answered on 2026-10-31. Each feature's answers are under
"Decisions made" in its handoff (`docs/handoffs/pdf-editor-scan.md`, `pdf-editor-reader.md`,
`design-editor-media.md`).

**A. Questions covering both PDF Editor features**

1. **App name** (Scan Q8, Reader Q1): decide before the first Reader release (session A6).
   "PDF Editor" stays until then; the package `com.haroon.pdfeditor` stays either way.
2. **arm64 only** (Scan Q3, Design Editor Q8): yes, for the PDF Editor and the Android
   Design Editor.
3. **Order:** the scanner first (Scan Phases 2–4 before Reader Phase 1). This departs from
   the recommendation; see "Order" above.
4. **Arabic and Urdu search:** normalised from v1, in Scan Phase 1 (Scan SPEC §4.3). This
   departs from the recommendation to defer it.
5. **Dependencies:** every proposal approved: Scan's CameraX 1.6.2, Tesseract4Android 4.9.0
   from JitPack, the English fast model, the GlyphLessFont, expo-sqlite ~16.0.10 and
   expo-clipboard ~8.0.8; Reader's `@mozilla/readability` 0.6.0, `dompurify` 3.4.17,
   `fflate` 0.8.3, `expo-print` ~15.0.8, `androidx.media` 1.7.0 and the sepia token.

Answers that touch the whole app: Android backup is off (`allowBackup="false"`, Scan Q5), so
scans and articles stay only on the phone.

**B. Scan only** (`docs/pdf-editor/scan/PRD.md` §10): Kotlin edge detector, Tesseract with
English fast from JitPack, editor saves become library items, backup off, English only in v1
(Urdu and Arabic next, downloaded on request), originals kept.

**C. Reader only** (`docs/pdf-editor/reader/PRD.md` §10): highlights and notes **in** v1, as
a new Phase 2b, carried into exports (departs from the recommendation); import runs (the owner
has all three file types); online voices off unless switched on; no audio export; no site
list (Q7 skipped); A4.

**D. Design Editor** (`docs/design-editor/PRD.md` §10): H.264, the pinned FFmpeg 9.0.2
download, Email 18 MB, a WhatsApp preset at 16 MB (departs from the recommendation), minSdk
35, full canvas parity, thumbnails plus the system player, arm64 only, one new icon for the
Mac and Android apps, location metadata dropped.
