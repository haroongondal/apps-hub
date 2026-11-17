# Quick edits Phase 2 (cut-out and upscale) Implementation Plan

> **For agentic workers:** executed with `cd-engineering-tools:parallel-agents-coord` (it replaces
> superpowers:subagent-driven-development here, per `~/.claude/CLAUDE.md`). Steps use `- [ ]`.

**Goal:** "Remove background" (Person, Object, Plain background) and "Upscale 2x / 4x" for a
selected image in Design Editor on the phone, run by local models in Kotlin.

**Architecture:** Pure pixel maths in `design-media` `core/` (JVM-tested against
`tools/quick-edits-bench/ref.py` fixtures); ORT runners in a new `vision/` package that read a
source file and write a PNG; the app's JS downloads each model on first use (search-tool pattern)
and Kotlin verifies and installs it; the editor page reaches the runners through
`window.native.vision`. The Real-ESRGAN export is served by a new public, content-addressed Store
Worker route.

**Tech Stack:** Kotlin + ONNX Runtime Android 1.32.0 (already in), Expo module API, TypeScript
(`node --test`), Cloudflare Worker (`tools/store-api`), Fabric in the engine page.

**Spec:** `docs/superpowers/specs/2026-11-13-quick-edits-design.md` (scope 3 and 4, AC-3..AC-6),
`docs/superpowers/specs/2026-11-13-image-tools-overview.md`, owner decisions in
`docs/handoffs/image-tools.md` (2026-11-18), phase brief
`.superpowers/sdd/2026-11-17-image-tools-3.2/phase-brief.md`.

## Global Constraints

- No new Gradle or npm dependency. ORT is `com.microsoft.onnxruntime:onnxruntime-android:1.32.0`.
- `design-media` never touches the network (`DataSafetyRulesTest` rule 6); `DesignMediaModule.kt`
  never names `ByteArray`, `ByteBuffer`, `Bitmap`, `Base64`, `readBytes`, `writeBytes` (rule 5).
- Models download in JS from a pinned URL; Kotlin checks size + SHA-256 and installs
  (`ClipModels.install` / `isReady` are generic, reuse them). Files live in `filesDir/models/`.
- Pinned models:
  - Object: U2-Netp, `u2netp.onnx`, https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx, 4,574,861 B, `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`.
  - Person: MODNet fp32, `modnet.onnx`, https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model.onnx, 25,888,640 B, `07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9`.
  - Upscale: our Real-ESRGAN x4v3 T=176 export, `realesr-general-x4v3-t176.onnx`, https://apps-hub-store.haroonmukhtar4.workers.dev/models/1c1bda585a8b044760e807d4e454b0a2f4bf0c0f0096ff4d8046c422e54f5ce0, 4,866,394 B, `1c1bda585a8b044760e807d4e454b0a2f4bf0c0f0096ff4d8046c422e54f5ce0`.
- Person (MODNet) must be removable in one place: the `TOOLS` map in `core/VisionModels.kt`;
  every list of cut-out choices (module, JS, page) is derived from it.
- ORT sessions: 2 intra-op threads, opened from the installed file per run and closed after it.
- Upscale: tile core 128, overlap 24, model input 176, scale 4; 2x = the 4x model run on a half-size copy (owner, 2026-11-18);
  output longest side <= 4096.
- Copy: sentence case, plain words, no emoji. Missing model while offline:
  "Connect to the internet once to get this tool." (AC-5).
- Mac (no `window.native.vision`): only "Plain background"; no Person, Object or Upscale (AC-6).
- Bridge transport (owner, 2026-11-18, option A): the source image crosses page -> app in base64
  pieces of <= 1 MB into a cache file; the result PNG comes back in pieces of <= 1 MB into a Blob.
  Unique run ids; each result file deleted after the page imports it; partial files deleted on
  cancel or error. Replaces the "file path, never base64" rule for vision only (SPEC §14 note).
- Commits: pathspec only, no attribution lines, no push. No phone, no install, no Worker deploy,
  no upload.

## Decisions taken in this plan (left to the builder by the design)

- Resampling: one exact port of Pillow 13's 8-bit two-pass resize (`ref.py` docstring recipe),
  with LANCZOS (support 3) and BILINEAR (support 1) kernels. U2 prep uses LANCZOS to 320x320;
  MODNet prep uses BILINEAR (its preprocessor, `sheet.py`); upscale's input shrink and 2x/cap
  shrink use LANCZOS.
- U2 post (as `ref.u2_mask`): min-max, bilinear half-pixel to full size, Gaussian feather sigma
  2 px (radius 6), `floor(255x + 0.5)`; float32 (±1). MODNet post: same bilinear, values clipped
  to 0..1, no min-max, no feather (the matte the owner judged in `sheet.py` was unfeathered).
- Upscale size rule (owner, 2026-11-18; replaces the earlier rule): L = longest side. If
  L >= 4096: refuse ("This image is already as big as it can be.") from the header size. The
  model input is the photo (4x) or a half-size copy of it (2x: each side rint(side / 2), at least
  1), shrunk further so its longest side is at most 1024 (aspect kept, rint) when bigger; the
  decoder makes both copies (`ImageDecoder.setTargetSize`). Output = exactly 4 x the model input,
  so no resize after the model and never more than 4096. Examples: (1080,1080,2) -> in 540x540,
  out 2160x2160; (1080,1080,4) -> 1024x1024, 4096x4096; (300,200,2) -> 150x100, 600x400;
  (300,200,4) -> 300x200, 1200x800; (2000,1000,2) -> 1000x500, 4000x2000; (2000,1000,4) ->
  1024x512, 4096x2048; (4096,10,2) -> refused.
- Upscale estimate (owner): tiles = ceil(inW/128) x ceil(inH/128); seconds = tiles x 1.9.
  Label: under 10 s "A few seconds"; under 60 s "About N seconds" with N rounded to the nearest
  10; else "About N minutes" with N = round(seconds / 60) ("About 1 minute" for 1). 1080 px:
  2x 25 tiles "About 50 seconds", 4x 64 tiles "About 2 minutes".
- Alpha in upscale (fix round 1 ruling): if any pixel's alpha < 255, the model runs on
  premultiplied RGB (Pillow's RGBa, MULDIV255 rounding); the output alpha is the model input's
  alpha resized with LANCZOS straight to the output size, and the output RGB is un-premultiplied
  by it (`min(255, c*255/a)`, a = 0 gives 0x00000000). Otherwise opaque. No dark fringe at soft
  edges, no second model pass.
- Cut-out keeps existing transparency: final alpha = min(source alpha, mask). Sources above
  4096x3072 px are decoded scaled down (aspect kept) to fit that budget.
- New fixtures (deferred by 3.0): a downscale U2 prep case and a MODNet prep case.

## Review Focus

1. A 12 MP photo (4000x3000) for cut-out: memory must stay float32 / IntArray at full size (no
   float64 full-size buffers). Test: `alphaMask` on 4000x3000 runs in the JVM test with default heap.
2. A tall thin or tiny image (e.g. 129x20, 1x1) for upscale tiling and reflect. Test: tiles and
   stitch for 129x20 and 1x1 with a fake 4x model equal nearest-neighbour 4x of the input.
3. A transparent PNG (already cut out) sent to Upscale: alpha must survive. Test: `upscalePlan` +
   `resizeAlpha` keeps a transparent border transparent.
4. A path from the page pointing outside the app's cache (`/data/data/.../files/models/x`):
   the runner must refuse it. Test: `VisionPaths.allowed` rejects it and `..` tricks.
5. Cancel in the middle of an upscale: no output file is left behind. Test in Task 3
   (`cancelLeavesNoFile`, using the stitch loop with a fake model that cancels on tile 2).

---

### Task 1: Pixel maths in `core/` + new fixtures

**Files:**
- Modify: `tools/quick-edits-bench/fixtures.py`, `packages/media-core/fixtures/quick-edits/README.md`
- Create fixtures: `packages/media-core/fixtures/quick-edits/{u2_down_input.png,u2_down_input.f32,modnet_input.png,modnet_input.f32}`
- Create: `apps/design-editor-mobile/modules/design-media/android/src/main/java/expo/modules/designmedia/core/{PillowResize.kt,CutoutMaths.kt,UpscaleMaths.kt}`
- Test: `.../src/test/java/expo/modules/designmedia/core/{PillowResizeTest.kt,CutoutMathsTest.kt,UpscaleMathsTest.kt}`

**Interfaces (Produces):** pixels are `IntArray` ARGB (as `Bitmap.getPixels`, unpremultiplied).
```kotlin
enum class Filter { LANCZOS, BILINEAR }
fun resize(argb: IntArray, w: Int, h: Int, nw: Int, nh: Int, filter: Filter): IntArray // Pillow 13 8-bit, all 4 channels
fun u2Input(argb: IntArray, w: Int, h: Int): FloatArray          // 1x3x320x320 NCHW
fun modnetSize(w: Int, h: Int): Pair<Int, Int>                   // s = min(512/shortest, 1024/longest), each side round(side*s/32)*32 with Python round (half to even: Math.rint), min 32
fun modnetInput(argb: IntArray, w: Int, h: Int): FloatArray      // 1x3xHxW at modnetSize, x/127.5 - 1
fun alphaMask(pred: FloatArray, pw: Int, ph: Int, w: Int, h: Int, minMax: Boolean, featherPx: Float): ByteArray // h*w, 0..255
fun withAlpha(argb: IntArray, alpha: ByteArray): IntArray
const val TILE = 128; const val OVERLAP = 24; const val TILE_IN = 176; const val SCALE = 4; const val MAX_SIDE = 4096
data class Tile(val x: Int, val y: Int, val x0: Int, val y0: Int, val x1: Int, val y1: Int)
fun tiles(w: Int, h: Int): List<Tile>
fun reflect(i: Int, n: Int): Int
fun tileInput(argb: IntArray, w: Int, h: Int, t: Tile): FloatArray            // 1x3x176x176, RGB/255
fun placeTile(out: IntArray, outW: Int, model: FloatArray, t: Tile)            // writes the 4x core, clip, floor(255x+0.5), alpha 255
data class UpscalePlan(val inW: Int, val inH: Int, val outW: Int, val outH: Int)
fun upscalePlan(w: Int, h: Int, scale: Int): UpscalePlan?                      // null when longest side >= 4096
fun hasAlpha(argb: IntArray): Boolean
```

- [ ] **Step 1: Fixtures.** Extend `fixtures.py` (no model needed): `u2_down_input.png` = `ref.synth(640, 480, 7)`, `u2_down_input.f32` = `ref.u2_prep` of it; `modnet_input.png` = `ref.synth(700, 500, 9)`, `modnet_input.f32` = the `sheet.modnet_cutout` prep (BILINEAR to modnetSize, /127.5 - 1, NCHW float32, here 1x3x512x704). Existing fixtures must stay byte-identical (check with `git diff --stat`). Python: `.superpowers/sdd/2026-11-17-image-tools-3.0/qe-in/venv/bin/python` read-only if it imports numpy 2.5.4 + Pillow 13.0.0, else a new venv under `.superpowers/sdd/2026-11-17-image-tools-3.2/venv` from `requirements.txt`. README lists the new files.
- [ ] **Step 2: Failing tests** (read fixtures via `fixtures.dir`, `quick-edits/...`; PNGs decode with `javax.imageio.ImageIO` on the JVM):
  - `u2InputMatchesUpscaleFixture` / `u2InputMatchesDownscaleFixture`: max abs diff vs `u2_input.f32` / `u2_down_input.f32` <= 1e-5.
  - `modnetSizeRule`: (700,500)->(704,512); (500,700)->(512,704); (4000,3000)->(672,512); (10,4000)->(32,1024); (33,32)->(512,512); never below 32, longest <= 1024.
  - `modnetInputMatchesFixture`: <= 1e-5 vs `modnet_input.f32`.
  - `alphaMaskMatchesU2Fixture`: `alphaMask(u2_pred.f32, 320,320, 300,200, true, 2f)` vs `u2_mask.png`, every pixel within ±1.
  - `alphaMaskHandles12Mp`: 4000x3000 output from a 320x320 pred completes, size 12,000,000.
  - `tilesMatchFixture`: `tiles` equals `esrgan_tiles.json` for both cases.
  - `reflectMatchesNumpy`: `reflect(i, 7)` for i in -40..49 equals `np.pad(arange(7), 43, 'reflect')[3:93]` (literal list in the test); `reflect(i,1) == 0`.
  - `stitchWithFakeModelIsNearest4x`: for 300x200, 129x20 and 1x1, a fake model (each input pixel to a 4x4 block) run through `tileInput` + `placeTile` gives exactly nearest-neighbour 4x of the input.
  - `upscalePlanRule`: (1080,1080,4)->(1024,1024,4096,4096); (1080,810,2)->(1024,768,2160,1620); (300,200,4)->(300,200,1200,800); (300,200,2)->(300,200,600,400); (2000,1000,4)->(1024,512,4096,2048); (4096,10,2)->null; outW,outH never > 4096.
  - `withAlphaAndHasAlpha`: trivial cases.
- [ ] **Step 3: Run, see them fail:** `cd apps/design-editor-mobile/android && JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew :design-media:testDebugUnitTest` (under `filelock run gradle`).
- [ ] **Step 4: Implement.** `resize` follows the `ref.py` docstring recipe exactly (coefficients `int(w*2^22 ± 0.5)`, `(2^21 + sum) >> 22`, clamp, pass order rule, skip an axis already at size), with BILINEAR = triangle kernel support 1. `u2Input`: resize LANCZOS to 320x320, divide by the max over all RGB values, then ImageNet mean (0.485, 0.456, 0.406) / std (0.229, 0.224, 0.225) in double, store float. `alphaMask`: float32 throughout, as `ref.u2_mask`.
- [ ] **Step 5: Run, all pass** (same command; also the whole `:design-media:testDebugUnitTest` green).
- [ ] **Step 6: Commit** the files above with pathspecs: `Quick edits Phase 2: cut-out and upscale maths in core, new prep fixtures`.

### Task 2: Store Worker public model route

**Files:** Modify `tools/store-api/src/index.ts`; Test `tools/store-api/src/__tests__/worker.test.ts`.

**Interfaces:** `GET /models/<sha256>` where sha256 matches `^[0-9a-f]{64}$` serves R2 key
`models/<sha256>`, no authorization. Every other `/models/...` path is 404. Upload stays
`PUT /admin/models/<sha256>` (existing, release token).

- [ ] **Step 1: Failing tests:** `models route serves a stored model without any token` (body, content-length; `cache-control: public, max-age=31536000, immutable`); `models route 404s for a missing model`; `models route refuses anything but 64 lowercase hex` (uppercase, 63 chars, `/models/<sha>/x`, `/models/..%2Fapps%2Fx`, `/models/<sha>.onnx` -> 404 and the bucket is never asked for a non-`models/` key); `models route is GET only` (PUT/POST/DELETE -> 404 or 401 as today, never a write); `apps keys stay private` (`GET /models/` cannot reach `apps/...`).
- [ ] **Step 2:** `pnpm --filter @apps-hub/store-api test` fails.
- [ ] **Step 3:** Add the route in `handle`, before the `SIGNING_KEY` check (a public read must not depend on signing config). `serve` gets an optional cache-control argument; the existing routes keep `private, no-store`.
- [ ] **Step 4:** `pnpm --filter @apps-hub/store-api test` and `typecheck` pass.
- [ ] **Step 5: Commit** `Store Worker: public content-addressed GET /models/<sha256>`. Do not deploy.

### Task 3: Vision runners, model entries, module API

**Files:**
- Create: `core/VisionModels.kt`, `vision/Vision.kt`, `vision/VisionPaths.kt` (package `expo.modules.designmedia.vision`, under `.../java/expo/modules/designmedia/vision/`)
- Modify: `DesignMediaModule.kt` (delegates only), `modules/design-media/src/index.ts` (additive)
- Test: `core/VisionModelsTest.kt`, `vision/VisionPathsTest.kt` (or a core test for the pure parts), `DataSafetyRulesTest` stays green unchanged.

**Interfaces:**
- Consumes: Task 1's functions.
- Produces (Kotlin):
```kotlin
object VisionModels { val U2NETP: ModelFile; val MODNET: ModelFile; val ESRGAN: ModelFile
  val TOOLS: Map<String, ModelFile> /* "person" to MODNET, "object" to U2NETP, "upscale" to ESRGAN; delete the person line to drop MODNet */ }
```
- Produces (TS, additive in `DesignMediaModule`):
```ts
visionTools(): Promise<{ tool: string; name: string; url: string; bytes: number; ready: boolean }[]>; // tool: 'person' | 'object' | 'upscale', from VisionModels.TOOLS
installVisionModel(name: string): Promise<boolean>;  // file name, like installPhotoModel
runVision(id: string, op: 'cutout' | 'upscale', src: string, option: string): Promise<string>; // option 'person'|'object' or '2'|'4'; returns the PNG's absolute path
cancelVision(id: string): Promise<void>;
addListener(name: 'onVisionProgress', fn: (e: { id: string; fraction: number }) => void): { remove(): void };
```
- Rejections (CodedException messages, plain words): model missing -> "This tool isn't on the phone yet."; cancelled -> code `CANCELLED`; src not allowed or unreadable -> "This image can't be opened."; upscale too big -> "This image is already as big as it can be."

- [ ] **Step 1: Failing tests:** `toolsMapPinsTheThreeModels` (names, URLs, bytes, sha from Global Constraints; the ESRGAN URL ends with its own sha); `visionPathsAllowOnlyTheCacheFolder` (`VisionPaths.allowed(cacheDir, path)`: true for `cache/vision/a.png`, false for `files/models/u2netp.onnx`, `cache/vision/../../files/x`, a symlink out of the folder, a relative path); `cancelLeavesNoFile` (the upscale loop, factored as a pure function taking a `(FloatArray) -> FloatArray` model and a cancel check, stops on tile 2 and no output file exists).
- [ ] **Step 2:** run the Gradle test command; they fail.
- [ ] **Step 3: Implement.** `Vision.run`: check `VisionPaths.allowed` (canonical path inside `cacheDir`); decode with `BitmapFactory` (`ARGB_8888`, `inPremultiplied = false`); open the tool's session (2 threads, `filesDir/models/<name>`; first input name / first output from the session, not hard-coded) inside `use`; cut-out = prep -> run -> `alphaMask` (U2: minMax true, feather 2; MODNet: false, 0) -> `withAlpha`; upscale = `upscalePlan` -> shrink input if needed -> tiles (progress `i / n` per tile on `onVisionProgress`, cancel checked between tiles) -> resize to out size if different -> alpha rule; write PNG to `cacheDir/vision/<id>.png.part`, rename to `<id>.png`, delete the part on any failure or cancel. `runVision` runs on its own queue so it never blocks the other module calls. `cancelVision` sets the id's flag.
- [ ] **Step 4:** Gradle tests + `:app:assembleDebug` pass; `pnpm --filter design-editor-mobile typecheck` passes.
- [ ] **Step 5: Commit** `Quick edits Phase 2: vision runners and model entries in design-media`.

### Task 4: Model download step in JS

**Files:** Create `apps/design-editor-mobile/src/photos/vision-tool.ts`, `.../src/photos/vision-tool-deps.ts`; Test `apps/design-editor-mobile/src/__tests__/vision-tool.test.ts` (add it to the app's `test` script).

**Interfaces:**
- Consumes: `getSearchTool`, `SearchToolDeps`, `SearchToolResult` from `search-tool.ts` (reuse, do not copy); Task 3's `visionTools` / `installVisionModel`.
```ts
export type VisionTool = 'person' | 'object' | 'upscale';
export function visionToolDeps(tool: VisionTool, base: SearchToolDeps /* realSearchToolDeps() for download/freeBytes/remove */): SearchToolDeps; // models() = only that tool's model
export function visionToolMessage(r: SearchToolResult): string | null;
// 'ready' -> null; 'offline' -> 'Connect to the internet once to get this tool.';
// 'no-room' -> 'There isn't enough free space for this tool. Free up some space and try again.';
// 'bad-download' -> 'The download didn't finish properly. Try again.'
```
`vision-tool-deps.ts` holds the one real wiring (`realVisionToolDeps(tool)`), like `search-tool-deps.ts`.

- [ ] **Step 1: Failing tests:** `onlyTheAskedToolDownloads` (person asked: only `models/modnet.onnx.part` fetched); `readyToolNeedsNoNetwork` (ready model, download throws -> still 'ready'); `offlineSaysConnectOnce` (download throws -> message exactly as above); every message passes the app's plain-words rules (reuse the helper in `plain-words.test.ts` if it exports one).
- [ ] **Step 2:** `pnpm --filter design-editor-mobile test` fails. **Step 3:** implement. **Step 4:** test + typecheck pass.
- [ ] **Step 5: Commit** `Quick edits Phase 2: model download step for cut-out and upscale`.

### Task 5a: Bridge (page <-> app <-> Kotlin), chunked

Page API, `window.native.vision(req)` in `packages/design-editor-engine/shell-mobile.js` (absent
on the Mac, so `app.js` tests `window.native.vision`):
```js
vision({ op: 'tools' }) -> Promise<string[]>                 // cut-out kinds available, from visionTools(): e.g. ['person','object']
vision({ op: 'cutout', kind: 'person'|'object', image: Blob, onProgress(phase, fraction) }) -> Promise<Blob|null>
vision({ op: 'upscale', scale: 2|4, image: Blob, onProgress(phase, fraction) }) -> Promise<Blob|null>
vision({ op: 'cancel' }) -> Promise<void>                    // cancels the run in flight; its promise resolves null
// phase: 'download' (first use fetches the model) or 'run'. Rejects with Error(plain-words message).
```
Transport: the shell slices `image` into pieces of 786,432 bytes (base64 1,048,576 chars, a
multiple of 3 so pieces join), `call('visionChunk', { id, index, data })` each; then
`call('vision', { id, op, option, chunks })`; the app joins the pieces, writes
`cacheDirectory/vision/<id>.src` (base64), makes sure the tool is installed
(`getSearchTool(realVisionToolDeps(tool), ...)`, progress as `visionProgress` commands, offline ->
`visionToolMessage`), calls `runVision(id, op, path, option)` (plain path), relays
`onVisionProgress` as `{ type: 'visionProgress', id, phase, fraction }`, deletes the .src file in
`finally`, and replies `{ bytes }`. The shell then pulls the result with
`call('visionRead', { id, index })` -> `{ data, done }` (read with `readAsStringAsync` base64,
`position`/`length` 786,432); on `done` the app deletes the result file. `visionCancel` calls
`cancelVision(id)` and deletes the .src, the result and any held pieces. Ids: `v` + time + random,
matching `[A-Za-z0-9_-]{1,64}`. `bridge.ts` gains the new PageEvent and WebCommand members.
Tests: node tests for any pure helper (piece offsets, id format); the Chrome mobile test drives
the shell with a fake `ReactNativeWebView` that answers the calls (a new test module registered
by one line). SPEC §14.3 gets an "As built (2026-11-18)" note: vision images cross in pieces
of <= 1 MB, which replaces the "file path, never base64" rule for vision.

### Task 5b: Editor UI (engine)

`app.js` (+ `image-maths.js` for the estimate, tested in `test/image-maths.test.mjs`):
- "Remove background": Person and Object (only the kinds `vision({op:'tools'})` returns) plus
  "Plain background" (today's colour fill with its tolerance). No `window.native.vision`: only
  Plain background, exactly as today.
- "Upscale": 2x and 4x, only with `window.native.vision`. Tapping shows the estimate first
  (`upscaleEstimate(w, h, scale)` -> `{ inW, inH, outW, outH, tiles, seconds, label } | null`, the
  rule above, null = refused with "This image is already as big as it can be.") with Start and
  Cancel; then a progress bar (download phase says "Getting the tool"), and Cancel.
- Source pixels: the image's original element (as `removeBg`), sent as a PNG Blob. Result: the
  returned Blob read as a data: URL and set with `setSrc` (designs keep images as data: URLs so
  save and undo keep working), then `record()`: one undoable edit; undo brings the original back.
- Errors: the rejection message in the page toast. Cancel: nothing changes.
- e2e: the Chrome mobile test with a fake `native.vision` (cut-out returns a known PNG, upscale
  reports progress then returns one; cancel leaves the image unchanged; one undo restores the
  original); the desktop e2e checks Person, Object and Upscale are absent on the Mac.

### Task 5c: Kotlin upscale rule

`upscalePlan` follows the owner's rule above (Kotlin `UpscaleMaths.kt`, tests with the same
example table as `image-maths.test.mjs`); `Vision`/`VisionJob` decode straight to the plan's
`inW x inH` and drop the post-model resize; alpha = model-input alpha LANCZOS-resized to 4x.

### Task 6: Gates

`pnpm test`; `pnpm typecheck`; the Gradle gate; `pnpm --filter design-editor test:e2e`;
`pnpm doctor`; `./gradlew :app:dependencies --configuration releaseRuntimeClasspath` with no
Play, ML Kit or LiteRT artifact.
