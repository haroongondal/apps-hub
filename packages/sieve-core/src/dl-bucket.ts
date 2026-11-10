export const MIN_GRANT = 1024; // bytes; the smallest slice worth waiting for

/** rate in bytes per second; Infinity = no limit */
export interface Bucket {
  rate: number;
  burst: number;
  tokens: number;
  at: number;
}

export function makeBucket(_rate: number, _now: number): Bucket {
  throw new Error('not implemented');
}

export function setRate(_b: Bucket, _rate: number, _now: number): void {
  throw new Error('not implemented');
}

export function take(_b: Bucket, _want: number, _now: number): { grant: number; waitMs: number } {
  throw new Error('not implemented');
}

export interface Meter {
  windowMs: number;
  startedAt: number;
  samples: { t: number; n: number }[];
}

/** windowMs defaults to 5000 */
export function makeMeter(_now: number, _windowMs?: number): Meter {
  throw new Error('not implemented');
}

export function addBytes(_m: Meter, _n: number, _now: number): void {
  throw new Error('not implemented');
}

/** bytes per second */
export function rate(_m: Meter, _now: number): number {
  throw new Error('not implemented');
}
