import { EVENTS, readMainCommand, readMainSettings, type MainSettings, type MainState } from '@apps-hub/sieve-core/src/yt-bridge.ts';
import { PLAYER_API, SEL } from './selectors.ts';

// Copies taken before any page script runs: the page can replace the originals later.
const apply = Reflect.apply;
const dispatch = EventTarget.prototype.dispatchEvent;
const listen = EventTarget.prototype.addEventListener;
const query = Document.prototype.querySelector;
const Custom = CustomEvent;
const later = setTimeout;
const now = performance.now.bind(performance);
const warn = console.warn;
const fail = console.error;

export interface YtPlayer {
  getPlayerState(): number;
  getVideoData(): { video_id?: string; author?: string; title?: string; isPlayable?: boolean; errorCode?: string | null; video_quality?: string; isLive?: boolean; list?: string };
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
  getAvailableQualityLevels(): string[];
  getPlaybackQuality(): string;
  setPlaybackQuality(q: string): void;
  setPlaybackQualityRange(min: string, max: string): void;
  getVolume(): number;
  setVolume(v: number): void;
  isMuted(): boolean;
  mute(): void;
  unMute(): void;
  getPlaylist(): string[] | null;
  getPlaylistIndex(): number;
  playVideoAt(index: number): void;
  nextVideo(): void;
  stopVideo(): void;
  pauseVideo(): void;
  playVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  addEventListener(name: string, fn: (arg: unknown) => void): void;
}

const off = new Set<string>();
const settingsCbs: ((s: MainSettings) => void)[] = [];
const commands = new Map<string, ((value?: number | string) => void)[]>();
const videoCbs: ((videoId: string) => void)[] = [];
let settings: MainSettings | null = null;
let state: MainState = { videoId: null, title: '', rate: 1, quality: 'auto', qualities: [], volume: 100, muted: false, live: false, playlist: null };
let sentAt = -Infinity;
let pending = false;
let lastVideo: string | null = null;

function safely<A extends unknown[]>(cb: (...args: A) => void, ...args: A): void {
  try {
    cb(...args);
  } catch (e) {
    fail('Sieve: a YouTube feature failed', e);
  }
}

export function feature(name: string, init: () => void): void {
  try {
    init();
  } catch (e) {
    if (off.has(name)) return;
    off.add(name);
    warn(`Sieve: ${name} is off on this page`, e);
  }
}

export function onSettings(cb: (s: MainSettings) => void): void {
  settingsCbs.push(cb);
  if (settings) safely(cb, settings);
}

export function onCommand(action: string, cb: (value?: number | string) => void): void {
  commands.set(action, [...(commands.get(action) ?? []), cb]);
}

function flush(): void {
  pending = false;
  sentAt = now();
  apply(dispatch, document, [new Custom(EVENTS.state, { detail: state })]);
}

export function sendState(patch: Partial<MainState>): void {
  state = { ...state, ...patch };
  if (pending) return;
  pending = true;
  later(flush, Math.max(0, sentAt + 100 - now()));
}

export function player(): YtPlayer | null {
  const p = apply(query, document, [SEL.player]) as Record<string, unknown> | null;
  return p && PLAYER_API.every((name) => typeof p[name] === 'function') ? (p as unknown as YtPlayer) : null;
}

export function onVideo(cb: (videoId: string) => void): void {
  videoCbs.push(cb);
}

const on = (type: string, fn: (e: Event) => void, capture = false): void => apply(listen, document, [type, fn, capture]);
on(EVENTS.settings, (e) => {
  const s = readMainSettings((e as CustomEvent).detail);
  if (s === null) return;
  settings = s;
  for (const cb of settingsCbs) safely(cb, s);
});
on(EVENTS.do, (e) => {
  const c = readMainCommand((e as CustomEvent).detail);
  if (c) for (const cb of commands.get(c.action) ?? []) safely(cb, c.value);
});
on(
  'loadstart',
  () => {
    let id: unknown;
    try {
      id = player()?.getVideoData()?.video_id;
    } catch {}
    if (typeof id !== 'string' || id === lastVideo) return;
    lastVideo = id;
    for (const cb of videoCbs) safely(cb, id);
  },
  true,
);
apply(dispatch, document, [new Custom(EVENTS.hello)]);
