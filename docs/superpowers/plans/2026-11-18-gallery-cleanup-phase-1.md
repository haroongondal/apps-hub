# Clean up the gallery, Phase 1 (engine) Implementation Plan

> **For agentic workers:** executed with `cd-engineering-tools:parallel-agents-coord` (the owner's rule replaces
> superpowers:subagent-driven-development). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The photo-index job also stores Clean up scores, and design-media can group, keep the best, dismiss,
trash (through Android's own dialog only), list recently removed and restore, all callable from JS for Phase 2.2.

**Architecture:** Pure maths and grouping in `core/` (JVM-tested against `packages/media-core/fixtures/gallery-cleanup`);
the index job scores a 512 px thumbnail next to the existing CLIP pass; a thin Android layer joins the index with
MediaStore columns and launches `MediaStore.createTrashRequest` from the current Activity via `OnActivityResult`.

**Tech Stack:** Kotlin (Expo Modules API, expo-modules-core 3.0.30), JUnit 4, kotlinx.serialization (already in), TS contract.

**Spec:** `docs/superpowers/specs/2026-11-13-gallery-cleanup-design.md` (AC-4 as amended by the owner 2026-11-18),
`docs/superpowers/plans/2026-11-18-gallery-cleanup-phase-0-results.md`, maths `tools/gallery-cleanup-bench/ref.py` docstring.

## Global Constraints

- Kotlin owns all of it; `core/` stays pure (no `android.*` imports). No new Gradle or npm dependency.
- design-media never touches the network (`DataSafetyRulesTest` rule 6).
- No gallery file is ever modified (AC-6). The only way a gallery photo leaves is `MediaStore.createTrashRequest(resolver, uris, true)`
  confirmed in Android's dialog; never `createDeleteRequest`, never `resolver.delete` on a gallery URI, never a permanent delete.
- Restore is `createTrashRequest(resolver, uris, false)`.
- Search behaviour and its tests stay unchanged (PhotoIndexTest, ClipImageTest, …).
- minSdk is 35, so API 30+ calls need no version checks.
- Erasable TypeScript only; the JS contract change is additive.

## Rulings (decided here; implementers do not revisit)

- R1 CLIP input: **kept as is** (`loadThumbnail(Size(256,256))` → `clipTensor`), plus a second `loadThumbnail(Size(512,512))` for the scores.
  Why: `ContentResolver.loadThumbnail` picks an integer `setTargetSampleSize` from the requested size, so a 512 request decodes
  the provider's thumbnail with a different codec sample size than a 256 request; no resize of the 512 bitmap reproduces the
  codec's sampled decode, so the CLIP tensor (and every stored search vector) would change. The provider caches thumbnails,
  so the extra load reads a cached file, not the full photo (the 143 ms phase-0 figure was a full-file decode). Recheck time on the phone in 2.2.
- R2 Score thumbnail: `loadThumbnail(Size(512,512))`, then if its long side > 512, `Bitmap.createScaledBitmap(bmp, w, h, true)` to
  `thumb512Size` (ref `thumb512`: long side 512, short side `floor(s*512/long + 0.5)`, at least 1; never upscale). This is a sampled
  codec decode plus a bilinear resize, i.e. Phase 0's filter **b** (draft+BILINEAR), not LANCZOS.
- R3 Blur: flagged when `laplacianVar < threshold`. Default **132.1** (filter b, natural set: 62.8 % blurred / 9.8 % sharp).
  Slider range **26.0** (gentle end: 22.6 % blurred / 0.3 % sharp) to **298.8** (strict end: 85 % of blurred, 36 % sharp), from the
  filter-b natural curve in `.superpowers/sdd/2026-11-18-image-tools-2.0/blur-report.txt`. Phone thumbnails recheck in 2.2.
- R4 Look-alikes: cosine of the stored int8 vectors (`dot / (|a| |b|)`), which is what Phase 0 tuned (ruling R4 there). Default
  **0.93**, strict **0.97**; pairs taken within 10 minutes (600,000 ms) of each other; groups are union-find components.
- R5 Copies: dHash Hamming ≤ 4 and `aspectClose` (2 %) on the stored 512-thumbnail width/height; buckets by multi-index hashing
  (split the 64 bits into 5 chunks of 13,13,13,13,12 bits; Hamming ≤ 4 means at least one chunk is equal); union-find components.
  A photo in a Copies group is left out of Look-alikes (one tick per photo across those two kinds). Blurry, Screenshots and Too
  dark/blown out may overlap anything.
- R6 Too dark / blown out: `mean < 0.08 || mean > 0.95`, and `spread < 0.08` (spec numbers; the spread cut-off is untuned, the same
  0.08 "low texture" line Phase 0 used).
- R7 Screenshots: MediaStore `RELATIVE_PATH` contains `Screenshots` (case-sensitive, as the spec says).
- R8 Keeper (copies and look-alikes): highest `laplacianVar`, then largest `width*height` of the original (MediaStore WIDTH×HEIGHT),
  then most bytes, then oldest `takenAt`, then lowest id. Keeper `best = true, ticked = false`; the rest `ticked = true`.
- R9 Ticks: only Copies and Look-alikes come pre-ticked (spec Scope 6 is the only tick rule). Blurry, Screenshots and Too dark/blown
  out come **unticked** (the screen has "Tick all"). Flag to the owner: the spec's Goal line "Untick anything to keep" could be read
  as all pre-ticked.
- R10 Dismissals ("Not a mistake"): stored as (kind, MediaStore id) in `filesDir/cleanup-dismissed.json` beside the index; a dismissed
  photo never shows in that kind again. Undo: `clearCleanupDismissals()` brings them all back (the spec leaves "undone" to the builder).
- R11 Trash record: `filesDir/cleanup-trash.json`, entries `{uri, name, bytes, trashedAt}` written only after Android's dialog
  returns RESULT_OK. Recently removed = entries with `trashedAt` within 30 days that MediaStore still reports `IS_TRASHED = 1`;
  `expiresAt` = MediaStore `DATE_EXPIRES` × 1000, else `trashedAt + 30 days`. Entries MediaStore no longer has as trashed are dropped.
  Restore removes the entries after RESULT_OK.
- R12 takenAt: MediaStore `DATE_TAKEN` (ms), or `DATE_MODIFIED × 1000` when it is 0/null.

## Review Focus

1. A torn or v1 index file: reading must give "scan again", never a crash or half-parsed scores (Task 2 test `v1FileMeansEmpty`).
2. The Activity is gone or a second trash request starts while one is open: reject with a plain error, never trash without the dialog,
   never record without RESULT_OK (Task 5 tests on the pure `TrashFlow` state machine).
3. A URI handed to `trashPhotos` that is not a MediaStore image (`content://media/external/images/media/<id>`): refused before any
   request (Task 5 test `refusesNonImageUris`).
4. Photos with no date taken, 1×1 or tiny thumbnails (w or h < 3), all-identical dHash 0 (flat images): no crash, flat photos are not
   all one Copies group unless aspect also matches (Task 3 test `flatPhotosOnlyGroupWithSameAspect` documents it: they do group when
   aspect matches; they are copies in hash terms, and the keeper rule still keeps one).
5. Photos trashed in Clean up still in the index until the next scan: grouping joins against live MediaStore rows, so they vanish at
   once (Task 5 behaviour; JVM test in Task 3 `missingMetaIsSkipped`).

---

### Task 1: Score maths (`core/CleanupScores.kt`)

**Files:** Create `core/CleanupScores.kt`, test `src/test/.../core/CleanupScoresTest.kt` (all paths below are under
`apps/design-editor-mobile/modules/design-media/android/src/{main,test}/java/expo/modules/designmedia/`).

**Interfaces — Produces:**
- `fun grey(argb: IntArray): ByteArray` (Pillow "L": `(19595R + 38470G + 7471B + 32768) shr 16`)
- `fun dhash(g: ByteArray, w: Int, h: Int): Long` (ref.py recipe, bit 63 = row 0 pair 0; port `Bench.java`)
- `fun hamming(a: Long, b: Long): Int`
- `fun brightness(g: ByteArray): DoubleArray` ([mean, spread] on 0..1)
- `fun laplacianVar(g: ByteArray, w: Int, h: Int): Double`
- `fun aspectClose(w1: Int, h1: Int, w2: Int, h2: Int, tol: Double = 0.02): Boolean`
- `fun thumb512Size(w: Int, h: Int): Pair<Int, Int>` (identity when long side ≤ 512)
- `data class PhotoScores(val dhash: Long, val mean: Float, val spread: Float, val laplacian: Float, val width: Int, val height: Int)`
- `fun scoresOf(argb: IntArray, w: Int, h: Int): PhotoScores`

- [ ] Step 1: tests. `matchesReferenceFixtures`: for every case in `gallery-cleanup/cases.json`, read the PNG with `javax.imageio.ImageIO`
  (`getRGB`), assert sha256(grey) == `grey_sha256`, `"%016x".format(dhash)` == `dhash`, brightness within 1e-12 relative,
  laplacianVar within 1e-9 relative (the `close` rule in Bench.java). `oddGreyMatchesU8`: grey of odd.png equals the bytes of odd.u8.
  `pairsAndAspect`: hamming for each `pairs` entry equals the stored value; `aspectClose` for each `aspect` entry equals `close`.
  `thumb512SizeFollowsRef`: (4000,3000)→(512,384), (300,200)→(300,200), (5000,3)→(512,1), (511,1024)→(256,512).
- [ ] Step 2: run, see them fail. Step 3: implement. Step 4: run `:design-media:testDebugUnitTest --tests '*CleanupScoresTest'` (under the
  `gradle` filelock), PASS. Step 5: commit (pathspec).

### Task 2: Index format v2 and the scoring pass

**Files:** Modify `core/PhotoIndex.kt`, `android/Gallery.kt`, `android/PhotoIndexRunner.kt`; test `core/PhotoIndexTest.kt`.

**Interfaces — Consumes:** Task 1 `PhotoScores`, `scoresOf`, `thumb512Size`.
**Produces:** `class PhotoRow(val key: PhotoKey, val vec: ByteArray, val scores: PhotoScores)`; `PhotoIndexFile.VERSION = 2`;
record = 24 (key) + 512 (vec) + 24 (scores: dhash Long, mean/spread/laplacian Float, width/height Short); `Gallery.scores(ctx, id): PhotoScores?`.

- [ ] Step 1: tests. Update the existing PhotoIndexTest helpers to build rows with scores; add `scoresRoundTrip` (all six fields back
  exactly, incl. a width of 512 and a laplacian of 0f) and `v1FileMeansEmpty` (a file written with the v1 header and v1-sized records
  reads as empty, so the job re-scans). Every existing PhotoIndexTest/search test must still pass unchanged in meaning.
- [ ] Step 2: fail. Step 3: implement. Job: per photo, CLIP tensor exactly as today (R1) and `Gallery.scores` (R2); a row is written only
  when both succeed (null from either skips the photo, as today). Width/height stored are the scored thumbnail's, after R2.
  Add one-line comments for R1 and R2 where the code does them.
- [ ] Step 4: full `:design-media:testDebugUnitTest` green (gradle lock). Step 5: commit.

### Task 3: Grouping and keeper (`core/Cleanup.kt`)

**Files:** Create `core/Cleanup.kt`, test `core/CleanupTest.kt`.

**Interfaces — Consumes:** Task 1 `PhotoScores`, `hamming`, `aspectClose`.
**Produces:**
```kotlin
enum class CleanupKind(val wire: String) { BLURRY("blurry"), COPIES("copies"), LOOKALIKES("lookalikes"), SCREENSHOTS("screenshots"), DARK("dark") }
class CleanupPhoto(val id: Long, val vec: ByteArray, val scores: PhotoScores, val bytes: Long, val takenAt: Long,
                   val pixels: Long, val relativePath: String?)
data class CleanupOptions(val blurThreshold: Double = BLUR_DEFAULT, val lookalikeCosine: Double = LOOKALIKE_DEFAULT)
data class GroupMember(val id: Long, val ticked: Boolean, val best: Boolean)
data class CleanupGroup(val kind: CleanupKind, val key: String, val members: List<GroupMember>, val bytes: Long)
fun cleanupGroups(photos: List<CleanupPhoto>, dismissed: Set<Pair<CleanupKind, Long>>, opts: CleanupOptions): List<CleanupGroup>
const val BLUR_DEFAULT = 132.1; const val BLUR_MIN = 26.0; const val BLUR_MAX = 298.8
const val LOOKALIKE_DEFAULT = 0.93; const val LOOKALIKE_STRICT = 0.97; const val LOOKALIKE_WINDOW_MS = 600_000L
const val DARK_MEAN = 0.08; const val BLOWN_MEAN = 0.95; const val LOW_SPREAD = 0.08
```
Blurry, Screenshots and Dark are one group each (key = kind wire name; members sorted: blurry by laplacian ascending, others newest
first); omitted when empty. Copies/Look-alike groups have ≥ 2 members, key = `"<wire>:<smallest id>"`, members keeper first then
newest first; groups sorted by bytes freed descending. `bytes` = sum of the ticked members' bytes for copies/look-alikes, all members
for the single-group kinds. `blurThreshold` is clamped to [BLUR_MIN, BLUR_MAX]. Dismissed (kind, id) pairs are removed from that kind
before grouping; a copies/look-alike group left with one member disappears.

- [ ] Step 1: tests (synthetic photos built in the test): `copiesGroupResizedNotOthers` (fixture dhashes noisy/half group with aspect
  300×200 vs 150×100; noisy/other don't; Hamming 5 doesn't), `copiesNeedSameAspect` (same hash, 300×200 vs 200×300 apart),
  `keeperOrder` (sharpest wins; tie → more pixels; tie → more bytes; tie → older; keeper unticked, rest ticked), `lookalikesNeedTimeAndCosine`
  (cos 0.95 within 9 min group; same pair 11 min apart doesn't; cos 0.92 doesn't; with lookalikeCosine 0.97 the 0.95 pair doesn't),
  `copiesWinOverLookalikes`, `blurryUsesThresholdAndIsUnticked` (scores 100 and 200: default flags only 100; threshold 250 flags both;
  threshold 1000 clamps to 298.8; members ticked=false), `screenshotsByRelativePath` ("Pictures/Screenshots/" yes, "DCIM/Camera/" no, null no),
  `darkAndBlown` (mean 0.05 spread 0.02 yes; mean 0.05 spread 0.2 no; mean 0.97 spread 0.01 yes), `dismissedNeverReturn`,
  `flatPhotosOnlyGroupWithSameAspect`, `missingMetaIsSkipped` (grouping only sees photos it is given), and
  `tenThousandPhotosUnderTwoSeconds` (AC-5: 10,000 synthetic photos, random 512-byte vectors, bursts of 5 near-duplicates every ~200
  photos, times spread over 2 years with some dense days, 5 % screenshots; one warm-up call, then the timed call `< 2000 ms`; print the time).
- [ ] Step 2: fail. Step 3: implement (precompute int8 norms; look-alikes: sort by takenAt, compare each photo with later ones while
  `takenAt` difference ≤ window). Step 4: tests green (gradle lock). Step 5: commit.

### Task 4: Trash record and dismissals stores (`core/CleanupStore.kt`)

**Files:** Create `core/CleanupStore.kt`, test `core/CleanupStoreTest.kt`. Uses the existing `AtomicFile` (core/Store.kt) and kotlinx.serialization.

**Produces:**
```kotlin
@Serializable data class TrashEntry(val uri: String, val name: String, val bytes: Long, val trashedAt: Long)
class TrashRecord(file: AtomicFile) { fun all(): List<TrashEntry>; fun add(entries: List<TrashEntry>); fun remove(uris: Set<String>);
  fun recent(now: Long, stillTrashed: Set<String>): List<TrashEntry> }   // keeps 30 days, drops (and saves without) entries not stillTrashed or older
const val TRASH_KEEP_MS = 30L * 24 * 60 * 60 * 1000
class Dismissals(file: AtomicFile) { fun all(): Set<Pair<String, Long>>; fun add(kind: String, ids: Collection<Long>); fun clear() }  // kind = CleanupKind.wire
```
(Kinds are stored as wire strings so this task does not depend on Task 3; Task 5 maps them to `CleanupKind`.)

- [ ] Step 1: tests: `addThenAllRoundTrips`, `missingOrCorruptFileIsEmpty` (garbage JSON reads as empty, never throws), `recentKeepsThirtyDays`
  (29 days kept, 31 dropped and no longer in `all()`), `recentDropsNoLongerTrashed`, `removeAfterRestore`, `addSameUriTwiceKeepsNewest`,
  `dismissalsRoundTripAndClear`.
- [ ] Step 2: fail. Step 3: implement. Step 4: green (gradle lock). Step 5: commit.

### Task 5: Android layer, module functions and the JS contract

**Files:** Create `android/CleanupTool.kt` (grouping join, dismissals, recently removed), `android/CleanupTrash.kt` (the only place
`createTrashRequest` appears), `core/TrashFlow.kt` (pure request state machine) + test `core/TrashFlowTest.kt`; modify
`DesignMediaModule.kt`, `modules/design-media/src/index.ts`, `DataSafetyRulesTest.kt`.

**Consumes:** Tasks 2-4 (`PhotoIndexFile.read`, `cleanupGroups`, `TrashRecord`, `Dismissals`).

**JS contract (additive, in `DesignMediaModule` interface):**
```ts
export type CleanupKind = 'blurry' | 'copies' | 'lookalikes' | 'screenshots' | 'dark';
export interface CleanupPhoto { uri: string; name: string; bytes: number; takenAt: number; ticked: boolean; best: boolean }
export interface CleanupGroup { kind: CleanupKind; key: string; photos: CleanupPhoto[]; bytes: number }
export interface CleanupResult { groups: CleanupGroup[]; blur: { min: number; max: number; default: number }; lookalike: { default: number; strict: number }; indexed: number }
export interface RemovedPhoto { uri: string; name: string; bytes: number; trashedAt: number; expiresAt: number }
cleanupGroups(options?: { blurThreshold?: number; lookalikeCosine?: number }): Promise<CleanupResult>;
trashPhotos(uris: string[]): Promise<{ moved: number }>;      // opens Android's dialog; 0 when the owner says no
recentlyRemoved(): Promise<RemovedPhoto[]>;
restorePhotos(uris: string[]): Promise<{ restored: number }>; // opens Android's dialog
dismissCleanup(kind: CleanupKind, uris: string[]): Promise<void>;
clearCleanupDismissals(): Promise<void>;
```
**Behaviour:**
- `cleanupGroups`: read the index (PhotoIndexFile, same file as search), query MediaStore Images once for `_ID, DISPLAY_NAME, SIZE,
  DATE_TAKEN, DATE_MODIFIED, WIDTH, HEIGHT, RELATIVE_PATH`; join by id (rows MediaStore no longer lists are skipped, R12 for takenAt);
  run `cleanupGroups`; map ids to `content://media/external/images/media/<id>` URIs. Runs on `readScope`.
- `trashPhotos` / `restorePhotos`: validate every URI (`MediaStore.Images.Media.EXTERNAL_CONTENT_URI/<numeric id>`; anything else
  rejects before any request), empty list resolves 0 without a dialog. Look up name and size first (trash only). Build
  `MediaStore.createTrashRequest(resolver, uris, true|false)`, launch with
  `appContext.currentActivity.startIntentSenderForResult(pi.intentSender, REQUEST_CODE, null, 0, 0, 0)`, and resolve the held
  `Promise` from `OnActivityResult` when `requestCode` matches: RESULT_OK → record (trash: `TrashRecord.add`; restore:
  `TrashRecord.remove`) and resolve the count; anything else → resolve 0 and record nothing. No Activity → reject
  `CodedException("Open the app to remove photos.")`; a request already open → reject `"Another request is still open."`.
  `TrashFlow` (pure, in core) holds this: `begin(kind, uris): Boolean` (false when busy), `finish(requestCode, ok): Pending?`, so the
  busy / wrong-code / cancelled paths are JVM-tested.
- `recentlyRemoved`: query MediaStore with `Bundle` arg `MediaStore.QUERY_ARG_MATCH_TRASHED = MediaStore.MATCH_ONLY` for the recorded
  ids (`_ID, DATE_EXPIRES`), pass the still-trashed URIs to `TrashRecord.recent(now, stillTrashed)`; a failed query (null cursor)
  returns the record's 30-day entries unfiltered rather than dropping anything. `expiresAt` per R11.
- `dismissCleanup` / `clearCleanupDismissals`: Task 4 `Dismissals`.
- `DataSafetyRulesTest`: new `rule7GalleryPhotosOnlyGoToTheTrash`: no source contains `createDeleteRequest`; `createTrashRequest(` appears
  only in `CleanupTrash.kt`; `resolver.delete(` / `contentResolver.delete(` appear only in `Outputs.kt` (its own pending rows).

- [ ] Step 1: tests: `TrashFlowTest` (`secondBeginWhileBusyIsRefused`, `wrongRequestCodeIsIgnored`, `cancelledRecordsNothing`,
  `okReturnsThePendingUris`), `refusesNonImageUris` (the URI check is a pure core function `galleryImageId(uri: String, base: String): Long?`),
  and rule 7.
- [ ] Step 2: fail. Step 3: implement. Step 4: full `:design-media:testDebugUnitTest :app:assembleDebug` (gradle lock), `pnpm typecheck`
  green. Step 5: commit.

## Gates (phase end)

`pnpm test`; `pnpm typecheck`; `cd apps/design-editor-mobile/android && JAVA_HOME=… ./gradlew :design-media:testDebugUnitTest :app:assembleDebug`;
`./gradlew :app:dependencies --configuration releaseRuntimeClasspath` has no Play, ML Kit or LiteRT artifacts; TS gates again from a
`git archive HEAD` export with `pnpm install --frozen-lockfile`. No desktop-app (Electron) tests.

## Not in this phase

Screens, the Search | Clean up segment, the "Scan now" UI, copy, the HyperOS trash-visibility check, the phone recheck of R1-R4 (all 2.2).
