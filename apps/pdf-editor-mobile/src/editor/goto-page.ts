import type { Locator } from '@apps-hub/knowledge-core';

export function citedPage(locator: Locator): number | null {
  if (!locator || !('page' in locator)) return null;
  return Number.isInteger(locator.page) && locator.page >= 1 ? locator.page : null;
}

export function pageParam(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const page = Number(value);
  return page >= 1 ? page : null;
}

export const clampPage = (page: number, pageCount: number) => Math.min(Math.max(1, Math.trunc(page)), Math.max(1, pageCount));

// Handed out once, on the first load: a failed load drops it, and a PDF opened later in the same editor never jumps.
export function pendingPage(page: number | null) {
  let waiting = page;
  return {
    take(loaded: { ok: boolean; pages?: number }): number | null {
      const target = waiting;
      waiting = null;
      if (target === null || !loaded.ok || !loaded.pages) return null;
      return clampPage(target, loaded.pages);
    },
  };
}
