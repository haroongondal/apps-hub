// About 6 pages of CV. The text lands in the "About you" field, so the owner sees where it was cut.
export const MAX_IMPORT_CHARS = 12_000;

export const NO_TEXT_PDF = "This PDF has no text Nexus can read. It may be a scan. Import a photo of it instead, or type the details.";
export const NO_TEXT_PHOTO =
  "Nexus couldn't read any text in that photo. It reads English text on this phone, not Arabic or Urdu yet. Try a clearer photo, or type the details.";

export interface Cleaned {
  text: string;
  cut: boolean;
}

export function cleanImport(raw: string, max = MAX_IMPORT_CHARS): Cleaned {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const chars = Array.from(text);
  if (chars.length <= max) return { text, cut: false };
  const head = chars.slice(0, max).join('');
  const line = head.lastIndexOf('\n');
  return { text: (line > head.length / 2 ? head.slice(0, line) : head).trimEnd(), cut: true };
}

export function pdfText(pagesJson: string | null): string | null {
  if (pagesJson === null) return null;
  let pages: unknown;
  try {
    pages = JSON.parse(pagesJson);
  } catch {
    return null;
  }
  if (!Array.isArray(pages)) return null;
  const text = pages.filter((p): p is string => typeof p === 'string').join('\n\n');
  return text.trim() === '' ? null : text;
}

export interface Candidate<T> {
  item: T;
  keptOut: boolean;
}

// Kept-out items stay in the list, marked, so the owner can pick one on purpose.
export async function candidates<T extends { id: string }>(
  items: readonly T[],
  o: { hasText: (item: T) => Promise<boolean>; excluded: ReadonlySet<string> },
): Promise<Candidate<T>[]> {
  const out: Candidate<T>[] = [];
  for (const item of items) if (await o.hasText(item)) out.push({ item, keptOut: o.excluded.has(item.id) });
  return out;
}

export async function photoText(uri: string, recognize: (uri: string) => Promise<string>): Promise<string> {
  const text = (await recognize(uri)).trim();
  if (text === '') throw new Error(NO_TEXT_PHOTO);
  return text;
}

export interface Imported extends Cleaned {
  from: string;
  keptOut: boolean;
  added: boolean;
}

export function describeImport(i: Imported): string {
  const parts = [`Filled from ${i.from}.`];
  if (i.added) parts.push('It is now in your Library, kept out of Nexus. Add it to Nexus from its menu if you want it there.');
  if (i.keptOut) parts.push('You kept it out of Nexus. Nexus read it for this CV because you picked it, and it stays kept out.');
  if (i.cut) parts.push(`Only the first ${MAX_IMPORT_CHARS.toLocaleString('en-GB')} characters were used.`);
  return parts.join(' ');
}
