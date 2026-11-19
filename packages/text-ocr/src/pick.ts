// Pure helpers over the lines the native recognizer returns. Coordinates are pixels of the
// image as it was decoded (EXIF rotation applied), origin top-left.
export interface OcrLine { text: string; left: number; top: number; right: number; bottom: number }
export interface OcrResult { width: number; height: number; lines: OcrLine[] }

const edgeDistance = (l: OcrLine, x: number, y: number) =>
  Math.hypot(Math.max(l.left - x, 0, x - l.right), Math.max(l.top - y, 0, y - l.bottom));

// The line under a press. A fingertip is imprecise, so a line counts as hit when the point is
// inside its box or within half a line height of it; the closest such line wins, ties go to the
// one whose centre is nearer.
export function pickLine(lines: OcrLine[], x: number, y: number): OcrLine | null {
  let best: OcrLine | null = null;
  let bestKey = [Infinity, Infinity];
  for (const l of lines) {
    const d = edgeDistance(l, x, y);
    if (d > (l.bottom - l.top) / 2) continue;
    const key = [d, Math.hypot((l.left + l.right) / 2 - x, (l.top + l.bottom) / 2 - y)];
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) { best = l; bestKey = key; }
  }
  return best;
}

export const allText = (lines: OcrLine[]): string =>
  lines.map(l => l.text.trim()).filter(Boolean).join('\n');
