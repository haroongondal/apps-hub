import { normalizeForSearch } from './normalize.ts';

const MAX_TOKENS = 8;

/**
 * "Invo café" → '"Invo"* "café"*'. Null for blank input (list mode). Quoting makes FTS5
 * operators literal; tokens are ANDed. Normalised like the indexed text (SPEC §4.3).
 */
export function ftsQuery(input: string): string | null {
  const tokens = normalizeForSearch(input)
    .split(/\s+/)
    .filter(Boolean) // also drops a token that normalised to nothing, e.g. a lone tatweel
    .slice(0, MAX_TOKENS)
    .map((token) => `"${token.replace(/"/g, '""')}"*`);
  return tokens.length ? tokens.join(' ') : null;
}
