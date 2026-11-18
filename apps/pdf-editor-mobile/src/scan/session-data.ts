import type { Quad } from 'pdf-scan';

export type Rotation = 0 | 90 | 180 | 270;
export type PageFilter = 'original' | 'auto' | 'gray' | 'bw';

export type ScanMode = 'document' | 'card';
export type CardSide = 'front' | 'back';

export interface SessionPage {
  file: string;
  quad: Quad | null;
  rotation: Rotation;
  filter: PageFilter;
  /** Card mode only: which side of the card this photo shows. */
  side: CardSide | null;
}

/** scan-session/session.json (SPEC §7.1). */
export interface ScanSession {
  version: 1;
  startedAt: number;
  folderId: string | null;
  appendTo: string | null;
  mode: ScanMode;
  /** Card mode: save front and back as one A4 sheet instead of two pages. */
  sheet: boolean;
  pages: SessionPage[];
}

const CAPTURE = /^cap-(\d+)\.jpg$/;

export const newSession = (folderId: string | null, now: number, mode: ScanMode = 'document'): ScanSession => ({
  version: 1,
  startedAt: now,
  folderId,
  appendTo: null,
  mode,
  sheet: false,
  pages: [],
});

export const newPage = (file: string, quad: Quad | null, side: CardSide | null = null): SessionPage => ({
  file,
  quad,
  rotation: 0,
  filter: 'auto',
  side,
});

/** The session without the page stored in [file]; the same session when there is no such page. */
export function withoutPage(session: ScanSession, file: string): ScanSession {
  if (!session.pages.some((p) => p.file === file)) return session;
  return { ...session, pages: session.pages.filter((p) => p.file !== file) };
}

export const fileNameOf = (uri: string) => decodeURIComponent(uri.replace(/\/+$/, '').split('/').pop() ?? '');

function parse(json: string | null): ScanSession | null {
  if (json === null) return null;
  try {
    const v = JSON.parse(json) as ScanSession;
    if (v?.version !== 1 || !Array.isArray(v.pages) || !v.pages.every((p) => typeof p?.file === 'string')) return null;
    // A session saved before card mode has no mode, sheet or side.
    return {
      ...v,
      mode: v.mode === 'card' ? 'card' : 'document',
      sheet: v.sheet === true,
      pages: v.pages.map((p) => ({ ...p, side: p.side === 'front' || p.side === 'back' ? p.side : null })),
    };
  } catch {
    return null;
  }
}

/**
 * The session as the files on disk say it is: pages whose file is gone are dropped, and a
 * capture written by the camera but missing from the JSON (the app died between the two
 * writes) is added at the end. Unreadable JSON is rebuilt from the captures alone.
 */
export function restoreSession(json: string | null, files: string[], now: number): ScanSession | null {
  const captures = files
    .filter((f) => CAPTURE.test(f))
    .sort((a, b) => Number(CAPTURE.exec(a)![1]) - Number(CAPTURE.exec(b)![1]));
  const session = parse(json) ?? (captures.length > 0 ? newSession(null, now) : null);
  if (!session) return null;
  const present = new Set(files);
  const pages = session.pages.filter((p) => present.has(p.file));
  const known = new Set(pages.map((p) => p.file));
  for (const f of captures) if (!known.has(f)) pages.push(newPage(f, null));
  return { ...session, pages };
}
