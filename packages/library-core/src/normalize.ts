// Harakat U+064B–U+065F and U+0670, tatweel U+0640, ZWNJ U+200C, ZWJ U+200D.
const STRIPPED = /[\u{064B}-\u{065F}\u{0670}\u{0640}\u{200C}\u{200D}]/gu;

/**
 * Folds text the way the FTS index does (SPEC §4.3), so Arabic and Urdu spellings that differ
 * only in marks, joiners or the yeh/kaf variants match. Latin text changes only through NFKC.
 */
export function normalizeForSearch(text: string): string {
  // Hermes is assumed to have normalize(); if it doesn't, the explicit maps below still run.
  const folded = typeof text.normalize === 'function' ? text.normalize('NFKC') : text;
  return folded
    .replace(STRIPPED, '')
    .replace(/\u{064A}/gu, '\u{06CC}') // Arabic yeh → Persian/Urdu yeh
    .replace(/\u{0643}/gu, '\u{06A9}'); // Arabic kaf → Persian/Urdu kaf
}
