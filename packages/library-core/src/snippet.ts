export interface SnippetPart {
  text: string;
  hit: boolean;
}

/** Splits a search snippet at its U+0002 / U+0003 markers so the UI can emphasise the matched words. */
export function snippetParts(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  for (const piece of snippet.split(/(\x02[^\x03]*\x03?)/)) {
    if (piece.startsWith('\x02')) parts.push({ text: piece.slice(1).replace(/\x03$/, ''), hit: true });
    else if (piece) parts.push({ text: piece.replace(/[\x02\x03]/g, ''), hit: false });
  }
  return parts;
}
