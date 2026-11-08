// The host, each parent domain, and each of those with its last one or two labels as `*` (for `google.*` filters).
// shortcut: no public-suffix list, so `google.github.io` also gets `google.*` and the lists' `google.*` rules apply there;
// if one misfires, add the two-label `*` only when the second-to-last label is a suffix like co, com or org.
export function hostCandidates(hostname: string): string[] {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host)) return host ? [host] : [];
  const labels = host.split('.');
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) {
    const rest = labels.slice(i);
    out.push(rest.join('.'), [...rest.slice(0, -1), '*'].join('.'));
    if (rest.length > 2) out.push([...rest.slice(0, -2), '*'].join('.'));
  }
  return out;
}
