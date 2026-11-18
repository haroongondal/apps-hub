# Scan: save, polish, image export and card mode Implementation Plan

> **For agentic workers:** execute with `cd-engineering-tools:parallel-agents-coord` (the owner's
> rule replaces `superpowers:subagent-driven-development` and `superpowers:executing-plans`).
> Steps use checkbox (`- [ ]`) syntax. Streams N, C and U run in parallel after Task 0.

**Goal:** A scan can be reviewed, polished with three filters, saved to the Library, exported as
PDF or images, and scanned in a card mode that can lay front and back on one A4 sheet.

**Architecture:** Pure-Kotlin page pipeline in the existing `pdf-scan` Expo module; a new pure-TS
`@apps-hub/scan-core` package behind ports (native, files, SQL), the same way `library-core` is
built; React Native screens in `apps/pdf-editor-mobile` that only render and call the service.

**Tech Stack:** Kotlin (Android `Bitmap`, `Matrix`, `MediaStore`, `FileProvider`), TypeScript 5.9
erasable syntax (`.ts` imports, `node --test`, `node:sqlite` as the real SQL engine), Expo SDK 54,
`expo-image-picker`, `expo-sharing`, `expo-file-system` (all already installed), gesture-handler +
reanimated.

**Spec:** `docs/superpowers/specs/2026-11-18-scan-save-polish-cards-design.md`, over
`docs/pdf-editor/scan/SPEC.md` (§4.2 scan track, §4.5 file layout, §6, §7.1, §7.5, §8, §11).

## Global Constraints

- No new dependency of any kind. If one seems needed, stop and ask the owner.
- Android only, arm64 only. Install on the phone only through the Store (`pnpm release`, owner's go). Never `adb install`.
- Never run the Electron e2e suites (`pdf-editor-desktop`, `design-editor`).
- TypeScript is erasable only (no enums, namespaces, parameter properties); imports end in `.ts`.
- A new `*.test.ts` does nothing until it is listed by name in that package's `test` script.
- Every colour and font comes from `@apps-hub/ui`; copy is sentence case, active voice, no emoji, no ALL-CAPS.
- A `Library` method is never called inside a `library.db.transaction` callback (the queue is held by the outer transaction).
- A `PageFilter` is `'original' | 'auto' | 'gray' | 'bw'`; their labels are "Original", "Magic", "Gray", "Black and white".
- File writes are `.tmp` then rename. Bitmaps are recycled. JPEG quality 90 for originals, 80 for processed pages, 70 for black and white.
- Card: ID-1, 85.6 × 53.98 mm, aspect 1.586; card pages process at long side 1,600 px; the sheet is A4 at 300 dpi, 2,480 × 3,508 px, cards at actual size (85.6 mm = 1,011 px wide), front above back, centred, 118 px margins.
- Commits carry no Claude attribution lines (owner's rule, memory `no-claude-attribution`).

## Review Focus

1. A page photographed with no detectable border (`quad` null): processing uses the full frame, never crashes; test in Task N3 and C4.
2. The app is killed between capture and save, or during save: no half-saved item appears in the Library; test in C4 (a failing `native.processPage` leaves no item row and no `library/<id>/` directory).
3. Save with 0 pages, or a card session with only a front: the save is refused with a clear error for 0 pages, and a one-card sheet is valid; tests in C4 and N4.
4. A very dark or an already pure-white page through Magic: no divide-by-zero, no NaN, output stays in 0..255; test in N2.
5. Saving images to the gallery twice: the second save adds new files, never overwrites or fails on a name clash (timestamped names); test in N5 (pure naming helper).

---

## Task 0: Contract freeze (lead, serial, before any stream starts)

**Files:**
- Modify: `apps/pdf-editor-mobile/modules/pdf-scan/src/index.ts`
- Modify: `apps/pdf-editor-mobile/src/scan/session-data.ts`, `apps/pdf-editor-mobile/src/__tests__/session-data.test.ts`
- Create: `packages/scan-core/package.json`, `tsconfig.json`, `src/types.ts`, `src/index.ts`
- Modify: `apps/pdf-editor-mobile/package.json` (add `"@apps-hub/scan-core": "workspace:*"`), `pnpm-lock.yaml` via `pnpm install`

**Interfaces — Produces** (every stream reads these; after this task only the lead edits them):

In `modules/pdf-scan/src/index.ts`, replace the "Phase 3 adds…" comment with:

```ts
export type PageFilter = 'original' | 'auto' | 'gray' | 'bw';
export type Rotation = 0 | 90 | 180 | 270;
export interface ImportResult { uri: string; width: number; height: number; quad: Quad | null }
export interface ProcessRequest {
  src: string; quad: Quad; rotation: Rotation; filter: PageFilter;
  out: string;          // absolute path without extension; writes <out>.jpg and, for 'bw', <out>.bits
  maxLongSide?: number; // default 2339
}
export interface ProcessResult {
  jpg: string; width: number; height: number;
  bits: string | null; bitsWidth: number | null; bitsHeight: number | null;
}
export interface SheetRequest { front: string; back: string | null; out: string } // processed card JPEG paths; out has no extension
export interface SheetResult { jpg: string; width: number; height: number }
// PdfScanModule gains (all path arguments accept an absolute path or a file:// URI):
//   importImage(src: string, dest: string): Promise<ImportResult>
//   detectQuad(src: string, card?: boolean): Promise<Quad | null>
//   processPage(req: ProcessRequest): Promise<ProcessResult>
//   composeCardSheet(req: SheetRequest): Promise<SheetResult>
//   saveImagesToGallery(paths: string[], album: string): Promise<number>   // count saved
//   shareImages(paths: string[], chooserTitle: string): Promise<void>
// ScanCameraViewProps gains: cardMode: boolean
```

Native error codes unchanged from SPEC §6.1 (`not_found`, `decode_failed`, `invalid_quad`, `out_of_memory`) plus `save_failed`.

In `src/scan/session-data.ts`: `ScanSession` gains `mode: 'document' | 'card'` and `sheet: boolean`; `SessionPage` gains `side: 'front' | 'back' | null`. `newSession(folderId, now, mode = 'document')` sets `mode`, `sheet: false`. `newPage(file, quad, side = null)`. `restoreSession` fills missing `mode`, `sheet` and `side` with `'document'`, `false` and `null` so a session saved by the Phase 2 build still loads.

In `packages/scan-core/src/types.ts` (scan-core must not import `pdf-scan`, a native module, so these are copies kept identical):

```ts
export type Quad = [number, number, number, number, number, number, number, number];
export type PageFilter = 'original' | 'auto' | 'gray' | 'bw';
export type Rotation = 0 | 90 | 180 | 270;
export type PageKind = 'page' | 'card' | 'sheet';
export interface OcrWord { t: string; b: [number, number, number, number]; c: number; l: number }
export interface ScanPage {
  pageId: string; position: number; kind: PageKind; quad: Quad; rotation: Rotation; filter: PageFilter;
  width: number; height: number; bitsWidth: number | null; bitsHeight: number | null;
  ocrState: 'pending' | 'done' | 'failed';
}
export interface SessionInput {
  folderId: string | null; appendTo: string | null; mode: 'document' | 'card'; sheet: boolean;
  pages: { file: string; quad: Quad | null; rotation: Rotation; filter: PageFilter; side: 'front' | 'back' | null }[];
}
export interface ProcessRequest { src: string; quad: Quad; rotation: Rotation; filter: PageFilter; out: string; maxLongSide?: number }
export interface ProcessResult { jpg: string; width: number; height: number; bits: string | null; bitsWidth: number | null; bitsHeight: number | null }
export interface ScanNative {
  processPage(req: ProcessRequest): Promise<ProcessResult>;
  composeCardSheet(req: { front: string; back: string | null; out: string }): Promise<{ jpg: string; width: number; height: number }>;
}
export interface ByteSink { write(bytes: Uint8Array): Promise<void> | void }
export interface ScanFiles {              // paths are absolute, no scheme
  makeDir(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;   // replaces an existing target
  copy(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;             // file or directory; no error when missing
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number>;             // bytes of a file, or the total of a directory tree
  read(path: string): Promise<Uint8Array>;
  open(path: string): Promise<ByteSink & { close(): Promise<void> }>;
}
```

- [ ] **Step 1: Write the failing test** in `session-data.test.ts`: `restoreSession` of JSON written without `mode`, `sheet` or `side` returns `mode: 'document'`, `sheet: false` and every page `side: null`; `newSession('f', 1, 'card').mode === 'card'`; `newPage('cap-1.jpg', null, 'front').side === 'front'`.
- [ ] **Step 2: Run** `node --test src/__tests__/session-data.test.ts` in the app folder. Expected: FAIL.
- [ ] **Step 3: Implement** the three `session-data.ts` changes above and the `index.ts` contract; create the `scan-core` package with the `package.json` shape of `library-core` (name `@apps-hub/scan-core`, `main`/`types` `src/index.ts`, `test` script listing test files by name, `typecheck`), a `tsconfig.json` copied from `library-core`, `src/index.ts` re-exporting `types.ts`; add the workspace dependency to the app; run `pnpm install`.
- [ ] **Step 4: Run** `node --test src/__tests__/session-data.test.ts` (PASS), `pnpm --filter @apps-hub/scan-core typecheck` and `pnpm --filter pdf-editor-mobile typecheck` (clean; the module functions are declared on the interface but unused).
- [ ] **Step 5: Commit** `git add -A && git commit -m "Scan: freeze the contract for save, filters and card mode"`.

Streams N, C and U start after this commit, each in its own agent, in this one worktree. Each edits only the files its tasks list.

---

# Stream N: native (`apps/pdf-editor-mobile/modules/pdf-scan/android/`)

All commands: `cd apps/pdf-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew :pdf-scan:testDebugUnitTest` (add `--tests '<class>'` for one). Only stream N edits `PdfScanModule.kt`, `AndroidManifest.xml` of the module, and Kotlin files.

### Task N1: Page geometry and bit packing

**Files:**
- Create: `core/PageGeometry.kt`, `core/BitPack.kt`, `src/test/.../core/PageGeometryTest.kt`, `BitPackTest.kt`

**Interfaces:** Produces
`object PageGeometry { fun outputSize(quadPx: DoubleArray, rotation: Int, maxLongSide: Int): Pair<Int, Int>; fun rotatedQuad(quad: DoubleArray, rotation: Int): DoubleArray }` (uses `Quads.rotate`) and
`object BitPack { fun pack(white: ByteArray, w: Int, h: Int): ByteArray }` (1 byte per pixel in, non-zero = white; out rows packed MSB-first, 1 = white, each row padded to whole bytes; not compressed, the caller deflates).

- [ ] **Step 1: Write failing tests.** `PageGeometryTest`: a 3000×2000 px upright rectangle quad `(0,0,1,0,1,1,0,1)` scaled to px gives `outputSize(..., 0, 2339) == (2339, 1559)`; rotation 90 gives `(1559, 2339)`; a source smaller than `maxLongSide` is never upscaled (1000×700 quad, max 2339 → `(1000, 700)`); a trapezoid uses `max(top, bottom)` and `max(left, right)` edge lengths. `BitPackTest`: a 10×2 image with the first pixel of row 0 white packs to `[0b1000_0000, 0b0000_0000, 0, 0]` (2 bytes per row).
- [ ] **Step 2: Run** the two classes. Expected: FAIL (unresolved reference).
- [ ] **Step 3: Implement** both objects as specified in SPEC §7.5 steps 2, 3 and 6.
- [ ] **Step 4: Run** the two classes. Expected: PASS.
- [ ] **Step 5: Commit** `Scan native: page geometry and bit packing`.

### Task N2: The three filters (`core/Filters.kt`)

**Files:** Create `core/Filters.kt`, `src/test/.../core/FiltersTest.kt`

**Interfaces:** Produces `object Filters` with, all in place on `IntArray` ARGB of `w × h`:
- `fun magic(argb: IntArray, w: Int, h: Int)`: background estimate (max filter on a ⅛-scale luma, window w/20, then box blur), divide each channel by it, stretch luma between its 1st and 99th percentiles, then lift saturation by 1.15 (clamped).
- `fun gray(argb: IntArray, w: Int, h: Int)`: BT.601 luma, the same normalisation and stretch, then an unsharp mask (radius 2 px box blur, amount 0.6).
- `fun sauvola(argb: IntArray, w: Int, h: Int, window: Int = 31, k: Double = 0.2): ByteArray`: gray first, then Sauvola (R = 128) with mean and variance at half resolution sampled bilinearly; returns 1 byte per pixel, 255 white, 0 black. Also writes the 0/255 result back into `argb` for the display JPEG.

- [ ] **Step 1: Write failing tests** on a synthetic page (white 400×300, black text-like bars, left-to-right brightness falling from 255 to 120 as a shadow): after `magic`, the standard deviation of background pixels (those not in a bar) is ≤ 6, every bar pixel is ≥ 60 darker than the background mean, and output channels stay in 0..255; after `gray`, red = green = blue for every pixel and edge contrast (bar vs neighbour) is at least the contrast after plain luma; after `sauvola`, every value is 0 or 255, ≥ 95% of bar pixels are 0 and ≥ 99% of background pixels are 255. Review-focus cases: an all-black image and an all-white image through `magic` and `gray` finish without exception and stay in 0..255.
- [ ] **Step 2: Run** `--tests '*FiltersTest'`. Expected: FAIL.
- [ ] **Step 3: Implement** the three functions on `IntArray`/`ByteArray` only (no Android classes, so the JVM test runs). Guard every division (background < 1 treated as 1; stretch with equal percentiles is a no-op).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Scan native: Magic, Gray and Black and white filters`.

### Task N3: Page processor, import and quad detection

**Files:** Create `android/PageProcessor.kt`; modify `PdfScanModule.kt`.

**Interfaces:** Consumes N1, N2. Produces `PdfScanModule` async functions `importImage`, `detectQuad`, `processPage` exactly as declared in Task 0. `PageProcessor.process(req)` implements SPEC §7.5: decode the upright original to ARGB_8888, build the quad in pixels (a null or missing quad is the full frame `0,0,1,0,1,1,0,1`), `PageGeometry.rotatedQuad`, `Matrix.setPolyToPoly`, draw, apply the filter, write `<out>.jpg` (quality 80; `bw` 70) and for `bw` also `<out>.bits` = `Deflater(9)` of `BitPack.pack(...)` at 1-bit size (long side 3,508 px, at most 1.5× the source), each via `.tmp` and rename, recycle bitmaps. `importImage` reuses `ScanCameraView.importUpright` logic: move that logic to a shared `android/ImageImport.kt` that both the view and the module call (the view's `importUpright` and `detectOn` are the only code moved; its behaviour stays). Add a `asFile(s: String): File` helper that accepts a path or a `file://` URI. Invalid quad (not 8 numbers in 0..1, or not convex) rejects `invalid_quad`; a missing source rejects `not_found`.

- [ ] **Step 1: Write the failing test** `PageProcessorLogicTest` (JVM, no Android classes) for the pure parts you factor out: `validateQuad(doubleArray)` accepts a convex quad and rejects a bow-tie, a 7-element array and values outside 0..1; `fullFrameQuad()` equals `[0,0,1,0,1,1,0,1]`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `PageProcessor`, the factored helpers, `ImageImport.kt`, and the three module functions (run on a background dispatcher; `busy` is not needed here).
- [ ] **Step 4: Run** `:pdf-scan:testDebugUnitTest :app:assembleDebug`. Expected: BUILD SUCCESSFUL.
- [ ] **Step 5: Commit** `Scan native: import, detect and process a page`.

### Task N4: Card sheet

**Files:** Create `core/SheetLayout.kt`, `android/CardSheet.kt`, `src/test/.../core/SheetLayoutTest.kt`; modify `PdfScanModule.kt`.

**Interfaces:** Produces `object SheetLayout { fun cardRects(hasBack: Boolean): List<IntArray> /* left, top, right, bottom in sheet px */ }` and `composeCardSheet` per Task 0. Sheet 2,480 × 3,508 px; card 1,011 × 637 px (85.6 × 53.98 mm at 300 dpi); horizontally centred; with two cards the gap between them is 118 px and the pair is vertically centred; with one card it sits where the front would. A source card whose aspect is portrait is rotated 90° onto the sheet. Card images are scaled to the rect (aspect preserved, letterboxed on white, no crop). Fills white, writes `<out>.jpg` quality 85 via `.tmp` and rename.

- [ ] **Step 1: Write the failing test**: `cardRects(true)` returns two rects each `1011 × 637` (±1), centred horizontally (left margin = right margin ±1), the first above the second with a 118 px gap; `cardRects(false)` returns one rect `1011 × 637` at the same position as the first of the two-card layout.
- [ ] **Step 2: Run** `--tests '*SheetLayoutTest'`. Expected: FAIL.
- [ ] **Step 3: Implement** `SheetLayout` and `CardSheet.compose`, and register `composeCardSheet`.
- [ ] **Step 4: Run** the unit tests, then `:app:assembleDebug`. Expected: PASS and BUILD SUCCESSFUL.
- [ ] **Step 5: Commit** `Scan native: compose front and back on one A4 sheet`.

### Task N5: Save to Photos and share images

**Files:** Create `android/Gallery.kt`, `android/ShareImages.kt`, `core/ImageNames.kt`, `core/ImageNamesTest.kt` (under test), `src/main/res/xml/pdfscan_paths.xml`; modify module `AndroidManifest.xml` and `PdfScanModule.kt`.

**Interfaces:** Produces `saveImagesToGallery(paths, album)`: MediaStore insert into `Pictures/<album>` with `IS_PENDING` set while writing, no permission, returns the count saved; `shareImages(paths, chooserTitle)`: `ACTION_SEND` for one path, `ACTION_SEND_MULTIPLE` for several, content URIs from a `FileProvider` with authority `${applicationId}.pdfscan.fileprovider`, `FLAG_GRANT_READ_URI_PERMISSION`. `object ImageNames { fun galleryName(base: String, epochMs: Long, index: Int): String }` returns `"<base>-<yyyyMMdd-HHmmss>-<index+1>.jpg"` with `base` stripped to `[A-Za-z0-9 _-]` (empty becomes `Scan`). The provider's `<paths>` expose the app cache and files directories only. Files shared must live under those, otherwise reject `not_found`.

- [ ] **Step 1: Write the failing test** `ImageNamesTest`: two calls with different `epochMs` give different names; the same instant with index 0 and 1 differ; `galleryName("a/b:c", …)` contains no `/` or `:`; an empty base gives a name starting `Scan-`.
- [ ] **Step 2: Run** `--tests '*ImageNamesTest'`. Expected: FAIL.
- [ ] **Step 3: Implement** the helper, `Gallery.kt`, `ShareImages.kt`, the provider and XML, and register both functions. Use `appContext.currentActivity ?: appContext.reactContext` for starting the chooser (new-task flag when there is no activity).
- [ ] **Step 4: Run** unit tests and `:app:assembleDebug`. Expected: PASS and BUILD SUCCESSFUL.
- [ ] **Step 5: Commit** `Scan native: save images to Photos and share images`.

### Task N6: Card-shaped detection

**Files:** Modify `core/QuadDetector.kt`, `android/ScanCameraView.kt`, `PdfScanModule.kt`, `QuadDetectorTest.kt` (add cases).

**Interfaces:** `DetectorConfig` gains `targetAspect: Double? = null` and `aspectTolerance: Double = 0.15`. When `targetAspect` is set, `findBest` skips (continues past) any component whose quad has `max(side)/min(side)` outside `targetAspect × (1 ± tolerance)`, where each side length is the mean of the two opposite edges. `ScanCameraView` gains `var cardMode: Boolean`; setting it swaps `detector` for a `QuadDetector(DetectorConfig(targetAspect = 1.586))` (document mode uses the default config) and the post-capture re-detection (`detectOn`) uses the same config. `PdfScanModule` gets `Prop("cardMode")`. `detectQuad(src, card)` from Task N3 passes the same config.

- [ ] **Step 1: Write failing tests** in `QuadDetectorTest` using its `frame(...)` helper: a 1.586-aspect rectangle (e.g. 380×240 px centred) is detected by `QuadDetector(DetectorConfig(targetAspect = 1.586))`; a 300×300 square is not detected by that detector but is detected by the default one; a card rotated to portrait (240×380) is detected in card mode.
- [ ] **Step 2: Run** `--tests '*QuadDetectorTest'`. Expected: FAIL (new cases).
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run** the full `:pdf-scan:testDebugUnitTest` (existing detector and stabilizer tests must still pass) and `:app:assembleDebug`. Expected: PASS.
- [ ] **Step 5: Commit** `Scan native: card-shaped detection`.

---

# Stream C: `packages/scan-core`

Commands from the repo root. Each new test file is added by name to the package's `test` script in the same task. Only stream C edits `packages/scan-core/**`.

Test helpers (create in Task C1, `src/__tests__/helpers.ts`): `nodeFiles(root: string): ScanFiles` over `node:fs/promises`; `fakeNative()` returning a `ScanNative` that records calls and writes tiny files (`<out>.jpg` containing a valid 1×1 JPEG, `<out>.bits` for `bw`); `openLibrary()` that opens `Library` on `nodeRawSql()` imported from `../../../library-core/src/__tests__/node-sql.ts` with `serialPort`, and `deps = { now: () => 1_700_000_000_000, newId: counter of 16-char base-36 ids }`.

### Task C1: Scan track and `ScanStore`

**Files:** Create `src/schema.ts`, `src/scan-store.ts`, `src/__tests__/helpers.ts`, `src/__tests__/scan-store.test.ts`; modify `src/index.ts`, `package.json`.

**Interfaces:** Produces `SCAN_STEPS: readonly string[]` (the SPEC §4.2 `scan` track step 1 verbatim, plus one column in `scan_pages`: `kind TEXT NOT NULL DEFAULT 'page' CHECK (kind IN ('page', 'card', 'sheet'))`; the step is unshipped, so it is edited in place) and
`class ScanStore { constructor(db: SqlPort); static open(db: SqlPort): Promise<ScanStore> /* migrate(db, 'scan', SCAN_STEPS) */; insertPages(tx: SqlPort, itemId: string, pages: ScanPage[]): Promise<void>; pages(itemId: string): Promise<ScanPage[]> /* by position */; page(itemId: string, pageId: string): Promise<ScanPage | null>; updatePage(itemId: string, pageId: string, patch: Partial<Pick<ScanPage, 'quad' | 'rotation' | 'filter' | 'width' | 'height' | 'bitsWidth' | 'bitsHeight'>>): Promise<void>; setPositions(itemId: string, pageIds: string[]): Promise<void>; deletePage(itemId: string, pageId: string): Promise<void> /* closes the gap in position */; pageTexts(itemId: string): Promise<string[]> /* ocr_text ?? '' in order */; nextPosition(itemId: string): Promise<number> }`. `Library` must already be open on the same `SqlPort` (the `library` track runs first).

- [ ] **Step 1: Write failing tests** against a real in-memory SQLite: opening twice is idempotent (track version stays 1); `insertPages` then `pages` round-trips `quad` (JSON), `kind`, and null `bits*`; deleting the item through `Library.deleteItem` cascades its pages away; `deletePage` of position 1 in a 3-page scan leaves positions 0,1; `setPositions` reorders; `kind` rejects `'x'` (CHECK); `pageTexts` returns `''` for a pending page.
- [ ] **Step 2: Run** `pnpm --filter @apps-hub/scan-core test`. Expected: FAIL.
- [ ] **Step 3: Implement** `schema.ts` and `scan-store.ts`; export from `index.ts`.
- [ ] **Step 4: Run.** Expected: PASS; also `pnpm --filter @apps-hub/scan-core typecheck`.
- [ ] **Step 5: Commit** `scan-core: the scan track and store`.

### Task C2: JPEG info and paper size

**Files:** Create `src/jpeg.ts`, `src/paper.ts`, `src/__tests__/jpeg.test.ts`, `paper.test.ts`.

**Interfaces:** Produces `jpegInfo(bytes: Uint8Array): { width: number; height: number; components: 1 | 3 }` (reads the first SOF0/SOF1/SOF2 marker, throws `Error('not a JPEG')` or `Error('unsupported JPEG: CMYK')` for 4 components) and `pageSizePt(widthPx: number, heightPx: number): { w: number; h: number }` per SPEC §8 "Page size": within 3% of √2 → A4 595.28 × 841.89; within 3% of 11/8.5 → Letter 612 × 792; otherwise the long side is 841.89 and the short side follows the aspect; landscape swaps.

- [ ] **Step 1: Write failing tests**: a hand-built minimal JPEG byte array with SOF0 height 300, width 200, 3 components → `{200, 300, 3}`; 1 component → 1; 4 components throws; random bytes throw. `pageSizePt(2480, 3508)` is A4 portrait; `(3508, 2480)` is A4 landscape; `(1700, 2200)` is Letter; `(1600, 1009)` (a card) has `h = 841.89` landscape orientation swapped so `w = 841.89` and `h ≈ 530.8` (±0.1).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `scan-core: JPEG info and paper sizes`.

### Task C3: The PDF writer

**Files:** Create `src/pdf-writer.ts`, `src/glyphless-font.ts`, `src/__tests__/pdf-writer.test.ts`.

**Interfaces:** Consumes `ByteSink`, `OcrWord`, `jpegInfo`, `pageSizePt`. Produces SPEC §8 exactly: `PageImage`, `PdfPage { image(): Promise<PageImage>; words: readonly OcrWord[]; widthPt: number; heightPt: number }` and `writeScanPdf(pages, sink, info: { title: string; created: Date }): Promise<{ bytes: number }>`. `glyphless-font.ts` exports `GLYPHLESS_TTF: Uint8Array` (573 bytes, copied from Tesseract `src/api/pdf_ttf.h` with its Apache-2.0 header) and `CID_TO_GID_FLATE: Uint8Array` (the 150-byte constant). Fonts are written only if some page has words (none until Phase 4, but the code and its test exist now).

- [ ] **Step 1: Write failing tests** (no external PDF library): a 2-page document with JPEG pages: the output starts `%PDF-1.7`, ends `%%EOF`; the `startxref` value points at the text `xref`; every `xref` entry offset points at `"<n> 0 obj"`; `/Count 2` appears in the Pages object; `/Filter /DCTDecode` image bytes equal the input bytes untouched; a `bits` page writes `/FlateDecode` and `/BitsPerComponent 1`; Info `/Title` is UTF-16BE with BOM; page *i* object numbers follow `10 + 3i`; with words present the output contains `3 Tr` and a hex string for the word; a word with box height 0 is skipped; a 4-component JPEG makes `writeScanPdf` throw.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** per SPEC §8 (layout, images, font set, text layer, Info). Offsets are counted as bytes go to the sink; one page's image bytes are held at a time.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `scan-core: PDF writer for scanned pages`.

### Task C4: `ScanService`

**Files:** Create `src/scan-service.ts`, `src/titles.ts`, `src/__tests__/scan-service.test.ts`; modify `src/index.ts`.

**Interfaces:** Consumes C1 to C3, `Library`, `ScanNative`, `ScanFiles`. Produces
`defaultTitle(mode: 'document' | 'card', now: number): string` → `"Scan 2026-10-31 14:05"` or `"Card 2026-10-31 14:05"` (local time, zero-padded) and
```ts
export interface ScanServiceDeps {
  library: Library; store: ScanStore; native: ScanNative; files: ScanFiles;
  libraryDir: string;   // absolute path of library/
  exportDir: string;    // absolute path of cache/export/
  newPageId(): string;
  newItemId(): string;
}
export class ScanService {
  constructor(deps: ScanServiceDeps);
  saveSession(session: SessionInput, opts?: { title?: string }): Promise<Item>;
  pages(itemId: string): Promise<ScanPage[]>;
  editPage(itemId: string, pageId: string, patch: { quad?: Quad; rotation?: Rotation; filter?: PageFilter }): Promise<ScanPage>;
  reorder(itemId: string, pageIds: string[]): Promise<void>;
  deletePage(itemId: string, pageId: string): Promise<void>;   // throws ScanError('last_page') on the only page
  pageTexts(itemId: string): Promise<string[]>;
  imagePaths(itemId: string, pageIds?: string[]): Promise<string[]>;   // processed JPEG paths in page order
  buildPdf(itemId: string): Promise<{ path: string; bytes: number }>;  // exportDir/<safe title>.pdf
}
export type ScanErrorCode = 'no_pages' | 'last_page' | 'not_found' | 'bad_order';
export class ScanError extends Error { code: ScanErrorCode }
```
`saveSession` behaviour: 0 pages → `ScanError('no_pages')`. The new item id comes from `deps.newItemId()` (a 16-character id matching `ITEM_ID`). For each page: copy `file` (absolute path = `sessionDir/file`, so `SessionInput.pages[].file` is already absolute when passed in; the app resolves it) to `<libraryDir>/<id>/pages/<pageId>.orig.jpg`, then `native.processPage({ src, quad: quad ?? FULL, rotation, filter, out: .../<pageId>, maxLongSide: mode === 'card' ? 1600 : undefined })`. In card mode with `sheet` true: process front and back cards (kind `'card'`, long side 1600) into a temp name, `native.composeCardSheet`, and store one page of kind `'sheet'` whose orig is the composed sheet, quad full frame, filter `'original'`; a session with no back card makes a one-card sheet. Write `thumb.jpg` via `processPage` with `filter: 'original'`, `maxLongSide: 320` from the first page. Create order: files first, then `createItem({ id, kind: 'scan', title, folderId, pageCount, sizeBytes })` (sum of `files.size`), then `store.insertPages` in `db.transaction`. If anything throws, delete the item row if it exists and remove `<libraryDir>/<id>`, then rethrow. `appendTo` adds pages after `nextPosition` to that item with the same file steps and updates `pageCount`, `sizeBytes`; no thumbnail change. After success, the app (not the service) deletes the session folder. `editPage` re-runs `processPage` from the stored original (card pages 1600, sheet pages default size), rewrites `width/height/bits*`, removes a stale `.bits` when the filter leaves `'bw'`, and `library.touch`es the item. `deletePage` removes the page's files then its row, updates `pageCount` and `sizeBytes`. `buildPdf` builds `PdfPage`s from `pageSizePt` and the page JPEG (or `.bits` for `bw`, with `bitsWidth/bitsHeight`), writes to `<exportDir>/<safe title>.pdf` through `files.open`, where the safe title replaces `/\:*?"<>|` and control characters with `-`, trims to 80 characters, and falls back to `Scan`.

- [ ] **Step 1: Write failing tests** with `fakeNative`, `nodeFiles` on a temp dir and a real SQLite: saving a 3-page session creates one `scan` item with `pageCount` 3, three `.orig.jpg` and three `.jpg` files, a `thumb.jpg`, positions 0..2, `ocrState 'pending'`; a page with `quad: null` calls `processPage` with `[0,0,1,0,1,1,0,1]`; a card session with `sheet: true` and two pages saves one page of kind `'sheet'` and calls `composeCardSheet` once with both card paths, and with one page calls it with `back: null`; a card session without `sheet` saves two `'card'` pages processed with `maxLongSide: 1600`; `saveSession` with 0 pages throws `no_pages` and creates no item; when `fakeNative.processPage` throws on the second page, `library.list` is empty and `<libraryDir>/<id>` does not exist (review focus 2); `appendTo` puts new pages after existing ones; `editPage` with a new filter re-calls `processPage` and bumps `updatedAt`; moving a page from `bw` to `auto` deletes its `.bits`; `deletePage` on the only page throws `last_page`; `reorder` with an unknown id or a missing id throws `bad_order`; `buildPdf` output passes the same xref check as C3 and has one page per scan page; `defaultTitle('document', Date.UTC-based fixed time)` has the form `Scan YYYY-MM-DD HH:mm`.
- [ ] **Step 2: Run** `pnpm --filter @apps-hub/scan-core test`. Expected: FAIL.
- [ ] **Step 3: Implement** `titles.ts`, `scan-service.ts`; export `ScanService`, `ScanError`, `defaultTitle` and all types from `index.ts`.
- [ ] **Step 4: Run** the package tests and `pnpm --filter @apps-hub/scan-core typecheck`. Expected: PASS and clean.
- [ ] **Step 5: Commit** `scan-core: save, edit, reorder and build a PDF`.

---

# Stream U: app screens (`apps/pdf-editor-mobile/app/scan/`, `src/scan/`, `src/library/`)

Until streams N and C land, U tests only pure helpers and relies on typecheck against the Task 0 contract. U owns the app's `package.json` `test` script and `app.json`; nobody else edits them.

### Task U1: Crop math and the crop editor

**Files:** Create `src/scan/quad-math.ts`, `src/__tests__/quad-math.test.ts`, `src/scan/crop-editor.tsx`; modify the app's `package.json` `test` script (add `src/__tests__/quad-math.test.ts`).

**Interfaces:** Produces `moveCorner(quad: Quad, index: 0 | 1 | 2 | 3, x: number, y: number): Quad` (clamps to 0..1; returns the original quad unchanged if the move would make the quad non-convex or flip its winding) and `isConvex(quad: Quad): boolean`, and `<CropEditor uri: string; imageWidth: number; imageHeight: number; quad: Quad; onChange(q: Quad): void />`: the image fitted to the available width, four 44 dp handles (gesture-handler `Gesture.Pan` + reanimated shared values), edges drawn as thin rotated `View`s in `c.accent`; each handle has `accessibilityLabel` "Top left corner" etc. and accessibility actions to nudge by 1%.

- [ ] **Step 1: Write failing tests**: `moveCorner` with `x = 1.4` clamps to 1; moving corner 0 of the unit quad to `(0.9, 0.9)` (past the opposite corner, making it non-convex) returns the input quad unchanged; moving it to `(0.1, 0.1)` returns the quad with only those two numbers changed; `isConvex` is false for a bow-tie.
- [ ] **Step 2: Run** `node --test src/__tests__/quad-math.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `quad-math.ts` and `crop-editor.tsx`.
- [ ] **Step 4: Run** the test (PASS) and `pnpm --filter pdf-editor-mobile typecheck`.
- [ ] **Step 5: Commit** `Scan app: crop editor`.

### Task U2: Service wiring and export actions

**Files:** Create `src/scan/service.ts`, `src/scan/files-expo.ts`, `src/scan/export.ts`.

**Interfaces:** Consumes `@apps-hub/scan-core`, `openLibrary()`, `PdfScan`. Produces `getScanService(): Promise<ScanService>` (one instance per process: `ScanStore.open(library.db)`, `native = PdfScan`, `files = expoFiles`, `libraryDir = libraryRoot()`'s path, `exportDir = exportDir()`'s path, `newPageId` and `newItemId` from `src/library/ids.ts`), `expoFiles: ScanFiles` over `expo-file-system` (`Directory`, `File`; `open` uses a `FileHandle` with `writeBytes`; paths are absolute without scheme, so build URIs with `file://` + path), and in `export.ts`: `sharePdf(itemId)` (`buildPdf` then `expo-sharing` `shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' })`), `saveImages(itemId, pageIds?)` → `PdfScan.saveImagesToGallery(paths, 'PDF Editor')` returning the count, `shareImages(itemId, pageIds?)` → `PdfScan.shareImages(paths, 'Share images')`, `openInEditor(itemId)` (`buildPdf`, then `router.push({ pathname: '/editor', params: { uri, name: <title>.pdf, itemId } })`, with the same 28 MB confirm as `open-item.ts`; move that confirm into an exported `confirmLarge` there and import it).

- [ ] **Step 1: Implement** the four files. No unit test: this layer is adapters over native and Expo APIs; the pure logic is tested in scan-core.
- [ ] **Step 2: Run** `pnpm --filter pdf-editor-mobile typecheck` and `lint`. Expected: clean.
- [ ] **Step 3: Commit** `Scan app: service wiring and export actions`.

### Task U3: Capture changes, import photos, review

**Files:** Modify `app/scan/capture.tsx`, `src/library/add-actions.ts`, `app/_layout.tsx`; create `app/scan/review.tsx`.

**Interfaces:** Consumes U1, U2, `session.ts` (`loadSession`, `saveSession`, `discardSession`, `openSession`, `sessionDir`).

- Capture: a `Segmented` "Document" / "Card" at the top (below the Auto/Manual row). Switching sets `session.mode` (allowed only while the session has 0 pages; otherwise the control is disabled with an accessibility hint) and the camera `cardMode` prop. In card mode a card-shaped guide (rounded rect, 1.586 aspect, `c.accent` outline, centred, 80% width) shows and the hint reads "Front of the card" then "Back of the card"; each capture sets `side` (first `'front'`, second `'back'`); a third capture in card mode is refused with the hint "A card has two sides. Tap Done.". "Done" now opens `/scan/review` instead of leaving.
- "Import photos" (add-actions key `import-photos`, label "Import photos", icon `images-outline`): `ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 20 })`; each asset goes through `PdfScan.importImage(asset.uri, <sessionDir>/cap-<Date.now() + i>.jpg)` (the name must match `/^cap-(\d+)\.jpg$/`), becomes a page with the detected quad, the session is saved, then `router.push('/scan/review')`. Failures show a `Notice` "Couldn't import <n> of <m> photos" and import the rest.
- Review (`/scan/review`): page strip of thumbnails (`expo-image`, selected outlined in `c.accent`); `CropEditor` on the selected page's original (`<sessionDir>/<file>`; a null quad shows the full frame with `detectQuad` run once to propose one); a live preview is not needed in the editor, so filters are applied by a small `Image` preview of `processPage({ ..., out: <sessionDir>/prev-<n>, maxLongSide: 1200 })` shown beside the editor toggle "Crop" / "Preview"; `Segmented` Original, Magic, Gray, Black and white; `Button`s Rotate, Retake, Delete page, Move left, Move right, Apply filter to all; `Field` "Title" (default from `defaultTitle`); in card mode with two pages a `Segmented` "Two pages" / "One sheet" bound to `session.sheet`; `Button` "Save": `getScanService().saveSession(...)` with absolute page paths, then `discardSession()` and `router.replace({ pathname: '/scan/[id]', params: { id } })`. Preview files named `prev-*` are removed on leaving. Errors (including `no_pages`) show a `Notice` and keep the session.
- `_layout.tsx` registers `scan/review`, `scan/[id]`, `scan/page`.

- [ ] **Step 1: Implement** the changes above; where it is pure (default title, page-side assignment, "can switch mode"), put it in `src/scan/session-data.ts`-style helpers in a new `src/scan/capture-rules.ts` with `src/__tests__/capture-rules.test.ts` (listed in `test`): `nextSide(mode, pages)` returns `null` (document), `'front'`, `'back'`, or `'full'` (card mode with two pages); `canSwitchMode(session)` is true only with 0 pages. Write those tests first and run them to see them FAIL, then implement.
- [ ] **Step 2: Run** `node --test src/__tests__/capture-rules.test.ts` (PASS), `pnpm --filter pdf-editor-mobile typecheck` and `lint`.
- [ ] **Step 3: Commit** `Scan app: review screen, card mode capture and import photos`.

### Task U4: Scan view, page view, opening scans

**Files:** Create `app/scan/[id].tsx`, `app/scan/page.tsx`; modify `src/library/open-item.ts`.

**Interfaces:** Consumes U2. `open-item.ts` gains `itemOpeners.scan = (item) => router.push({ pathname: '/scan/[id]', params: { id: item.id } })`.

- `/scan/[id]`: `Header` with the item title (rename through the Library's existing item sheet is out of scope), subtitle "<n> pages"; a grid of page thumbnails (`itemFile(id, 'pages/<pageId>.jpg')`); `Button`s "Share PDF", "Open in editor", "Save images" (→ `Notice`-style confirmation "Saved <n> images to Photos"), "Share images", "Add pages" (`openSession` with `appendTo` set to the id, then `/scan/capture`; capture's Done then calls `saveSession` with `appendTo` through review). Errors say what happened and how to fix it.
- `/scan/page`: the page image, "Edit page" (the crop editor and filter row, saving with `editPage`; a page of kind `'sheet'` hides crop and filter and offers Rotate only), "Delete page" (confirmation naming the page number; `last_page` shows "A scan needs at least one page. Delete the whole scan from the Library instead."), "Save image", "Share image" for this page, Move left and Move right via `reorder`.

- [ ] **Step 1: Implement** both screens and the opener.
- [ ] **Step 2: Run** `pnpm --filter pdf-editor-mobile typecheck` and `lint`. Expected: clean.
- [ ] **Step 3: Commit** `Scan app: scan view, page view and opening a scan`.

---

# Integration (lead, after N, C and U are committed)

### Task I1: Wire, verify, document

**Files:** Modify `apps/pdf-editor-mobile/app.json` (`version` `1.3.0`), `pnpm-lock.yaml` if needed, `docs/handoffs/pdf-editor-scan.md`, `apps/pdf-editor-mobile/AGENTS.md` (if it lists scan functions), `docs/pdf-editor/scan/SPEC.md` §6.1 and §7.5 (filter labels, card mode, `kind` column, new native functions).

- [ ] **Step 1:** Merge check: `git log --oneline` shows commits from all three streams; `git status` clean; no file was edited by two streams (`git log --name-only` per stream).
- [ ] **Step 2: Run, report actual output:**
  `pnpm --filter @apps-hub/scan-core test`, `pnpm --filter @apps-hub/library-core test`, `pnpm test`, `pnpm typecheck`,
  `pnpm --filter pdf-editor-mobile lint`, `pnpm --filter pdf-editor-mobile run doctor` (the one known pre-existing failing check may remain; say so),
  `cd apps/pdf-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew :pdf-scan:testDebugUnitTest :app:assembleDebug`.
  Expected: all pass, BUILD SUCCESSFUL.
- [ ] **Step 3:** Update the handoff file's session log and "Current state + exact next step", and the SPEC sections named above; run `docs-keeper` if the docs drift is wider.
- [ ] **Step 4: Commit** `Scan: save, polish, image export and card mode (1.3.0)`; open a PR only when the owner asks.
- [ ] **Step 5: Phone test (owner's go required for the release):** `pnpm release pdf-editor -m "Scan: review, save, filters, images and card mode"` after the owner confirms the Cloudflare account; the owner installs from the Store. Checks: scan a page, Save, Share PDF, Save images (appear in Photos > PDF Editor), the three filters on a receipt and a book page, a card sheet (print or zoom to 100% and measure 85.6 mm), a card as two pages, import photos, add pages, kill the app mid-session and resume. Record results in the handoff.

## Self-review notes

- Spec coverage: save (U3, C4), PDF export (C3, C4, U2), image export (N5, U2, U4), three filters (N2), card mode (N6, N4, U3, C4), version (I1), no new dependency (constraint).
- Known limit (stated in the design): a separate card page in the PDF uses the generic paper rule, so it is card-shaped; the one-sheet option is the print-ready one.
- Type names used across tasks: `SessionInput`, `ScanPage`, `PageKind`, `ScanNative`, `ScanFiles`, `ScanService`, `ScanError`, `SheetRequest`/`SheetResult` (native) match Task 0.
