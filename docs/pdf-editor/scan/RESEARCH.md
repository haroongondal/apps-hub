# Scan: research for an offline document scanner and OCR in PDF Editor

Researched 2026-10-30 for the **Scan** feature of PDF Editor (`apps/pdf-editor-mobile`,
release id `pdf-editor`, package `com.haroon.pdfeditor`). Requirements are in
`docs/pdf-editor/scan/PRD.md`, architecture in `docs/pdf-editor/scan/SPEC.md`.

Labels: **verified** means read on the primary source (repo, licence file, official docs,
published binary) or checked in this repo or SDK. **Reported** means a secondary source or a
primary source we could not open. **Assumed** means our own estimate, to be measured.

---

## 1. Verdict

| #   | Question                                     | Verdict                                                                                                                                                                                                                         |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Edge detection, perspective and enhancement  | **No OpenCV in v1.** The perspective warp is a platform call (`Matrix.setPolyToPoly`). Border detection and filters are about 600 lines of pure Kotlin, tested on the JVM. Stock OpenCV would add 24.7 MB to the APK.         |
| Q2  | OCR engine                                   | **Tesseract4Android 4.9.0 with English `tessdata_fast`** (Apache-2.0, 7.5 MB of arm64 code plus a 4.1 MB model). ML Kit is excluded. PP-OCR on ONNX Runtime is the fallback if real photos read badly.                      |
| Q3  | Camera                                       | **CameraX 1.6.2 inside our own Expo local module.** vision-camera v5 needs `react-native-worklets` ≥ 0.6 (SDK 54 pins 0.5.1); vision-camera v4 and expo-camera both pull ML Kit or Play services.                          |
| Q4  | Searchable PDF                               | **A small streaming PDF writer in pure TypeScript, outside the WebView.** JPEG pages pass through untouched; an invisible text layer uses Tesseract's 573-byte GlyphLessFont. pdf-lib in the WebView would hit the 40 MB bridge. |
| Q5  | Prior art                                    | Copy the CameraX setup, corner-drift stabiliser and sharpness gate from MakeACopy, FairScan and OSS Document Scanner. Avoid their weak spots: stock OpenCV bloat, GPL models, no auto-capture, firing while refocusing.        |
| Q6  | Competitors                                  | All three charge about $5–$10 a month. OCR, Office export and editing sit behind the paywall; CamScanner and Adobe Scan push OCR or storage through their clouds. Microsoft Lens was retired in 2026.                       |
| Q7  | Storage and permissions                      | **CAMERA is the only runtime permission needed.** Pages live in app-private storage; export goes through the share sheet. The app today also declares RECORD_AUDIO, SYSTEM_ALERT_WINDOW and two storage permissions; remove them. |
| Q8  | APK size and ABIs                            | **Ship arm64-v8a only.** That takes the APK from 82.9 MB to about 32 MB; Scan then adds about 15 MB, for about 47 MB. The owner's phone and the Mac's emulator are both arm64.                                                |
| —   | Host                                         | **PDF Editor is the right host.** Scans end as PDFs, the editor can mark them up, the library is shared with Reader, and the brand and Store entry already exist (§10).                                                       |

---

## 2. Edge detection, perspective and enhancement (Q1)

### What a scanner needs

1. Find the page's four corners in a live preview frame, about 10 times a second.
2. Map the quadrilateral to a rectangle (perspective warp) on the full-resolution photo.
3. Clean the result: even out lighting, raise contrast, optionally convert to grayscale or
   black and white.

### OpenCV

- Latest releases: 4.14.0 (GitHub 2026-07-19, Maven 2026-07-21), 5.0.0 (2026-06-06) and
  5.0.0.1 (Maven 2026-06-26). Apache-2.0. Maven Central `org.opencv:opencv`. (verified)
- The stock AAR is 123.4 MB (4.14.0) for 4 ABIs. On arm64, `libopencv_java4.so` is
  **24.66 MB** uncompressed (4.14.0) and `libopencv_java5.so` is 33.4 MB, plus 1.3 MB of
  `libc++_shared.so`. (verified, read from the published AARs)
- 16 KB pages: `libopencv_java*` is aligned in 4.14.0, 5.0.0 and 5.0.0.1, but 5.0.0's
  `libc++_shared.so` is not. Use 4.14.0 or 5.0.0.1 if OpenCV is ever added. (verified, ELF headers)
- FairScan ships the stock library: 23.47 MB inside a 47.0 MB arm64 APK. A contributor's
  minimal OpenCV build cut that APK to 31.8 MB (FairScan issue #24). (verified)
- Slimming: `BUILD_LIST=core,imgproc` and `BUILD_SHARED_LIBS=OFF` are official CMake options.
  OSS Document Scanner links OpenCV core, imgproc and photo with Tesseract, Leptonica and
  ZXing into one 6.70 MB `.so`. (verified)
- opencv-mobile (nihui) v37, 2026-10-20: Apache-2.0, static libraries only (21.1 MB zip for
  4.14.0), **no Java bindings**, so it needs our own JNI and a C++ build in the module.
  (verified)
- Everything a scanner uses is in imgproc: Canny, adaptiveThreshold, findContours,
  approxPolyDP, getPerspectiveTransform, warpPerspective, CLAHE, Laplacian. (verified,
  `imgproc.hpp`)

### Without OpenCV

- **Warp:** `android.graphics.Matrix.setPolyToPoly(src, 0, dst, 0, 4)` builds a projective
  map from four points; `Canvas.drawBitmap` with `FILTER_BITMAP_FLAG` applies it with
  bilinear filtering. (verified, Android reference; filter quality assumed) Speed on a 12 MP
  photo is not published: measure on the phone (§12).
- **MakeACopy** does perspective correction, dewarping and enhancement "in plain Java"; ONNX
  Runtime is its only native code. Its `Homography.java` (Apache-2.0) is a ready reference.
  (verified)
- **Detection** is a classic pipeline that fits in pure Kotlin. OSS Document Scanner's
  detector (verified, `DocumentDetector.cpp`): resize to 500 px, blur, Canny (or threshold
  plus close and dilate), find contours, `approxPolyDP` with ε = 0.02 of the perimeter, keep
  convex quadrilaterals with max cosine ≤ 0.4 and area ≥ 4% of the frame.
- BoofCV 1.6.0 (2026-10-23) is a pure-Java, Apache-2.0 vision library with an Android
  artifact. (verified) It is an option, but a general library for a 600-line job.
- RenderScript has been deprecated since Android 12. Its replacement toolkit is archived
  (last push 2023-10-10) and has no warp or edge detection. (verified)

### Learned corner detectors (for later)

| Model                       | Licence      | Size                                   | Runtime                                        | Status                                                       |
| --------------------------- | ------------ | -------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| MakeACopy DocQuad           | Apache-2.0   | 13.4 MB (`.ort`)                       | ONNX Runtime minimal build, 3.97 MB arm64      | Shipping, about 4 Hz (verified)                              |
| FairScan segmentation       | **GPL-3.0**  | 4.92 MB (TFLite)                       | LiteRT                                         | Excluded: GPL would cover the whole app (verified)           |
| DocAligner heatmap models   | Apache-2.0 (code) | not verified                      | ONNX, 256×256 input                            | Weight licence and size unverified                           |

LiteRT 2.3.2's POM depends on the proprietary `com.google.android.play:ai-delivery`, and
F-Droid flagged LiteRT in April 2026 (verified for 2.3.2; reported for 1.4.1). ONNX Runtime
has no such dependency.

### ML Kit Document Scanner is excluded

"The models, scanning logic and UI flow are dynamically downloaded by Google Play services"
(`play-services-mlkit-document-scanner:16.0.0`, needs 1.7 GB RAM). It is proprietary Play
services code, against AGENTS.md rule 5, and does nothing on a phone without Play services.
(verified, ML Kit doc-scanner page)

### iOS for later

`VNDocumentCameraViewController` (iOS 13, Apple's fixed UI), `VNDetectRectanglesRequest`
(iOS 11) and `VNDetectDocumentSegmentationRequest` (iOS 15) are system frameworks. (verified,
Apple docs) Core Image's `CIPerspectiveCorrection` filter does the warp. On-device processing
is assumed; Apple's pages don't state it.

**Verdict Q1:** pure Kotlin detector and filters, platform warp, 0 MB of new native code.
If the detector proves unreliable on the phone (PRD AC-4), the upgrade path is an
opencv-mobile static build of core + imgproc (assumed 3–5 MB) or MakeACopy's DocQuad on a
minimal ONNX Runtime (17.4 MB). Owner question Q1.

---

## 3. OCR (Q2)

### Tesseract on Android

- **Tesseract4Android 4.9.0**, released 2025-06-11, last commit 2026-02-05, 951 stars, not
  archived. It bundles Tesseract 5.5.1, Leptonica 1.85.0, libjpeg v9f and libpng 1.6.48.
  Upstream Tesseract is at 5.5.4 (2026-10-28). (verified)
- Licences: Apache-2.0 (project and Tesseract), BSD-2-Clause style (Leptonica), IJG (libjpeg),
  PNG Reference Library License v2 (libpng). **The IJG licence requires the notice "this
  software is based in part on the work of the Independent JPEG Group"** in a binary
  distribution, so it goes on an About or notices screen. (verified)
- Distribution: **JitPack only**, as `cz.adaptech.tesseract4android:tesseract4android:4.9.0`
  (and `-openmp`). Not on Maven Central. (verified) The app's `android/build.gradle` already
  lists `https://www.jitpack.io` in `allprojects.repositories` (verified, this repo).
- Size: AAR 12.85 MB for 4 ABIs. arm64 `.so` files: **7.51 MB** (libtesseract 4.16,
  libleptonica 2.88, libjpeg 0.25, libpngx 0.22). The OpenMP flavour is 8.32 MB. All are
  16 KB aligned; release 4.8.0 added 16 KB support. (verified, ELF headers)
- API: `getResultIterator()`, `PageIterator.getBoundingRect(level)`,
  `ResultIterator.getUTF8Text(level)` and `confidence(level)` give word boxes and
  confidences. `getHOCRText`, `meanConfidence` and `stop()` exist; there is no TSV or ALTO
  wrapper. (verified, `TessBaseAPI.java`)
- `TessBaseAPI` is not thread-safe: one instance on one thread. (verified, README)

### English model files (all Apache-2.0, verified)

| Set             | `eng.traineddata` | Notes                                                        |
| --------------- | ----------------- | ------------------------------------------------------------ |
| tessdata_fast   | **4.11 MB**       | Integer, smaller network, fastest; "best value for money"    |
| tessdata_best   | 15.40 MB          | Float, slowest, most accurate                                |
| tessdata        | 23.47 MB          | Only set with the legacy engine                              |

Other languages are cheap: German is 1.53 MB (fast). `osd.traineddata` (page orientation) is
10.56 MB.

### Speed and accuracy on a phone

One third-party benchmark exists (ScanKnifePlus PR #52, `docs/ocr-bench/results.md`,
2026-10-20; one device, small sample): OnePlus 6T (Snapdragon 845), Tesseract 5.5.3 OpenMP,
phone photos of printed A4 pages, warped and OCR'd at 2480×3508 px (300 dpi).

| Model | Seconds per page | CER   | WER   |
| ----- | ---------------- | ----- | ----- |
| fast  | 3.4              | 0.13% | 1.09% |
| best  | 5.7              | 0.19% | 1.09% |

- Book photos: 1.8–8.5 s per page with fast. Native heap grew 35–60 MB; the process peaked at
  350–430 MB PSS. Two-column pages recognised the words but scrambled reading order (CER about
  35%). (verified as read at source; reported as evidence)
- The owner's Helio G100 has 2 Cortex-A76 cores against the 845's 4 big cores. Estimate:
  **3–5 s per page** with fast. (assumed; measure, §12)
- Tesseract works best at 300 dpi or more; accuracy drops when the x-height is under about
  20 px and there is little chance below 10 px. (verified, tessdoc `ImproveQuality.md`)

### ONNX route: PaddleOCR on ONNX Runtime

- PaddleOCR v3.7.0 (2026-06-11) and RapidOCR v3.10.0 (2026-10-08) are Apache-2.0; every
  PP-OCRv5/v6 model on Hugging Face is tagged Apache-2.0. (verified)
- Models: PP-OCRv6 tiny det 1.83 + rec 4.49 = **6.3 MB**; PP-OCRv5 mobile English 13.3 MB.
  Printed-English accuracy on Paddle's own metric: v6 medium 94.1%, tiny 88.4%, v5 mobile
  86.0%. (verified)
- ONNX Runtime Android 1.31.1 (2026-10-26), MIT: arm64 `libonnxruntime.so` is **34.2 MB**;
  a custom minimal build is about 4 MB but loads only ORT-format models. (verified)
- PaddleOCR's official Kotlin SDK (`deploy/ppocr-android`, 2026-06-10) pulls OpenCV 4.5.3
  (17.1 MB plus 6.2 MB `libc++_shared`, **4 KB aligned only**). Ente's `mobile_ocr` (MIT)
  ports PP-OCRv5 to Kotlin without OpenCV. (verified)
- PP-OCR returns **line boxes, not word boxes**; word boxes would come from CTC positions,
  and RapidOCR's version of that has open bugs (#749). (reported)
- No primary head-to-head with Tesseract on printed English exists. Secondary sources rate
  PaddleOCR more accurate on receipts (CER about 0.20 vs 0.33 on SROIE) and Tesseract faster.
  (reported)

### ML Kit Text Recognition v2 is excluded

- Bundled `com.google.mlkit:text-recognition:16.0.1` (about 4 MB per script per ABI) still
  depends on `play-services-base` 18.5.0, `play-services-basement` 18.4.0 and `mlkit:common`
  18.11.0, which pulls Google's transport and Firebase encoder libraries. All are under the
  "ML Kit Terms of Service", not an open-source licence. (verified, Google Maven POMs)
- Unbundled `play-services-mlkit-text-recognition` has Play services download the model.
  (verified)
- The terms say ML Kit sends "metrics about the performance and utilization of the APIs" to
  Google. The data-disclosure page lists device model, OS, package, latency, image format and
  per-installation identifiers, bundled features included, with no opt-out. (verified)
- So it breaks all three rules: closed source, Google client libraries, telemetry.

### iOS later

`VNRecognizeTextRequest` (iOS 13, `.accurate` and `.fast`) gives word boxes through
`VNRecognizedText.boundingBox(for:)`. `RecognizeDocumentsRequest` (iOS 26) adds lines,
paragraphs and tables. (verified) Tesseract has no maintained iOS package: SwiftyTesseract
and libtesseract are archived and point to Vision. (verified) So iOS uses Vision, and the OCR
engine sits behind a port.

**Verdict Q2:** Tesseract4Android 4.9.0, standard flavour first (OpenMP compared in a spike),
`eng` from tessdata_fast in the APK. PP-OCRv6 tiny on ONNX Runtime is the fallback, at about
+40 MB with the full runtime. Owner question Q2.

---

## 4. Camera and auto-shutter (Q3)

### Options

| Option                         | Version, licence                      | Fit                                                                                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| react-native-vision-camera v5  | 5.2.4 (2026-10-29), MIT               | Nitro module. Frame processing (`useFrameOutput`) needs `react-native-worklets` **≥ 0.6.0** (`scheduleOnRuntime`); Expo SDK 54 pins **0.5.1** (in this app's `package.json`). Backend is CameraX 1.7.0-alpha03. Open Android leaks: #4213, #4180, #4207. (verified) |
| react-native-vision-camera v4  | 4.7.3, MIT                            | Always pulls ML Kit barcode scanning (bundled, or `play-services-mlkit-barcode-scanning` 18.3.1). (verified) Excluded.                                                                                                                                     |
| expo-camera (SDK 54)           | 17.0.10, MIT                          | Its Android Gradle file always depends on `play-services-code-scanner` 16.1.0 and `mlkit:barcode-scanning` 17.3.0. No per-frame API. Adds RECORD_AUDIO by default. (verified) Excluded.                                                                     |
| **CameraX in our Expo module** | **1.6.2** stable (2026-08-26), Apache-2.0 | core 1.18 MB, camera2 1.16 MB, lifecycle 53 KB, view 112 KB (AARs). Preview + ImageAnalysis + full-resolution ImageCapture are guaranteed together even on LEGACY devices ("PRIV PREVIEW + YUV PREVIEW + JPEG MAXIMUM"). (verified) All three active FOSS scanners use it. |

- Expo Modules supports view props, events and view-bound async functions on both platforms
  in the installed `expo-modules-core` 3.0.30 (`ViewDefinitionBuilder.kt:212`,
  `ViewDefinition.swift:112`). (verified, this repo)
- Detection runs in Kotlin on the analysis thread; only corner coordinates cross to JS.

### Auto-shutter heuristics in FOSS scanners (verified from code)

| Project              | Rule                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FairScan             | Stable when the largest corner movement is under 20 px on a 640×480 frame (about 3% of the width) for 3 frames in a row. No auto-capture yet (issue #157).   |
| OSS Document Scanner | Largest corner distance under 50 px; after 1,000 ms it runs a 1,000 ms progress ring and fires if the quad still matches. Area ≥ 4%, max cosine 0.4.          |
| WeScan (iOS)         | Keeps the last 8 rectangles, needs 3 within 40 px; fires after 35 consecutive passes within 6 px.                                                           |
| MakeACopy            | Ready when 8 of the last 10 frames are stable with geometry quality ≥ 0.80. Sharpness is the variance of the Laplacian on luma inside the quad. Manual shutter. |

None gates on exposure. FairScan reads `LENS_FOCUS_DISTANCE` through Camera2Interop. Our
rule (SPEC §7.3) uses thresholds as a share of the frame diagonal, a sharpness gate, an
autofocus-state gate and a "page changed" re-arm for batches.

**Verdict Q3:** CameraX 1.6.2 in the `pdf-scan` local module. No vision-camera, no
expo-camera.

---

## 5. Searchable PDF (Q4)

### Invisible text layer: the algorithm (verified, `pdfrenderer.cpp`, OCRmyPDF `renderer.py`)

- Draw the page image, then the OCR text in **text render mode 3** (invisible) so viewers can
  select and search it.
- Font: Tesseract's **GlyphLessFont** (`pdf.ttf`, 573 bytes, Apache-2.0) wrapped as Type0 /
  Identity-H. Every CID maps to glyph 1 through a CIDToGIDMap (128 KiB raw, **150 bytes**
  zlib-compressed); ToUnicode is the identity `<0000> <FFFF> <0000>`; default width 500;
  text is UTF-16BE hex.
- Coordinates: `s = 72 / dpi` points per pixel; `x = left · s`; `y = pageHeight − bottom · s`.
- Width matching: horizontal scaling `Tz = 2 · 100 · wordWidth / (fontSize · nChars)` with
  width 500. Keep each line in one `BT … ET`; Poppler does not carry `Tz` across blocks.
- PDF.js 3.11.174 keeps render-mode-3 text in its text layer. (reported, from its worker
  source)

### Options for building the PDF

| Option                                             | Result                                                                                                                                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pdf-lib 1.17.1 in the WebView                      | It exports `setTextRenderingMode`, `TextRenderingMode.Invisible`, `setCharacterSqueeze` (that is `Tz`) and passes JPEG through. But `embedFont` writes CID = glyph id, which breaks a glyphless font, and StandardFonts are WinAnsi only. Images go in and the PDF comes out as base64 (+33%), and a 30-page colour scan at 300 dpi (26–45 MB) passes the 40 MB stall. (verified) |
| Tesseract's `TessPDFRenderer`                      | Exposed by Tesseract4Android 4.9.0. Streams to disk and passes a JPEG file through as DCTDecode. But it runs OCR again at build time, so cached results, page edits and no-OCR exports don't fit, and the JNI call always returns true. (verified) |
| `android.graphics.pdf.PdfDocument`                 | Unsuitable: it re-encodes bitmaps as lossless Flate (about 5–8 MB a page, assumed), drops fully transparent text, and keeps every page in memory until `writeTo`. (verified, AOSP and Skia source)                                              |
| PdfBox-Android 2.0.27.0                            | Apache-2.0 but last released 2023-01-02, 3.25 MB plus BouncyCastle, and labels grayscale JPEGs as DeviceRGB. (verified)                                                                                                                         |
| **Pure-TS streaming writer (chosen)**              | About 300 lines, no dependency. Reads each page with `File.bytes()` and writes with `FileHandle.writeBytes()` over JSI, no base64 (both exist in the installed `expo-file-system` 19.0.24, verified in its type definitions). Same code serves iOS; `node --test` drives it with a fake sink. Memory stays at about one page. |

### Page image targets

| DPI | A4 (px)            | US Letter (px) |
| --- | ------------------ | -------------- |
| 150 | 1240×1754 (2.2 MP) | 1275×1650      |
| 200 | 1654×2339 (3.9 MP) | 1700×2200      |
| 300 | 2480×3508 (8.7 MP) | 2550×3300      |

An A4 ARGB bitmap is 34.8 MB at 300 dpi and 15.5 MB at 200 dpi. (verified arithmetic)

Size per page (assumed; measure on the phone):

| Mode                                 | Per page          | 20 pages     |
| ------------------------------------ | ----------------- | ------------ |
| Colour JPEG, 200 dpi, quality 80     | 0.4–0.7 MB        | 8–14 MB      |
| Colour JPEG, 300 dpi                 | 0.9–1.5 MB        | 18–30 MB     |
| Grayscale JPEG, 200 dpi              | 0.25–0.45 MB      | 5–9 MB       |
| Black and white, 1-bit Flate, 300 dpi | 55–110 KB        | 1.1–2.2 MB   |

- pdf-lib has no CCITT encoder and `embedPng` expands a 1-bit PNG to 8-bit RGB. Android's
  `Bitmap.compress` writes only JPEG, PNG and WebP. Packing 1 bit per pixel ourselves and
  compressing with `java.util.zip.Deflater` gives a stream a PDF can embed directly. (verified)
- Text layer: about 5–10 KB per page. (assumed)

**Verdict Q4:** store pages as 200 dpi JPEG (quality 80) or 300 dpi 1-bit Flate for black and
white; OCR from a 300 dpi-equivalent gray image; build the PDF with a TS writer from stored
pages and cached word boxes. Keep a scan's PDF under 28 MB so the editor's base64 bridge can
still open it.

---

## 6. Prior art (Q5)

| Project                 | Licence, latest           | Stack                                                                                                         | arm64 APK              | Weak spots                                                                       |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| OSS Document Scanner    | MIT, 1.26.2 (2026-10-22)  | NativeScript + C++: opencv-mobile (core, imgproc, photo), Tesseract, classic contours, CameraX                | 12.0 MB                | Unstable edges on light pages (#738), focus not locked at capture (#710), auto-capture bug (#740), custom NativeScript fork |
| MakeACopy               | Apache-2.0, 4.9.0 (2026-10-30) | Java, CameraX, DocQuad ONNX corners + edge snap + One-Euro smoothing, PaddleOCR v5 on ONNX Runtime, own PDF writer, **no OpenCV** | 42.4 MB (Light), about 107 MB (Full) | Models dominate size; no auto-capture                                            |
| FairScan                | GPL-3.0, 2.3.0 (2026-09-20) | Kotlin/Compose, CameraX 1.6.1, LiteRT segmentation, stock OpenCV 4.12.0, Tesseract4Android, PdfBox-Android | 47.0 MB                | OpenCV bloat (#24), LiteRT Play dependency (#155), no auto-capture (#157)        |
| OpenNoteScanner         | GPL-3.0, 1.0.35 (2020)    | Needs the OpenCV Manager app                                                                                  | —                      | Abandoned                                                                        |

(all verified on the repos and published APKs)

**Copy:** CameraX with a 640×480 analysis stream and a 4:3 full-resolution capture; a
homography warp without OpenCV; corner-drift stabilising with a timed progress ring; a
Laplacian-variance sharpness gate and an autofocus gate.

**Avoid:** the stock OpenCV AAR, GPL models, LiteRT 2.x, expo-camera, ML Kit, absolute pixel
thresholds, firing while the lens refocuses.

---

## 7. Competitors (Q6)

| App           | Price today (USD)                                                                                                     | Behind the paywall                                                                                                                                         | Account or cloud                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| CamScanner    | $9.99 a month, $59.99 a year (App Store); Play items $0.49–$399.99; contains ads (verified)                           | Cloud OCR (3 a month free, 1,000 Premium), Image to Word, Image to Excel, watermark removal (first-party post, Nov 2022, verified)                           | "More accurate" OCR is cloud OCR; sync needs sign-up. Play Data safety: shares device IDs for advertising (verified) |
| Adobe Scan    | Plus $4.99 a month or $19.99 a year; Premium $9.99 a month (verified)                                                  | Combine, export to Office, password protection, text editing, compression; Premium raises OCR from 5 to 100 pages and storage from 5 to 20 GB (verified) | Scans auto-save to Adobe Document Cloud; subscribing needs an Adobe ID (verified)                                    |
| SwiftScan     | VIP $5.99 a month or $34.99 a year; Plus $7.99–$9.99 a month or $59.99 a year (verified)                               | OCR, cloud upload, WebDAV/FTP, page editing, smart naming (verified)                                                                                      | OCR on device (verified); collects device IDs, "data can't be deleted" (verified)                                    |
| Microsoft Lens | Retired: removed from stores 2026-02-09, scanning stopped 2026-03-09 (verified)                                       | —                                                                                                                                                          | Its replacement, OneDrive scan, "does not support saving scans locally" (verified)                                   |

- CamScanner shipped a malicious ad library in 2019 (Kaspersky: Trojan-Dropper Necro.n; the
  app had over 100 million installs and was pulled from Play). (verified)
- APK sizes: CamScanner 7.27.5 157.71 MB (verified); Adobe Scan 41–99 MB and SwiftScan
  132.97 MB (reported).

What the owner gets for free that these charge for: on-device OCR with no page cap,
searchable PDF export, page editing, folders and tags, no watermark, no account, no upload.

---

## 8. Storage and permissions on Android 14–16 (Q7)

- **App-specific internal storage** needs no permission, other apps can't read it, and it is
  encrypted on Android 10+. (verified)
- **Photo picker** (`PickVisualMedia`) needs no storage permission; expo-image-picker 17.0.11
  uses it unless `legacy: true`. (verified) Android 14's selected-photos permission is only
  for apps with their own gallery. (verified)
- **Export:** the share sheet through a FileProvider (expo-sharing 14.0.8 ships its own and
  adds no permission) or SAF `ACTION_CREATE_DOCUMENT`, which needs no permission. (verified)
- **The app's committed manifest already declares** INTERNET, READ_EXTERNAL_STORAGE,
  WRITE_EXTERNAL_STORAGE, RECORD_AUDIO, SYSTEM_ALERT_WINDOW and VIBRATE, with
  `android:allowBackup="true"` (verified, `apps/pdf-editor-mobile/android/app/src/main/AndroidManifest.xml:2-15`).
  The extra ones come from Expo plugins applied at prebuild: expo-image-picker adds CAMERA and
  RECORD_AUDIO unless told not to, expo-file-system adds INTERNET and the storage pair.
  `android.blockedPermissions` in `app.json` writes `tools:node="remove"`. (verified)
- Android 15: edge-to-edge by default; `dataSync` and `mediaProcessing` foreground services
  are capped at 6 h a day. Android 16: edge-to-edge can't be turned off, predictive back is on.
  Neither release lists a camera-specific change. (verified)
- `allowBackup="true"` lets Android Auto Backup copy app data (up to 25 MB) to the user's
  Google Drive. For private scans that is a choice for the owner (PRD Q5). (verified,
  manifest; Auto Backup behaviour reported)

**Verdict Q7:** add CAMERA; remove RECORD_AUDIO, SYSTEM_ALERT_WINDOW and both storage
permissions. INTERNET stays: React Native needs it in development and Reader needs it.

---

## 9. APK size and ABIs (Q8)

- Today's release APK (`apps/pdf-editor-mobile/releases/PDF-Editor-1.0.0-release.apk`) is
  **82.9 MB**. Native libraries total 69.3 MB, stored uncompressed: arm64-v8a 18.1 MB,
  armeabi-v7a 12.5 MB, x86 19.2 MB, x86_64 19.5 MB. (verified, measured in this session)
- It already passes `zipalign -c -P 16`, and all 21 arm64 `.so` files have 16 KB LOAD
  alignment (RN 0.81.5, AGP 8.11.0, NDK 27.1 with flexible page sizes). (verified)
- The phone: Helio G100-Ultra, 2× Cortex-A76 + 6× Cortex-A55, 64-bit, so arm64-v8a.
  (verified, MediaTek and Xiaomi spec pages) Its page size is probably 4 KB; Xiaomi and
  MediaTek devices are not on Google's 16 KB list. (assumed)
- This Mac is Apple Silicon and its only emulator (`apps-hub-test`) is arm64-v8a, Android 35,
  so arm64-only costs nothing for debugging. (verified)
- Restrict ABIs with `reactNativeArchitectures=arm64-v8a` in
  `apps/pdf-editor-mobile/android/gradle.properties:31`; the RN Gradle plugin turns it into
  `ndk.abiFilters`, which also drops prebuilt `.so` files from AARs. `splits.abi` would need a
  versionCode per ABI and buys nothing for a private Store. (verified; AAR filtering assumed)
- `libexpo-sqlite.so` is 1.82 MB on arm64 (verified, NetLens release APK).

### Size budget (arm64-only)

| Part                                   | Size                   |
| -------------------------------------- | ---------------------- |
| Today's app, arm64 only                | about 31.7 MB (assumed: 82.9 − 51.2) |
| Tesseract4Android `.so` files          | +7.51 MB (verified)    |
| `eng.traineddata` (fast)               | +4.11 MB (verified)    |
| expo-sqlite                            | +1.82 MB (verified)    |
| CameraX classes after dexing           | about +1.5 MB (assumed) |
| New app and package code               | about +0.3 MB (assumed) |
| **Total**                              | **about 47 MB**; budget 50 MB (PRD NFR-2) |

Release builds have minify off (`android/app/build.gradle:69`), so nothing is shrunk.

---

## 10. Host fit: why PDF Editor

- **Shared output.** A scan becomes a PDF; the editor (PDF.js + pdf-lib) can open it to add
  text, signatures, highlights and pages. That needs no new engine code: the existing `open`
  bridge command takes the scan's PDF.
- **Shared library.** Reader saves articles into the same library; both features need search,
  folders and tags, and the home screen today is only an "Open a PDF" button.
- **Already set up.** The `pdf` brand, Store entry, release id, signing and package exist.
- **What the engine does not reuse:** building the scan PDF. pdf-lib in the WebView would
  push every page through the base64 bridge (§5), so the scan PDF is written outside it.
- **Cost of merging:** about +15 MB of APK (after dropping three ABIs, the app still shrinks
  by about 36 MB overall) and one new permission, CAMERA.

A separate scanner app would duplicate the library, the share flow and the brand, and still
need the editor for markup. Verdict: merge.

---

## 11. Where this research contradicts the brief

1. **OpenCV is not needed** for the warp (`Matrix.setPolyToPoly`) or, at v1 quality, for
   detection. The stock SDK would add 24.7 MB.
2. **"Tesseract or ML Kit" is not the choice.** ML Kit is excluded even when bundled (Google
   client libraries plus usage metrics). The real alternative is PaddleOCR on ONNX Runtime.
3. **vision-camera frame processors don't fit SDK 54** (worklets 0.5.1 vs ≥ 0.6), and
   expo-camera pulls ML Kit. CameraX in our module is the camera.
4. **pdf-lib can draw invisible text** but can't embed the glyphless font correctly, and the
   bridge limit rules out building there anyway.
5. **The app already declares RECORD_AUDIO, SYSTEM_ALERT_WINDOW and storage permissions.**
   "Camera permission only" means removing four, not just adding one.
6. **The emulator is arm64**, so shipping arm64 only doesn't hurt debugging.

---

## 12. Not verified: measure on the phone (Phase 2 and 4 spikes)

- Tesseract time per page and peak memory on the Helio G100, standard vs OpenMP flavour.
- Kotlin detector speed on a 640×480 frame and its hit rate on real pages.
- `setPolyToPoly` warp time on a 12 MP photo.
- Real JPEG sizes per page at quality 80, 200 dpi.
- The camera's hardware level and maximum 4:3 capture size.
- Page size (`adb shell getconf PAGE_SIZE`; reading only, installs still go through the Store).
- Text-selection alignment of the invisible layer in PDF.js, Chrome and Acrobat.

---

## Sources

All accessed 2026-10-30.

**Image processing and detection**
- OpenCV: https://github.com/opencv/opencv/releases ; https://github.com/opencv/opencv/blob/4.x/LICENSE ; https://repo1.maven.org/maven2/org/opencv/opencv/ ; https://raw.githubusercontent.com/opencv/opencv/4.x/modules/imgproc/include/opencv2/imgproc.hpp ; OpenCV `doc/tutorials/introduction/config_reference/config_reference.markdown`
- opencv-mobile: https://github.com/nihui/opencv-mobile
- Android Matrix: https://developer.android.com/reference/android/graphics/Matrix
- RenderScript: https://developer.android.com/guide/topics/renderscript/migrate ; https://github.com/android/renderscript-intrinsics-replacement-toolkit
- BoofCV: https://github.com/lessthanoptimal/BoofCV
- DocAligner: https://github.com/DocsaidLab/DocAligner
- FairScan model: https://github.com/pynicolas/fairscan-segmentation-model
- LiteRT POMs: https://dl.google.com/android/maven2/com/google/ai/edge/litert/
- ML Kit Document Scanner: https://developers.google.com/ml-kit/vision/doc-scanner
- Apple: https://developer.apple.com/documentation/visionkit/vndocumentcameraviewcontroller ; https://developer.apple.com/documentation/vision/vndetectrectanglesrequest ; https://developer.apple.com/documentation/vision/vndetectdocumentsegmentationrequest
- WeScan: https://github.com/WeTransferArchive/WeScan

**OCR**
- Tesseract4Android: https://github.com/adaptech-cz/Tesseract4Android ; https://jitpack.io/cz/adaptech/tesseract4android/tesseract4android/4.9.0/
- Tesseract: https://github.com/tesseract-ocr/tesseract ; https://github.com/tesseract-ocr/tessdata_fast ; https://github.com/tesseract-ocr/tessdata_best ; https://github.com/tesseract-ocr/tessdata ; https://tesseract-ocr.github.io/tessdoc/Data-Files.html ; https://tesseract-ocr.github.io/tessdoc/Benchmarks.html ; https://github.com/tesseract-ocr/tessdoc/blob/main/ImproveQuality.md
- Phone benchmark: https://github.com/haziaferi/ScanKnifePlus/pull/52
- PaddleOCR: https://github.com/PaddlePaddle/PaddleOCR ; http://www.paddleocr.ai/main/en/version3.x/algorithm/PP-OCRv6/PP-OCRv6.html ; http://www.paddleocr.ai/main/en/version3.x/inference_deployment/cross_platform/android_deployment.html ; https://huggingface.co/PaddlePaddle
- RapidOCR: https://github.com/RapidAI/RapidOCR ; https://www.modelscope.cn/models/RapidAI/RapidOCR ; https://rapidai.github.io/RapidOCRDocs/main/install_usage/rapidocr/parameters/
- ONNX Runtime: https://repo1.maven.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/1.31.1/ ; https://onnxruntime.ai/docs/tutorials/mobile/ ; https://onnxruntime.ai/docs/build/custom.html
- Ente mobile_ocr: https://github.com/ente/mobile_ocr
- ML Kit text recognition: https://developers.google.com/ml-kit/vision/text-recognition/v2/android ; https://developers.google.com/ml-kit/android-data-disclosure ; https://developers.google.com/ml-kit/terms ; https://dl.google.com/dl/android/maven2/com/google/mlkit/
- Apple Vision: https://developer.apple.com/documentation/vision/vnrecognizetextrequest ; https://developer.apple.com/documentation/vision/recognizedocumentsrequest
- Tesseract on iOS: https://github.com/SwiftyTesseract/libtesseract
- Secondary only: https://imagetotable.ai/es/references/tesseract-vs-paddleocr-receipt-benchmark ; https://codesota.com/ocr/paddleocr-vs-tesseract

**Camera**
- vision-camera: https://github.com/margelo/react-native-vision-camera (tags v4.7.3, v5.2.4; issues #3743, #4180, #4207, #4213) ; https://visioncamera.margelo.com
- Worklets compatibility: https://docs.swmansion.com/react-native-worklets/docs/guides/compatibility
- expo-camera: https://github.com/expo/expo/blob/sdk-54/packages/expo-camera/android/build.gradle ; https://docs.expo.dev/versions/v54.0.0/sdk/camera/
- CameraX: https://developer.android.com/jetpack/androidx/releases/camera ; https://developer.android.com/media/camera/camerax/architecture ; https://developer.android.com/reference/android/hardware/camera2/CameraDevice

**PDF**
- Tesseract renderer: https://github.com/tesseract-ocr/tesseract/blob/main/src/api/pdfrenderer.cpp ; https://github.com/tesseract-ocr/tesseract/blob/main/src/api/pdf_ttf.h
- Leptonica: https://github.com/DanBloomberg/leptonica/blob/master/src/pdfio2.c
- OCRmyPDF: https://github.com/ocrmypdf/OCRmyPDF (`src/ocrmypdf/fpdf_renderer/renderer.py`)
- AOSP and Skia: https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/libs/hwui/jni/pdf/PdfDocument.cpp ; https://skia.googlesource.com/skia/+/refs/heads/main/src/pdf/SkPDFBitmap.cpp
- PdfBox-Android: https://github.com/TomRoush/PdfBox-Android
- fontkit: https://registry.npmjs.org/@pdf-lib/fontkit
- Apple: https://developer.apple.com/documentation/coregraphics/cgtextdrawingmode/invisible
- Local: `packages/pdf-editor-engine/vendor/pdf-lib.min.js`, `vendor/pdf.worker.min.js`; `expo-file-system` 19.0.24 `build/ExpoFileSystem.types.d.ts`

**Competitors**
- https://apps.apple.com/us/app/camscanner-pdf-scanner-app/id388627783 ; https://play.google.com/store/apps/details?id=com.intsig.camscanner ; https://blog.camscanner.com/2022/11/22/camscanner-unlocks-an-advanced-feature-to-american-ios-and-android-users/ ; https://securelist.com/dropper-in-google-play/92496/
- https://apps.apple.com/us/app/adobe-scan-pdf-ocr-scanner/id1199564834 ; https://www.adobe.com/devnet-docs/adobescan/ios/en/managingsubscriptions.html ; https://www.adobe.com/acrobat/mobile/scanner-app.html
- https://apps.apple.com/us/app/scanner-qr-code-automatic/id834854351 ; https://play.google.com/store/apps/details?id=net.doo.snap ; https://swiftscan.app
- https://support.microsoft.com/en-us/lens/
- https://www.apkmirror.com/apk/intsig-information-co-ltd/camscanner-phone-pdf-creator/

**Android platform**
- https://developer.android.com/training/data-storage/app-specific ; https://developer.android.com/training/data-storage/shared/photo-picker ; https://developer.android.com/about/versions/14/changes/partial-photo-video-access ; https://developer.android.com/training/data-storage/shared/documents-files
- https://developer.android.com/about/versions/15/behavior-changes-15 ; https://developer.android.com/about/versions/16/behavior-changes-16 ; https://expo.dev/changelog/sdk-54
- https://developer.android.com/guide/practices/page-sizes ; https://github.com/expo/fyi/blob/main/android-16kb-page-sizes.md ; https://reactnative.dev/blog/2025/01/21/version-0.77
- https://developer.android.com/ndk/guides/abis ; https://developer.android.com/studio/build/configure-apk-splits ; https://reactnative.dev/docs/build-speed
- https://www.mediatek.com/products/smartphones/mediatek-helio-g100 ; https://www.mi.com/global/product/redmi-note-14-pro/specs/

**This repo (verified 2026-10-30)**
- `apps/pdf-editor-mobile/android/app/src/main/AndroidManifest.xml:2-15`, `android/gradle.properties:31`, `android/build.gradle` (JitPack), `android/app/build.gradle:69` (minify off), `releases/PDF-Editor-1.0.0-release.apk`
- `expo-sqlite` 16.0.10: SQLite 3.50.3 (`vendor/sqlite3/sqlite3.h:149`), FTS5 on by default (`ios/ExpoSQLite.podspec:40-41`)
- Node 22.23.4 `node:sqlite` (SQLite 3.53.4): FTS5 with `unicode61 remove_diacritics 2`, `trigram`, `snippet()` and `bm25()` all work (run in this session)
- `expo-modules-core` 3.0.30: view-bound `AsyncFunction` (`android/.../views/ViewDefinitionBuilder.kt:212`, `ios/Core/Views/ViewDefinition.swift:112`)
- `apps/netlens/releases/NetLens-0.1.0-release.apk`: `libexpo-sqlite.so` 1.82 MB arm64
