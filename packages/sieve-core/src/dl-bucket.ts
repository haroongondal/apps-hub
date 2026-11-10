export const MIN_GRANT = 1024; // bytes; the smallest slice worth waiting for

/** rate in bytes per second; Infinity = no limit */
export interface Bucket {
  rate: number;
  burst: number;
  tokens: number;
  at: number;
}

// NaN, 0 and negatives mean no limit.
const limit = (rate: number) => (Number.isFinite(rate) && rate > 0 ? rate : Infinity);
const burstFor = (rate: number) => (rate === Infinity ? Infinity : Math.max(65_536, Math.floor(rate / 4)));

function refill(b: Bucket, now: number): void {
  // no arithmetic with an Infinity rate: Infinity * 0 is NaN and would poison a later setRate
  if (b.rate === Infinity) b.tokens = Infinity;
  else b.tokens = Math.min(b.burst, b.tokens + (b.rate * Math.max(0, now - b.at)) / 1000);
  b.at = now;
}

export function makeBucket(rate: number, now: number): Bucket {
  const r = limit(rate);
  const burst = burstFor(r);
  return { rate: r, burst, tokens: burst, at: now };
}

export function setRate(b: Bucket, rate: number, now: number): void {
  refill(b, now);
  b.rate = limit(rate);
  b.burst = burstFor(b.rate);
  b.tokens = Math.min(b.tokens, b.burst);
}

export function take(b: Bucket, want: number, now: number): { grant: number; waitMs: number } {
  refill(b, now);
  if (!(want > 0)) return { grant: 0, waitMs: 0 };
  if (b.rate === Infinity) return { grant: want, waitMs: 0 };
  const need = Math.min(want, MIN_GRANT);
  if (b.tokens < need) return { grant: 0, waitMs: Math.ceil(((need - b.tokens) / b.rate) * 1000) };
  const grant = Math.min(want, Math.floor(b.tokens));
  b.tokens -= grant;
  return { grant, waitMs: 0 };
}

export interface Meter {
  windowMs: number;
  startedAt: number;
  samples: { t: number; n: number }[];
}

export function makeMeter(now: number, windowMs = 5000): Meter {
  return { windowMs, startedAt: now, samples: [] };
}

function prune(m: Meter, now: number): void {
  const from = now - m.windowMs;
  while (m.samples.length && m.samples[0].t < from) m.samples.shift();
}

export function addBytes(m: Meter, n: number, now: number): void {
  m.samples.push({ t: now, n });
  prune(m, now);
}

/** bytes per second */
export function rate(m: Meter, now: number): number {
  prune(m, now);
  if (!m.samples.length) return 0;
  const span = Math.min(m.windowMs, Math.max(1000, now - m.startedAt));
  return m.samples.reduce((s, x) => s + x.n, 0) / (span / 1000);
}
