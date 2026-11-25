import { File, Paths } from 'expo-file-system';
import { DEFAULT_OCR_LANGUAGE, toOcrLanguage, type OcrLanguage } from 'text-ocr';

// The language the person last picked for reading text, kept in the app's own storage like ai_source.
const file = () => new File(Paths.document, 'ocr_language');

export function loadOcrLanguage(): OcrLanguage {
  try {
    const f = file();
    return f.exists ? toOcrLanguage(f.textSync().trim()) : DEFAULT_OCR_LANGUAGE;
  } catch {
    return DEFAULT_OCR_LANGUAGE; // unreadable: read English, as before
  }
}

export function saveOcrLanguage(lang: OcrLanguage): void {
  try {
    file().write(lang);
  } catch (err) {
    console.warn('Nexus could not save the text language', err); // the choice still applies until the app closes
  }
}
