import { requireNativeModule } from 'expo-modules-core';
import type { OcrResult } from './pick.ts';

export type { OcrLine, OcrResult } from './pick.ts';
export { allText, pickLine } from './pick.ts';

// Tesseract (English) on the phone. Everything stays on the device.
export interface TextOcrModule {
  // base64 of a JPEG or PNG, without a data: prefix
  recognizeBase64(base64: string): Promise<OcrResult>;
  // a file:// or content:// uri; the picture's EXIF rotation is applied before reading
  recognizeFile(uri: string): Promise<OcrResult>;
  // puts plain text on the system clipboard
  copy(text: string): Promise<void>;
}

export default requireNativeModule<TextOcrModule>('TextOcr');
