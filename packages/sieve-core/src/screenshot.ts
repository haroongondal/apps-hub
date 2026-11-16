import { formatTime } from './time.ts';

const MAX_TITLE = 120;
const utf8 = new TextEncoder();
const MAX_TITLE_BYTES = 200; // file names are at most 255 bytes; this leaves room for the time, .png and Chrome's " (1)"
const PREFIX = 'data:image/png;base64,';

// `<title> <h-mm-ss or m-ss>.png`. The title is page text: `/` and `\` are replaced, so it cannot change the folder, and `..` cannot start a name.
// Chrome also refuses `~`, control characters and format characters (joiners, direction marks): the first two become a space, the last are dropped so joined text stays joined.
// Lone surrogates and private-use characters become a space too.
export function screenshotName(title: string, seconds: number): string {
  const clean = title.replace(/\p{Cf}+/gu, '').replace(/[\\/:*?"<>|~\p{Cc}\p{Cs}\p{Co}]+/gu, ' ').replace(/\s+/g, ' ').replace(/^[. ]+/, '');
  let cut = '';
  let bytes = 0;
  for (const ch of [...clean].slice(0, MAX_TITLE)) {
    bytes += utf8.encode(ch).length;
    if (bytes > MAX_TITLE_BYTES) break;
    cut += ch;
  }
  cut = cut.trim();
  return `${cut || 'YouTube video'} ${formatTime(seconds).replaceAll(':', '-')}.png`;
}

export const isPngDataUrl = (s: unknown, maxBytes: number): s is string => typeof s === 'string' && s.startsWith(PREFIX) && s.length <= maxBytes;

// The video's computed `transform`: Sieve's own flip is a scale, so the signs of the x and y scale are the flips.
export function flipFromMatrix(transform: string): { h: boolean; v: boolean } {
  const m = /^matrix(3d)?\(([^)]*)\)$/.exec(transform.trim());
  const n = m ? m[2].split(',').map(Number) : [];
  const [a, d] = m?.[1] ? [n[0], n[5]] : [n[0], n[3]];
  return { h: a < 0, v: d < 0 };
}
