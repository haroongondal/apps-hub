# text-ocr

Expo local module: on-device English text recognition (Tesseract) and a clipboard copy, Android only. Shared by Design Editor and PDF Editor. Contract: `src/index.ts`.

- Engine: Tesseract4Android 4.9.0 (Apache-2.0), resolved from JitPack, which both apps already list in `allprojects.repositories`.
- Model: `android/src/main/assets/tessdata/eng.traineddata`, tessdata_fast (Apache-2.0), copied to `filesDir/tessdata` on first use.
  sha256 `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` (4113088 bytes). `android/build.gradle` fails the build if it changes; `ENG_SIZE` in `Recognizer.kt` must match when you update it.
- Lines are Tesseract text lines with mean confidence of at least 40. Pictures are read with `inSampleSize` so the longest side is at most 3000 px, then rotated upright from EXIF; `width` and `height` are of that bitmap and the boxes refer to it.
- Tests: `pnpm --filter text-ocr test` (TS) and `./gradlew :text-ocr:testDebugUnitTest` from an app's `android/` folder (JVM).
