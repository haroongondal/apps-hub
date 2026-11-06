type Rules = { normal: Set<string>; wildcard: Set<string>; exception: Set<string> };

let rules: Rules | null = null;

// A rule the URL parser can't convert could never match a host that is normalised through the same parser.
const toAscii = (rule: string): string | null => {
  if (/^[\x00-\x7f]*$/.test(rule)) return rule.toLowerCase();
  try {
    return new URL(`http://${rule}`).hostname.toLowerCase();
  } catch {
    return null;
  }
};

export function loadPublicSuffixList(text: string): void {
  const next: Rules = { normal: new Set(), wildcard: new Set(), exception: new Set() };
  for (const line of text.split('\n')) {
    const rule = line.trim().split(/[ \t]/)[0];
    if (rule === '' || rule.startsWith('//')) continue;
    const ascii = toAscii(rule.replace(/^!/, '').replace(/^\*\./, ''));
    if (ascii === null) continue;
    (rule.startsWith('!') ? next.exception : rule.startsWith('*.') ? next.wildcard : next.normal).add(ascii);
  }
  rules = next;
}

export function publicSuffixRegistrableDomain(asciiHost: string): string | null {
  if (rules === null) throw new Error('The public suffix list is not loaded');
  const labels = asciiHost.split('.');
  if (labels.some((l) => l === '')) return null;
  const n = labels.length;
  const suffix = (i: number) => labels.slice(i).join('.');
  const indices = [...labels.keys()];
  const exceptionAt = indices.find((i) => rules!.exception.has(suffix(i)));
  const longestMatch = indices.find((i) => rules!.normal.has(suffix(i)) || rules!.wildcard.has(suffix(i + 1)));
  const suffixLabels = exceptionAt !== undefined ? n - exceptionAt - 1 : longestMatch !== undefined ? n - longestMatch : 1;
  return n > suffixLabels ? labels.slice(-(suffixLabels + 1)).join('.') : null;
}
