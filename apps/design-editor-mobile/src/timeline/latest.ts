export function createLatest<T>(): (p: Promise<T>) => Promise<T | undefined> {
  let current = 0;
  return async p => {
    const mine = ++current;
    try {
      const value = await p;
      return mine === current ? value : undefined;
    } catch (e) {
      if (mine === current) throw e;
      return undefined;
    }
  };
}
