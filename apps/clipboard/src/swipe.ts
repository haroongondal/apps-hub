const DISTANCE = 0.35;
const FLING = 1;

/** -1 or 1 to delete toward that side, 0 to spring back. */
export function swipeDirection(dx: number, vx: number, width: number): -1 | 0 | 1 {
  if (Math.abs(dx) < width * DISTANCE && Math.abs(vx) < FLING) return 0;
  return (dx || vx) < 0 ? -1 : 1;
}

/** Only a clearly sideways drag swipes, so taps still copy and vertical drags still scroll. */
export function isSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) > 12 && Math.abs(dx) > 2 * Math.abs(dy);
}
