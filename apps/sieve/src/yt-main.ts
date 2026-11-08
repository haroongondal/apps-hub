import { AD_KEYS, stripAds } from '@apps-hub/sieve-core/src/youtube-ads.ts';

// shortcut: settings arrive asynchronously, so player data YouTube reads before they do is stripped, even on an allowed channel and even when Sieve is off, paused, the site is allowlisted or the Ads list is off. Upgrade if the owner notices.
let told = false;
let on = true;
let allowed: ReadonlySet<string> = new Set();

const apply = Reflect.apply;
const nativeParse = JSON.parse;
const nativeJson = Response.prototype.json;
const dispatch = EventTarget.prototype.dispatchEvent;
const Custom = CustomEvent;
const KEYS = [...AD_KEYS, 'playerResponse', 'videoDetails'];

type Details = { channelId?: unknown; author?: unknown; videoId?: unknown };
type Player = { videoDetails?: Details; playerResponse?: { videoDetails?: Details } };

function isPlayer(v: unknown): v is Player {
  if (typeof v !== 'object' || v === null) return false;
  for (const key of KEYS) if (key in v) return true;
  return false;
}

function announce(p: Player): void {
  const d = p.videoDetails ?? p.playerResponse?.videoDetails;
  if (d) apply(dispatch, document, [new Custom('sieve-yt-channel', { detail: { id: String(d.channelId), name: String(d.author), videoId: String(d.videoId) } })]);
}

function clean<T>(value: T): T {
  if (!on || typeof value !== 'object' || value === null) return value;
  try {
    if (Array.isArray(value) ? value.length > 5 || !value.some(isPlayer) : !isPlayer(value)) return value;
    stripAds(value, allowed);
    for (const item of Array.isArray(value) ? value : [value]) if (isPlayer(item)) announce(item);
  } catch {}
  return value;
}

// Method shorthand, like the natives: no prototype, and `new` throws.
JSON.parse = {
  parse(_text: string, _reviver?: unknown) {
    return clean(apply(nativeParse, this, arguments));
  },
}.parse;
Response.prototype.json = {
  json() {
    return apply(nativeJson, this, arguments).then(clean);
  },
}.json;

// The inline `var ytInitialPlayerResponse = …` runs before the settings arrive, so a value set then is checked when first read.
let initial: unknown;
let unchecked = false;
Object.defineProperty(window, 'ytInitialPlayerResponse', {
  configurable: true,
  get() {
    if (unchecked) {
      unchecked = false;
      clean(initial);
    }
    return initial;
  },
  set(value: unknown) {
    initial = value;
    unchecked = !told;
    if (told) clean(value);
  },
});

document.addEventListener('sieve-yt-allow', (e) => {
  const detail = (e as CustomEvent<{ on?: unknown; ids?: unknown }>).detail;
  if (typeof detail?.on !== 'boolean' || !Array.isArray(detail.ids)) return;
  told = true;
  on = detail.on;
  allowed = new Set(detail.ids);
});
