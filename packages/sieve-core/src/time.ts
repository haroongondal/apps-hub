// '75', 'm:ss' or 'h:mm:ss' (seconds, and minutes after an hour, are two digits below 60). Anything else is null.
export function parseTime(text: string): number | null {
  const m = /^(?:(\d{1,7})|(\d{1,7}):([0-5]\d)|(\d{1,4}):([0-5]\d):([0-5]\d))$/.exec(text.trim());
  if (!m) return null;
  if (m[1] !== undefined) return Number(m[1]);
  if (m[2] !== undefined) return Number(m[2]) * 60 + Number(m[3]);
  return Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6]);
}

export function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return h ? `${h}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export interface LoopPart { start: number; end: number }

// Where to seek, or null to leave the video alone. `end` is clamped to the duration, so an open-ended part loops at the video's end.
export function loopSeek(t: number, part: LoopPart | null, duration: number): number | null {
  if (!part) return null;
  const end = Math.min(part.end, duration);
  return end > part.start && t >= end - 0.05 ? part.start : null;
}
