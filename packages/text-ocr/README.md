# text-ocr

Expo local module: on-device text recognition in English, Arabic and Urdu (Tesseract) and a clipboard copy, Android only. Shared by Design Editor and PDF Editor. Contract: `src/index.ts`.

- Engine: Tesseract4Android 4.9.0 (Apache-2.0), resolved from JitPack, which both apps already list in `allprojects.repositories`.
- Models: `android/src/main/assets/tessdata/{eng,ara,urd}.traineddata`, tessdata_fast (Apache-2.0, licence text checked), copied to `filesDir/tessdata` the first time a language is used. Taken from `tesseract-ocr/tessdata_fast` at commit `87416418657359cb625c412a48b6e1d6d41c29bd`; the git blob ids match upstream. `android/build.gradle` fails the build if a file changes (`verifyTraineddata`); `MODEL_SIZES` in `Recognizer.kt` must match when you update one.

  | File | Bytes | sha256 |
  | --- | --- | --- |
  | eng | 4113088 | `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` |
  | ara | 1432056 | `e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729` |
  | urd | 1398718 | `62e8250ce2a994106e313a82e26a516a39e2cf159d0ce3c5b5008387fd0d555f` |
- Language: `recognizeFile(uri, lang?)` and `recognizeBase64(base64, lang?)` take `eng`, `ara`, `urd`, `ara+eng` or `urd+eng` (the `OcrLanguage` type, choices and plain-words hints in `src/languages.ts`). Left out means English, so Design Editor and Inflow are unchanged. Anything else is refused natively (`languageCodes`), since the string reaches a file path. No language detection: the app asks.
- Search: OCR text is not folded here. Text that goes into the Library body is folded by the Library (`normalizeForSearch` in `@apps-hub/library-core`, called by `createItem` and `setBody`), so Arabic and Urdu spellings match whichever model read them; copy and display keep what Tesseract returned.
- Accuracy: `test-fixtures/README.md` (small synthetic sample, tesseract.js, not a phone).
- Lines are Tesseract text lines with mean confidence of at least 40. Pictures are read with `inSampleSize` so the longest side is at most 3000 px, then rotated upright from EXIF; `width` and `height` are of that bitmap and the boxes refer to it.
- Tests: `pnpm --filter text-ocr test` (TS) and `./gradlew :text-ocr:testDebugUnitTest` from an app's `android/` folder (JVM).
