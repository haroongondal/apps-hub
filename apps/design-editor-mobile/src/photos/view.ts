import type { Access } from './access-map.ts';
import type { SearchToolResult } from './search-tool.ts';

export type PhotosView = 'ask' | 'blocked' | 'get-tool' | 'getting-tool' | 'preparing' | 'search';

export function photosView(s: { access: Access; modelsReady: boolean; gettingTool: boolean; indexed: number; scanning: boolean }): PhotosView {
  if (s.access === 'none') return 'ask';
  if (s.access === 'blocked') return 'blocked';
  if (!s.modelsReady) return s.gettingTool ? 'getting-tool' : 'get-tool';
  return s.indexed === 0 && s.scanning ? 'preparing' : 'search';
}

export type ScanDecision = 'scan' | 'pending' | 'none';

// a new grant doesn't change the gallery stamp, so changed access always scans
export function scanDecision(s: { before: Access | null; access: Access; force: boolean; modelsReady: boolean; galleryChanged: boolean; active: boolean }): ScanDecision {
  if (s.access === 'none' || s.access === 'blocked' || !s.modelsReady) return 'none';
  const accessChanged = s.before !== null && s.before !== s.access;
  if (!s.force && !accessChanged && !s.galleryChanged) return 'none';
  return s.active ? 'scan' : 'pending';
}

export function toolResultText(r: SearchToolResult): string | null {
  switch (r) {
    case 'no-room': return 'Not enough space. Free up about 300 MB and try again.';
    case 'bad-download': return "The search tool didn't download correctly. Try again.";
    case 'offline': return 'The download stopped. Check your connection and try again.';
    default: return null;
  }
}

export function waitingText(w: 'heat' | 'battery' | null): string | null {
  if (w === 'heat') return 'Paused while your phone cools down. It carries on by itself.';
  if (w === 'battery') return 'Paused to save battery. It carries on when you charge or the battery is above 20%.';
  return null;
}

export const scanLine = (indexed: number, progress: number | null): string =>
  progress === null
    ? `${indexed.toLocaleString('en-US')} photos ready to search`
    : `Getting your photos ready · ${Math.round(progress * 100)}%`;
