export const ITEM_ID = /^[0-9a-z]{16}$/;

/** Directory names under library/ that look like item ids but have no row (start-up sweep). */
export function orphanDirs(dirNames: readonly string[], ids: ReadonlySet<string>): string[] {
  return dirNames.filter((name) => ITEM_ID.test(name) && !ids.has(name));
}
