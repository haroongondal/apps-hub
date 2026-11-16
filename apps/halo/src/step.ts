/** One stepper press: snaps to the step grid, rounds off float noise, clamps to the range. */
export function stepValue(value: number, dir: 1 | -1, min: number, max: number, step: number): number {
  const next = Number((Math.round((value + dir * step) / step) * step).toFixed(3));
  return Math.min(max, Math.max(min, next));
}
