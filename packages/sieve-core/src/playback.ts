// Speed, volume and mouse-wheel arithmetic for the YouTube tools (pure, so node --test runs it).
export const MIN_RATE = 0.1;
export const MAX_RATE = 16;

const EPS = 1e-9;
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const tidy = (v: number): number => Math.round(v * 1000) / 1000; // 0.1 × 3 is 0.30000000000000004

// The next rate up or down. With `anySpeed` (or no list of rates) it is the next multiple of `step`, so 1.1 goes to 1.25 or 1;
// otherwise the next of YouTube's own rates, staying where it is at the end of the list.
export function nextSpeed(current: number, dir: 1 | -1, o: { step: number; anySpeed: boolean; rates: readonly number[] }): number {
  if (!o.anySpeed && o.rates.length) {
    const rates = [...o.rates].sort((a, b) => a - b);
    const beyond = dir === 1 ? rates.filter((r) => r > current + EPS) : rates.filter((r) => r < current - EPS);
    // At the end of the list the speed stays, so Faster never lowers a speed set above the list (any speed was on before) and Slower never raises one.
    return (dir === 1 ? beyond[0] ?? Math.max(current, rates.at(-1)!) : beyond.at(-1) ?? Math.min(current, rates[0]!));
  }
  const k = current / o.step;
  const whole = Math.abs(k - Math.round(k)) < 1e-6 ? Math.round(k) : k;
  return clamp(tidy((dir === 1 ? Math.floor(whole) + 1 : Math.ceil(whole) - 1) * o.step), MIN_RATE, MAX_RATE);
}

// The nearest rate; a tie goes to the lower one.
export function snapSpeed(rate: number, rates: readonly number[]): number {
  let best = rate;
  let gap = Infinity;
  for (const r of [...rates].sort((a, b) => a - b)) {
    if (Math.abs(r - rate) < gap - EPS) {
      best = r;
      gap = Math.abs(r - rate);
    }
  }
  return best;
}

export const formatSpeed = (rate: number): string => `${Number(rate.toFixed(2))}×`;

export const nextVolume = (current: number, dir: 1 | -1, step: number): number => clamp(current + dir * step, 0, 100);

export interface WheelState { acc: number; at: number }

// Adds one wheel event to `s` (changed in place) and says whether it made a step: +1 for a wheel up (faster, louder), -1 for down, flipped by `reverse`.
export function wheelSteps(s: WheelState, deltaY: number, deltaMode: number, now: number, reverse: boolean): -1 | 0 | 1 {
  const px = deltaY * (deltaMode === 1 ? 40 : deltaMode === 2 ? 800 : 1);
  if (px === 0) return 0;
  if (now - s.at > 300 || Math.sign(px) !== Math.sign(s.acc)) s.acc = 0;
  s.acc += px;
  s.at = now;
  if (Math.abs(s.acc) < 50) return 0;
  const up = s.acc < 0;
  s.acc = 0;
  return up !== reverse ? 1 : -1;
}
