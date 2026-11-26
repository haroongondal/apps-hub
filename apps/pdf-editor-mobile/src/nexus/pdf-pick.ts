import type { Item } from '@apps-hub/library-core';

// The editor page reads the PDF through a base64 bridge that stalls near 40 MB (see open-item.ts).
export const MAX_INDEX_BYTES = 28 * 1024 * 1024;

export interface PickRules {
  hasPages(itemId: string): boolean;
  excluded: ReadonlySet<string>;
  tried: ReadonlySet<string>;
}

/** The next PDF whose text was never read: added by sharing, so no one has opened it in the editor yet. */
export function nextUnindexedPdf(items: readonly Item[], rules: PickRules): Item | null {
  return (
    items.find(
      (i) => i.kind === 'pdf' && i.sizeBytes <= MAX_INDEX_BYTES && !rules.excluded.has(i.id) && !rules.tried.has(i.id) && !rules.hasPages(i.id),
    ) ?? null
  );
}
