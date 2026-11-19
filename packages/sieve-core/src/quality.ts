import { isRecord } from './settings.ts';
import { QUALITIES, type Quality, type QualityChoice, type YouTubeSettings } from './youtube-settings.ts';
import type { YtPage } from './yt-bridge.ts';

export type QualityContext = 'videos' | 'playlists' | 'embeds';

export function qualityContext(page: YtPage): QualityContext {
  return page.kind === 'embed' ? 'embeds' : page.list ? 'playlists' : 'videos';
}

export function qualityTarget(ctx: QualityContext, fullscreen: boolean, q: YouTubeSettings['quality']): QualityChoice {
  const full = q[`${ctx}Full`];
  return fullscreen && full !== 'same' ? full : q[ctx];
}

// The highest known label at or below the target; when the offer has none that low, its lowest. `auto` and unknown labels are ignored.
export function pickQuality(available: readonly string[], target: Quality): Quality | null {
  const offered = QUALITIES.filter((l) => available.includes(l));
  const below = offered.filter((l) => QUALITIES.indexOf(l) <= QUALITIES.indexOf(target));
  return below.at(-1) ?? offered[0] ?? null;
}

export function parseMediaType(type: string): { mime: string; codecs: string[]; params: Record<string, string> } {
  const [head = '', ...rest] = String(type).split(';');
  const out: { mime: string; codecs: string[]; params: Record<string, string> } = { mime: head.trim().toLowerCase(), codecs: [], params: {} };
  for (const part of rest) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
    if (key === 'codecs') out.codecs = value.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
    else if (key) out.params[key] = value;
  }
  return out;
}

interface Options { h264: boolean; max30fps: boolean }
const NOT_H264 = /^(vp8|vp9|vp09|av01)(\.|$)/;
const tooFast = (fps: unknown): boolean => (typeof fps === 'string' || typeof fps === 'number') && fps !== '' && Number(fps) > 30;

// Only video is ever refused. Used for MediaSource.isTypeSupported's string.
export function refuseType(type: string, o: Options): boolean {
  if (!o.h264 && !o.max30fps) return false;
  const t = parseMediaType(type);
  if (!t.mime.startsWith('video/')) return false;
  return (o.h264 && t.codecs.some((c) => NOT_H264.test(c))) || (o.max30fps && tooFast(t.params.framerate));
}

// Used for MediaCapabilities.decodingInfo's configuration: the contentType string, and `video.framerate` as a number.
export function refuseConfig(config: unknown, o: Options): boolean {
  if (!isRecord(config) || !isRecord(config.video)) return false;
  const { contentType, framerate } = config.video;
  return (typeof contentType === 'string' && refuseType(contentType, o)) || (o.max30fps && tooFast(framerate));
}
