# Technical specification: Scan and Library in PDF Editor

Requirements (FR, NFR, AC and the six invariants) are in `docs/pdf-editor/scan/PRD.md`.
Facts and sources are in `docs/pdf-editor/scan/RESEARCH.md`; "R§n" below points there.
Items marked **spike** are settled on the owner's phone in the phase named in §15.
Written 2026-10-30.

## 1. Tech stack

- **UI:** React Native 0.81.5 in Expo SDK 54, TypeScript 5.9 (erasable syntax only, `.ts`
  import extensions), expo-router 6, `@apps-hub/ui` with `brand="pdf"`, Ionicons from
  `@expo/vector-icons` (already used). No hand-rolled colours or fonts.
- **Domain logic:** two pure TypeScript packages, Hermes-safe (no `Buffer`, no `node:*`
  imports, no `TextEncoder`), tested with `node --test`:
  - `packages/library-core`: the Library contract (§4), shared with Reader.
  - `packages/scan-core`: scan pages, the recognition queue and the PDF writer (§7.6, §8).
- **Storage:** `expo-sqlite` ~16.0.10 (SQLite 3.50.3 with FTS5; RESEARCH, "This repo"
  sources) and the
  `expo-file-system` 19 object API (`File`, `Directory`, `Paths`). The editor screen keeps
  its `expo-file-system/legacy` calls.
- **Native:** one Expo local module, `pdf-scan` (`apps/pdf-editor-mobile/modules/pdf-scan`),
  Kotlin now, Swift in Phase 6. Camera: CameraX 1.6.2. OCR: Tesseract4Android 4.9.0.
  Image processing: our own Kotlin plus `android.graphics.Matrix` (R§2).
- **Principle:** native code owns pixels (camera, detection, warp, filters, OCR); TypeScript
  owns records (library rows, page order, recognition queue, the PDF file). Only file paths,
  corner coordinates and recognised words cross the bridge.
- **ABIs:** arm64-v8a only (`reactNativeArchitectures=arm64-v8a`), the owner's answer to Q3 (2026-10-31).
- **minSdk:** unchanged (the app's current 24); nothing below needs more. Tested on Android
  13+ (NFR-8).

## 2. Dependencies

All were **approved by the owner on 2026-10-31** (session S0; PRD Q1–Q3; CLAUDE.md for this app).

| Name                                                        | Version             | Licence (checked)                                                                 | Size impact (arm64)                     | Why                                                                         | Alternatives considered                                                                                                    |
| ----------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `expo-sqlite`                                               | ~16.0.10            | MIT (already used by NetLens and OpenTunnel)                                      | +1.82 MB `.so` (verified)               | `library.db` with FTS5                                                      | AsyncStorage (no search); op-sqlite (another native lib for no gain)                                                        |
| `androidx.camera:camera-core`, `camera-camera2`, `camera-lifecycle`, `camera-view` | 1.6.2 | Apache-2.0                                                                         | About +1.5 MB of dex (assumed; AARs 2.5 MB) | Preview, analysis frames and full-resolution capture in one session (R§4)   | vision-camera v5 (needs worklets ≥ 0.6, Nitro, alpha CameraX); vision-camera v4 and expo-camera (pull ML Kit / Play services) |
| `cz.adaptech.tesseract4android:tesseract4android`           | 4.9.0 (JitPack)     | Apache-2.0; bundles Leptonica (BSD-2-Clause style), libjpeg (IJG), libpng (PNG v2) | +7.51 MB `.so` (verified)               | On-device OCR with word boxes and confidences (R§3)                         | PP-OCRv6 + ONNX Runtime (+about 40 MB, line boxes only); ML Kit (excluded)                                                    |
| `eng.traineddata` from `tessdata_fast`                      | repo `main` at the commit recorded in Phase 4 | Apache-2.0                                                      | +4.11 MB asset (verified)               | English model                                                               | `tessdata_best` (15.40 MB, slower, no clear gain on print, R§3)                                                              |
| GlyphLessFont `pdf.ttf` (copied from Tesseract `src/api/pdf_ttf.h`) | Tesseract 5.5.x | Apache-2.0                                                                  | 573 bytes                               | Invisible text layer font (R§5)                                             | OCRmyPDF's Occulta.ttf (13 KB); a real font via fontkit (556 KB+, breaks extraction)                                          |
| `expo-clipboard`                                            | ~8.0.8 (SDK 54's pin) | MIT                                                                          | Kotlin only, tens of KB (assumed)       | "Copy text" (FR-15)                                                         | React Native's `Share.share` with the text (no copy, but no dependency)                                                      |

Not added: OpenCV, ONNX Runtime, ML Kit, Play services, react-native-svg, vision-camera,
expo-camera. Gradle already lists JitPack in `allprojects.repositories`
(`apps/pdf-editor-mobile/android/build.gradle`), so no repository change is needed.

New workspace packages: `@apps-hub/library-core`, `@apps-hub/scan-core` (no third-party
dependencies; dev only `@types/node` and `typescript`, as `packages/core`).

## 3. Repository layout

```text
packages/library-core/                    @apps-hub/library-core (Phase 1)
├── package.json, tsconfig.json           as packages/core; "test" lists every test file
└── src/
    ├── index.ts                          public API (§4.6)
    ├── sql.ts                            SqlPort, RawSql, serialPort() (§4.1)
    ├── migrate.ts                        per-feature migration tracks (§4.4)
    ├── schema.ts                         the 'library' track (§4.2)
    ├── fts-query.ts                      ftsQuery() (§4.3)
    ├── library.ts                        class Library
    ├── errors.ts                         LibraryError
    └── __tests__/                        node-sql.ts (test helper over node:sqlite) + *.test.ts
packages/scan-core/                       @apps-hub/scan-core (Phase 3; OCR parts Phase 4)
└── src/
    ├── index.ts, types.ts                Quad, PageFilter, OcrWord, ScanPage
    ├── scan-store.ts                     the 'scan' track and scan_pages access (§4.2)
    ├── scan-service.ts                   save a session, edit pages, recognition queue (§7.6)
    ├── pdf-writer.ts                     writeScanPdf() (§8)
    ├── glyphless-font.ts                 pdf.ttf bytes + compressed CIDToGIDMap (Apache-2.0 header)
    ├── jpeg.ts                           readJpegInfo() from the SOF marker
    ├── paper.ts                          page size in points from the image aspect
    └── __tests__/
apps/pdf-editor-mobile/
├── app/
│   ├── _layout.tsx                       + new routes
│   ├── index.tsx                         Library home, replaces "Open a PDF" (Phase 1)
│   ├── editor.tsx                        + itemId param, docInfo, save to library (Phase 1)
│   ├── about.tsx                         licences and notices (Phase 4)
│   └── scan/capture.tsx, review.tsx, [id].tsx, page.tsx   (Phases 2–4)
├── src/
│   ├── editor/bridge.ts                  + docInfo event (Phase 1)
│   ├── library/                          sql-expo.ts, open-library.ts, files.ts, ids.ts,
│   │                                     add-actions.ts, open-item.ts, use-library.ts, sweep.ts
│   └── scan/                             native.ts (re-export), session.ts, crop-editor.tsx,
│                                         use-scan.ts
└── modules/pdf-scan/                     Expo local module (Phase 2)
    ├── expo-module.config.json           platforms: ["android"] until Phase 6 adds "apple"
    ├── package.json                      name "pdf-scan" → Gradle project :pdf-scan
    ├── src/index.ts                      the contract (§6)
    ├── android/build.gradle              CameraX, Tesseract4Android, JUnit
    ├── android/src/main/AndroidManifest.xml       CAMERA + uses-feature (§10)
    ├── android/src/main/assets/tessdata/eng.traineddata   (Phase 4)
    ├── android/src/main/java/expo/modules/pdfscan/
    │   ├── core/                         pure Kotlin, no android.*: Luma, QuadDetector,
    │   │                                 QuadStabilizer, Filters, PageGeometry, BitPack, OcrLayout
    │   ├── android/                      ScanCameraView, PageProcessor, OcrEngine, Tessdata
    │   └── PdfScanModule.kt
    ├── android/src/test/java/expo/modules/pdfscan/core/   JVM tests (§12)
    ├── android/src/test/resources/quads/  optional real frames, 320×240 PGM + corners.json
    └── ios/                              Phase 6: PdfScan.podspec, *.swift
packages/pdf-editor-engine/core.js, mobile.html   + docInfo (Phase 1)
apps/pdf-editor-desktop/test/mobile.mjs           + docInfo assertion (Phase 1)
```

## 4. The Library contract (shared with Reader)

### 4.1 Database and connection

- One database, `library.db`, opened once per app process with
  `SQLite.openDatabaseAsync('library.db')`, then
  `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`.
- **One connection only.** Don't use `withExclusiveTransactionAsync`: it opens a second
  connection (verified, `expo-sqlite/build/SQLiteDatabase.js:510-516`), on which
  `foreign_keys` is off, so cascades would silently not run. Don't use
  `withTransactionAsync` either: it is not exclusive, so another feature's write can land
  inside it (verified, its doc comment in `SQLiteDatabase.d.ts:72-92`).
- Instead, `serialPort()` in `library-core` serialises writes through one promise queue
  and runs transactions as `BEGIN IMMEDIATE … COMMIT` on the same connection, handing the
  callback a port that bypasses the queue:

```ts
export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

/** What a driver must provide: four direct calls on one connection. */
export interface RawSql {
  run(sql: string, params: readonly SqlValue[]): Promise<void> | void;
  all(sql: string, params: readonly SqlValue[]): Promise<Row[]> | Row[];
  first(sql: string, params: readonly SqlValue[]): Promise<Row | null> | Row | null;
  exec(sql: string): Promise<void> | void; // several statements, no params
}

/** What the Library and feature stores use. */
export interface SqlPort {
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  all(sql: string, params?: readonly SqlValue[]): Promise<Row[]>;
  first(sql: string, params?: readonly SqlValue[]): Promise<Row | null>;
  exec(sql: string): Promise<void>;
  /** BEGIN IMMEDIATE … COMMIT; ROLLBACK and rethrow on error. No nesting. */
  transaction<T>(fn: (tx: SqlPort) => Promise<T>): Promise<T>;
}

export function serialPort(raw: RawSql): SqlPort;
```

- Reads (`all`, `first`) go straight to the connection; writes (`run`, `exec`,
  `transaction`) wait their turn. Calling `transaction` on `tx` throws.
- App driver (`src/library/sql-expo.ts`): four one-liners over `runAsync`, `getAllAsync`,
  `getFirstAsync`, `execAsync`. Test driver (`src/__tests__/node-sql.ts`): the same over
  `node:sqlite` `DatabaseSync`, as OpenTunnel's tests do (FTS5, `snippet`, `bm25` and
  `unicode61 remove_diacritics 2` verified in Node 22.23.4, SQLite 3.53.4).

### 4.2 Schema

Track `library`, step 1 (verified on SQLite 3.53.4 in a scratch run on 2026-10-30:
case-insensitive unique folder names per parent, FK to a UNIQUE column, the FTS triggers,
cascades from `items`). On 2026-10-31 the insert and title triggers were dropped: titles now
enter `items_fts` normalised (§4.3), which a trigger can't do, so `createItem` and
`updateItem` write the FTS row in the same transaction as the `items` row. Phase 1 re-runs
this step in its tests.

```sql
CREATE TABLE folders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES folders(id),   -- no cascade: a folder with children can't be deleted
  created_at INTEGER NOT NULL               -- ms since epoch, UTC
);
CREATE UNIQUE INDEX folders_unique_name ON folders (ifnull(parent_id, ''), name COLLATE NOCASE);

CREATE TABLE items (
  rid        INTEGER PRIMARY KEY,           -- rowid alias, stable across VACUUM; = items_fts.rowid
  id         TEXT NOT NULL UNIQUE,          -- public id, directory name, referenced by feature tables
  kind       TEXT NOT NULL CHECK (kind IN ('pdf', 'scan', 'article')),
  title      TEXT NOT NULL,
  folder_id  TEXT REFERENCES folders(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,    -- total of library/<id>/
  page_count INTEGER                        -- null when unknown or not paged
);
CREATE INDEX items_folder_updated ON items (folder_id, updated_at DESC);
CREATE INDEX items_updated ON items (updated_at DESC);

CREATE TABLE tags (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE item_tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
) WITHOUT ROWID;
CREATE INDEX item_tags_tag ON item_tags (tag_id);

-- Body text lives only here (OCR text, extracted PDF text, article text), normalised (§4.3).
-- Library writes the row: createItem inserts (rid, normalizeForSearch(title), normalizeForSearch(body ?? '')),
-- updateItem rewrites title, setBody rewrites body. No insert or title trigger.
CREATE VIRTUAL TABLE items_fts USING fts5(
  title, body,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN
  DELETE FROM items_fts WHERE rowid = old.rid;
END;
```

Track `scan`, step 1 (owned by `scan-core`, Phase 3):

```sql
CREATE TABLE scan_pages (
  item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  page_id    TEXT NOT NULL,                -- file stem under library/<item>/pages/
  position   INTEGER NOT NULL,             -- 0-based order in the document
  quad       TEXT NOT NULL,                -- JSON [x0,y0,x1,y1,x2,y2,x3,y3], 0..1 of the original
  rotation   INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270)),
  filter     TEXT NOT NULL CHECK (filter IN ('original', 'auto', 'gray', 'bw')),
  width      INTEGER NOT NULL,             -- processed JPEG, px
  height     INTEGER NOT NULL,
  bits_width INTEGER,                      -- 'bw' only: the 1-bit image, px
  bits_height INTEGER,
  ocr_state  TEXT NOT NULL DEFAULT 'pending' CHECK (ocr_state IN ('pending', 'done', 'failed')),
  ocr_text   TEXT,                         -- plain text of the page
  ocr_words  TEXT,                         -- JSON OcrWord[] (§6)
  ocr_conf   REAL,                         -- mean confidence 0..100
  ocr_error  TEXT,
  PRIMARY KEY (item_id, page_id)
) WITHOUT ROWID;
CREATE INDEX scan_pages_order ON scan_pages (item_id, position);
CREATE INDEX scan_pages_pending ON scan_pages (ocr_state) WHERE ocr_state = 'pending';
```

### 4.3 Search

Query text from the search box goes through `ftsQuery()`:

```ts
/** "Invo café" → '"Invo"* "café"*'. Null for blank input (list mode). */
export function ftsQuery(input: string): string | null;
```

- Split on whitespace; keep at most 8 tokens; double any `"`; wrap each token in quotes and
  add `*`. Quoting makes FTS5 operators (`AND`, `OR`, `NOT`, `NEAR`, `-`, `^`, `:`) literal.
  Tokens are ANDed. A punctuation-only token becomes an empty phrase, which FTS5 ignores
  (verified: `'"parking"* "-"*'` matches like `'"parking"*'`).
- Accents are ignored by the tokenizer (`"cafe"*` finds "café", verified).
- **Arabic and Urdu normalisation, in v1 (owner, 2026-10-31).** `normalizeForSearch(text)`
  runs on the query tokens in `ftsQuery`, on the body that `setBody` or `createItem` writes,
  and on the title that `createItem` and `updateItem` write to `items_fts`. In order: NFKC; strip harakat
  U+064B–U+065F and U+0670, tatweel U+0640, ZWNJ U+200C and ZWJ U+200D; map ي (U+064A) → ی
  (U+06CC) and ك (U+0643) → ک (U+06A9). Latin text passes through unchanged apart from NFKC
  folding (ligatures such as "ﬁ", full-width forms). It is pure TS, so `node --test` covers it.
  - Hermes is assumed to implement `String.prototype.normalize`; Phase 1 checks it on the
    emulator. If it is missing, `normalizeForSearch` skips NFKC, keeps the explicit maps and
    the handoff records the gap.
  - Snippets come from the normalised text, so they show Arabic and Urdu without harakat.
    Titles in lists come from `items.title`, unchanged.

```sql
SELECT i.id, i.kind, i.title, i.folder_id, i.created_at, i.updated_at, i.size_bytes, i.page_count,
       snippet(items_fts, -1, char(2), char(3), '…', 12) AS snippet
FROM items_fts
JOIN items i ON i.rid = items_fts.rowid
WHERE items_fts MATCH ?
  AND (? IS NULL OR i.kind = ?)
  AND (? IS NULL OR EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = i.id AND t.tag_id = ?))
ORDER BY bm25(items_fts, 10.0, 1.0)      -- a title hit outweighs a body hit 10 to 1
LIMIT ?;
```

- The snippet marks matches with U+0002 and U+0003; the UI renders those spans in
  `fonts.semibold` and strips the markers. Search is library-wide; each hit shows its folder.
- List mode (blank search):

```sql
SELECT … FROM items i
WHERE (? = 1 OR i.folder_id IS ?)        -- 'everywhere' flag, or one folder (NULL = top level)
  AND (? IS NULL OR i.kind = ?)
  AND (? IS NULL OR EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = i.id AND t.tag_id = ?))
ORDER BY i.updated_at DESC               -- or i.title COLLATE NOCASE
LIMIT ? OFFSET ?;
```

- `setBody` truncates text to 1,000,000 UTF-16 code units at a whitespace boundary.
- Later, for scripts without spaces (Chinese, Japanese, Thai), a library step can add a
  second FTS table with the `trigram` tokenizer (available in both SQLite builds). Not in v1.

### 4.4 Migrations

```sql
CREATE TABLE IF NOT EXISTS schema_tracks (track TEXT PRIMARY KEY, version INTEGER NOT NULL);
```

```ts
/** Applies steps[version..] of one track in one transaction; returns the new version. */
export function migrate(db: SqlPort, track: string, steps: readonly string[]): Promise<number>;
```

- Each feature owns a track: `library` (library-core), `scan` (scan-core), `reader`
  (Reader). A step is one SQL string run with `exec`. Steps are append-only: never edit or
  reorder a shipped step. A track's version is the number of steps applied.
- Tracks let Scan and Reader add tables on parallel branches without fighting over one
  version number. Order at start-up: `library` first, then each feature's track.
- A database newer than the code (version > steps.length) throws `LibraryError('too_new')`
  and the app shows "This library was made by a newer version of PDF Editor."

### 4.5 File layout

Root: `Paths.document` (Android `filesDir`).

```text
library/<itemId>/                 one directory per item; itemId matches /^[0-9a-z]{16}$/
├── thumb.jpg                     optional cover for the list, ≤ 320 px wide, JPEG quality 70 (any kind)
├── document.pdf                  kind 'pdf': the PDF bytes, never modified in place
├── text.json                     kind 'pdf' or 'article': Reader's read-aloud text (a cache for PDFs; never for scans)
├── pages/<pageId>.orig.jpg       kind 'scan': upright original, ≤ 3,000 px long side, quality 90
├── pages/<pageId>.jpg            kind 'scan': processed page, ≤ 2,339 px long side, quality 80
├── pages/<pageId>.bits           kind 'scan', filter 'bw' only: zlib (RFC 1950), 1 bit per pixel, 1 = white
└── (kind 'article': Reader's files, named in Reader's SPEC)
scan-session/                     the one unsaved capture session (§7.1)
tessdata/eng.traineddata          written by the pdf-scan module from its asset (§7.5)
```

Cache (`Paths.cache`): `export/<safe title>.pdf`, built on demand for share and "Open in
editor", deleted at start-up.

- **Ids:** `newId()` = `Date.now()` in base 36, padded to 9, plus 7 random base-36
  characters (`Math.random` is fine: ids are not secrets). Injected into `Library` so tests
  are deterministic.
- **Atomic writes:** write `<name>.tmp`, then move over the final name (TS: `File.move`;
  Kotlin: `File.renameTo`).
- **Create order:** write files into a fresh `library/<id>/`, then insert the row.
- **Delete order:** delete the row (cascades), then the directory.
- **Start-up sweep** (`src/library/sweep.ts`, pure helper `orphanDirs()` in library-core):
  remove `library/` subdirectories whose name matches the id pattern and has no row, then
  empty `cache/export/`. So a crash between the two steps leaves no visible damage.
- `size_bytes` is recomputed by the app after it changes an item's files (sum of `File.size`).

### 4.6 TypeScript API (`@apps-hub/library-core`)

```ts
export type ItemKind = 'pdf' | 'scan' | 'article';

export interface Item {
  id: string; kind: ItemKind; title: string; folderId: string | null;
  createdAt: number; updatedAt: number; sizeBytes: number; pageCount: number | null;
}
export interface Folder { id: string; name: string; parentId: string | null; createdAt: number; itemCount: number }
export interface Tag { id: string; name: string; itemCount: number }
export interface SearchHit extends Item { snippet: string | null } // U+0002 / U+0003 around matches

export type LibraryErrorCode = 'not_found' | 'invalid_name' | 'duplicate_name' | 'cycle' | 'too_new';
export class LibraryError extends Error { code: LibraryErrorCode }

export interface LibraryDeps { now(): number; newId(): string }

export class Library {
  static open(db: SqlPort, deps: LibraryDeps): Promise<Library>; // runs the 'library' track
  readonly db: SqlPort;                                         // for feature stores in the same DB

  // items
  createItem(input: { id?: string; kind: ItemKind; title: string; folderId?: string | null;
                      pageCount?: number | null; sizeBytes?: number; body?: string }): Promise<Item>;
  getItem(id: string): Promise<Item | null>;
  updateItem(id: string, patch: { title?: string; folderId?: string | null;
                                  pageCount?: number | null; sizeBytes?: number }): Promise<Item>;
  touch(id: string): Promise<void>;                              // updated_at = now
  setBody(id: string, text: string): Promise<void>;
  getBody(id: string): Promise<string>;                         // the normalised search text, not a display copy
  deleteItem(id: string): Promise<void>;                         // caller then removes library/<id>/
  list(q: { folderId?: string | null; everywhere?: boolean; kind?: ItemKind; tagId?: string;
            sort?: 'recent' | 'title'; limit?: number; offset?: number }): Promise<Item[]>;
  search(text: string, q?: { kind?: ItemKind; tagId?: string; limit?: number }): Promise<SearchHit[]>;
  allIds(): Promise<Set<string>>;                                // for the start-up sweep

  // folders
  createFolder(name: string, parentId: string | null): Promise<Folder>;
  renameFolder(id: string, name: string): Promise<void>;
  moveFolder(id: string, parentId: string | null): Promise<void>; // rejects a move into itself or a descendant ('cycle')
  deleteFolder(id: string): Promise<void>;                         // moves items and subfolders to its parent first
  listFolders(parentId: string | null): Promise<Folder[]>;
  folderPath(id: string): Promise<Folder[]>;                       // root → id, for the breadcrumb

  // tags
  listTags(): Promise<Tag[]>;
  tagsFor(itemId: string): Promise<Tag[]>;
  setItemTags(itemId: string, names: readonly string[]): Promise<Tag[]>; // trims, dedupes ignoring case, creates, removes unused tags
}

export function ftsQuery(input: string): string | null;
export function normalizeForSearch(text: string): string;          // §4.3
export function migrate(db: SqlPort, track: string, steps: readonly string[]): Promise<number>;
export function serialPort(raw: RawSql): SqlPort;
export function orphanDirs(dirNames: readonly string[], ids: ReadonlySet<string>): string[];
export const ITEM_ID = /^[0-9a-z]{16}$/;
```

Validation (throws `invalid_name`): titles and names are trimmed, 1–200 characters for
titles, 1–100 for folder and tag names, no `/` in folder names, no control characters.
Every write that changes an item bumps `updated_at`, except `setBody`.

### 4.7 Rules for features (Scan now, Reader in parallel)

1. Create and change items only through `Library`. Never write `items`, `folders`, `tags`,
   `item_tags` or `items_fts` directly (PRD invariant 3).
2. Own tables live in the feature's migration track, reference `items(id)` with
   `ON DELETE CASCADE`, and are reached through `library.db`.
3. Body text goes in through `setBody` (whole text, replaced each time).
4. Files go under `library/<id>/`, with names the feature documents. `thumb.jpg` is the
   shared cover name.
5. Add-sheet entries are registered in `src/library/add-actions.ts`
   (`{ key, label, icon, run }`); opening an item is routed by kind in
   `src/library/open-item.ts`. Reader adds its `article` entries there.
6. Need a new column on `items`? Add a `library` track step in `library-core`, with tests,
   in its own change.

What Reader's docs ask of the Library (`docs/handoffs/pdf-editor-reader.md`, "Coordination
with Scan") and where it is:

| Reader need                                   | Answer                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Create, update, delete items; set body text   | `createItem`, `updateItem`, `deleteItem`, `setBody`                                                      |
| List by kind, folder or tag; search with snippet | `list`, `search`                                                                                     |
| Add a PDF file as an item                     | The app helper `addPdf(uri, folderId)` in `src/library/files.ts` (Phase 1), used by "Open a PDF"        |
| Read OCR text and page count                  | `Item.pageCount`; per-page text from `ScanStore.pageTexts(itemId)` (string[] in page order, Phase 3). Scan does not also write a `text.json`: the rows are the one copy. |
| A migration hook                              | Migration tracks (§4.4): Reader's steps go in track `reader`, replacing its own `reader_meta` version key |
| "+" sheet and filter extension points         | `add-actions.ts`, `open-item.ts`; the kind filter shows every kind present                              |
| `foreign_keys = ON`                           | Set on the one connection (§4.1)                                                                        |
| Arabic and Urdu normalisation                 | In v1 (owner, 2026-10-31): `normalizeForSearch` in `ftsQuery`, `setBody` and the FTS title (§4.3); Reader passes raw text |

## 5. Editor integration (Phase 1)

### 5.1 New bridge event

`src/editor/bridge.ts` gains one page event; `mobile.html` and `core.js` gain the sending
side (the schema is frozen otherwise):

```ts
| { type: 'docInfo'; pages: number; text: string[]; thumb?: string } // thumb: base64 JPEG, page 1, 320 px wide
```

- `core.js`: after `loadPdf` finishes (and after `emitDocumentLoaded`), if the adapter has
  `emitDocInfo`, read each page's `getTextContent()`, join `str` values (newline on
  `hasEOL`), stop adding once the total reaches 1,000,000 characters, render page 1 to a
  320 px wide canvas and call `A.emitDocInfo({ pages, text, thumb })`. Runs after the page is
  usable; errors are swallowed with a console warning (search just lacks body text).
- `mobile.html`: `emitDocInfo(info) { post({ type: 'docInfo', ...info, thumb: info.thumb && info.thumb.split(',')[1] }) }`.
  The desktop adapter has no `emitDocInfo`, so the Electron app is unchanged.
- `apps/pdf-editor-desktop/test/mobile.mjs`: assert one `docInfo` with the fixture's page
  count and non-empty text.

### 5.2 Flows in the shell

- **Open a PDF** (add sheet): pick with `expo-document-picker` → `id = newId()` → copy to
  `library/<id>/document.pdf` → `createItem({ id, kind: 'pdf', title: name without .pdf,
  folderId: current, sizeBytes })` → `router.push('/editor', { uri, name, itemId: id })`.
- **docInfo** with an `itemId` and no merged sources: `setBody(itemId, text.join('\n\n'))`,
  `updateItem(itemId, { pageCount: pages })`, write `thumb.jpg` if absent, update `sizeBytes`.
- **save** (unchanged share behaviour, plus): with an `itemId`, write the bytes to a new
  `library/<newId>/document.pdf`, `createItem({ kind: 'pdf', title: '<source title> (edited)',
  folderId: source folder, body: last docInfo text })`, then share as today. The source file
  is never touched (PRD invariant 5). Approved by the owner (PRD Q4, 2026-10-31).
- **Size guard:** opening any item whose PDF is over 28 MB asks first: "This PDF is 34 MB.
  The editor may not open files over about 28 MB." [Cancel] [Open anyway].

## 6. Native module contract (`pdf-scan`)

### 6.1 TypeScript (`modules/pdf-scan/src/index.ts`)

```ts
import { requireNativeModule, requireNativeView } from 'expo';
import type { PermissionResponse } from 'expo-modules-core';
import type { ViewProps } from 'react-native';

/** x,y of top-left, top-right, bottom-right, bottom-left; 0..1 of the upright image. */
export type Quad = [number, number, number, number, number, number, number, number];
export type PageFilter = 'original' | 'auto' | 'gray' | 'bw';
export type Rotation = 0 | 90 | 180 | 270;

export interface ImportResult { uri: string; width: number; height: number; quad: Quad | null }
export interface ProcessRequest {
  src: string;          // upright original (*.orig.jpg)
  quad: Quad; rotation: Rotation; filter: PageFilter;
  out: string;          // absolute path without extension; writes <out>.jpg and, for 'bw', <out>.bits
  maxLongSide?: number; // default 2339; the review screen asks for 1200 for quick previews
}
export interface ProcessResult {
  jpg: string; width: number; height: number;
  bits: string | null; bitsWidth: number | null; bitsHeight: number | null;
}
export interface OcrRequest { src: string; quad: Quad; rotation: Rotation; lang: string } // lang: Tesseract code, 'eng'
export interface OcrWord {
  t: string;                               // the word
  b: [number, number, number, number];     // x0, y0, x1, y1: 0..1 of the processed page, top-left origin
  c: number;                               // confidence 0..100
  l: number;                               // line number on the page, from 0
}
export interface OcrResult { words: OcrWord[]; text: string; confidence: number; ms: number }

export interface PdfScanModule {
  getCameraPermission(): Promise<PermissionResponse>;
  requestCameraPermission(): Promise<PermissionResponse>;
  /** Decode, apply EXIF orientation, scale to ≤ 3,000 px, write JPEG quality 90 to dest, detect. */
  importImage(src: string, dest: string): Promise<ImportResult>;
  detectQuad(src: string): Promise<Quad | null>;
  processPage(req: ProcessRequest): Promise<ProcessResult>;
  /** One page at a time; rejects with code 'busy' if one is running, 'cancelled' after cancelRecognize. */
  recognize(req: OcrRequest): Promise<OcrResult>;
  cancelRecognize(): void;
  ocrLanguages(): string[];                // installed traineddata, e.g. ['eng']
}
export const PdfScan = requireNativeModule<PdfScanModule>('PdfScan');

export type ScanHint = 'searching' | 'hold' | 'blurry' | 'focusing' | 'captured';
export interface QuadEvent { quad: Quad | null; steady: number; hint: ScanHint } // steady: 0..1 towards auto-capture
export interface CaptureEvent {
  uri: string;        // upright original already written to sessionDir as cap-<ms>.jpg (≤ 3,000 px)
  width: number; height: number;
  quad: Quad | null;  // refined on the full image; null when nothing was found
  auto: boolean;
}
export interface CameraErrorEvent { code: 'unavailable' | 'permission' | 'capture_failed'; message: string }

export interface ScanCameraViewProps extends ViewProps {
  active: boolean;          // bind or unbind the camera (false while the screen is blurred)
  autoCapture: boolean;
  torch: boolean;
  accentColor: string;      // from useTheme().c.accent; the native outline uses it
  sessionDir: string;       // absolute file:// URI of scan-session/
  onQuad?: (e: { nativeEvent: QuadEvent }) => void;               // ≤ 10 per second, on change only
  onCapture?: (e: { nativeEvent: CaptureEvent }) => void;
  onCameraError?: (e: { nativeEvent: CameraErrorEvent }) => void;
}
export interface ScanCameraViewRef { capture(): Promise<void> }   // manual shutter
export const ScanCameraView = requireNativeView<ScanCameraViewProps>('PdfScan');
```

The contract grows by phase, and nothing is declared before it is built: Phase 2 adds the
two permission functions and the view; Phase 3 adds `importImage`, `detectQuad` and
`processPage`; Phase 4 adds `recognize`, `cancelRecognize` and `ocrLanguages`.

Errors reject with Expo `CodedException` codes: `not_found` (file), `decode_failed`,
`invalid_quad` (not 8 numbers in 0..1, or not convex), `busy`, `cancelled`, `ocr_init`
(traineddata missing or corrupt), `out_of_memory`.

### 6.2 Kotlin (`PdfScanModule.kt`)

```kotlin
class PdfScanModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PdfScan")

    AsyncFunction("getCameraPermission") { promise: Promise ->
      Permissions.getPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.CAMERA)
    }
    AsyncFunction("requestCameraPermission") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.CAMERA)
    }
    AsyncFunction("importImage") Coroutine { src: String, dest: String -> processor.importImage(src, dest) }  // ImportResult record
    AsyncFunction("detectQuad") Coroutine { src: String -> processor.detect(src) }                           // List<Double>?
    AsyncFunction("processPage") Coroutine { req: ProcessRequest -> processor.process(req) }                // ProcessResult record
    AsyncFunction("recognize") Coroutine { req: OcrRequest -> ocr.recognize(req) }                          // OcrResult record
    Function("cancelRecognize") { ocr.cancel() }
    Function("ocrLanguages") { ocr.languages() }

    View(ScanCameraView::class) {
      Events("onQuad", "onCapture", "onCameraError")
      Prop("active") { view: ScanCameraView, on: Boolean -> view.setActive(on) }
      Prop("autoCapture") { view: ScanCameraView, on: Boolean -> view.autoCapture = on }
      Prop("torch") { view: ScanCameraView, on: Boolean -> view.setTorch(on) }
      Prop("accentColor") { view: ScanCameraView, hex: String -> view.outlineColor = Color.parseColor(hex) }
      Prop("sessionDir") { view: ScanCameraView, uri: String -> view.sessionDir = File(Uri.parse(uri).path!!) }
      AsyncFunction("capture") { view: ScanCameraView -> view.captureManual() }
    }
  }
}

class ProcessRequest : Record {
  @Field val src: String = ""
  @Field val quad: List<Double> = emptyList()
  @Field val rotation: Int = 0
  @Field val filter: String = "auto"
  @Field val out: String = ""
  @Field val maxLongSide: Int = 2339
}
class OcrRequest : Record {
  @Field val src: String = ""; @Field val quad: List<Double> = emptyList()
  @Field val rotation: Int = 0; @Field val lang: String = "eng"
}
// ImportResult, ProcessResult, OcrResult and OcrWord are Records mirroring §6.1.
```

Heavy work runs on `Dispatchers.Default` except OCR, which runs on one dedicated thread
(`TessBaseAPI` is not thread-safe, R§3). View-bound `AsyncFunction` is supported by the
installed `expo-modules-core` 3.0.30 (R§4).

### 6.3 Swift (Phase 6)

```swift
public class PdfScanModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PdfScan")
    AsyncFunction("getCameraPermission") { (promise: Promise) in /* AVCaptureDevice.authorizationStatus(for: .video) */ }
    AsyncFunction("requestCameraPermission") { (promise: Promise) in /* AVCaptureDevice.requestAccess(for: .video) */ }
    AsyncFunction("importImage") { (src: URL, dest: URL) -> ImportResult in /* ImageIO, orientation applied */ }
    AsyncFunction("detectQuad") { (src: URL) -> [Double]? in /* VNDetectRectanglesRequest */ }
    AsyncFunction("processPage") { (req: ProcessRequest) -> ProcessResult in /* CIPerspectiveCorrection + filters */ }
    AsyncFunction("recognize") { (req: OcrRequest) -> OcrResult in /* VNRecognizeTextRequest(.accurate), words via boundingBox(for:) */ }
    Function("cancelRecognize") { /* VNRequest.cancel() */ }
    Function("ocrLanguages") { () -> [String] in ["eng"] }   // Tesseract-style codes mapped to Vision's ("eng" → "en-US")
    View(ScanCameraView.self) {
      Events("onQuad", "onCapture", "onCameraError")
      Prop("active") { (view: ScanCameraView, on: Bool) in view.setActive(on) }
      Prop("autoCapture") { (view: ScanCameraView, on: Bool) in view.autoCapture = on }
      Prop("torch") { (view: ScanCameraView, on: Bool) in view.setTorch(on) }
      Prop("accentColor") { (view: ScanCameraView, hex: String) in view.outlineColor = UIColor(hex: hex) }
      Prop("sessionDir") { (view: ScanCameraView, uri: URL) in view.sessionDir = uri }
      AsyncFunction("capture") { (view: ScanCameraView) in try await view.captureManual() }
    }
  }
}
struct ProcessRequest: Record {
  @Field var src: String = ""; @Field var quad: [Double] = []; @Field var rotation: Int = 0
  @Field var filter: String = "auto"; @Field var out: String = ""; @Field var maxLongSide: Int = 2339
}
```

iOS `.bits` files must be zlib-wrapped (RFC 1950): Apple's `COMPRESSION_ZLIB` writes raw
DEFLATE, so add the 2-byte header and the Adler-32 trailer. Vision's boxes have a
bottom-left origin; flip y to match §6.1.

## 7. Processing pipeline

### 7.1 Capture session

- `scan-session/session.json` (atomic write after every capture and edit):

```ts
interface ScanSession {
  version: 1;
  startedAt: number;
  folderId: string | null;          // where the scan will be saved
  appendTo: string | null;          // itemId when adding pages to an existing scan (FR-17)
  pages: { file: string; quad: Quad | null; rotation: Rotation; filter: PageFilter }[];
}
```

- One session at a time. The Library home shows a `Notice` when one exists: "Unsaved scan
  with 5 pages" [Resume] [Discard] (AC-15).
- Camera captures and photo imports both land in `scan-session/` as upright JPEGs
  (`importImage` for imports; the camera view does the same itself).
- Save (`ScanService.saveSession`, §7.6) moves each file into `library/<id>/pages/`, then
  deletes `scan-session/`.

### 7.2 Border detection (`core/QuadDetector.kt`, pure Kotlin)

Input: a luma plane (`ByteArray`, width, height, row stride). From the camera it is the
analysis frame's Y plane (no colour conversion); from a file it is the decoded bitmap's
luma, downscaled first.

1. Box-downscale so the long side is ≤ 320 px (a 640×480 frame becomes 320×240).
2. 5×5 Gaussian blur (separable, integer).
3. Sobel gradients; non-maximum suppression; hysteresis with high = 90th percentile of
   gradient magnitude (floor 20 on the 8-bit scale, so a blank frame has no edges) and
   low = 0.4 × high.
4. Dilate the edge map once (3×3) to close 1-px gaps.
5. 8-connected components of edge pixels (iterative fill with an `IntArray` stack). Drop
   components whose bounding box is under 25% of the frame's width or height.
6. Per component: convex hull (monotone chain); Douglas–Peucker with ε = 2% of the hull
   perimeter, raised until ≤ 16 vertices; the largest-area quadrilateral on those vertices.
7. Keep quads that are convex, cover ≥ 20% of the frame, have every interior angle in
   50°–130°, have ≥ 60% edge support (64 samples per side, a sample counts within 2 px of an
   edge pixel), and don't sit within 1% of all four frame borders (that's the frame, not a
   page). Score = area × support; the best wins.
8. Order corners top-left, top-right, bottom-right, bottom-left (min and max of x + y and
   x − y); return normalised to 0..1.

Budget: ≤ 60 ms per frame on the phone (NFR-1, **spike S2**). Buffers are allocated once
per frame size and reused. Constants live in one `DetectorConfig` data class so Phase 2 can
tune them against the fixture set (AC-4).

Known limit: a white page on a white surface has weak edges and may return null; the crop
then defaults to the full image inset by 2%, and the owner drags the corners.

### 7.3 Auto-capture (`core/QuadStabilizer.kt`, pure Kotlin, clock injected)

States: `SEARCHING → HOLDING → FIRED → COOLDOWN → SEARCHING`.

| Rule                 | Value (start; tuned in Phase 2)                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Drift                | Largest corner movement between consecutive detections, as a share of the frame diagonal. HOLDING while ≤ 2%.                           |
| Hold time            | 800 ms of HOLDING fires. `steady` = elapsed / 800 ms (drives the ring).                                                                  |
| Lost quad            | Missing for > 200 ms resets to SEARCHING.                                                                                                |
| Sharpness gate       | Variance of the Laplacian of luma inside the quad ≥ 60 (8-bit, 320 px scale; **spike S2** calibrates). Below it: hint `blurry`, the hold pauses. |
| Focus gate           | `CONTROL_AF_STATE` from a Camera2Interop capture callback must be `PASSIVE_FOCUSED` or `FOCUSED_LOCKED`; scanning pauses the hold (hint `focusing`). Fixed-focus cameras pass. |
| Focus assist         | On entering HOLDING, one `FocusMeteringAction` at the quad's centre.                                                                     |
| Re-arm (no duplicates) | After a capture, COOLDOWN until the quad is missing for ≥ 400 ms, or it moves > 15% of the diagonal, or the 32×32 luma thumbnail inside it differs from the captured one by ≥ 12% mean absolute difference (page turned). |
| Manual shutter       | Always allowed; also enters COOLDOWN.                                                                                                    |

Thresholds are shares of the frame, not pixels, so they hold at any analysis size (R§4).

### 7.4 Camera (`android/ScanCameraView.kt`)

- `PreviewView` plus an overlay `View` that draws the quad (2 dp stroke in `outlineColor`,
  20% fill) and the progress ring.
- Use cases bound to the activity's lifecycle: `Preview`; `ImageAnalysis` at 640×480,
  `STRATEGY_KEEP_ONLY_LATEST`, YUV_420_888, analysed on one background executor;
  `ImageCapture` at the largest 4:3 size, `CAPTURE_MODE_MINIMIZE_LATENCY`, JPEG quality 95.
  This trio is guaranteed even on LEGACY hardware (R§4). **Spike S1:** hardware level, the
  capture size actually chosen, and whether analysis and capture share the same 4:3 field of
  view (so normalised coordinates map 1:1).
- Analysis: rotate the detected quad by `imageInfo.rotationDegrees` into upright coordinates,
  feed `QuadStabilizer`, emit `onQuad` at most every 100 ms and only when the quad or hint
  changed.
- Capture: `takePicture` to `cacheDir/cap-<ms>.jpg` → import (decode with `inSampleSize`,
  scale to ≤ 3,000 px, apply EXIF orientation with `android.media.ExifInterface`, write
  `sessionDir/cap-<ms>.jpg` quality 90) → re-detect on the imported image; if found and
  within 3% of the analysis quad, use it, else the analysis quad → `onCapture`. Haptics are
  done in JS (`expo-haptics`).
- `active=false` unbinds all use cases (screen blurred or app in background).

### 7.5 Page processing (`android/PageProcessor.kt` + `core/Filters.kt`)

1. Decode the upright original to ARGB_8888.
2. Rotation shifts the corner order (90° = one step) and swaps output width and height;
   the bitmap itself is never rotated.
3. Output size (`core/PageGeometry.kt`): width = max(top, bottom edge length), height =
   max(left, right edge length) in source pixels, scaled so the long side is `maxLongSide`
   (default 2,339 px = A4 at 200 dpi). Never upscale the JPEG.
4. Warp: `Matrix.setPolyToPoly(quadPx, 0, rectPx, 0, 4)`, then
   `Canvas(out).drawBitmap(src, matrix, Paint(Paint.FILTER_BITMAP_FLAG))`. **Spike S3** times
   it on the phone.
5. Filters (pure Kotlin on `IntArray` / `ByteArray`):
   - `original`: none.
   - `auto`: estimate the background (max filter on a ⅛-scale luma with a window of 1/20 of
     the width, then box blur), divide each channel by it, then stretch luma between its 1st
     and 99th percentiles. Even lighting, colour kept.
   - `gray`: BT.601 luma, then the same normalisation and stretch.
   - `bw`: `gray` at the 1-bit size (long side 3,508 px = 300 dpi, at most 1.5× the source),
     then Sauvola thresholding (window 31 px, k = 0.2, R = 128) with local mean and variance
     computed at half resolution and sampled bilinearly, which keeps memory near 20 MB.
6. Write `<out>.jpg` (quality 80; `bw` writes its thresholded image at quality 70 for
   display). For `bw` also write `<out>.bits`: rows packed MSB-first, 1 = white, padded to
   whole bytes, compressed with `java.util.zip.Deflater(9)` (zlib format). Both via `.tmp`
   and rename.
7. Recycle bitmaps. Peak memory about 80 MB (a 3,000 px source is 27 MB; NFR-3).

### 7.6 Text recognition

**Native (`android/OcrEngine.kt`, `android/Tessdata.kt`):**

1. On first use, copy `assets/tessdata/eng.traineddata` to `filesDir/tessdata/` if missing or
   a different size (atomic). One `TessBaseAPI`, initialised once with
   `init(filesDir.path, "eng", OEM_LSTM_ONLY)`, `setVariable("user_defined_dpi", "300")`,
   page segmentation mode `PSM_AUTO` (**spike S5** compares PSM 3 and 6).
2. Build the OCR image from the original and quad, like §7.5 but gray, normalised, not
   thresholded, with the long side clamped to 2,339–3,508 px (200–300 dpi; small sources are
   upscaled because Tesseract wants an x-height near 20 px, R§3).
3. `setImage(bitmap)`; `getUTF8Text()`; walk `getResultIterator()` at `RIL_WORD`: text,
   `getBoundingRect`, `confidence`; a new line starts where `isAtBeginningOf(RIL_TEXTLINE)`.
4. Normalise boxes by the OCR image size (`core/OcrLayout.kt`). The OCR image and the stored
   JPEG have the same aspect, so 0..1 coordinates fit both and the PDF page.
5. `clear()` and recycle after each page. `cancel()` calls `stop()`; the pending call rejects
   with `cancelled`.

**Queue (`scan-core/src/scan-service.ts`):**

```ts
export interface ScanNative {
  processPage(req: ProcessRequest): Promise<ProcessResult>;
  recognize(req: OcrRequest): Promise<OcrResult>;
  cancelRecognize(): void;
}
export interface ScanFiles {
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;            // file or directory, missing is fine
  read(path: string): Promise<Uint8Array>;        // File.bytes()
  sizeOf(dir: string): Promise<number>;
  itemDir(itemId: string): string;                // file:// URI of library/<id>/
}

export class ScanService {
  constructor(lib: Library, store: ScanStore, native: ScanNative, files: ScanFiles);
  saveSession(s: ScanSession, title: string): Promise<Item>;          // or appends when s.appendTo
  editPage(itemId: string, pageId: string, edit: { quad?: Quad; rotation?: Rotation; filter?: PageFilter }): Promise<void>;
  reorder(itemId: string, pageIds: readonly string[]): Promise<void>;
  deletePage(itemId: string, pageId: string): Promise<void>;
  retry(itemId: string, pageId: string): Promise<void>;               // failed → pending
  runOcr(): Promise<void>;                                            // no-op if already running
  pause(): void; resume(): void;                                      // the capture screen pauses it
  onProgress(fn: (p: { itemId: string; done: number; total: number }) => void): () => void;
  buildPdf(itemId: string, sink: ByteSink): Promise<{ bytes: number }>;
  documentText(itemId: string): Promise<string>;                      // "Copy text"
}
```

- `runOcr` takes pending pages oldest scan first, then by position, one at a time. Per page,
  in one transaction: set `ocr_state` 'done', `ocr_text`, `ocr_words`, `ocr_conf`, then
  `setBody(itemId, pages' text joined by "\n\n" in position order)`. A failure stores
  'failed' and `ocr_error` and moves on.
- It starts after `Library.open` at app start (resuming anything left 'pending', AC-10),
  after `saveSession`, after `retry`, and after an edit that resets a page.
- Changing a page's quad or rotation resets it to 'pending' (word positions change).
  Changing only the filter keeps the text: recognition always reads the original.
- `reorder` and `deletePage` rewrite the body in the new order.
- It pauses while the camera is open (both compete for the 2 big cores).
- React Native timers pause in the background, but awaiting native promises does not
  depend on timers, so the loop keeps going while the process lives; if the process dies,
  the next start resumes (no foreground service, no extra permission).

## 8. The PDF writer (`scan-core/src/pdf-writer.ts`)

```ts
export interface ByteSink { write(bytes: Uint8Array): Promise<void> | void }
export type PageImage =
  | { kind: 'jpeg'; bytes: Uint8Array }                                  // size and components from SOF
  | { kind: 'bits'; bytes: Uint8Array; width: number; height: number }; // zlib, 1 bit, 1 = white
export interface PdfPage {
  image(): Promise<PageImage>;   // a thunk: only one page's bytes are held at a time
  words: readonly OcrWord[];
  widthPt: number; heightPt: number;
}
export function writeScanPdf(
  pages: readonly PdfPage[], sink: ByteSink, info: { title: string; created: Date },
): Promise<{ bytes: number }>;
```

**Layout.** PDF 1.7 header with a binary comment line. Object numbers are fixed in advance
so the page tree can be written first: 1 Catalog, 2 Pages (`/Kids` lists every page),
3 Info, 4–9 the font set (written only if some page has words), then per page *i*:
`10 + 3i` Page, `11 + 3i` Contents, `12 + 3i` image XObject. Offsets are counted as bytes go
to the sink; a classic `xref` table, `trailer` (`/Size /Root /Info`) and `startxref` close
the file.

**Images.**
- JPEG: `/Subtype /Image /Width w /Height h /ColorSpace /DeviceRGB` (3 components) or
  `/DeviceGray` (1) `/BitsPerComponent 8 /Filter /DCTDecode`. The bytes pass through
  untouched. A 4-component (CMYK) JPEG throws; the pipeline never makes one.
- Bits: `/ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode`.
- Content: `q {W} 0 0 {H} 0 0 cm /Im0 Do Q` fills the page.

**Page size (`paper.ts`).** From the processed image's aspect: within 3% of √2 → A4
(595.28 × 841.89 pt); within 3% of 11/8.5 → US Letter (612 × 792 pt); otherwise the long
side is 841.89 pt and the short side follows the aspect. Landscape swaps. No setting in v1.

**Font set** (as Tesseract's `pdfrenderer.cpp`, R§5):

```text
4 Type0      /BaseFont /GlyphLessFont /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 9 0 R
5 CIDFontType2 /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>
             /FontDescriptor 6 0 R /DW 500 /CIDToGIDMap 8 0 R
6 FontDescriptor /Flags 5 /FontBBox [0 0 500 1000] /ItalicAngle 0 /Ascent 1000 /Descent 0
             /CapHeight 1000 /StemV 80 /FontFile2 7 0 R
7 FontFile2  pdf.ttf, 573 bytes, /Length1 573
8 CIDToGIDMap  every CID → glyph 1; 128 KiB raw, stored as the 150-byte Flate constant
9 ToUnicode  CMap: codespace <0000> <FFFF>; bfrange <0000> <FFFF> <0000>
```

**Text layer.** Per line (words sharing `l`), one `BT 3 Tr … ET`. Per word, with page size
W × H points and box `b = [x0, y0, x1, y1]`:

```text
fs   = (y1 − y0) · H                                  font size = box height
x    = x0 · W,  y = H − y1 · H                         baseline at the box bottom
text = word + (last word on the line ? '' : ' ')
span = (last word ? x1 : next word's x0) · W − x      so selection runs on to the next word
Tz   = 100 · span / (fs · 0.5 · text.length)          glyph width is 500/1000 em
emit /F0 {fs} Tf {Tz} Tz 1 0 0 1 {x} {y} Tm <{UTF-16BE hex of text}> Tj
```

Numbers are written with at most 2 decimals. Words with `fs < 1` or `span ≤ 0` are skipped.
Text is encoded one UTF-16 code unit per CID, as Tesseract does. Content streams are not
compressed (no zlib in Hermes; the text layer is 5–10 KB a page).

**Info.** `/Title` (UTF-16BE with BOM), `/Producer (PDF Editor)`, `/CreationDate`. No device
or user data.

**In the app.** `buildPdf` writes to `cache/export/<title>.pdf` through a `FileHandle`
(`writeBytes`, no base64), reading each page with `File.bytes()`. It is built on demand for
Share PDF and Open in editor, never stored in the library, so pages aren't stored twice.
Over 28 MB, "Open in editor" warns (§5.2).

## 9. Storage budget

| Per page                          | Size (assumed; **spike S7** measures)            |
| --------------------------------- | ------------------------------------------------ |
| Original, ≤ 3,000 px, quality 90  | 1.2–1.8 MB                                       |
| Processed colour JPEG, 200 dpi    | 0.4–0.7 MB (gray 0.25–0.45 MB)                   |
| `.bits` (black and white only)    | 55–110 KB                                        |
| OCR words in the database         | 20–40 KB                                         |

A 20-page colour scan takes about 40 MB on the phone with originals (PRD Q7), and its PDF
about 8–14 MB.

## 10. Permissions and manifest

- `modules/pdf-scan/android/src/main/AndroidManifest.xml`:
  `<uses-permission android:name="android.permission.CAMERA"/>` and
  `<uses-feature android:name="android.hardware.camera.any" android:required="false"/>`.
- The app manifest removes what libraries merge in (expo-file-system adds the storage pair;
  expo-image-picker adds RECORD_AUDIO, R§8). Add `xmlns:tools` and:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" tools:node="remove"/>
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove"/>
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" tools:node="remove"/>
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" tools:node="remove"/>
```

  and mirror it in `app.json` (`android.blockedPermissions`) so a future prebuild keeps it.
  INTERNET stays (React Native development; Reader). VIBRATE stays (haptics).
- `android:allowBackup="false"` (owner, PRD Q5, 2026-10-31), mirrored as
  `android.allowBackup: false` in `app.json`. Scans and articles stay only on the phone.
- Runtime flow: "Scan a document" → `getCameraPermission()`; `undetermined` → request;
  denied with `canAskAgain: false` → the capture screen shows a `Notice` "Camera access is
  off. PDF Editor needs it to scan pages." with [Open settings] (`Linking.openSettings()`).
- iOS (Phase 6): `NSCameraUsageDescription` "PDF Editor uses the camera to scan documents.
  Pages stay on this device."

## 11. Screens

All screens use `@apps-hub/ui` (`ThemeProvider brand="pdf"` is already in `_layout.tsx`).
Copy is sentence case. Icons are Ionicons, each with an `accessibilityLabel`.

| Route                  | Built from                                                                                                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` (Library)          | `Screen` with a `FlatList`. `Header` "Library" (or the folder name, subtitle the breadcrumb "Library / Work"), trailing "Add" (`add` icon) and, inside a folder, "Folder actions". `Field` "Search titles and text". `Segmented` All plus each kind present (PDFs, Scans; Reader adds Articles), hidden while only one kind exists. Tag filter row → `Sheet` of tags. `Notice` for an unsaved scan. Folders as `Row`s (leading `folder-outline`, subtitle "3 items"), then items as `Row`s (leading `thumb.jpg` or first page via `expo-image` 40×52, subtitle "Scan · 12 pages · 31 Oct · 6.1 MB", search hits add the snippet), trailing "More" (`ellipsis-horizontal`) → item `Sheet`. `Empty` "Your library is empty" / "Scan a document or open a PDF. Everything stays on this device." with two `Button`s. |
| Add sheet              | `Sheet` "Add" with `Row`s: "Scan a document" (`camera-outline`), "Import photos" (`images-outline`), "Open a PDF" (`document-outline`), "New folder" (`folder-open-outline`).                                                                                                                       |
| Item sheet             | `Sheet` with `Row`s: "Rename", "Move to folder", "Tags", "Share PDF", "Delete" (danger `Button` with a confirmation naming the item). Rename uses a `Field`; Move lists folders as `Row`s plus "Library (top level)"; Tags has a `Field` "Add a tag" and `Row`s with a check.                                   |
| `/scan/capture`        | Full-screen `ScanCameraView`. Top bar: "Close", torch, `Segmented` Auto / Manual. Hint `Text` (meta): "Looking for the page edges", "Hold steady", "Too blurry, hold still", "Focusing", "Captured page 3". Bottom: last capture thumbnail with a `Pill` count, the round shutter (`Pressable` 72 dp, label "Take photo"), `Button` "Done". `AccessibilityInfo.announceForAccessibility` on each capture. |
| `/scan/review`         | Page strip (`expo-image` thumbnails, selected page outlined in `c.accent`). The crop editor: the image with four 44 dp handles (react-native-gesture-handler + reanimated, both installed) and edges drawn as thin rotated `View`s. `Segmented` Original, Auto, Grayscale, Black and white; `Button`s "Rotate", "Retake", "Delete page", "Move left", "Move right", "Apply filter to all". `Field` "Title". `Button` "Save". |
| `/scan/[id]`           | `Header` title, subtitle "12 pages · text read on 9 of 12" with `Progress` while reading. Page grid. `Button`s "Share PDF", "Open in editor", "Add pages", "Copy text". A failed page shows a `Notice` with "Try again".                                                                          |
| `/scan/page`           | `Segmented` Image / Text; the page image or its recognised text (selectable); "Edit page" opens the crop editor for that page.                                                                                                                                                                        |
| `/about`               | `Group`s of licence notices: Tesseract (Apache-2.0), Leptonica, the IJG notice "This software is based in part on the work of the Independent JPEG Group", libpng, CameraX (Apache-2.0), GlyphLessFont (Apache-2.0), PDF.js, pdf-lib. Reached from the Library header's "More" sheet.                       |

No drag-to-reorder in v1: "Move left" and "Move right" are accessible and need no new
dependency.

## 12. Testing

### TypeScript (`node --test`, real SQLite through `node:sqlite`)

Each new file is added to its package's `test` script (CLAUDE.md gotcha).

`packages/library-core/src/__tests__/`:
- `sql-port.test.ts`: writes serialise; a write issued during a transaction waits for it; a
  throwing transaction rolls back; `tx.transaction` throws.
- `migrate.test.ts`: fresh install, re-run is a no-op, two tracks independent, appended step
  applies, `too_new`.
- `library-items.test.ts`: create, get, update bumps `updated_at`, `setBody` doesn't, delete
  cascades to tags and feature rows (a fake feature table), FTS row follows insert, rename
  and delete, body truncation at 1,000,000.
- `library-folders.test.ts`: duplicate names ignoring case in one parent, same name in two
  parents, move into a descendant → `cycle`, delete moves items and subfolders to the parent
  (AC-2), `folderPath`, item counts.
- `library-tags.test.ts`: create on first use, dedupe "Tax" and "tax", unused tags removed,
  filter by tag (AC-3).
- `library-search.test.ts`: prefix match, accents, title outranks body, snippet markers, kind
  and tag filters, list mode sort and paging, 500 items × 20 pages of text answer in
  < 300 ms on the Mac (a smoke bound for NFR-1).
- `fts-query.test.ts`: blank → null, quotes doubled, operators literal, 8-token cap,
  punctuation-only tokens harmless.
- `normalize.test.ts`: harakat, tatweel, ZWNJ/ZWJ stripped; ي → ی and ك → ک; NFKC ligatures;
  Latin text unchanged. `library-search.test.ts` adds: a query with harakat finds a body and a
  title without them and the reverse, and "كتاب" finds "کتاب".
- `orphan-dirs.test.ts`: only id-shaped names without rows.

`packages/scan-core/src/__tests__/`:
- `pdf-writer.test.ts`: header, xref offsets equal byte positions, `startxref`; the output
  loads in the vendored pdf-lib (`packages/pdf-editor-engine/vendor/pdf-lib.min.js`) with the
  right page count and sizes; text operators (`3 Tr`, `Tf`, `Tz`, `Tm`) and the numbers for a
  known box; UTF-16BE for "é" and "€"; no font objects when no page has words; a bits page's
  image dictionary; `image()` called once per page, in order.
- `glyphless-font.test.ts`: the TTF starts with `00 01 00 00`; the CIDToGIDMap inflates
  (`node:zlib`, test only) to 65,536 big-endian 1s.
- `jpeg.test.ts`: baseline and progressive SOF, gray and RGB, CMYK rejected, truncated file.
- `paper.test.ts`: A4, Letter, receipt, landscape.
- `scan-store.test.ts`: the `scan` track, page rows, cascade when the item is deleted.
- `scan-service.test.ts` (fake native and files, real Library): save moves files and inserts
  rows; append to an existing scan; recognition in order, body joined in page order; a crash
  mid-queue resumes without duplicates (AC-10); a failure continues; retry; quad change
  resets, filter change doesn't; reorder and delete rewrite the body; pause stops after the
  current page.
- `no-network.test.ts` (PRD invariant 1): reads the sources of both packages and the
  module's Kotlin and fails on `fetch(`, `XMLHttpRequest`, `WebSocket`, `java.net.`,
  `okhttp3` or `HttpURLConnection`.

PRD invariant 2 is checked in Phases 2 and 4 with
`./gradlew :app:dependencies --configuration releaseRuntimeClasspath | grep -E 'mlkit|play-services|firebase|litert'`,
which must print nothing.

### Kotlin (`./gradlew :pdf-scan:testDebugUnitTest`, JVM, no Android classes)

- `QuadDetectorTest`: synthetic pages (a light quad with text-like noise on a textured
  background, rotated and tilted) found within 2% of the diagonal; page partly out of frame,
  blank frame and clutter → null. If the owner supplies real frames, they go in
  `src/test/resources/quads/` as 320×240 PGM with corners in `corners.json` and join the
  same assertion. AC-4 itself is judged on the phone.
- `QuadStabilizerTest`: steady sequence fires after 800 ms; 3% jitter resets; blurry and
  focusing pause; no second fire on the same page; a turned page (thumbnail change) re-arms.
- `FiltersTest`: background normalisation flattens a lighting gradient; Sauvola turns
  gradient-lit text into black on white; percentile stretch.
- `PageGeometryTest`: output size from a quad, rotation corner shifts, the warped corners of
  a synthetic homography land within 2 px (AC-7).
- `BitPackTest`: packing and `Inflater` round trip; padding of odd widths.
- `OcrLayoutTest`: pixel boxes to 0..1, line numbering from iterator data.

### Engine

`pnpm --filter pdf-editor-desktop test:e2e`: `mobile.mjs` checks the `docInfo` event.

### On the phone (Store install only)

AC-1 to AC-15 as a checklist in the handoff, with measured times and sizes. Speeds are read
from `Log.d` timings in debug builds and a stopwatch on release builds; nothing is sent
anywhere.

## 13. Build, release and Store

- Release id `pdf-editor`, already registered in `tools/release/src/apps.ts` (with the
  `prepare` step that rebuilds the editor page). `pnpm release pdf-editor -m "…"` builds,
  signs and publishes; install on the phone from the Store only.
- `versionName` comes from `expo.version` in `app.json` (`tools/release/src/main.ts:77`):
  1.1.0 for Library, 1.2.0 for capture, 1.3.0 for pages and PDF, 2.0.0 for recognition and
  the finished feature.
- CI auto-releases changed Store apps on push to `main` (`docs/app-store.md`). Merge a
  phase to `main` only when it is ready for the phone.
- Confirm the Cloudflare account before any Store deploy (standing rule).
- The package `com.haroon.pdfeditor` is already on the developer-verification list; no new
  package.
- Check native alignment on each release APK:
  `$ANDROID_HOME/build-tools/36.0.0/zipalign -c -P 16 -v 4 <apk>` and
  `$ANDROID_HOME/build-tools/36.0.0/aapt dump permissions <apk>` (AC-12, AC-13).
- Docs to update as phases land: `AGENTS.md` (PDF Editor line, the new Gradle gate),
  `apps/pdf-editor-mobile/CLAUDE.md` ("This app is a shell" gains the module and the
  library), `packages/pdf-editor-engine/README.md` (the `docInfo` event).

## 14. Phases

One phase per session, in order. Each ends with the verification commands' real output, a
Store release the owner tests, and a handoff update.

| Phase | Build                                                                                                                                                                                                                         | Exit criteria                                                                                                     |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1     | **Library foundation:** `library-core` (§4), `library.db`, Library home, add sheet with "Open a PDF", folders, tags, search (with Arabic and Urdu normalisation), item sheet, start-up sweep, `docInfo` event, editor save to library                             | TS tests green; e2e green; AC-1, AC-2, AC-3 and AC-14 (with a PDF) on the phone; release 1.1.0. Reader starts after Phase 4 (S0 order). |
| 2     | **Camera and detection:** `pdf-scan` module (Android), `ScanCameraView`, `QuadDetector`, `QuadStabilizer`, permission flow, manifest clean-up, backup off, arm64 only, capture screen, session file; spikes S1–S4                        | JVM tests green; AC-4, AC-5, AC-12, AC-13 (size so far) on the phone; release 1.2.0                                  |
| 3     | **Pages and PDF:** `importImage`, `processPage`, filters, review screen and crop editor, `scan-core` store, service and PDF writer (images only), scan view, Share PDF, Open in editor, Import photos, Add pages; spike S7     | TS and JVM tests green; AC-6, AC-7, AC-14 (with a scan), AC-15; release 1.3.0                                       |
| 4     | **Text recognition and searchable PDF:** Tesseract4Android, the English asset, `recognize`, the queue, body → search, the text layer, Copy text, retry, About screen; spikes S5, S6                                          | AC-8, AC-9, AC-10, AC-11, AC-1 with scan text; release 2.0.0                                                       |
| 5     | **Hardening:** the full AC sweep on the phone, tuning detector and stabiliser constants, NFR-1 to NFR-3 measured, docs updated                                                                                               | Every AC passes or has a written gap; NFR numbers in the handoff                                                  |
| 6     | **iOS (optional):** the Swift side of §6.3, `NSCameraUsageDescription`, `expo-module.config.json` adds "apple"                                                                                                               | Simulator build green; capture and recognition on a device if one is available (7-day sideload, no Store)         |

## 15. Spikes

Each records pass or fail, the numbers and the decision in `docs/handoffs/pdf-editor-scan.md`.

| #  | Phase | Question                                                                                                                         | Decision it feeds                                     |
| -- | ----- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| S1 | 2     | Camera hardware level; the 4:3 capture size CameraX picks; do analysis and capture share the field of view; which AF states arrive | Coordinate mapping (§7.4), focus gate (§7.3)          |
| S2 | 2     | Detector ms per frame on the phone; hit rate on 20 real pages (AC-4); the sharpness threshold that separates sharp from blurred    | `DetectorConfig`, stabiliser constants; Q1 upgrade    |
| S3 | 2     | `setPolyToPoly` warp time and peak memory for a 3,000 px source to a 2,339 px page                                                | Whether warping needs a tile-based fallback           |
| S4 | 2     | `adb shell getconf PAGE_SIZE` (reading only); `zipalign -c -P 16` and size of the arm64-only APK                                  | AC-13; 16 KB checks for new `.so` files               |
| S5 | 4     | Tesseract seconds per page and peak PSS on the five-page set: standard vs OpenMP, PSM 3 vs 6; word error rate                     | Flavour, PSM; AC-8; Q2 fallback                       |
| S6 | 4     | Text-layer alignment in the editor (PDF.js), Chrome and Preview on the Mac                                                        | Tz and baseline formula (§8)                          |
| S7 | 3     | Real sizes per page: original, colour and gray JPEG at quality 80, `.bits`                                                         | NFR-2 numbers; JPEG quality                           |
