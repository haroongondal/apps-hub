const A4 = { w: 595.28, h: 841.89 };
const LETTER = { w: 612, h: 792 };
const TOLERANCE = 0.03;

/** SPEC §8 "Page size": A4 or Letter when the aspect is within 3%, otherwise a long side of 841.89 pt. */
export function pageSizePt(widthPx: number, heightPx: number): { w: number; h: number } {
  const landscape = widthPx > heightPx;
  const aspect = Math.max(widthPx, heightPx) / Math.min(widthPx, heightPx);
  const near = (target: number) => Math.abs(aspect / target - 1) <= TOLERANCE;
  let short: number;
  let long: number;
  if (near(Math.SQRT2)) ({ w: short, h: long } = A4);
  else if (near(11 / 8.5)) ({ w: short, h: long } = LETTER);
  else {
    long = A4.h;
    short = Math.round((long / aspect) * 100) / 100;
  }
  return landscape ? { w: long, h: short } : { w: short, h: long };
}
