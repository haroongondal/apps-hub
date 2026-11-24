// Only CC0 sounds: no credit is owed, so the app never has to print one.
// The query is built by hand: React Native's URL polyfill is incomplete.
export const FREESOUND_SEARCH_URL = 'https://freesound.org/apiv2/search/';
export const SONG_MIN_S = 15;
export const SONG_MAX_S = 600;
const PAGE_SIZE = 15;
// An empty search lists the most downloaded songs, so the panel has something to show before the person types.
const POPULAR_QUERY = 'music';

export interface SongHit { id: number; name: string; durationS: number; previewUrl: string }
export interface SongPage { hits: SongHit[]; hasMore: boolean }

export function songSearchUrl(query: string, token: string, page: number): string {
  const filter = `license:"Creative Commons 0" duration:[${SONG_MIN_S} TO ${SONG_MAX_S}]`;
  const typed = query.trim();
  const params: [string, string][] = [
    ['query', typed || POPULAR_QUERY], ['token', token.trim()], ['filter', filter],
    ['fields', 'id,name,duration,license,previews'], ['page', String(page)], ['page_size', String(PAGE_SIZE)],
  ];
  if (!typed) params.push(['sort', 'downloads_desc']);
  return `${FREESOUND_SEARCH_URL}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

export function parseSongPage(json: unknown): SongPage {
  if (typeof json !== 'object' || json === null) return { hits: [], hasMore: false };
  const body = json as { results?: unknown; next?: unknown };
  const results = Array.isArray(body.results) ? body.results : [];
  const hits: SongHit[] = [];
  for (const r of results) {
    if (typeof r !== 'object' || r === null) continue;
    const s = r as Record<string, unknown>;
    const previews = typeof s.previews === 'object' && s.previews !== null ? (s.previews as Record<string, unknown>) : {};
    const preview = previews['preview-hq-mp3'];
    const durationS = typeof s.duration === 'number' ? s.duration : NaN;
    if (typeof s.id !== 'number' || !Number.isInteger(s.id) || typeof s.name !== 'string') continue;
    if (s.license !== 'Creative Commons 0' || !(durationS > 0)) continue;
    if (typeof preview !== 'string' || !preview.startsWith('https://')) continue;
    hits.push({ id: s.id, name: s.name, durationS, previewUrl: preview });
  }
  return { hits, hasMore: typeof body.next === 'string' && body.next !== '' };
}
