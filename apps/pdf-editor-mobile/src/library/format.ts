import type { Item, ItemKind } from '@apps-hub/library-core';

export const KIND_LABEL: Record<ItemKind, string> = { pdf: 'PDF', scan: 'Scan', article: 'Article' };
export const KIND_PLURAL: Record<ItemKind, string> = { pdf: 'PDFs', scan: 'Scans', article: 'Articles' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

/** "Scan · 12 pages · 31 Oct · 6.1 MB" */
export function describeItem(item: Item): string {
  return [
    KIND_LABEL[item.kind],
    item.pageCount === null ? null : plural(item.pageCount, 'page'),
    formatDate(item.updatedAt),
    formatBytes(item.sizeBytes),
  ]
    .filter(Boolean)
    .join(' · ');
}
