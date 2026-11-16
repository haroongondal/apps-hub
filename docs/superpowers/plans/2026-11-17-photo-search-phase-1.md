# Find a photo, Phase 1 (engine) Implementation Plan

> **Execution:** run inline (superpowers:executing-plans). If subagents are used, use
> `cd-engineering-tools:parallel-agents-coord`, never `superpowers:subagent-driven-development`
> (owner's global rule). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Kotlin engine for on-device photo search in Design Editor mobile: CLIP tokenizer and
image preprocessing that match the Python reference, a photo index built by a job in the existing
media queue, word search and "more like this" over it, exposed to JS. No screen yet (Phase 2).

**Architecture:** Pure logic in `modules/design-media/.../core/` (tokenizer, preprocessing, index
file, diff, ranking, back-off, model list), tested on the JVM against fixtures made by the Python
reference. Platform code in `.../android/`: ONNX Runtime sessions, model download, MediaStore scan,
and a `PhotoIndexRunner` that the existing `MediaJobService` runs for a new `PhotoIndexPlan`.
`DesignMediaModule` exposes search functions; the TS adapter and `@apps-hub/media-core` types get
the matching contract.

**Tech Stack:** Kotlin, JUnit 4 (existing), `com.microsoft.onnxruntime:onnxruntime-android:1.32.0`
(owner approved 2026-11-16), Expo Modules API, TypeScript 5.9; Python reference in `tools/photo-bench`.

**Spec:** `docs/superpowers/specs/2026-11-13-photo-search-design.md` (Phases → 1, plus Details),
shared parts in `docs/superpowers/specs/2026-11-13-image-tools-overview.md`. Phase 0 results and
rulings: `docs/handoffs/photo-search.md`.

## Global Constraints

- FOSS only, no Google services; ORT AAR pinned by SHA-256 like `verifyFfmpegAar`; `releaseRuntimeClasspath` must contain no `com.google.android.gms`/`com.google.firebase`/`com.google.mlkit`.
- Design Editor data-safety rules (`docs/design-editor/PRD.md` §5, enforced by `DataSafetyRulesTest` over every module source): no network code anywhere in `design-media` (rule 6: no `java.net`, `HttpURLConnection`, `URL(`, `openConnection`, `Socket(`), no `"w"`/`"rw"`/`"wt"`/`"wa"` string literals (rule 1), no external-storage paths (rule 2), and `DesignMediaModule.kt` must not contain `ByteArray`, `ByteBuffer`, `Bitmap`, `Base64`, `readBytes`, `writeBytes` (rule 5).
- Models download on first use **from the app's JS** (`expo-file-system/legacy` `createDownloadResumable`, already a dependency), never from a media job; Kotlin only verifies and installs them. Pinned revision `6b7c523703ae26e39be4b03774966f8571c7f523` of `Xenova/clip-vit-base-patch32`, checked by SHA-256, stored in `filesDir/models/` (= `FileSystem.documentDirectory + 'models/'`; the app sets `allowBackup="false"`):
  - `onnx/vision_model_quantized.onnx` 89,117,001 B, sha256 `583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299`
  - `onnx/text_model_fp16.onnx` 127,339,794 B, sha256 `df587ffbf248bf20d44fa6e16adc5ebc27ead691860e5333dbdaab5fd6bf3f6e`
- `tokenizer.json` (2,224,119 B, sha256 `f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd`, MIT) is bundled as a module asset, not downloaded.
- Image input: `ContentResolver.loadThumbnail(uri, Size(256, 256), signal)`; tensor = PIL BICUBIC short side 224, centre crop 224, mean `[0.48145466, 0.4578275, 0.40821073]`, std `[0.26862954, 0.26130258, 0.27577711]`, NCHW float32.
- Text input: tokens `[49406] + bpe + [49407]`, truncated so the total is ≤ 77 (end token kept), **not padded** (Phase 0 ruling).
- Image session 2 intra-op threads; text session 1. Output names `image_embeds` / `text_embeds`, inputs `pixel_values` / `input_ids`.
- Index: one record per photo, vector stored int8 = round(unit vector × 127). Results: top 60, nothing below cosine 0.25 (Phase 0 floor).
- Back-off: pause when battery < 20% and not charging, or thermal status ≥ `THERMAL_STATUS_SEVERE` (3); resume when neither holds.
- Never modify or delete a gallery file; no network call in the search path (AC-5). The only network use is the model download.
- Copy: sentence case, plain words, no engineering terms (memory: plain words for users).
- minSdk is 35: no version guards. Builds ship arm64-v8a only.
- New `*.test.ts` files must be added to their package's `test` script. Commit only when the owner asks; no Claude attribution lines.

## Decisions this plan makes (from "Left to the builder" and the repo pattern)

- Files go in the existing `core/` (pure) and `android/` (platform) packages with `Clip`/`Photo`
  prefixes, not new `photos/`/`vision/` packages: that is the module's layer convention.
- The index is a binary file, not SQLite: JVM-testable, loaded whole for search anyway, and a
  version bump in the header triggers the re-scan the design asks for. Each job first rewrites
  the file with the rows it keeps, then appends; a torn last record is ignored on load.
- The model download is a step the app runs before the first index job ("Getting the search
  tool"), in JS, because media jobs must never touch the network (data-safety rule 6). Kotlin
  holds the model list (one source of truth), hands it to JS, and verifies each `.part` file
  before installing it. `filesDir` instead of `noBackupFilesDir`: JS can reach it, and the app
  has no backup.
- The `photo-index` job diffs the gallery and embeds new photos; it fails with a plain message if
  the models are missing. Back-off waits inside the job (checks every 60 s), so the queue shows it
  as running.
- Thumbnail decode lives in the runner; nothing new in the service except the `PhotoIndexPlan`
  branches. Search logic lives in `android/PhotoSearch.kt` so `DesignMediaModule.kt` only
  delegates (rule 5).

## Review Focus

1. A photo deleted or edited while the job runs: `loadThumbnail` throws → skip that photo, keep going (test in Task 5 via the diff on the next run; runner catches per photo).
2. Permission revoked or "Selected photos" only: the MediaStore query returns what is visible; the job indexes that and drops the rest (diff handles it). No crash on an empty gallery (Task 4 test).
3. The app killed mid-job: the append-only file keeps finished rows; a torn final record is dropped on load (Task 4 test); the next run continues.
4. Model download interrupted or corrupted: `.part` file never used; length or SHA mismatch deletes it and `installPhotoModel` returns false (Task 5 test); the JS step reports it in plain words (Task 7 test).
5. A query of only spaces or symbols, or very long text: tokenizer still returns `[49406, …, 49407]` ≤ 77 tokens (Task 2 tests).

---

### Task 1: Reference fixtures

**Files:**
- Create: `tools/photo-bench/fixtures.py`
- Create (generated): `packages/media-core/fixtures/photo-search/tokens.json`, `image.png`, `image.f32`, `README.md`
- Create: `apps/design-editor-mobile/modules/design-media/android/src/main/assets/clip/tokenizer.json` (copy of the pinned file)

**Interfaces:**
- Produces `tokens.json`: `[{"text": string, "ids": number[]}]`, ids unpadded, from `tokenizers` 0.23.3 with `enable_truncation(77)` and no padding. Cases: all 976 COCO captions (`.strip()`) plus: `""`, `"   "`, `"Dog   ON the\tBEACH"`, `"don't stop"`, `"it's 3:45pm"`, `"café naïve résumé"`, `"🙂 smile"`, `"!!!???"`, `"x" * 200` (truncation), `"red car at night"`, `"receipt"`.
- Produces `image.png`: 300×200 RGB, deterministic (numpy seed 7: horizontal gradient + vertical gradient + uniform noise ±20), and `image.f32`: its tensor from `ref.py`'s `prep()` (3×224×224 float32 LE).

- [ ] **Step 1:** Write `fixtures.py <clip_dir> <out_dir>` reusing `ref.py`'s `prep` (import it) and the tokenizer settings above; write a 4-line `README.md` saying how the files were made (command, package versions).
- [ ] **Step 2: Run** `$OLD/venv/bin/python -I tools/photo-bench/fixtures.py $OLD/models/clip packages/media-core/fixtures/photo-search`.
Expected: `tokens.json` with 987 entries; `image.f32` 602,112 B; the 976 caption ids equal rows of `$W/texts.i64` up to and including their first 49407 (check in the same script with an assert when `$W` is given as an optional 3rd arg).
- [ ] **Step 3:** Copy `$OLD/models/clip/tokenizer.json` to the asset path; `shasum -a 256` matches the Global Constraints value. Add a CLIP (MIT, OpenAI) entry to `core/THIRD_PARTY_NOTICES.txt`.

### Task 2: CLIP tokenizer

**Files:**
- Create: `.../designmedia/core/ClipTokenizer.kt`
- Test: `.../test/java/expo/modules/designmedia/core/ClipTokenizerTest.kt`
- Modify: `modules/design-media/android/build.gradle` (test system property `module.assets` = `file('src/main/assets').absolutePath`)

**Interfaces:**
- Produces: `class ClipTokenizer(vocab: Map<String, Int>, merges: List<Pair<String, String>>)` with
  `fun encode(text: String): IntArray` and `companion fun fromJson(json: String): ClipTokenizer`
  (reads `model.vocab` and `model.merges`; merges are `"a b"` strings in this file version — handle both string and 2-element array forms).

- [ ] **Step 1: Failing test** `encodesLikeTheReference`: for every entry of `tokens.json` (`fixtures.dir`), `encode(text).toList() == ids`. Plus `alwaysWrapsAndCaps`: `encode("")` is `[49406, 49407]`; `encode("x".repeat(200)).size <= 77` and ends in 49407.
- [ ] **Step 2: Run** `cd apps/design-editor-mobile/android && JAVA_HOME=$JAVA_HOME ./gradlew :design-media:testDebugUnitTest --tests '*ClipTokenizerTest*'` → FAIL (class missing).
- [ ] **Step 3: Implement** in this order (matches `tokenizer.json`):
  1. Normalise: `Normalizer.normalize(text, NFC)`, replace `\s+` with `" "`, `lowercase(Locale.ROOT)`.
  2. Split with `Pattern.compile("<\\|startoftext\\|>|<\\|endoftext\\|>|'s|'t|'re|'ve|'m|'ll|'d|[\\p{L}]+|[\\p{N}]|[^\\s\\p{L}\\p{N}]+")`, keeping matches only.
  3. Byte-level: UTF-8 bytes of each piece mapped through GPT-2 `bytes_to_unicode` (printable ranges `!`..`~`, `¡`..`¬`, `®`..`ÿ` map to themselves; the other bytes map to `U+0100 + n` in byte order).
  4. BPE per piece: symbols = chars, last symbol gets `"</w>"` appended; repeatedly merge the adjacent pair with the lowest merge rank; map symbols through `vocab` (unknown → 49407). Cache per piece.
  5. `[49406] + ids.take(75) + [49407]`.
- [ ] **Step 4: Run** the same command → PASS (all 987 cases).

### Task 3: Image preprocessing

**Files:**
- Create: `.../core/ClipImage.kt`
- Test: `.../core/ClipImageTest.kt`

**Interfaces:**
- Produces: `fun clipTensor(argb: IntArray, width: Int, height: Int): FloatArray` (3×224×224, NCHW, normalised). Android side passes `Bitmap.getPixels` output.

- [ ] **Step 1: Failing test** `matchesPilWithinOneLevel`: load `image.png` with `javax.imageio.ImageIO` → `getRGB` array; compare with `image.f32`: every element `abs(diff) <= (1.0/255)/std[c] + 1e-5`, and mean abs diff `< 0.002`. Plus `squareInputOnlyResizes`: a 448×448 solid colour gives every element = `((c/255) - mean)/std` to 1e-5.
- [ ] **Step 2: Run** `./gradlew :design-media:testDebugUnitTest --tests '*ClipImageTest*'` → FAIL.
- [ ] **Step 3: Implement** PIL's 8-bit resample: scale `k = 224 / min(w, h)`, target `(round(w*k), round(h*k))` (Python `round`, half to even), horizontal pass then vertical pass, each a separable filter with the bicubic kernel `a = -0.5`, `support = 2 * max(1, inScale)`, centre `(x + 0.5) * inScale`, window `[max(0, (int)(centre - support + 0.5)), min(in, (int)(centre + support + 0.5)))`, weights normalised to sum 1, result rounded and clamped to 0..255 after each pass. Then crop `((W-224)/2, (H-224)/2)` with integer division, then `(v/255 - mean)/std`.
- [ ] **Step 4: Run** → PASS.

### Task 4: Index file, diff, ranking, back-off

**Files:**
- Create: `.../core/PhotoIndex.kt`
- Test: `.../core/PhotoIndexTest.kt`

**Interfaces:**
- Produces:
  - `data class PhotoKey(val id: Long, val modified: Long, val size: Long)`
  - `class PhotoRow(val key: PhotoKey, val vec: ByteArray /* 512 */)`
  - `fun quantize(v: FloatArray): ByteArray` (unit-normalise, × 127, round, clamp −127..127)
  - `object PhotoIndexFile { const val VERSION = 1; fun read(f: File): List<PhotoRow>; fun append(f: File, rows: List<PhotoRow>); fun rewrite(f: File, rows: List<PhotoRow>) }` — header `"CLIPIDX\u0000"` (8 B) + version Int + dim Int (512); records 3 Longs + 512 B (536 B). `read` returns empty on a missing file or wrong magic/version (that is the re-scan trigger), and ignores a trailing partial record. `rewrite` writes a temp file then renames.
  - `data class IndexDiff(val toEmbed: List<PhotoKey>, val keep: List<PhotoRow>)`; `fun diff(gallery: List<PhotoKey>, index: List<PhotoRow>): IndexDiff` (a row is kept only if the gallery has the same id with the same modified and size; toEmbed in gallery order).
  - `fun rank(rows: List<PhotoRow>, query: FloatArray, limit: Int, floor: Float): List<Long>` — score = `Σ vec[i] * unit(query)[i] / 127`; ids with score ≥ floor, best first, at most `limit`. Ties keep index order.
  - `fun shouldPause(batteryPct: Int, charging: Boolean, thermalStatus: Int): Boolean`.
  - `const val SEARCH_LIMIT = 60; const val SEARCH_FLOOR = 0.25f`.
- [ ] **Step 1: Failing tests:**
  - `roundTripAndTornTail`: append 3 rows, append 2 more, then append 100 junk bytes → `read` returns the 5 rows, equal keys and vectors.
  - `versionMismatchMeansEmpty`: a file whose version Int is 0 → `read` is empty.
  - `diffKeepsUnchangedDropsGoneEmbedsNewAndChanged`: gallery {1 same, 2 modified later, 4 new}, index {1, 2, 3} → keep [1], toEmbed [2, 4].
  - `emptyGalleryDropsEverything`.
  - `int8RankingMatchesFloat`: 2,000 seeded random unit vectors (Random(1)), 50 random queries: the int8 top-5 equals the float top-5 in ≥ 98% of positions; floor filters out a query orthogonal to everything.
  - `backOffRule`: (19, false, 0) pause; (19, true, 0) run; (20, false, 0) run; (80, true, 3) pause; (80, false, 2) run.
- [ ] **Step 2: Run** `./gradlew :design-media:testDebugUnitTest --tests '*PhotoIndexTest*'` → FAIL; **Step 3:** implement; **Step 4:** → PASS.

### Task 5: Models, dependency and download check

**Files:**
- Create: `.../core/ClipModels.kt`; Test: `.../core/ClipModelsTest.kt`
- Modify: `modules/design-media/android/build.gradle`

**Interfaces:**
- Produces: `data class ModelFile(val name: String, val url: String, val bytes: Long, val sha256: String)`;
  `object ClipModels { val VISION: ModelFile; val TEXT: ModelFile; val ALL = listOf(VISION, TEXT) }`
  (URL = `https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/<revision>/onnx/<file>`, values from Global Constraints; `name` = the file name);
  `fun sha256Of(f: File): String` (lower-case hex, streamed);
  `fun isReady(dir: File, m: ModelFile): Boolean` (file exists, length == bytes; hash is checked once at install, not on every start);
  `fun install(dir: File, m: ModelFile): Boolean` — takes `dir/<name>.part`: if its length and `sha256Of` match, renames it to `dir/<name>` and returns true; otherwise deletes it and returns false.
- [ ] **Step 1: Failing test** `sha256OfKnownBytes` (`"abc"` → `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`), `isReadyNeedsExactLength`, `pinnedUrlsUseTheRevision` (every URL contains `6b7c523703ae26e39be4b03774966f8571c7f523`), `installAcceptsOnlyTheRightBytes` (temp dir, a `ModelFile` for `"abc"`: right bytes → true and the final file exists; wrong bytes of the same length → false and no `.part` left; missing `.part` → false). Run → FAIL; implement; → PASS.
- [ ] **Step 2: Gradle:** add `implementation("com.microsoft.onnxruntime:onnxruntime-android:1.32.0")` with a `verifyOnnxRuntimeAar` task modelled on `verifyFfmpegAar`. Get the AAR's SHA-256 with `shasum -a 256` on `$SP/aar/onnxruntime-android-1.32.0.aar` and pin it; hook it to `preBuild` the same way.
- [ ] **Step 3: Verify** `./gradlew :app:dependencies --configuration releaseRuntimeClasspath | grep -E 'gms|firebase|mlkit'` → no output, and `| grep onnxruntime` → `1.32.0`.

### Task 6: Encoders, gallery scan and the index job

**Files:**
- Create: `.../android/ClipSessions.kt`, `.../android/Gallery.kt`, `.../android/PhotoIndexRunner.kt`
- Modify: `.../core/Plans.kt`, `.../core/OutputName.kt`, `.../core/Bitrate.kt`, `.../core/EncoderMode.kt`, `.../core/Targets.kt`, `.../core/Messages.kt`, `.../android/Runners.kt`, `.../android/MediaJobService.kt`, any runner `when (plan)` the compiler flags
- Test: `.../core/PlanJsonTest.kt` (add a case), `.../core/PhotoIndexTest.kt` (add `jobToAdd` cases)

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `data object PhotoIndexPlan : Plan { override val tool get() = "photo-index" }`, JSON `{"tool":"photo-index"}`.
  - `fun photoIndexJob(id: String): Job` (inputId `"gallery"`, inputName from `Messages.PHOTOS`, state QUEUED) and `fun jobToAdd(jobs: List<Job>, id: String): Job?` (null when a photo-index job is QUEUED or RUNNING).
  - `object ClipSessions { fun image(ctx): OrtSession; fun text(ctx): OrtSession; fun embedImage(s, tensor: FloatArray): FloatArray; fun embedText(s, ids: IntArray): FloatArray; fun releaseText() }` — one shared `OrtEnvironment`; text session lazy and released by `releaseText()`.
  - `object Gallery { fun list(ctx): List<PhotoKey>; fun thumbnail(ctx, id: Long): IntArray? }` — `MediaStore.Images.Media.EXTERNAL_CONTENT_URI`, columns `_ID, DATE_MODIFIED, SIZE`, sorted `DATE_ADDED DESC` (newest first gets searchable first); `thumbnail` returns `null` on any exception (deleted/unreadable).
  - `object PhotoIndexRunner { fun start(req: Request, done: (Outcome) -> Unit): Runner }` — a `Worker`: if `ClipModels.ALL` are not all `isReady(filesDir/models)` return `Outcome.Failed("models missing")` and the service fails the job with `Messages.TOOL_MISSING`; else `diff`, `rewrite` the index (`filesDir/photo-index.bin`) with `keep`, then embed `toEmbed` (progress = done/total) appending every 25 photos (`FileOutputStream(f, true)`, never a `"rw"` literal — rule 1); a photo whose thumbnail is `null` is skipped. Before each photo `w.check()` and, if `shouldPause(...)` (`BatteryManager`, `PowerManager.currentThermalStatus`), sleep 60 s in 1 s steps with `w.check()` until it clears. Returns `Outcome.Written()`.
  - Service: `pump()` skips the input probe and space check for `PhotoIndexPlan`; `completed()` records `Done(id, emptyList(), now())` for `PhotoIndexPlan` before the empty-output check, then `release` and `pump`; `finishedWith` maps the runner's `"models missing"` to `Messages.TOOL_MISSING` instead of `COULDNT_PROCESS` and does not retry.
  - Messages (plain words): `PHOTOS = "Photos"`, `TOOL_MISSING = "Get the search tool first, then try again."`.
- [ ] **Step 1: Failing tests:** `PlanJsonTest.photoIndexRoundTrips` (`decodePlan(encodePlan(PhotoIndexPlan)) == PhotoIndexPlan`); `PhotoIndexTest.jobToAddSkipsWhenOneIsWaiting` (QUEUED or RUNNING present → null; only DONE/FAILED present → new job). Run → FAIL.
- [ ] **Step 2:** Add the plan and the core branches (`outputExt` → `"bin"`, `outputLabel` → `""`, `neededBytes` → 0, `hasBitrateMode` → false; `targetFor` unchanged, since `completed()` returns before `publish` for this plan). Run the two tests → PASS.
- [ ] **Step 3:** Write the three android files and the service/Runners branches. Run `./gradlew :design-media:testDebugUnitTest :app:assembleDebug` → BUILD SUCCESSFUL, all tests pass (including `DataSafetyRulesTest`).

### Task 7: JS contract, the download step and permissions

**Files:**
- Create: `.../android/PhotoSearch.kt`, `apps/design-editor-mobile/src/photos/search-tool.ts`, `apps/design-editor-mobile/src/__tests__/search-tool.test.ts` (add to the app's `test` script)
- Modify: `.../designmedia/DesignMediaModule.kt`, `modules/design-media/src/index.ts`, `packages/media-core/src/types.ts`, `apps/design-editor-mobile/src/media/tools.ts` (label), `modules/design-media/android/src/main/AndroidManifest.xml`, `apps/design-editor-mobile/android/app/src/main/AndroidManifest.xml`

**Interfaces:**
- Produces (module and `DesignMediaModule` interface in `src/index.ts`; module bodies delegate to `PhotoSearch`):
  - `photoModels(): Promise<{ name: string; url: string; bytes: number; ready: boolean }[]>`
  - `installPhotoModel(name: string): Promise<boolean>` — `ClipModels.install(filesDir/models, …)`.
  - `startPhotoIndex(): Promise<string>` — job id; uses `jobToAdd`, returns the existing job's id when one is waiting.
  - `photoIndexState(): Promise<{ indexed: number; modelsReady: boolean }>`
  - `searchPhotos(query: string): Promise<string[]>` — content URIs, best first, ≤ 60, `[]` below the floor; rejects with `"The search tool isn't ready yet."` when models are missing.
  - `similarPhotos(uri: string): Promise<string[]>` — ranks by that photo's stored vector, without the photo itself.
  - `releasePhotoSearch(): Promise<void>` — frees the text session.
  - The index is cached in memory and reloaded when the file's `lastModified` changes.
- `search-tool.ts`: `getSearchTool(deps: { models(): Promise<…>; download(url: string, to: string, onBytes: (n: number) => void): Promise<void>; install(name: string): Promise<boolean>; freeBytes(): Promise<number> }, onProgress: (fraction: number) => void): Promise<'ready' | 'no-room' | 'bad-download'>` — skips ready models; needs free space ≥ missing bytes + 50 MB else `'no-room'`; downloads each missing model to `models/<name>.part` (the app wires `createDownloadResumable` to `documentDirectory + 'models/'`, creating the folder); `install` false → `'bad-download'`. Plain-word messages for each result live with the Phase 2 screen.
- `search-tool.test.ts` (fakes for every dep): `skipsReadyModels`, `stopsWhenNoRoom` (no download called), `reportsBadDownload`, `progressReachesOne`.
- `types.ts`: `export interface PhotoIndexPlan { tool: 'photo-index' }` added to `Plan`. `tools.ts` label: `'photo-index': 'Get photos ready for search'`.
- Manifests: module adds `READ_MEDIA_IMAGES` and `READ_MEDIA_VISUAL_USER_SELECTED`; the app's `tools:node="remove"` line for `READ_MEDIA_IMAGES` is deleted. (The request flow is Phase 2; until then the job finds what is already visible.)
- [ ] **Step 1:** Implement; run `pnpm --filter design-editor-mobile typecheck` and `pnpm --filter @apps-hub/media-core typecheck` → no errors (fix every switch over `Plan['tool']` they flag).
- [ ] **Step 2:** Run `pnpm test` → all pass; `./gradlew :design-media:testDebugUnitTest :app:assembleDebug` → BUILD SUCCESSFUL.

### Task 8: Verify the build and record

- [ ] **Step 1:** In the debug APK: `unzip -l app-debug.apk | grep -E 'libonnxruntime|clip/tokenizer.json'` → both present; `zipalign -c -P 16 -v 4 app-debug.apk | grep libonnxruntime` → OK; note the APK size change against `main`.
- [ ] **Step 2:** `pnpm doctor` for design-editor-mobile → no new problems.
- [ ] **Step 3:** Handoff: session log, file map additions, next step (Phase 2 plan: permission flow, Photos tab, Store release and the on-phone checks AC-1..AC-6). Ask the owner whether to commit.
