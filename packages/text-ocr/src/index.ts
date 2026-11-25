import { requireNativeModule } from 'expo-modules-core';
import type { OcrLanguage } from './languages.ts';
import type { OcrResult } from './pick.ts';

export type { OcrLine, OcrResult } from './pick.ts';
export { allText, pickLine } from './pick.ts';
export type { OcrLanguage, OcrLanguageChoice } from './languages.ts';
export { DEFAULT_OCR_LANGUAGE, OCR_LANGUAGES, toOcrLanguage } from './languages.ts';

// Tesseract on the phone: English, Arabic and Urdu. Everything stays on the device.
// `lang` is optional and means English when left out, so callers written before it keep working.
export interface TextOcrModule {
  // base64 of a JPEG or PNG, without a data: prefix
  recognizeBase64(base64: string, lang?: OcrLanguage): Promise<OcrResult>;
  // a file:// or content:// uri; the picture's EXIF rotation is applied before reading
  recognizeFile(uri: string, lang?: OcrLanguage): Promise<OcrResult>;
  // puts plain text on the system clipboard
  copy(text: string): Promise<void>;
}

export default requireNativeModule<TextOcrModule>('TextOcr');
