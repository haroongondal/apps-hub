// The text languages the phone can read. The id is the Tesseract language string the native side takes:
// the first model leads, "+eng" adds English words and numbers to Arabic or Urdu lines.
export type OcrLanguage = 'eng' | 'ara' | 'urd' | 'ara+eng' | 'urd+eng';

export interface OcrLanguageChoice { id: OcrLanguage; label: string; hint: string }

// The hints follow what the sample pictures showed (test-fixtures/README.md): clear, plain-print Urdu and Arabic read well, flowing Nastaliq-style Urdu does not,
// and Urdu mixed with English is worse still (48 to 67% character error). Keep them in step with that README.
export const OCR_LANGUAGES: ReadonlyArray<OcrLanguageChoice> = [
  { id: 'eng', label: 'English', hint: 'Works best on clear, printed text.' },
  { id: 'ara', label: 'Arabic', hint: 'Works best on clear, printed text. Check the result before you use it.' },
  { id: 'urd', label: 'Urdu', hint: 'Plain, clear print reads well. Urdu in the curly, flowing style of many books and newspapers is often misread, so check the result.' },
  { id: 'ara+eng', label: 'Arabic and English', hint: 'For text that mixes both. Mixed lines can come out in the wrong order, so check the result.' },
  { id: 'urd+eng', label: 'Urdu and English', hint: 'For text that mixes both. Urdu mixed with English is often misread, so check the result line by line.' },
];

export const DEFAULT_OCR_LANGUAGE: OcrLanguage = 'eng';

/** A saved or typed value as a language, or the default when it is not one of the choices. */
export const toOcrLanguage = (value: unknown): OcrLanguage =>
  OCR_LANGUAGES.find((l) => l.id === value)?.id ?? DEFAULT_OCR_LANGUAGE;
