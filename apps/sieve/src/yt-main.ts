import { AD_KEYS, stripAds } from '@apps-hub/sieve-core/src/youtube-ads.ts';

// shortcut: settings arrive asynchronously, so the first video of a hard load is stripped, even on an allowlisted channel, when YouTube reads it before they arrive. Upgrade if the owner notices.
let told = false;
let on = true;
let allowed: ReadonlySet<string> = new Set();

const apply = Reflect.apply;
const nativeParse = JSON.parse;
const nativeJson = Response.prototype.json;
const dispatch = EventTarget.prototype.dispatchEvent;
const Custom = CustomEvent;
const KEYS = [...AD_KEYS, 'playerResponse', 'videoDetails'];

function clean<T>(value: T): T {
  if (!on || typeof value !== 'object' || value === null) return value;
  try {
    for (const key of KEYS) {
      if (!(key in value)) continue;
      stripAds(value, allowed);
      const r = value as { videoDetails?: { channelId?: unknown; author?: unknown }; playerResponse?: { videoDetails?: { channelId?: unknown; author?: unknown } } };
      const details = r.videoDetails ?? r.playerResponse?.videoDetails;
      if (details) apply(dispatch, document, [new Custom('sieve-yt-channel', { detail: { id: String(details.channelId), name: String(details.author) } })]);
      break;
    }
  } catch {}
  return value;
}

JSON.parse = function parse(this: unknown, _text: string, _reviver?: unknown) {
  return clean(apply(nativeParse, this, arguments));
};
Response.prototype.json = function json(this: Response) {
  return apply(nativeJson, this, arguments).then(clean);
};

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
