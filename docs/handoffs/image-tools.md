# Handoff: Design Editor image tools (features 2-4)

## Resume prompt

Dated 2026-11-17. Work in the worktree
`/Users/outsentia/Documents/apps-hub/.claude/worktrees/image-tools` on branch `image-tools`
(local only). Read this file completely first, then the designs it names. Trust the verified
facts below and don't re-measure them. Follow the handoff contract in `~/.claude/CLAUDE.md`
and "How every session runs" in `docs/build-sessions.md`. Run phases with
`cd-engineering-tools:phased-orchestration` (one phase agent per phase, ledgers under
`.superpowers/sdd/`). Continue from "Current state + exact next step".

## Goal and fixed constraints

- Build features 2-4 of the image-tools programme in Design Editor mobile: 2 Clean up the
  gallery, 3 Quick edits, 4 Heavy edits. Designs (approved 2026-11-16, owner re-approved
  2026-11-17): `docs/superpowers/specs/2026-11-13-{image-tools-overview,gallery-cleanup-design,quick-edits-design,heavy-edits-design}.md`.
  Where the overview and `docs/handoffs/photo-search.md` disagree, the handoff wins.
- The owner's go (2026-11-17) covers plan, build and commit on `image-tools`. Pushing,
  merging, Store releases and installs need the owner's word each time.
- Stop and report to the owner: where a design says the owner judges, at any spike result
  that misses its bar, before each release.
- Weights and code: Apache-2.0, MIT or BSD only. Excluded: Ultralytics/AGPL,
  onnx-community/ISNet-ONNX, MobileCLIP, InsightFace packs, CodeFormer.
- ONNX Runtime Android 1.32.0 is already in. Any new Gradle or npm dependency needs the owner's yes.
- Kotlin owns all image and model work (pure maths in `core/`, JVM tests against a Python
  reference in `tools/photo-bench` style). RN only renders (`@apps-hub/ui`, brand `design`,
  sentence case, plain words).
- Models download in the app's JS (pinned URL + SHA-256, the pattern in
  `apps/design-editor-mobile/src/photos/search-tool.ts`); Kotlin only verifies and installs.
  `design-media` never touches the network (`DataSafetyRulesTest`, PRD NFR-4).
- Nothing deleted unless the owner ticked it and confirmed Android's dialog; trash only; no
  gallery file is ever edited.
- Images cross the WebView bridge as file paths, never base64 (stalls around 40 MB).
- Mac shows palette and auto-enhance only; model tools hidden where `window.native.vision` is missing.
- Phone: claim `device:49kjmnuwonkffqzh` with coord, release when done. Benchmarks from
  `/data/local/tmp` (`tools/photo-bench/phone.sh`). Install apps only through the Store.
  Never run `uiautomator dump`. No Claude attribution lines in commits or PRs.
- Never edit the `photo-search` worktree (another session owns it).
- Owner, 2026-11-18: never run desktop-app tests (`pnpm --filter design-editor test:e2e` or any
  suite that opens Electron windows), even though the original prompt lists it as a gate.

## Decisions made (with why)

- 2026-11-17: base is `photo-search` commit `9e13c3d` (Phase 1 done), not origin/main. Why:
  feature 1 Phase 2 (Photos tab) is still being built by another session; the four specs, ORT
  1.32.0 and `search-tool.ts` exist only on `photo-search`. Owner chose to start with feature 3
  ("go with feature 3"). Feature 2 waits until Phase 2 lands; then merge/rebase onto it.
- 2026-11-17: 3.0 (phone spike) and 3.1 (palette + auto-enhance, engine only) run at the same
  time: no shared files, and 3.1 needs no phone. 3.2 waits for 3.0's numbers.

- 2026-11-18 (owner): Real-ESRGAN export is hosted in the Store bucket. The bucket is private
  (signed /f/ links only), so the Worker gets a read-only, unauthenticated, content-addressed
  route GET /models/<sha256> (public weights, integrity checked by SHA-256 in the app). URL
  https://apps-hub-store.haroonmukhtar4.workers.dev/models/<sha256>. Deploy and upload need the
  owner's yes on the Cloudflare account (cf profile "personal"); upload goes through the existing
  PUT /admin/models/<sha256> with RELEASE_TOKEN.
- 2026-11-18 (owner): "Remove background" offers Person (MODNet fp32) and Object (U2-Netp) plus
  the colour fill as "Plain background"; Person stays only if MODNet's phone timing passes.
- 2026-11-18 (owner): start 3.2 now, before the phone timings; stop and report if a timing misses.

- 2026-11-18 (owner): upscale stays although it misses 30 s: show an estimate first ("About 2
  minutes"), progress and Cancel; 2x = 4x on a half-size copy (about 40 s for 1080 px), 4x about
  2.5 min. Why: phone timing 1.9 s per 176 px tile, 81 tiles for 1080 px.
- 2026-11-18 (owner): the editor page holds photos only as data: URLs (SPEC §14: uploads use the
  page's own file input; exports already cross as base64 under 30 MB), so vision images cross the
  bridge in chunks of 1 MB or less (source to a cache file, result back into a blob: URL). This
  replaces "file paths, never base64" for vision.
- 2026-11-18 (owner yes): Store Worker deployed to the personal account (cf --profile personal,
  account id matches cloudflare.config.ts) from origin/main + the route commits de7770f, 6e65214
  (version 85911ebd-3c08-4e1b-9d59-c737ba543dc4). Model uploaded with PUT /admin/models/<sha>.
  **The live Worker now has a route that origin/main lacks: until image-tools merges, a deploy
  from main would drop /models/. Merge those two commits first or deploy from a branch that has them.**

- 2026-11-18: origin/main (Find a photo #38, squash-merged) merged into image-tools as ba3d97f.
  Files image-tools never touched took main's side; DesignMediaModule.kt and design-media
  src/index.ts keep both sides; the app's test list is the union. Feature 2 is unblocked (the
  Photos tab is on main). photo-search still has later commits not on main (e8d57be short-query
  floor fix): check the Store's current Design Editor build before releasing so we don't drop it.

- 2026-11-18 (owner): release feature 3 from the branch now (not ship-first). The first release
  run was killed when the session ended (during the Gradle build; nothing uploaded). Meanwhile
  photo-search released build 11 from main (#40 short searches). image-tools merged photo-search
  (773f3b9) and origin/main (06c003b, docs-only difference) and released build 12 from 06c003b: published (99.2 MB), the other nine manifest entries unchanged after re-fetch. Told photo-search (apps-hub-8a) to release only from a branch that contains image-tools.

- 2026-11-18 (owner): Blurry keeps a careful default (at most ~10% of sharp photos flagged,
  catches about 2 in 3 blurred) plus the strictness slider; AC-4 changes to match ("at the
  default, at most 10% of sharp flagged; the slider reaches 85% of blurred"). Why: Laplacian alone
  can't reach 85%/10% on natural blur, and every deletion is ticked and confirmed anyway.
- 2026-11-18 (owner): CERTH-tuned threshold is fine as is (research benchmarking use; images stay
  local, only the number ships). Re-check on the phone's own thumbnails in 2.1/2.2.

- 2026-11-18 (owner): only copies and look-alikes start ticked (all but the best); Blurry,
  Screenshots and Too dark start unticked. Matches what 2.1 built.

- 2026-11-18: ONNX Runtime 1.32's AAR ships Microsoft 1DS telemetry (provider
  ai.onnxruntime.TelemetryInitializer builds the Java HTTP transport for the native client;
  endpoint mobile.events.data.microsoft.com). On the owner's phone the provider failed at start
  (UnsatisfiedLinkError), so likely nothing was sent. Fixed 826a7bda: provider removed in the
  design-media manifest (tools:node="remove"), setTelemetry(false) on every OrtEnvironment,
  DataSafetyRulesTest rule 8. Owner said release build 14 with it.
- 2026-11-18 (owner): Clean up on build 13 "worked fine" (groups, delete + Undo, Recently removed).

## Evidence already verified

- From `docs/handoffs/photo-search.md` (don't redo): phone numbers, ORT AAR facts, licences
  (U-2-Net Apache-2.0, Real-ESRGAN BSD-3, MODNet Apache), sizes (U-2-Netp 4.6 MB, MODNet
  8-bit 6.6 MB), cpusets (A76 = cpu6, cpu7), use USB adb (Wi-Fi ~1 MB/s and drops; run long
  phone jobs under `nohup`).
- The mobile editor page has an offline CSP (`default-src 'none'`; images from data:/blob:
  only), SPEC §14.1. A file path from Kotlin must reach Fabric through the shell's existing
  file-loading route, not a `file://` URL.
- `packages/design-editor-engine` has no `test` script; engine behaviour is covered by
  `pnpm --filter design-editor test:e2e`.

- Model sources (3.0): U2-Netp `https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx`
  sha256 309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8, 4,574,861 B, Apache-2.0.
  MODNet fp32 `https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model.onnx`
  sha256 07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9, 25,888,640 B, Apache-2.0.
  Real-ESRGAN source .pth `https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth`
  sha256 8dc7edb9...96292, BSD-3; our ONNX export (T=176) sha256
  1c1bda585a8b044760e807d4e454b0a2f4bf0c0f0096ff4d8046c422e54f5ce0, 4,866,394 B, not hosted yet.
- Kotlin reference for 3.2: `tools/quick-edits-bench/{ref.py,fixtures.py,export_esrgan.py}`,
  fixtures `packages/media-core/fixtures/quick-edits/` (byte-identical across runs). Compare
  exactly or within +-1 level. Open for 3.2: a downscale-to-320 fixture; how alpha is upscaled.

- Phone timings 2026-11-18 (2 threads A76, Wi-Fi adb, battery): U2-Netp cut-out about 1.35 s total
  (model 1182 ms median, RAM 410 MB); MODNet fp32 about 1.48 s (1315 ms, RAM 274 MB); Real-ESRGAN
  T=176 1925 ms per tile (RAM 59 MB, no throttling over 81 runs). Phone outputs match the Mac to
  <= 7.8e-5. Results note `docs/superpowers/plans/2026-11-17-quick-edits-phase-0-results.md`.
- Live checks 2026-11-18: GET /models/1c1bda58... returns 200, 4,866,394 B, SHA-256 matches;
  manifest without token 401, with release token 200; bad model path refused.

## File map

- Designs: see above. Session rules: `docs/build-sessions.md` "How every session runs".
- Engine: `packages/design-editor-engine/{app.js,shell-mobile.js,build.mjs}`; current
  "Remove background" is `removeBackground()` / `removeBg()` in `app.js`.
- Mobile bridge: `apps/design-editor-mobile/src/editor/bridge.ts`.
- Kotlin: `apps/design-editor-mobile/modules/design-media/android/.../{core,android}/`;
  CLIP work from feature 1 under `vision/`-style files (`ClipSessions.kt`).
- Model download pattern: `apps/design-editor-mobile/src/photos/search-tool.ts`.
- Bench: `tools/photo-bench/` (ref.py, bench.cpp, build.sh, phone.sh).
- Phase ledgers (git-ignored): `.superpowers/sdd/2026-11-17-image-tools-<phase>/`.

## Session log

- 2026-11-17: feature 1 Phase 2 not finished (another session). Owner said go with feature 3.
  Worktree created from `9e13c3d`, `pnpm install` done. Handoff written. Phase agents for 3.0
  and 3.1 started.
- 2026-11-17 (later): the session ended mid-run. Landed: 3.0 plan f50b7ae + phone bench
  5be0796; 3.1 plan cae845f + palette/enhance maths e694a5f (11/11 node tests). 3.1 rulings:
  swatch on an image sets the page background; brand kit exists (brand.colors); auto-enhance
  sets Brightness and Contrast only (no white-balance or saturation control exists; gap for
  the owner). Phone was off adb. Both phase agents resumed from their ledgers.
- 2026-11-17: 3.1 DONE (commits cae845f, e694a5f, 8b6b813, 90c9bd4, e1b5005; ledger
  `.superpowers/sdd/2026-11-17-image-tools-3.1/progress.md`). Palette "Colours in this photo"
  (k-means, fixed seed, distinct = RGB distance >= 16; swatch = page background; "Add to brand
  kit" appends missing ones) and "Auto-enhance" (Brightness + Contrast only, one undo exact) in
  `packages/design-editor-engine/image-maths.js` + `app.js`. Gates: phase agent ran e2e 3/3 green;
  main session's clean export of e1b5005: pnpm test exit 0 (engine 15/15), typecheck exit 0.
  Open: AC-1 not yet timed on the phone (Mac 9-37 ms); owner to confirm swatch = page background
  and the missing white-balance/saturation controls.
- 2026-11-17: 3.0 PARTIAL (commits f50b7ae, 5be0796, abaae1d, 5ba74fb, 1710cc3, de96f3e, eac988a,
  5b8ca47; results note `docs/superpowers/plans/2026-11-17-quick-edits-phase-0-results.md`;
  ledger `.superpowers/sdd/2026-11-17-image-tools-3.0/progress.md`). Mac side done; phone timings
  NOT run (phone off wireless adb 02:08-02:48, claim released to Halo session apps-hub-96).
  Edge verdict (main session checked the contact sheet): U2-Netp good for pets/products (clock
  keeps a shadow crescent, plush ghost patches); fails people (fades hand on 544519, keeps the
  sign on 488710, keeps crowd on 459272). MODNet fp32 fixes every people case; MODNet 8-bit
  (both Xenova files) deletes most of the person on 2/5, unusable. No pinnable Real-ESRGAN
  x4v3 ONNX exists: exported ourselves (matches PyTorch to 5.4e-6, deterministic bytes).
  Ruling: upscale tile input 176 px, overlap 24 (seam error 0.8 vs 10 levels at 16).

## Current state + exact next step

Design Editor build 14 is live (2026-11-18, from image-tools 3de9ec14): quick edits (feature 3), Clean
up the gallery (feature 2), and the ONNX Runtime telemetry removal. Owner checked Clean up on 13:
works. image-tools is NOT merged to main: any Design Editor release from main or photo-search would
drop features 2-3 and bring the telemetry back. Next:
1. Owner on build 14: Gallery app's recycle bin visibility, the Blurry slider on real photos, the quick
   edits (Person cut-out, Upscale 2x/4x with Cancel, airplane mode), the new copy.
2. Ship image-tools to main (pr-shipper, owner's go), so main has the Worker /models/ route and the
   telemetry fix.
3. Feature 4 (Heavy edits): 4.0 phone spike (MI-GAN vs LaMa, owner judges; SlimSAM; Depth Anything V2
   Small; YuNet; GFPGAN licence/size check first).
Phone test of 14 over adb (owner asked, 2026-11-18; brief `.superpowers/sdd/2026-11-18-image-tools-2.2/phone-check/qa-brief.md`):
A1 palette PASS, A2 enhance+Undo PASS; Wi-Fi adb dropped right after tapping Remove background > Person
and did not return (possible crash/reboot: check uptime and logcat when back). LEFT ON PHONE: test photos
/sdcard/Pictures/ImageToolsTest/ittest-{dog-a,dog-b,dog-half,girl}.jpg (MediaStore ids 1000086248-51):
rm -r the folder, scan_file each path, confirm the relative_path query is empty. The agent also edited the
unsaved 'Continue' draft in Design Editor (was blank; now orange background + girl photo): owner to reset.
Observations: 'Photo' in the image chooser opens the camera, not the gallery; sheet renders blank for 2-5 s
after a tap; Undo deselects the image. Remaining checks: A3-A6, C1-C5.
Open Minors: 2.2 M1 (two 'Undo' for screen readers), M2 (repeated hint); 3.2 thin rim after upscaling a
cut-out (check by eye); P3 photos reduced to sRGB.
