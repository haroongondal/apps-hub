// The text languages the phone can read. The id is the Tesseract language string the native side takes:
// the first model leads, "+eng" adds English words and numbers to Arabic or Urdu lines.
export type OcrLanguage = 'eng' | 'ara' | 'urd' | 'ara+eng' | 'urd+eng';

export interface OcrLanguageChoice { id: OcrLanguage; label: string; hint: string }

// The hints follow what the sample pictures showed (test-fixtures/README.md): clear printed Naskh text reads well,
// curly Nastaliq Urdu does not, and a line that mixes scripts needs a check. Keep them in step with that README.
export const OCR_LANGUAGES: ReadonlyArray<OcrLanguageChoice> = [
  { id: 'eng', label: 'English', hint: 'Works best on clear, printed text.' },
  { id: 'ara', label: 'Arabic', hint: 'Works best on clear, printed text. Check the result before you use it.' },
  { id: 'urd', label: 'Urdu', hint: 'Works best on clear, printed text. Curly, hand-lettered style is often misread, so check the result.' },
  { id: 'ara+eng', label: 'Arabic and English', hint: 'For text that mixes both. Mixed lines can come out in the wrong order, so check the result.' },
  { id: 'urd+eng', label: 'Urdu and English', hint: 'For text that mixes both. Urdu works best on clear, printed text, so check the result.' },
];

export const DEFAULT_OCR_LANGUAGE: OcrLanguage = 'eng';

/** A saved or typed value as a language, or the default when it is not one of the choices. */
export const toOcrLanguage = (value: unknown): OcrLanguage =>
  OCR_LANGUAGES.find((l) => l.id === value)?.id ?? DEFAULT_OCR_LANGUAGE;
