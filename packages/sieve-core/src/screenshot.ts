import { formatTime } from './time.ts';

const MAX_TITLE = 120;
const PREFIX = 'data:image/png;base64,';

// `<title> <h-mm-ss or m-ss>.png`. The title is page text: `/` and `\` are replaced, so it cannot change the folder, and `..` cannot start a name.
export function screenshotName(title: string, seconds: number): string {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[. ]+/, '');
  const cut = [...clean].slice(0, MAX_TITLE).join('').trim();
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
