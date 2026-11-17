import type { CardSide, ScanMode, ScanSession, SessionPage } from './session-data';

/** The side the next photo shows: null in document mode, 'full' when a card already has both. */
export function nextSide(mode: ScanMode, pages: readonly SessionPage[]): CardSide | 'full' | null {
  if (mode !== 'card') return null;
  if (pages.length >= 2) return 'full';
  if (pages.some((p) => p.side === 'front')) return 'back';
  if (pages.some((p) => p.side === 'back')) return 'front';
  return pages.length === 0 ? 'front' : 'back';
}

export const canSwitchMode = (session: ScanSession) => session.pages.length === 0;

const RANK = { front: 0, back: 1 } as const;

export const sortCardPages = (pages: readonly SessionPage[]): SessionPage[] =>
  [...pages].sort((a, b) => (a.side ? RANK[a.side] : 2) - (b.side ? RANK[b.side] : 2));

/** A sheet holds one or two cards; anything else saves as separate pages. */
export const sheetChoice = (s: ScanSession) => s.mode === 'card' && s.sheet && s.pages.length >= 1 && s.pages.length <= 2;

/** Preview file name (processPage adds .jpg). The stamp keeps it unique across review sessions, which restart the counter. */
export const previewName = (now: number, n: number) => `prev-${now.toString(36)}-${n}`;
