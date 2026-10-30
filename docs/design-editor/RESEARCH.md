# Design Editor media tools: research

Researched 2026-10-30 and 2026-10-31. Started as a standalone idea ("SnapCompress & Media
Studio": compress to a target size, clip without re-encoding, extract audio tracks, make
GIFs, convert formats, run a batch queue in the background). On 2026-10-30 the owner decided
the tools live in the **Design Editor**, on the Mac (the existing Electron app) and on Android
(a new mobile Design Editor that is a Store app). iOS can follow later.

How facts are marked:

- **Verified**: checked on this Mac against the installed SDKs, the repo or a tool run, with
  the file or command named.
- **Source**: taken from the linked page (listed at the end with access dates). Where sources
  disagree, both are given.
- **Assumed**: an estimate. Each one names the phase that measures it.

---

## 1. Verdicts

| Question | Verdict | Main evidence |
| --- | --- | --- |
| Feasible on Android, offline, FOSS only? | **Yes.** Media3 Transformer plus `MediaExtractor`/`MediaMuxer` cover every feature with the phone's hardware encoders. No FFmpeg needed in v1. | §4, §6, §7 |
| Feasible on the Mac? | **Yes.** FFmpeg run from Electron's main process covers every feature, including two-pass target size. | §5 |
| Where should it live? | The owner chose the Design Editor (Mac + new Android app). The evidence alone pointed to a standalone app; §2 gives the costs of the chosen route and what keeps them small. | §2 |
| Engine on Android | **Media3 + platform APIs**, not FFmpeg. ffmpeg-kit is retired, an own FFmpeg build adds 15–30 MB per ABI and needs a Nix toolchain, and it would use the same hardware encoders anyway. | §4 |
| Engine on the Mac | **FFmpeg + FFprobe static binaries** (arm64) spawned from the main process. libx264 two-pass for target size; VideoToolbox for fast re-encodes. | §5 |
| Target-size accuracy | Two-pass x264 lands within about 0.1% of the target bitrate on one published test; one-pass encoders overshoot by up to about 20%. On the phone the only safe design is **encode, measure, retry** with a hard rule that nothing above the target is ever delivered. | §6 |
| Background batch on Android | A `mediaProcessing` foreground service, limited by Android to **6 hours per 24 hours** (reset when the user opens the app). HyperOS may still kill it when swiped away; Phase 1 tests that on the phone. | §9 |
| Name | "SnapCompress" collides (snapcompress.io and others, plus Snap Inc.'s mark). No new name is needed now: the tools ship as "Media tools" inside Design Editor. | §15 |

---

## 2. Where the media tools live

### 2.1 Options that were weighed

| Option | Cost | Benefit |
| --- | --- | --- |
| (a) Standalone app (`apps/snapcompress`) | One new Store app: Expo shell, one Kotlin module, one brand. About 65–85 MB APK like the other apps (§2.3). | Smallest scope; no canvas work; the coordinator's and this research's first view. |
| (b) Fold into PDF Editor | PDF Editor gains a foreground service, notification permission and Media3 (§2.3). Its UI is a WebView page; media screens would be React Native screens beside it. | One fewer app. "Compress to fit" is shared in spirit with a future "compress PDF to fit". |
| (c) Fold into Design Editor (**owner's choice**) | Mac: small (a media window, FFmpeg binaries, about 300 lines in `main.js`). Android: Design Editor has no Android app today, so this means building one: extract the editor into a shared engine package, a WebView shell, touch input for the canvas, plus the media screens. | Media and design tools in one place on both devices. Canva sells both together (§14). Later ideas (put a clip on a design, export a design as MP4) have a home. |
| (d) One app for all three new ideas (scanner, reader, media) | Mixes a PDF/document library with video jobs. Every permission, service and dependency of each idea lands in one APK. | One install. |

### 2.2 What the evidence says about the owner's choice

- **On the Mac it is a cheap, natural fit.** The Design Editor already has the shape the tools
  need: a main process that owns files and dialogs, a preload bridge and a "only write to paths
  the user picked" rule (**verified**, `apps/design-editor/main.js:51-68`). FFmpeg runs as a
  child process of that main process. Nothing in the canvas changes.
- **On Android it is a new app either way.** Option (c) costs more than (a) only by the canvas
  work: moving `index.html`/`app.js` into `packages/design-editor-engine`, a WebView shell and
  touch input. That work also gives the owner a phone Design Editor, which (a) would not.
- **Sharing between canvas and media code is small.** The canvas is plain JS in a WebView; the
  media tools are native jobs on files that must never cross the WebView bridge (the base64
  bridge stalls at about 40 MB, **verified** in `packages/pdf-editor-engine/README.md:93`).
  What is genuinely shared is `packages/media-core` (§2.4) between the Mac and Android shells.
- **Risk the choice adds:** the Android Phase 1 spike can't be installed through the Store
  without an app to carry it. It ships inside a minimal `design-editor-mobile` shell that later
  grows the canvas (SPEC §17).

**Verdict:** the owner's choice stands. It costs one extra phase (engine extraction and the
touch canvas) compared with a standalone media app, and it keeps the media work itself the same.
Option (d) stays rejected: it would put a camera scanner, a document library and a media queue
behind one set of permissions with no shared code between them.

### 2.3 Size and permission numbers

- Current release APKs, universal with four ABIs (**verified**, `apps/*/android/app/build/outputs/apk/release`):
  PDF Editor 83.4 MB, Deputy 67.8 MB, NetLens 64.8 MB, Store 58.8 MB, OpenTunnel 46.5 MB.
  PDF Editor's native libraries alone, uncompressed: arm64 18.1 MB, armv7 12.5 MB, x86 19.2 MB,
  x86_64 19.5 MB. A WebView-based mobile Design Editor will land near PDF Editor's 83 MB.
- Media3 1.11.1 AARs the transformer pulls in (transformer, effect, muxer, inspector, exoplayer,
  common, container, extractor, decoder, datasource, database) total **4.49 MB** (**verified**,
  Content-Length on Google Maven). No native code. APK delta assumed 3–5 MB; Phase 1 measures it.
- FFmpeg on Android instead: FFShare's per-ABI APKs were 19.3 MB (video-only FFmpeg, arm64) and
  29.4 MB (full, arm64), and its 2026 universal APK with two ABIs is 76.7 MB (**verified**,
  GitHub release assets of `caydey/ffshare`). That is 15–30 MB per ABI for FFmpeg.
- Permissions the media tools add on Android: `POST_NOTIFICATIONS` (runtime), `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_MEDIA_PROCESSING`. No storage or `READ_MEDIA_*` permission (§10).
  One foreground service (`mediaProcessing`).

### 2.4 Shared regardless of host

`packages/media-core` (pure TypeScript, `node --test`): the job model, input validation, the
target-size budget and its retry rule, the resolution and frame-rate ladder, destination presets,
output naming and the codec-to-container table. The Mac shell runs it in Electron's main process
without a build step (§11, **verified**); the Android shell runs it in React Native. The budget is
generic (bytes, seconds, a quality floor), so PDF Editor's future "compress PDF to fit" can reuse
the preset list and the fit-check, though not the video ladder.

---

## 3. The owner's devices

### 3.1 Phone: Redmi Note 14 Pro 4G

- Model 24116RACCG, Android 16, HyperOS `OS3.0` (**verified** in `docs/handoffs/deputy.md`, from the phone).
- SoC **MediaTek Helio G100 Ultra**, 6 nm: 2× Cortex-A76 at 2.2 GHz + 6× Cortex-A55 at 2.0 GHz,
  Mali-G57 MC2; storage UFS 2.2; camera records up to 1080p60, no 4K (Source: GSMArena,
  PhoneArena). MediaTek publishes no separate sheet for the "Ultra"; CPU-Monkey reports the same
  cores, clocks, GPU and node as the G100, with Notebookcheck calling it an overclocked G99.
- Video hardware from MediaTek's G100 page: **encode H.264 and H.265/HEVC; decode H.264, HEVC
  and VP9**; recording and playback tiers 2K30, FHD60, HD120. **No AV1** in either direction
  (a community list claims AV1 decode; it conflicts with MediaTek's page and is ignored).
- Consequences: H.264 and HEVC output only; AV1 inputs may fail to decode (software fallback,
  slow); 4K inputs above the decoder's FHD60/2K30 tier may fail or run slowly. Phase 1 lists the
  actual codecs with `MediaCodecList` on the phone instead of trusting the spec sheet.
- Speed targets are therefore sized for an encoder rated at FHD60: transcoding 1080p30 can run
  at most about 2× real time. **Assumed** target: a 60-second 1080p30 clip compresses in 45 s or
  less per attempt. Phase 1 measures it.

### 3.2 Mac

- This Mac: Apple M5, macOS 27.0.1 (**verified**, `sysctl`, `sw_vers`).
- M5 media engine: hardware H.264, HEVC and ProRes encode and decode; AV1 **decode only**
  (Source: Wikipedia "Apple M5", retailer spec listing). One video encode engine on M5 and
  M5 Pro, two on M5 Max.

---

## 4. Engines on Android

### 4.1 FFmpeg on Android today

- **ffmpeg-kit is retired.** The README says so; GitHub shows the repo archived on 2026-07-02.
  Its prebuilt binaries were removed around 2025-04-01, including from Maven Central, so builds
  that depended on `com.arthenica:ffmpeg-kit-*` broke (Source: arthenica/ffmpeg-kit, DEV
  Community post by the fork's author). The owner's suggested `ffmpeg-kit-flutter` and the
  React Native wrapper `ffmpeg-kit-react-native` (last official release 6.0.2, September 2023)
  are dead ends.
- **FFmpegKitNext** (arthenica) is the official continuation: source only, no published
  packages, built with Nix, LGPL 3.0 by default and GPL 3.0 with `--enable-gpl`. Its version
  table lists 9.0.2 (2026-10-24) (Source: README).
- **ffmpegkit-maintained** is a community fork: Android only, prebuilt for arm64-v8a only, LGPL
  and `-gpl` variants (the GPL ones add x264, x265, xvidcore, vid.stab), no React Native.
- Community React Native forks exist for 16 KB page sizes; none was found that states New
  Architecture or Expo SDK 54 support.
- **Working precedent:** FFShare (GPL-3.0, 1,138 stars) moved to FFmpegKitNext v8.1.1 in its
  2.0.0 release (2026-08-14), built with `nix-android.sh -p android-r27d`, arm64 + armv7,
  `--enable-gpl --enable-x264 --enable-x265` and about 25 other libraries (**verified**,
  `build_ffmpegkit.sh` in `caydey/ffshare`). Its target size is software x264 at a CRF capped
  by `-maxrate/-bufsize` (size × 8 / duration, audio at most a third).
- **16 KB pages:** Google Play requires 16 KB page support for apps targeting Android 15+ from
  2025-11-01; native libraries must be built with a current NDK (FFShare uses r27d) and AGP
  8.5.1+ (Source: developer.android.com). This repo isn't on Play, but newer phones may ship
  16 KB kernels, so any native library has to meet it.
- **Licences:** FFmpeg is LGPL 2.1+; `--enable-gpl` or linking x264/x265 makes the build GPL;
  the LGPL checklist asks for dynamic linking, matching source and the configure line
  (Source: ffmpeg.org/legal.html).

### 4.2 Media3 Transformer (AndroidX)

- Latest stable **1.11.1** (2026-09-10); 1.12.0-alpha02 (2026-10-26) raises minSdk to 24
  (Source: release notes). Licence **Apache-2.0** (**verified**, GitHub API for `androidx/media`).
  `media3-transformer`, `-effect`, `-muxer` and `-inspector` 1.11.1 are on Google Maven
  (**verified**, maven-metadata.xml).
- Uses `MediaCodec` for decode and encode and OpenGL for effects; throughput is usually limited
  by the hardware encoder (Source: Transformer troubleshooting).
- Features used here (Source: Transformer "Transformations" and "Customization" pages,
  `VideoEncoderSettings.java`, `DefaultEncoderFactory.java`):
  - `setVideoMimeType` / `setAudioMimeType`; when input already matches, Transformer
    transmuxes instead of re-encoding.
  - Trim with `MediaItem.ClippingConfiguration`. `experimentalSetTrimOptimizationEnabled(true)`
    re-encodes only the start of a trim (single MP4 input, no effects, encoder profile and level
    compatible) and falls back to a full export by itself, reporting the outcome.
    `experimentalSetMp4EditListTrimEnabled(true)` is faster but keeps the "deleted" pre-roll
    hidden in the file, which Google flags as a privacy risk. **Not used.**
  - Resolution with `Presentation.createForHeight(h)`; `setRemoveAudio`, `setRemoveVideo`.
  - `VideoEncoderSettings`: `setBitrate`, `setBitrateMode` (VBR default; only VBR or CBR
    accepted), `setiFrameIntervalSeconds` (default 1.0 s), `setEncoderPerformanceParameters`,
    `setMaxBFrames`. `DefaultEncoderFactory.setRequestedVideoEncoderSettings`,
    `setEnableFallback` (on by default: clamps the bitrate into the encoder's range and picks
    the nearest supported resolution). With no bitrate set it uses
    width × height × fps × 0.07 × 2 (1080p30 ≈ 8.7 Mbps).
  - HDR: keeps HDR on Android 13+ with encoder support; otherwise tone-maps to SDR with OpenGL
    (Android 10+) or MediaCodec (Android 12+).
  - Output: MP4 by default (`InAppMp4Muxer`); `WebmMuxer`, `AacMuxer`, `OggMuxer`, `WavMuxer`
    need a custom `Muxer.Factory` (Source: "Supported formats").
  - `media3-inspector` (since 1.9.0) holds `FrameExtractor` and `MetadataRetriever`
    (Source: Media3 1.9.0 blog post).

### 4.3 `MediaExtractor` + `MediaMuxer` (platform)

Codec support per container, from the table in AOSP `MediaMuxer.java` (**verified**, main branch):

| Codec | MP4 | WebM | Ogg | From API |
| --- | --- | --- | --- | --- |
| AAC, AMR-NB, AMR-WB, H.263, MPEG-4, AVC | ✓ | | | 17 |
| Vorbis, VP8 | | ✓ | | 21 |
| VP9 | | ✓ | | 24 |
| HEVC | ✓ | | | 24 |
| Opus | | ✓ | ✓ | 26 |
| AV1 | ✓ | | | 31 |
| Dolby Vision | ✓ | | | 32 |

- Several audio or video tracks in one file: MP4 only, API 26+. B-frames in MP4 since API 25.
- Not muxable at all: MP3, AC-3, E-AC-3, FLAC, PCM, DTS. MP3, AC-3 and E-AC-3 are self-framing,
  so their samples can be written back to back as `.mp3`/`.ac3`/`.eac3` (**assumed** valid;
  Phase 4 checks with sample files). FLAC and PCM go through a re-encode or a WAV header.
- Output format constants: `MUXER_OUTPUT_MPEG_4`=0, `WEBM`=1, `3GPP`=2, `HEIF`=3, `OGG`=4
  (**verified**, `android.jar` 36).

### 4.4 Decision per feature (Android)

| Feature | Engine | Why |
| --- | --- | --- |
| Compress (target size, quality, resolution, frame rate) | Media3 Transformer, hardware AVC/HEVC | Hardware speed; Apache-2.0; no native code |
| Convert video to MP4 (H.264 or HEVC + AAC) or to M4A | Media3 Transformer | Same |
| Change container without re-encoding (MKV → MP4) | `MediaExtractor` + `MediaMuxer` | Lossless; table in §4.3 decides when it is possible |
| Lossless clip (keyframe cut) | `MediaExtractor` + `MediaMuxer` | Full control of the cut point, keeps every audio track, no hidden pre-roll |
| Exact clip | Media3 with trim optimisation | Re-encodes only the first GOP when the device allows it |
| Extract audio tracks | `MediaExtractor` + `MediaMuxer` (copy), Transformer for the rest | AAC → `.m4a`, Opus → `.ogg` copy; others re-encoded to AAC and labelled |
| Video to GIF | Media3 `FrameExtractor` for scaled frames + a Kotlin GIF encoder ported from `gifenc` (MIT) | No native library; GIF needs no hardware |
| Batch queue | A Kotlin foreground service (`mediaProcessing`) | JS pauses in the background (Deputy, §9) |

**Not on the phone in v1:** MP3, WebM or animated WebP output (no MP3 encoder in Android; the
G100 lists no VP8/VP9 encoder; animated WebP needs libwebp). They are Mac features.

**FFmpeg is the fallback, not the plan.** If Phase 1 shows that Media3 can't decode the owner's
real inputs, the fallback is FFmpegKitNext built LGPL with `h264_mediacodec` (FFmpeg's MediaCodec
encoder takes `bitrate_mode` cq/vbr/cbr/cbr_fd, Source: ffmpeg-codecs). It uses the same hardware
encoder, so it does not improve target-size accuracy; only slow software x264 would.

---

## 5. Engines on the Mac

### 5.1 Getting FFmpeg into an Electron app

| Option | FFmpeg | Licence | Notes |
| --- | --- | --- | --- |
| `ffmpeg-static` 5.3.0 (npm) | 6.1.1 | GPL-3.0-or-later | macOS arm64 binary from osxexperts.net, fetched by an install script (pnpm blocks install scripts unless allowed in `allowBuilds`) (**verified**, `npm view`; Source: README) |
| `@ffmpeg-installer/darwin-arm64` 4.1.5 | 4.x | FFmpeg licence link | Last published 2022, 36.8 MB unpacked (**verified**, `npm view`). Stale. |
| Martin Riedl's static macOS arm64 builds | 9.0.2 (2026-09-20) and nightly | GPL in practice (includes x264, x265) | Static `ffmpeg`, `ffprobe`; signed and notarised; build script public (Source: ffmpeg.martin-riedl.de) |
| Own build from source | Pinned (8.1.x or 9.0.x) | LGPL, or GPL with x264 | Needs Xcode command-line tools and `pkg-config`; full control of the configure line |
| `ffmpeg.wasm` / Mediabunny (WebCodecs) in the renderer | n/a | MIT / MPL-2.0 | Rejected: Mediabunny 1.65.0 forces a re-encode whenever the trim start moves (no lossless clip) and has no GIF; ffmpeg.wasm is software only and slow |

Electron itself ships a decode-only FFmpeg for Chromium; it can't encode.

**Recommendation:** a pinned FFmpeg + FFprobe pair, arm64, in `apps/design-editor/vendor/ffmpeg/`
(gitignored), fetched by a script that checks SHA-256. First choice: Martin Riedl's 9.0.2 release
binaries (no build tooling, notarised). Fallback: build from source with the same script. The
owner chooses (PRD Q2).

**Licence consequence (flagged):** a build with x264 is GPL. That has no effect while the binary
stays on the owner's Mac. If the owner ever gives the `.app` to someone else, the FFmpeg and x264
source and the configure line must go with it. Spawning FFmpeg as a separate program does not
make the Design Editor's own code GPL (separate programs talking over the command line count as
an aggregate under the FSF's reading; the FAQ page rate-limited during research, so this is from
the FAQ's well-known "MereAggregation" answer, not re-read today).

### 5.2 VideoToolbox through FFmpeg

From `libavcodec/videotoolboxenc.c` (Source: FFmpeg master):

- `-b:v` sets `kVTCompressionPropertyKey_AverageBitRate`.
- `-maxrate` sets `DataRateLimits` as bytes per 1-second window; `-bufsize` is not used.
- `-constant_bit_rate 1` uses `kVTCompressionPropertyKey_ConstantBitRate` and fails with an
  error if the encoder doesn't support it.
- `-q:v` (constant quality) works only on macOS arm64; elsewhere it errors.
- Other options: `allow_sw`, `require_sw`, `realtime`, `prio_speed`, `power_efficient`,
  `spatial_aq`, `max_ref_frames`.
- No two-pass mode (the encoder reads no pass statistics). **Assumed**; Phase 2 confirms with
  `ffmpeg -h encoder=h264_videotoolbox`.

Quality: "to reach the same VMAF score, VideoToolbox usually needs a higher bitrate than
libx264", and it is usually faster than `libx264 -preset medium` (Source: FFmpeg Cookbook,
updated 2026-10-09). Recommended `-q:v` 45–65 (Source: slhck.info, updated January 2026).

### 5.3 Two-pass libx264

One published test (8-second clip, target 6000 kbit/s): one pass gave 7176 kbit/s (+19.6%),
two passes gave 5992 kbit/s (−0.13%) (Source: martin-riedl.de, 2022-01-09). One clip only, so
this is the order of magnitude, not a guarantee; the retry rule (§6.5) still guards the result.
Low target sizes mean low bitrates, where x264's efficiency over hardware encoders matters most.

### 5.4 Running FFmpeg from the main process

- `child_process.spawn` with an argument array (no shell). `-progress pipe:1 -nostats` writes
  `key=value` lines every 0.5 s (`-stats_period`), each block ending with `progress=continue`
  or `progress=end`; `out_time_us` against the probed duration gives the fraction
  (Source: ffmpeg.html).
- Cancel: write `q` to stdin, then `SIGKILL` after 3 s; delete the partial output.
- `ffprobe -v error -print_format json -show_format -show_streams` for inputs.
- `powerSaveBlocker.start('prevent-app-suspension')` keeps the Mac awake during a batch and
  lets the screen sleep (Source: Electron docs).
- Lossless cut: `-ss` before `-i` with `-c copy` seeks to the closest seek point before the
  position and keeps it (Source: ffmpeg.html). `-map 0:a:N` picks the Nth audio stream.

### 5.5 Decision per feature (Mac)

| Feature | Command shape |
| --- | --- |
| Compress to a target size | libx264 two-pass (`-pass 1 -an -f null /dev/null`, then `-pass 2`), AAC audio, then the size check |
| Compress by quality, resize, convert video | `h264_videotoolbox` / `hevc_videotoolbox` with `-q:v`, AAC |
| Lossless clip | `-ss` before `-i`, `-to`, `-map 0 -c copy`, keyframe shown to the user first |
| Exact clip | Same with re-encode (VideoToolbox) |
| Extract audio | `-map 0:a:N -c copy` to the container that fits the codec (§8.2), else re-encode |
| GIF | One filter graph: `fps,scale,split,palettegen,paletteuse` (§7) |
| Convert audio | AAC/M4A, MP3 (libmp3lame), Opus, FLAC, WAV |

---

## 6. Target-size compression

### 6.1 Destination limits (checked 2026-10-30)

| Destination | Limit | Status |
| --- | --- | --- |
| Discord, free | **20 MB** (was 10 MB from September 2024; raised on 2026-08-13; mobile now measures the file before its own compression) | Source: Discord's post via Yahoo Tech/Gadget Review, 2026-08-14; Discord's FAQ page returned 403 |
| Discord Nitro Basic / Nitro | 50 MB / 500 MB | Same source |
| Gmail (personal) | 25 MB; larger attachments become Drive links | Source: Gmail Help |
| Outlook.com | 25 MB for attachments; larger via OneDrive | Source: Microsoft Support |
| Telegram | 2 GB per file, 4 GB with Premium | Source: Telegram blog (2022) |
| WhatsApp | Documents 2 GB; media sent as video about 16 MB (sources conflict: 16, 64, 100 MB) | **Unverified**; WhatsApp's own FAQ didn't load |

- The brief's "25 MB for Discord" is out of date: Discord is 20 MB.
- Email: attachments travel base64-encoded (4/3 plus line breaks, about 1.37×), and a secondary
  source says a 25 MB Gmail cap holds only 18–20 MB of file. **Assumed** preset: 18 MB for
  email. The device check in Phase 4 attaches an 18 MB and a 24 MB file to Gmail to confirm.
- Whether Discord counts 20 MB as 20,000,000 or 20,971,520 bytes is unknown, so presets use
  decimal megabytes (the smaller reading).

### 6.2 Budget formula

```
aim            = target × margin            (margin: 0.90 hardware one-pass, 0.97 x264 two-pass)
overhead       = 64 KiB + 1% of target       (MP4 index; calibrated in Phase 1)
total_bps      = (aim − overhead) × 8 / duration_s
audio_bps      = 128k if total_bps ≥ 1,000k; 96k if ≥ 500k; 64k if ≥ 250k; else 48k
video_bps      = (total_bps − audio_bps) × correction    (correction: per-encoder, §6.4)
```

Compressor (MIT) uses the same shape: target bits minus audio bits minus 2% plus 50 KiB, then a
per-resolution floor (**verified**, `CompressorUiState.kt`). Source audio that is already AAC at
or below `audio_bps` is copied, not re-encoded.

### 6.3 Resolution and frame-rate ladder

Frame rate is capped at 30 first (Compressor does the same: dropping 60 → 30 keeps more detail
than dropping a resolution step). Then the largest rung whose bits per pixel per frame
(`video_bps / (w × h × fps)`) is at or above the floor. Rungs (short side/fps): 1080/30, 720/30,
540/30, 480/30, 360/30, 360/24, 240/24.

Floors (**assumed**, tuned in Phase 1 against the owner's clips): hardware H.264 0.05, hardware
HEVC 0.035, x264 0.04. The base matches the "Kush gauge" (0.07 bpp for low motion) that Media3
itself uses for its default bitrate. Below half the floor at the lowest rung, the job is refused
with the longest duration that would fit.

### 6.4 Rate control on Android hardware

- Bitrate modes in the platform: `BITRATE_MODE_CQ`=0, `VBR`=1, `CBR`=2, `CBR_FD`=3; support is
  per encoder (`isBitrateModeSupported`) (**verified**, `android.jar` 36). Media3 accepts only
  VBR or CBR.
- **MediaTek evidence:** Compressor uses CBR by default but VBR on MediaTek, since a Xiaomi with a
  Dimensity 9400 on Android 16 produced no encoder output for 10 s in CBR and Media3 failed with
  "Muxer error" (issue #80, fixed by commit 71954d2, 2026-07-26). On a Dimensity 7300 a 28 MB
  clip came out at 21 MB against a 10 MB target (issue #49), and a Dimensity 9500 user asked for
  automatic re-compression because one pass misses (issue #121, open). On a Dimensity 800U,
  HEVC 1080p failed and fell back to 720p AVC (issues #103/#104).
- So on the owner's MediaTek phone: VBR first, CBR only as a fallback if VBR fails to start;
  expect overshoot; measure, and retry.
- **Correction factor:** after each job, store `actual_video_bytes / planned_video_bytes` per
  encoder name and mode; the next plan divides by the median of the last five, clamped to
  0.8–1.5. This is the calibration the hardware needs, and it costs a few lines.

### 6.5 Retry rule (both platforms)

1. Encode attempt 1 to a temporary file. If its size is ≤ target, publish it.
2. Otherwise: `next_video_bps = video_bps × (planned_video_bytes / actual_video_bytes) × 0.97`.
   Re-check the ladder (a rung may drop). Encode again.
3. At most 3 attempts. If the third is still over, fail with "Couldn't fit under N MB" and keep
   nothing. **Nothing above the target is ever delivered.**

Expected accuracy: two-pass x264 hits on attempt 1 in most cases (§5.3). Hardware one-pass with
a 0.90 margin should absorb up to 11% overshoot on attempt 1; a 15–20% overshoot (§5.3, §6.4)
needs attempt 2. Phase 1 measures the hit rate on the owner's clips.

### 6.6 Worked numbers

**A. 60-second 1080p30 clip to Discord (20 MB), phone, hardware H.264**

- aim = 20,000,000 × 0.90 = 18,000,000 B; overhead = 65,536 + 200,000 = 265,536 B.
- total = (18,000,000 − 265,536) × 8 / 60 = **2,364,595 bit/s**; audio 128 kbit/s;
  video = **2,236,595 bit/s** (correction 1.0).
- 1080p30: 2,236,595 / (1920 × 1080 × 30) = 0.036 < 0.05 → drop. 720p30:
  2,236,595 / (1280 × 720 × 30) = **0.081** ≥ 0.05 → **720p30 H.264 at 2.24 Mbit/s**.
  With HEVC, 1080p30 passes (0.036 ≥ 0.035) → 1080p30 HEVC.
- Planned bytes: video 16,774,463 + audio 960,000 + overhead ≈ 18.0 MB.
- If the encoder overshoots video by 15%: 19,290,632 + 960,000 + 265,536 = 20.5 MB → over.
  Attempt 2: 2,236,595 × (16,774,463 / 19,290,632) × 0.97 ≈ **1,886,000 bit/s**, still 720p
  (0.068 bpp). At the same 15% overshoot: 16.3 + 0.96 + 0.27 ≈ **17.5 MB** → published.

**B. 3-minute clip to 20 MB:** total = 17,734,464 × 8 / 180 = 788,198 bit/s → audio 96k →
video 692,198 bit/s → H.264: 720p 0.025 ✗, 540p 0.044 ✗, **480p30 0.056 ✓**; HEVC: **540p30**.

**C. 30-minute clip to 20 MB:** total 78,822 bit/s → audio 48k → video 30,822 bit/s → 240p24 at
0.0126 bpp, under half the floor → refused. The lowest rung needs 0.025 × 426 × 240 × 24 +
48,000 = 109,344 bit/s, so the message says it can hold about **21 minutes**.

---

## 7. GIF

- FFmpeg: generate a palette from the clip, then map frames to it, in one graph:
  `fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`.
  `stats_mode=diff` weights the palette to moving pixels; Bayer dithering compresses better than
  error diffusion; `diff_mode=rectangle` re-encodes only changed areas (Sources: mux.com, DEV
  Community, ffmpeg-user list).
- gifski is AGPL-3.0-or-later (commercial licence by arrangement) (Source: crate metadata).
  **Not used.**
- `gifenc` 1.0.3 (mattdesl, **MIT**, **verified** `npm view`): palette quantisation and LZW in a
  few hundred lines of JS; the Android GIF encoder ports it to Kotlin and adds a 4×4 Bayer
  dither before quantising.
- GIF size can't be predicted from a bitrate. A "fit under N MB" GIF walks a ladder
  (480 px/12 fps → 360/12 → 320/10 → 240/10) and re-encodes, at most 4 tries. Defaults: 480 px
  wide, 12 fps, warn above 15 s.
- Animated WebP is usually much smaller, but needs libwebp (BSD) on Android. Mac only, later.

---

## 8. Lossless cuts and audio extraction

### 8.1 Cuts

- A stream copy can only start on a keyframe. The tools show the keyframe at or before the
  chosen start ("Starts at 0:12.4, the nearest keyframe before 0:13.0") before exporting.
- Android: `MediaExtractor.seekTo(start, SEEK_TO_PREVIOUS_SYNC)`, copy samples into
  `MediaMuxer` until presentation time reaches the end. With B-frames, the last one or two frames
  before the end may not decode (**assumed**; Phase 4 tests a B-frame sample).
- Mac: FFmpeg `-ss` before `-i` with `-c copy` (§5.4). LosslessCut does the same.
- "Exact cut" re-encodes: Media3 trim optimisation on Android (only the first GOP when allowed),
  VideoToolbox on the Mac.
- LosslessCut (GPL-2.0-only since 2021; MIT before): lossless cut, merge, track extraction,
  remux, "smart cut" marked experimental (Sources: GitHub, Wikipedia). Ideas taken: show
  keyframes, keep all tracks by default, extract tracks one per file. No code taken.

### 8.2 Audio track extraction (copy where possible)

| Source codec | Mac (FFmpeg copy) | Android |
| --- | --- | --- |
| AAC, ALAC | `.m4a` | `.m4a` via `MediaMuxer` MP4 (AAC); ALAC re-encoded to AAC |
| MP3 | `.mp3` | raw frames to `.mp3` (**assumed**) |
| Opus | `.opus` (Ogg) | `.ogg` via `MediaMuxer` OGG |
| Vorbis | `.ogg` | `.webm` via `MediaMuxer` WebM |
| AC-3, E-AC-3 | `.ac3`, `.eac3` | raw frames (**assumed**) |
| FLAC | `.flac` | re-encoded to AAC `.m4a` |
| PCM | `.wav` | WAV header + samples |
| DTS, TrueHD, other | `.mka` | re-encoded to AAC `.m4a` |

Re-encoded tracks are labelled "converted to AAC" in the result.

---

## 9. Background work

### 9.1 Android

- `mediaProcessing` foreground service type, value 8192, permission
  `FOREGROUND_SERVICE_MEDIA_PROCESSING` (**verified**, `android.jar` 36). Added in Android 15.
- **Time limit:** `dataSync` and `mediaProcessing` may run 6 hours in any 24 (tracked per type,
  shared by all of the app's services of that type). Bringing the app to the foreground resets
  it. At the limit the system calls `Service.onTimeout(int, int)` (**verified** present) and the
  service has a few seconds to call `stopSelf()`, or the app crashes with "did not stop within
  its timeout". Starting another after the limit throws `ForegroundServiceStartNotAllowedException`
  (Source: developer.android.com FGS timeout and service types pages).
- WorkManager vs a plain service: WorkManager adds rescheduling, but a half-written transcode
  can't resume and a foreground service can't be started from the background anyway. A plain
  service owning a sequential queue (like Deputy's `RunService`) is simpler. Jobs that were
  running when the process died are marked "interrupted" and wait for the user.
- **HyperOS:** no official developer docs. User guides agree that surviving in the background
  needs Autostart on, battery saver "No restrictions" and sometimes the app locked in Recents; a
  developer report says "Close all" killed an idle process (Sources: SportsTrackLive docs, anki-
  alarm issue #35). Deputy's 57-minute survival on this phone came with an accessibility grant
  that includes "unlimited autostart" (**verified** in `docs/handoffs/deputy.md`), which a media
  app won't have. **Phase 1 spike:** start a long batch, swipe the app away, lock the phone,
  check the queue after 10 minutes.
- Notifications: `POST_NOTIFICATIONS` is a runtime permission on Android 13+.

### 9.2 Mac

- Jobs run as FFmpeg child processes of the main process; the renderer can be closed or hidden.
- `powerSaveBlocker` with `prevent-app-suspension` during a batch.
- Quitting with jobs running asks first, kills FFmpeg and deletes partial files.

---

## 10. Input and output

### 10.1 Android

- **Photo picker:** Android 11+ through system updates; videos yes, **audio no**; multi-select
  with `PickMultipleVisualMedia`; access lasts until restart or the app stops;
  `takePersistableUriPermission` keeps it (up to 5,000 grants) (Source: developer.android.com).
  No `READ_MEDIA_*` permission is needed.
- **expo-image-picker 17.0.11 copies every picked video into the app cache**
  (`MediaHandler.kt:101-102`) and declares `CAMERA` and the old storage permissions
  (**verified**). Not used for video.
- **expo-document-picker 14.0.8** uses `ACTION_OPEN_DOCUMENT` with `EXTRA_ALLOW_MULTIPLE`, and
  with `copyToCacheDirectory: false` returns `content://` URIs without copying (**verified**,
  `DocumentPickerModule.kt:36-39,124`). It handles video and audio, and it is already in the
  workspace (PDF Editor). The native module takes a persistable grant so queued jobs survive.
- **Output:** `MediaStore` insert with `RELATIVE_PATH` (`Movies/Design Editor`,
  `Music/Design Editor`, `Pictures/Design Editor` for GIFs) and `IS_PENDING` until complete
  (**verified** constants). No permission needed for the app's own inserts. The original is
  only read.

### 10.2 Mac

- Inputs come from `dialog.showOpenDialog` (multi-select); outputs go to a folder the user picks
  with `showOpenDialog({ properties: ['openDirectory'] })`. Both join the main process's granted
  set, as `save-file` already requires (**verified**, `main.js:51-62`).

---

## 11. Electron facts that shape the design

- Electron 44.8.0 bundles **Node 24.22.0** and **Chrome 152.0.7977.167**;
  `process.features.typescript` is `"strip"` (**verified**, `ELECTRON_RUN_AS_NODE=1 electron -p`).
- **The main process imports erasable `.ts` files directly, no build step** (**verified**: a
  scratch Electron app whose `main.mjs` imported `./budget.ts`, and then the same file through a
  symlinked `node_modules/@probe/core` package, printed the right result). Node refuses to strip
  types for files whose real path is under `node_modules`; workspace packages resolve to their
  real path under `packages/`, so they work.
- `@electron/packager` 20.3.0 dereferences symlinks by default (**verified**,
  `dist/platform.js:178`), and the `dist` script ignores `node_modules` (**verified**,
  `apps/design-editor/package.json`). So `packages/media-core` reaches the packaged app through a
  `vendor/media-core` symlink, exactly as `vendor/ui` does today.
- The page's CSP is `default-src 'self'; script-src 'self'; …` with no `media-src`
  (**verified**, `index.html:5`), and the renderer can't run TypeScript, so all planning runs in
  the main process. Video preview of a picked file in a `<video>` element is checked in Phase 2
  (`file://` first; a custom `media:` protocol serving only granted paths if CSP or range
  requests block it).

---

## 12. The mobile Design Editor

- Pattern to copy: PDF Editor. `packages/pdf-editor-engine` holds the page; `build.mjs` inlines
  scripts, `@apps-hub/ui` CSS and fonts into one HTML asset for the Expo WebView; the desktop
  shell loads the engine files directly; `bridge.ts` is a frozen message schema (**verified**).
- The base64 bridge stalls at roughly 40 MB (**verified**, engine README line 93). Design files,
  images and exports stay well under that; **video never crosses it**.
- Fabric.js 7.4.0 (vendored) handles touch for select and drag (`touchstart`,
  `allowTouchScrolling`) but has no pinch handling (**verified** by search of
  `vendor/fabric.min.js`: no "pinch"). Pinch-zoom and two-finger pan are built with pointer
  events (MDN's pattern) in the mobile page.
- The Design Editor's page talks to its shell only through `window.native` (`saveFile`,
  `openDesign`, `readAutosave`, `writeAutosave`, `setDocState`, `onMenu`) (**verified**,
  `preload.cjs`, `app.js:51,52,534,572,580,605,614`). The mobile shell supplies the same six
  functions over `postMessage`.

---

## 13. iOS (later, optional)

- No paid Apple developer account, so no installs on an iPhone yet (`docs/app-store.md`).
- AVFoundation covers the same jobs: `AVAssetExportSession` with the passthrough preset and a
  `timeRange` for keyframe cuts (it won't overwrite an existing file), `AVAssetReader` +
  `AVAssetWriter` with `AVVideoAverageBitRateKey` for target size (Sources: Apple sample code,
  third-party articles; not checked against Apple's reference pages).
- iOS 26 adds `BGContinuedProcessingTask` for user-started work such as exports, with system
  progress UI (Source: Apple's class page metadata and WWDC25 write-ups). That is the background
  queue on iOS.
- The Expo shell and `media-core` carry over; the native module gets a Swift side.

---

## 14. Market and prior art

| Product | Status and price | What it gates |
| --- | --- | --- |
| CapCut | Standard (the old Pro) $9.99/month; new Pro $19.99/month or $179.99/year on the web; app-store prices vary by region (Sources: eesel.ai, bigvu.tv, 2026) | 4K export, AI tools, some templates watermark on free |
| Adobe Premiere Rush | **Discontinued**: no new downloads or renewals after 2025-09-30, support ended 2026-09-30, apps "may no longer function" (Source: Adobe Help) | n/a; Adobe points to Premiere on iPhone and desktop |
| Canva | Pro $15/month or $120/year (mid-2026 sources) or $18/$180 (re-verified 2026-09-08 by Moda) | Free MP4 up to 30 min at 1080p; **changing MP4 quality, even down to 480p or 720p, asks free users to upgrade**; Pro gets 4K and 2-hour videos (Source: Canva Help) |
| "VideoCompress" | Ambiguous: several App Store compressors use the name, priced from $0.99/month to $29.99/year | Usually subscriptions or weekly plans |

FOSS prior art on Android:

- **Compressor** (JoshAtticus, **MIT**, 783 stars, last push 2026-10-24): Media3 only, no
  permissions, target-size presets (Discord moved from 10 to 20 MB in its code), H.264/H.265/AV1,
  frame rate before resolution, VBR on MediaTek. Claims a 200 MB 4K video in about 11 s on a
  Pixel 8 Pro versus about 21 min for an FFmpeg-based app (self-reported). **Copy:** the ladder
  order, the MediaTek VBR rule, AAC passthrough. **Improve:** retry until under the target.
- **FFShare** (**GPL-3.0**): share-sheet FFmpeg compressor; capped CRF; 76.7 MB APK.
- **Open Video Editor** (devhyper, GPL-3.0): Media3 trim, scale, rotate, audio extraction.

---

## 15. Name check

"SnapCompress" is taken in the same space: snapcompress.io (a privacy-first image compression and
conversion site), snap-compress.com, and two GitHub projects; "Snap" is also Snap Inc.'s mark.
Since the tools ship inside Design Editor, they are called **Media tools** in the UI and no new
app name is needed.

---

## 16. Where the original brief was wrong or out of date

1. **ffmpeg-kit / ffmpeg-kit-flutter is retired** (archived 2026-07-02, binaries pulled around
   2025-04-01). The stack is React Native, not Flutter, anyway.
2. **Discord's free limit is 20 MB**, not 25 MB.
3. **Premiere Rush is discontinued.** CapCut's top tier is $19.99/month, above the brief's range.
4. **The phone has no AV1 hardware** (encode or decode); H.264 and HEVC only.
5. **"Lossless clipping" only cuts on keyframes.** Frame-exact cuts need a re-encode of at least
   the first GOP.
6. **A background queue on Android 15+ gets 6 hours per 24**, and HyperOS may kill it when
   swiped away.
7. **Target-size accuracy can't come from one hardware pass.** It needs measure-and-retry.
8. The owner's "merge into an existing app" works on the Mac at low cost; on Android it means
   building a new app either way.

---

## Sources

Accessed 2026-10-30 unless marked 2026-10-31.

- ffmpeg-kit: [arthenica/ffmpeg-kit](https://github.com/arthenica/ffmpeg-kit),
  [FFmpegKitNext](https://github.com/arthenica/ffmpeg-kit-next),
  [ffmpegkit-maintained FAQ](https://github.com/ffmpegkit-maintained/ffmpeg/wiki/FAQ),
  [DEV: FFmpegKit is retired](https://dev.to/lucquebec/ffmpegkit-is-retired-heres-how-to-fix-your-android-build-ndk-r26c-patch-35j0),
  [ffmpeg-kit-react-native on npm](https://www.npmjs.com/package/ffmpeg-kit-react-native),
  [AliAkhgar/ffmpeg-kit-16KB](https://github.com/AliAkhgar/ffmpeg-kit-16KB)
- FFShare: [caydey/ffshare](https://github.com/caydey/ffshare) (releases, `build_ffmpegkit.sh`,
  `FFmpegParamMaker.kt`), [F-Droid](https://f-droid.org/packages/com.caydey.ffshare/)
- 16 KB pages: [Support 16 KB page sizes](https://developer.android.com/guide/practices/page-sizes)
- FFmpeg: [legal](https://ffmpeg.org/legal.html), [ffmpeg.html](https://ffmpeg.org/ffmpeg.html),
  [ffmpeg-codecs](https://ffmpeg.org/ffmpeg-codecs.html),
  [videotoolboxenc.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/videotoolboxenc.c),
  [Martin Riedl builds](https://ffmpeg.martin-riedl.de/),
  [Martin Riedl: two-pass encoding](https://www.martin-riedl.de/2022/01/09/two-pass-encoding-with-ffmpeg/),
  [FFmpeg Cookbook: VideoToolbox](https://ffmpeg-cookbook.com/en/articles/hardware-encode-videotoolbox/),
  [slhck: VBR settings](https://slhck.info/video/2017/02/24/vbr-settings.html),
  [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)
- Media3: [release notes](https://developer.android.com/jetpack/androidx/releases/media3),
  [Transformations](https://developer.android.com/media/media3/transformer/transformations),
  [Customization](https://developer.android.com/media/media3/transformer/customization),
  [Supported formats](https://developer.android.com/media/media3/transformer/supported-formats),
  [Troubleshooting](https://developer.android.com/media/media3/transformer/troubleshooting),
  [VideoEncoderSettings.java](https://github.com/androidx/media/blob/release/libraries/transformer/src/main/java/androidx/media3/transformer/VideoEncoderSettings.java),
  [DefaultEncoderFactory.java](https://github.com/androidx/media/blob/release/libraries/transformer/src/main/java/androidx/media3/transformer/DefaultEncoderFactory.java),
  [Media3 1.9.0 what's new](https://android-developers.googleblog.com/2025/12/media3-190-whats-new.html),
  [Google Maven](https://dl.google.com/android/maven2/androidx/media3/) (2026-10-31)
- MediaMuxer: [AOSP MediaMuxer.java](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/media/java/android/media/MediaMuxer.java)
- Android background and storage: [FGS timeout](https://developer.android.com/develop/background-work/services/fgs/timeout),
  [FGS types](https://developer.android.com/develop/background-work/services/fgs/service-types),
  [Photo picker](https://developer.android.com/training/data-storage/shared/photo-picker),
  [SportsTrackLive: Xiaomi battery](https://docs.sportstracklive.com/android-battery-saving/xiaomi),
  [anki-alarm issue #35](https://github.com/YgorPerez/anki-alarm/issues/35)
- Phone and SoC: [GSMArena Redmi Note 14 Pro 4G](https://m.gsmarena.com/xiaomi_redmi_note_14_pro_4g-ampp-13614.php),
  [PhoneArena review](https://www.phonearena.com/reviews/xiaomi-redmi-note-14-pro-review_id7009),
  [MediaTek Helio G100](https://www.mediatek.com/products/smartphones/mediatek-helio-g100),
  [CPU-Monkey G100 Ultra](https://www.cpu-monkey.com/en/cpu-mediatek_helio_g100_ultra),
  [Notebookcheck Redmi Pad 2](https://www.notebookcheck.net/Redmi-Pad-2-Hands-on-review-videos-confirm-details-and-unimproved-performance-of-Helio-G100-Ultra-powered-tablet.1027380.0.html),
  [AV1 device list (community)](https://gist.github.com/nekotrix/82158fc48f7edb0db8338779a997dad0)
- Mac: [Apple M5 (Wikipedia)](https://en.wikipedia.org/wiki/Apple_M5),
  [Electron powerSaveBlocker](https://www.electronjs.org/docs/latest/api/power-save-blocker)
- Limits: [Yahoo Tech: Discord raises free upload limit](https://tech.yahoo.com/apps/articles/discord-raises-free-upload-limit-144632691.html),
  [Discord File Attachments FAQ](https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ) (403),
  [Gmail Help](https://support.google.com/mail/answer/6584),
  [Outlook.com sending limits](https://support.microsoft.com/en-au/office/sending-limits-in-outlook-com-279ee200-594c-40f0-9ec8-bb6af7735c2e),
  [Telegram Premium blog](https://telegram.org/blog/700-million-and-premium),
  [Dropbox: WhatsApp large videos](https://www.dropbox.com/resources/send-large-videos-on-whatsapp),
  [IONOS: Gmail limit](https://www.ionos.com/digitalguide/e-mail/technical-matters/gmail-attachment-size-limit/)
- GIF: [mux.com](https://www.mux.com/articles/create-gifs-from-video-clips-with-ffmpeg),
  [DEV: MP4 to GIF](https://dev.to/voorai/how-to-convert-mp4-to-gif-with-ffmpeg-248l),
  [ffmpeg-user: palettegen diff](https://ffmpeg.org/pipermail/ffmpeg-user/2021-March/052519.html),
  [gifski crate](https://docs.rs/crate/gifski/0.3.0/source/README.md),
  [gifenc](https://github.com/mattdesl/gifenc)
- Prior art: [Compressor](https://github.com/JoshAtticus/Compressor) (source files, issues #49,
  #80, #103, #104, #121, commit 71954d2), [Show HN: Compressor](https://news.ycombinator.com/item?id=46778460),
  [Open Video Editor](https://f-droid.org/packages/io.github.devhyper.openvideoeditor/),
  [LosslessCut](https://github.com/mifi/lossless-cut), [LosslessCut (Wikipedia)](https://en.wikipedia.org/wiki/LosslessCut),
  [Mediabunny conversion guide](https://mediabunny.dev/guide/converting-media-files)
- Market: [Adobe: Premiere Rush end of life](https://helpx.adobe.com/premiere-rush/kb/end-of-life.html),
  [eesel.ai: CapCut pricing](https://eesel.ai/blog/capcut-pricing),
  [bigvu: CapCut pricing](https://www.bigvu.tv/blog/capcut-pricing-2026-free-vs-pro-included-alternatives),
  [Canva Help: download as video](https://www.canva.com/help/download-as-video/),
  [Moda: Canva pricing](https://moda.app/blog/canva-pricing),
  [Style Factory: Canva pricing](https://stylefactoryproductions.com/blog/canva-pricing),
  [App Store: Video Compress](https://apps.apple.com/hn/app/video-compress-reduce-size/id6444723677?l=en-GB)
- iOS: [BGContinuedProcessingTask](https://developer.apple.com/documentation/backgroundtasks/bgcontinuedprocessingtask),
  [Apple AVFoundationExporter sample](https://developer.apple.com/library/archive/samplecode/avexporter/Listings/Swift_AVFoundationExporter_main_swift.html)
- Name: [snapcompress.io](https://snapcompress.io/), [snap-compress.com](https://www.snap-compress.com/)
- Fabric.js pinch: [MDN pinch zoom gestures](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures)
