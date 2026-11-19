// The page sees and can forge every `sieve-yt-*` event, so each `detail` goes through a reader here before use.
import { isRecord } from './settings.ts';
import { QUALITIES, validateYouTube, type Quality, type YouTubeSettings } from './youtube-settings.ts';

export type YtPageKind = 'watch' | 'browse' | 'shorts' | 'embed' | 'chat' | 'other';
export interface YtPage { kind: YtPageKind; videoId: string | null; list: string | null }

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const id = (v: string | null | undefined): string | null => (v && VIDEO_ID.test(v) ? v : null);

export function ytPage(url: string): YtPage {
  const other: YtPage = { kind: 'other', videoId: null, list: null };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return other;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return other;
  const list = LIST_ID.test(u.searchParams.get('list') ?? '') ? u.searchParams.get('list') : null;
  const [, first = '', second] = u.pathname.split('/');
  if (first === 'embed' && (u.hostname === 'www.youtube.com' || u.hostname === 'www.youtube-nocookie.com')) return { kind: 'embed', videoId: id(second), list };
  if (u.hostname !== 'www.youtube.com') return other;
  if (u.pathname === '/watch') return { kind: 'watch', videoId: id(u.searchParams.get('v')), list };
  if (first === 'shorts') return { kind: 'shorts', videoId: id(second), list: null };
  if (first === 'live_chat' || first === 'live_chat_replay') return { kind: 'chat', videoId: null, list: null };
  return { kind: 'browse', videoId: null, list: null };
}

// YouTube's own scripts can read these, so they hold only what the main world needs.
export interface MainSettings {
  on: boolean; // youtube.on, never settings.enabled
  speed: YouTubeSettings['speed'];
  volume: { setDefault: boolean; level: number; step: number };
  quality: YouTubeSettings['quality'];
  experiments: YouTubeSettings['experiments'];
}

export function mainSettings(y: YouTubeSettings, on: boolean): MainSettings {
  const { setDefault, level, step } = y.volume;
  return { on, speed: { ...y.speed }, volume: { setDefault, level, step }, quality: { ...y.quality }, experiments: { presets: [...y.experiments.presets], overrides: y.experiments.overrides } };
}

export function readMainSettings(detail: unknown): MainSettings | null {
  if (!isRecord(detail) || typeof detail.on !== 'boolean') return null;
  return mainSettings(validateYouTube({ speed: detail.speed, volume: detail.volume, quality: detail.quality, experiments: detail.experiments }), detail.on);
}

export interface MainState {
  videoId: string | null;
  title: string;
  rate: number;
  quality: string;
  qualities: Quality[];
  volume: number;
  muted: boolean;
  live: boolean;
  playlist: { index: number; length: number; reversed: boolean } | null;
}

const clamp = (v: unknown, min: number, max: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const isQuality = (v: unknown): v is Quality => (QUALITIES as readonly unknown[]).includes(v);
const int = (v: unknown, min: number, max: number): number | null => (Number.isInteger(v) ? Math.min(max, Math.max(min, v as number)) : null);

export function readMainState(detail: unknown): MainState | null {
  if (!isRecord(detail)) return null;
  const p = detail.playlist;
  const index = isRecord(p) ? int(p.index, -1, 10_000) : null;
  const length = isRecord(p) ? int(p.length, 0, 10_000) : null;
  return {
    videoId: typeof detail.videoId === 'string' ? id(detail.videoId) : null,
    title: typeof detail.title === 'string' ? detail.title.slice(0, 300) : '',
    rate: clamp(detail.rate, 0.1, 16, 1),
    quality: detail.quality === 'auto' || isQuality(detail.quality) ? detail.quality : 'auto',
    qualities: Array.isArray(detail.qualities) ? [...new Set(detail.qualities.filter(isQuality))] : [],
    volume: clamp(detail.volume, 0, 100, 100),
    muted: detail.muted === true,
    live: detail.live === true,
    playlist: isRecord(p) && index !== null && length !== null ? { index, length, reversed: p.reversed === true } : null,
  };
}

export interface MainCommand { action: string; value?: number | string }

export function readMainCommand(detail: unknown): MainCommand | null {
  if (!isRecord(detail) || typeof detail.action !== 'string' || !/^[a-z0-9-]{1,64}$/.test(detail.action)) return null;
  const v = detail.value;
  if ((typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 100)) return { action: detail.action, value: v };
  return { action: detail.action };
}

export const EVENTS = { hello: 'sieve-yt-hello', settings: 'sieve-yt-settings', do: 'sieve-yt-do', state: 'sieve-yt-state' } as const;
