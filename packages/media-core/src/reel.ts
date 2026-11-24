import { addClip, addMusic, emptyProject, MAX_STILLS, type AudioSource, type Project, type Source } from './project.ts';

export const REEL_SECONDS = [2, 3, 5] as const;
export const MAX_REEL_PHOTOS = MAX_STILLS;
export const REEL_WIDTH = 720;
export const REEL_HEIGHT = 1280;

export interface DateWindow { fromMs: number; toMs: number }
export interface ReelQuery { words: string; window: DateWindow | null }
export interface TakenPhoto { uri: string; takenAt: number }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_WORD = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const FILLER = new Set(['from', 'in', 'on', 'during', 'of', 'at', 'taken', 'photos', 'photo', 'pictures', 'picture', 'pics', 'my', 'the', 'for', 'between']);
const DAY_RANGE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\s*(?:to|until|till|through|-|–)\s*(\d{4})-(\d{1,2})-(\d{1,2})\b/;

const at = (y: number, m: number, d: number) => new Date(y, m, d).getTime();
const days = (y: number, m: number, d: number, n: number): DateWindow => ({ fromMs: at(y, m, d), toMs: at(y, m, d + n) });

function realDay(y: number, m: number, d: number): boolean {
  const t = new Date(y, m, d);
  return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
}

type Rule = { re: RegExp; window: (m: RegExpExecArray, now: Date) => DateWindow | null };

const RULES: Rule[] = [
  {
    re: DAY_RANGE,
    window: m => {
      const [a, b] = [[+m[1], +m[2] - 1, +m[3]], [+m[4], +m[5] - 1, +m[6]]] as const;
      if (!realDay(...a) || !realDay(...b)) return null;
      const [first, last] = at(...a) <= at(...b) ? [a, b] : [b, a];
      return { fromMs: at(...first), toMs: at(last[0], last[1], last[2] + 1) };
    },
  },
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, window: m => (realDay(+m[1], +m[2] - 1, +m[3]) ? days(+m[1], +m[2] - 1, +m[3], 1) : null) },
  { re: /\btoday\b/, window: (_, n) => days(n.getFullYear(), n.getMonth(), n.getDate(), 1) },
  { re: /\byesterday\b/, window: (_, n) => days(n.getFullYear(), n.getMonth(), n.getDate() - 1, 1) },
  {
    // On a Saturday or Sunday "this weekend" is the one under way; on a weekday it is the coming one, and "last weekend" the one just gone.
    re: /\b(this|last) weekend\b/,
    window: (m, n) => {
      const dow = n.getDay();
      const sinceSat = dow === 6 ? 0 : dow === 0 ? 1 : null;
      const sat = sinceSat !== null ? n.getDate() - sinceSat : n.getDate() + (6 - dow);
      return days(n.getFullYear(), n.getMonth(), m[1] === 'last' ? sat - 7 : sat, 2);
    },
  },
  {
    re: /\b(this|last) (week|month|year)\b/,
    window: (m, n) => {
      const back = m[1] === 'last' ? 1 : 0;
      if (m[2] === 'year') return { fromMs: at(n.getFullYear() - back, 0, 1), toMs: at(n.getFullYear() - back + 1, 0, 1) };
      if (m[2] === 'month') return { fromMs: at(n.getFullYear(), n.getMonth() - back, 1), toMs: at(n.getFullYear(), n.getMonth() - back + 1, 1) };
      const monday = n.getDate() - ((n.getDay() + 6) % 7) - 7 * back;
      return days(n.getFullYear(), n.getMonth(), monday, 7);
    },
  },
  {
    re: /\b(?:last|past) (\d{1,3}) days\b/,
    window: (m, n) => {
      const count = +m[1];
      if (count < 1 || count > 366) return null;
      return { fromMs: at(n.getFullYear(), n.getMonth(), n.getDate() - (count - 1)), toMs: at(n.getFullYear(), n.getMonth(), n.getDate() + 1) };
    },
  },
  {
    // A month without a year is the latest one that has begun: in November, "march" is this March and "december" last December.
    re: new RegExp(`\\b(${MONTH_WORD})(?:\\s+(\\d{4}))?\\b`),
    window: (m, n) => {
      const month = MONTHS.indexOf(m[1].slice(0, 3));
      const year = m[2] ? +m[2] : month > n.getMonth() ? n.getFullYear() - 1 : n.getFullYear();
      return { fromMs: at(year, month, 1), toMs: at(year, month + 1, 1) };
    },
  },
];

function trimFiller(text: string): string {
  const words = text.split(' ').filter(Boolean);
  while (words.length && FILLER.has(words[0])) words.shift();
  while (words.length && FILLER.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

export function parseReelQuery(text: string, now: Date): ReelQuery {
  const clean = text.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const rule of RULES) {
    const m = rule.re.exec(clean);
    const window = m && rule.window(m, now);
    if (!m || !window) continue;
    return { words: trimFiller(`${clean.slice(0, m.index)} ${clean.slice(m.index + m[0].length)}`), window };
  }
  return { words: trimFiller(clean), window: null };
}

const dayText = (ms: number) => {
  const d = new Date(ms);
  const month = MONTHS[d.getMonth()];
  return `${d.getDate()} ${month[0].toUpperCase()}${month.slice(1)} ${d.getFullYear()}`;
};

export function windowText(w: DateWindow): string {
  const first = dayText(w.fromMs);
  const last = dayText(w.toMs - 1);
  return first === last ? first : `${first} to ${last}`;
}

export function pickReelPhotos(found: TakenPhoto[], ranked: string[] | null): { photos: TakenPhoto[]; more: number } {
  const seen = new Set<string>();
  const unique = found.filter(p => !seen.has(p.uri) && !!seen.add(p.uri));
  const byTime = (a: TakenPhoto, b: TakenPhoto) => a.takenAt - b.takenAt;
  let kept: TakenPhoto[];
  if (ranked) {
    const place = new Map(ranked.map((u, i) => [u, i]));
    kept = unique.filter(p => place.has(p.uri)).sort((a, b) => place.get(a.uri)! - place.get(b.uri)!).slice(0, MAX_REEL_PHOTOS);
  } else {
    const all = [...unique].sort(byTime);
    kept = all.length <= MAX_REEL_PHOTOS ? all : Array.from({ length: MAX_REEL_PHOTOS }, (_, i) => all[Math.floor((i * all.length) / MAX_REEL_PHOTOS)]);
  }
  return { photos: [...kept].sort(byTime), more: unique.length - kept.length };
}

export function stillSource(uri: string, name: string, secondsEach: number): Source {
  return { uri, name, durationS: secondsEach, width: REEL_WIDTH, height: REEL_HEIGHT, fps: 30, hasAudio: false, still: true };
}

export function reelProject(uris: string[], secondsEach: number, name: string, song?: AudioSource): Project {
  const photos = uris.reduce((p, uri, i) => addClip(p, stillSource(uri, `Photo ${i + 1}`, secondsEach), `p${i}`), emptyProject(name));
  return song ? addMusic(photos, song, 'song', 0) : photos;
}
