export const MAX_LINKS = 500;

export function normaliseLinks(hrefs: readonly string[], max = MAX_LINKS): string[] {
  const out = new Set<string>();
  for (const h of hrefs) {
    if (out.size >= max) break;
    try {
      const u = new URL(h);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.add(u.href);
    } catch {
      // not a URL
    }
  }
  return [...out];
}

// The two functions below are serialised into the page by chrome.scripting.executeScript: no imports, no outer variables.
export function collectAll(): string[] {
  return [...document.links].map((a) => (a as HTMLAnchorElement).href);
}

export function collectSelected(): string[] {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0) return [];
  return [...document.links].filter((a) => sel.containsNode(a, true)).map((a) => (a as HTMLAnchorElement).href);
}
