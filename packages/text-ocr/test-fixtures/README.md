# OCR sample pictures

Eleven small pictures (about 100 KB in all) of printed Arabic, Urdu and mixed Arabic or Urdu with English, drawn from the sentences in `truth.json` with this Mac's system fonts by `render.mjs`. `measure.mjs` reads them with Tesseract and writes `results.json`. They are the evidence behind the wording of the language choices in `src/languages.ts`.

What was measured, 2026-11-25:

- Engine: tesseract.js 6.0.1 (WASM), a different Tesseract build from the one inside Tesseract4Android 4.9.0 (5.5.1). The models are the same `tessdata_fast` files the app bundles (commit `87416418657359cb625c412a48b6e1d6d41c29bd`), page mode auto, lines under confidence 40 dropped, as `Recognizer.kt` does. This is NOT a phone run: the Android engine, camera photos (blur, skew, shadow, curved pages) and real documents were not measured.
- The pictures are synthetic, perfectly straight and sharp. Real photos will read worse.
- CER is the character error rate over the whole picture (edits needed / characters in the truth, after collapsing white space), so a line the confidence filter drops counts as missing text. "Words found" is the share of truth words that appear in the output after the Library's search folding.

| Picture | Font and size | Model | CER | Words found | Lines kept |
| --- | --- | --- | --- | --- | --- |
| ar-naskh-geeza | Geeza Pro 36 px | ara | 52.9% | 52% | 2 of 4 |
| ar-naskh-damascus | Damascus 36 px | ara | 0.6% | 97% | 4 of 4 |
| ar-naskh-decotype | DecoType Naskh 36 px | ara | 2.3% | 86% | 4 of 4 |
| ar-small-geeza | Geeza Pro 22 px | ara | 0.0% | 100% | 4 of 4 |
| ur-naskh-geeza | Geeza Pro 36 px | urd | 0.0% | 100% | 4 of 4 |
| ur-naskh-small | Geeza Pro 22 px | urd | 0.0% | 100% | 4 of 4 |
| ur-nastaliq-noto | Noto Nastaliq Urdu 36 px | urd | 51.6% | 33% | 2 of 4 |
| ur-nastaliq-deco | DecoType Nastaleeq Urdu 36 px | urd | 36.7% | 43% | 3 of 4 |
| ar-en-geeza | Geeza Pro 34 px | ara+eng | 9.6% | 53% | 4 of 4 |
| ur-en-naskh | Geeza Pro 34 px | urd+eng | 48.1% | 62% | 4 of 4 |
| ur-en-nastaliq | Noto Nastaliq Urdu 34 px | urd+eng | 67.3% | 38% | 4 of 4 |

What it shows:

- Clear printed Arabic and Urdu in Naskh-style fonts read well (0 to 2% CER) except where the confidence filter drops a line: in `ar-naskh-geeza` two lines scored 31 and 36, were nearly right, and were dropped, which is the 52.9%. The filter stays at 40 for every language (my call: a lower one keeps junk such as the 23-scored `:7-` line in `ur-nastaliq-noto`); an owner decision if Arabic lines going missing matters more.
- Curly Nastaliq Urdu reads badly (37 to 52% CER, one or two lines dropped), and Urdu mixed with English is worse still. This is why the Urdu hints say "clear, printed text" and "often misread".
- Mixed Arabic and English held up in this sample (9.6%). Both scripts come out with invisible direction marks (U+200E, U+200F) around the English words; the Library index ignores them (`library-search.test.ts`, "OCR text with direction marks").
- Picking the wrong language is worse than anything above: Urdu read with the Arabic model is 23% (Naskh) to 91% (Nastaliq) off, Arabic read with the Urdu model 10 to 39% off, and either read as English is 95 to 100% off. There is no automatic language detection; the person chooses.
- Not measured: English (unchanged), handwriting, camera photos, Arabic with harakat, other fonts, speed or memory on the phone.

Reproduce: `npm i tesseract.js @napi-rs/canvas` in a scratch folder, link its `node_modules` here, put `eng`, `ara` and `urd` `.traineddata` in a folder, then `node render.mjs` and `node measure.mjs <that folder>`.
