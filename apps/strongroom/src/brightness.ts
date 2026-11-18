// Runs setBright calls one after another, so a slow bright(true) can't land after a later bright(false).
// A failed bright(false) is retried once; a failed bright(true) is dropped, because brightness is cosmetic.
export function serialBrightness(setBright: (on: boolean) => Promise<unknown>): (on: boolean) => void {
  let chain: Promise<unknown> = Promise.resolve();
  return (on) => {
    chain = chain.then(() => setBright(on).catch(() => (on ? undefined : setBright(false))).catch(() => {}));
  };
}
