# Scan: save, polish, image export and card mode (design)

Date 2026-11-18. Branch `scan-phase-3`, worktree `.claude/worktrees/scan-phase-3`, from
origin/main 2b4aa8a. App `apps/pdf-editor-mobile`. Delta over `docs/pdf-editor/scan/`
(PRD, SPEC, PROMPTS); where this file is silent, SPEC wins.

## Why

The owner can't save a scan. On origin/main Scan stops after Phase 2: the camera captures
pages into `scan-session/`, and "Done" returns to the Library without saving anything
(`app/scan/capture.tsx`, handoff line "Done also returns to the Library until Phase 3 adds
review"). They want CamScanner's basics: save a scan as a PDF or as images, a polish step
with the three best filters, and a card mode (ID cards, licences).

## What we build

1. **Phase 3 as planned** (PROMPTS Phase 3, FR-10 to FR-12, FR-15 to FR-17, AC-6, AC-7, AC-14,
   AC-15): review screen with crop, rotate, filter, retake, delete, move, apply to all;
   Save creates a `scan` library item; scan view; import photos; add pages; share PDF; open
   in editor. No OCR (Phase 4 stays separate; `scan_pages.ocr_state = 'pending'`).
2. **Image export (new).** From the scan view and the page view:
   - "Save images" writes the processed JPEGs to the gallery (MediaStore, `Pictures/PDF
     Editor`, no permission on Android 10+).
   - "Share images" sends them through the share sheet (`ACTION_SEND_MULTIPLE` for several
     pages, `ACTION_SEND` for one) via our own FileProvider. All pages or the current page.
   - A black-and-white page exports its display JPEG, not the 1-bit data.
3. **Polish with three filters (new, replaces the plan's four).** Original stays as "no
   filter" so a bad result is always undoable. The three filters, all pure Kotlin:
   - **Magic** (the plan's `auto`, the default): background estimate, divide, percentile
     stretch; colour kept, shadows flattened, paper whitened. Tuned further with a mild
     saturation lift so stamps and ink stay vivid.
   - **Gray** (the plan's `gray`): luma, same normalisation, then an unsharp mask so text
     is crisp.
   - **Black and white** (the plan's `bw`): Sauvola, as SPEC §7.5.
   `PageFilter` stays `'original' | 'auto' | 'gray' | 'bw'` in the contract; only the labels
   change ("Original", "Magic", "Gray", "Black and white"). Polish also includes the
   existing crop, rotate and corner editing. No brightness sliders in v1.
4. **Card mode (new).** A `Segmented` Document / Card on the capture screen.
   - Detection: the same quad detector, with a card-shaped guide (ID-1, 85.6 × 53.98 mm,
     1.586:1, either orientation). In card mode the detector prefers a quad whose aspect is
     within 15% of 1.586 and the outline turns the accent colour only then.
   - Output size from the card's real shape, not A4: long side 1,600 px (about 475 dpi
     for a card, a few hundred KB).
   - Two ways to save, chosen on the review screen after the two captures:
     - **Separate pages**: each card is its own page (the normal path).
     - **One sheet**: front above back on one A4 page, each at actual card size, centred,
       with a margin. Native `composeCardSheet` draws both processed card images onto an
       A4 JPEG (2,480 × 3,508 px, 300 dpi), so PDF, image export and the scan view treat
       the sheet as an ordinary page.
   - Flow: capture asks "Front" then "Back" (hint text), then Done. One card is allowed
     (no back); the sheet then has one card.
   - Cards get the Magic filter by default, same editing as documents.
5. Version `expo.version` to 1.3.0 (PROMPTS Phase 3 step 5); Store release only on the
   owner's go.

## Goals, non-goals, anti-goals

- Goals: a scan the owner can keep, in two clicks from the camera; files they can send as
  PDF or images; text readable on real photos taken indoors; a card page they can attach to
  a form.
- Non-goals: OCR and the searchable PDF (Phase 4), brightness and contrast sliders, drag
  reorder, QR and ID-card field extraction, cloud anything, iOS, new dependencies.
- Anti-goals: a filter that makes pages worse than the original with no way back; a card
  sheet whose card size is wrong when printed; losing a capture session if the app dies.

## Constraints

FOSS only, zero telemetry, no new dependencies (SPEC §2; `expo-image-picker` and
`expo-sharing` are already approved or installed, the builder confirms in `package.json`).
Android only. No OpenCV. arm64 only. Install through the Store only, never `adb install`.
Desktop Electron tests are not run (owner rule). Each package's `test` script lists test
files by name. Erasable TypeScript, `.ts` imports. `@apps-hub/ui` for every colour.
Sentence-case copy, no emoji. Library methods are never called inside a
`library.db.transaction` callback.

## Approaches considered

- **A. Pure-Kotlin pipeline, new features on top (chosen).** No dependency cost; filters need
  tuning on real photos.
- **B. Add OpenCV.** Sturdier filters, +24.7 MB, the owner already ruled it out for v1.
  Kept as the fallback if the filters fail on the phone.
- **C. Ship save first, polish and cards later.** Two release rounds. Superseded: the owner
  asked to run everything in parallel; the work lands as separate commits per stream, so the
  save path can still ship alone if the others slip.

## Parallel plan

Skill: `cd-engineering-tools:parallel-agents-coord`, one worktree, file ownership below.

Step 0, serial, done by the lead before any stream starts (the contract freeze, small):
- `modules/pdf-scan/src/index.ts`: add `importImage`, `detectQuad`, `processPage`,
  `composeCardSheet`, `saveImagesToGallery`, `shareImages`, the `Segmented`-free types
  (`PageFilter`, `Rotation`, `ProcessRequest`, `ProcessResult`, `CardMode` on the camera
  view props and `CaptureEvent`).
- `src/scan/session-data.ts`: `ScanSession.mode: 'document' | 'card'`, per-page
  `side: 'front' | 'back' | null`, `sheet: boolean`.
- `packages/scan-core/src/types.ts` and the `scan` migration track (SPEC §4.2 verbatim).
- A fake `PdfScan` binding for TS tests.

| Stream | Owns (only it edits these) | Depends on |
| ------ | -------------------------- | ---------- |
| **N, native** | `modules/pdf-scan/android/**` (PageGeometry, Filters, BitPack, PageProcessor, card aspect in QuadDetector, `composeCardSheet`, MediaStore save, share intent, FileProvider, `PdfScanModule.kt`, Kotlin tests) | contract |
| **C, scan-core** | `packages/scan-core/**` (store, service, pdf-writer, jpeg, paper, tests, its `package.json`) | contract, fake binding |
| **U, screens** | `app/scan/review.tsx`, `app/scan/[id].tsx`, `app/scan/page.tsx`, `app/scan/capture.tsx`, `src/scan/crop-editor.tsx`, `src/library/open-item.ts`, `add-actions.ts`, the app's `package.json` and `app.json` | contract, scan-core types; uses the fake until N and C land |

Shared files, edited only by the lead at integration: `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
`AndroidManifest.xml`, root and app docs, the handoff. Integration order: N and C merge,
U wires to the real binding and service, then the verification commands below.

## Verification (report real output)

`pnpm --filter @apps-hub/scan-core test`, `pnpm test`, `pnpm typecheck`,
`pnpm --filter pdf-editor-mobile lint`, `... typecheck`, `... run doctor`,
`cd apps/pdf-editor-mobile/android && ./gradlew :pdf-scan:testDebugUnitTest :app:assembleDebug`.
Kotlin tests include the card sheet geometry (card drawn at 85.6 mm wide at 300 dpi = 1,011 px,
within 2 px) and the three filters on synthetic pages. On the phone, through the Store
only: scan a page, save, share PDF, save images, a card sheet, and compare the three filters
on a real receipt and a real book page.

## Left to the builder (my calls, mark them in the code review)

- Exact filter constants (saturation lift, unsharp radius), tuned on the phone.
- Whether "Save images" needs a "Saved to Photos" toast or a `Notice`.
- FileProvider authority name and cache subfolder.
- Card detection tolerance (15% is a start).
- If `expo-image-picker` is not installed, stop and ask for approval before adding it.
