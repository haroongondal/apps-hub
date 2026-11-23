import { isKnownAuthority, LINK_PERMISSION } from './names.ts';

interface El { name: string; attrs: Record<string, string>; kids: El[]; parent?: El }

const ACTION = /^com\.haroon\.[a-z][a-z0-9]*\.action\.[A-Z][A-Z0-9_]*$/;
const TAG = /<(\/?)([A-Za-z][\w.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const ATTR = /([\w.-]+:)?([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * A small tolerant scanner, not an XML parser: comments and the XML prolog are dropped, attribute
 * namespaces are ignored (`android:name` is read as `name`), and a `>` inside an attribute value is
 * fine. It does not resolve `@string/` references, entities, `tools:` overrides or manifest merging,
 * so audit the source manifest of a module, not the merged one.
 */
function parse(xml: string): El {
  const root: El = { name: '#root', attrs: {}, kids: [] };
  let cur = root;
  for (const m of xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').matchAll(TAG)) {
    if (m[1]) { if (cur.parent) cur = cur.parent; continue; }
    const el: El = { name: m[2], attrs: {}, kids: [], parent: cur };
    for (const a of m[3].matchAll(ATTR)) el.attrs[a[2]] = a[3] ?? a[4];
    cur.kids.push(el);
    if (!m[4]) cur = el;
  }
  return root;
}

const all = (el: El): El[] => el.kids.flatMap((k) => [k, ...all(k)]);

/**
 * Checks an AndroidManifest.xml text against the link rules and returns the problems (empty is clean):
 * a link provider or action refuses callers without the signature permission, nothing a link starts
 * runs headless, and the permission is declared as `signature`. `allowHeadless` lists activities
 * (full class name, or the `.dotted` name written in the manifest) that are grandfathered as headless.
 * Limits: path-permission children and `activity-alias` are not read.
 */
export function auditManifest(xml: string, opts: { allowHeadless?: string[] } = {}): string[] {
  const allow = opts.allowHeadless ?? [];
  const els = all(parse(xml));
  const problems: string[] = [];
  const inApp = (e: El) => e.parent?.name === 'application';

  for (const p of els.filter((e) => e.name === 'provider' && inApp(e) && e.attrs.exported === 'true')) {
    const authorities = (p.attrs.authorities ?? '').split(';');
    if (!authorities.some(isKnownAuthority)) continue;
    const who = `provider ${p.attrs.name}`;
    const read = p.attrs.readPermission ?? p.attrs.permission;
    const write = p.attrs.writePermission ?? p.attrs.permission;
    if (!read) problems.push(`${who} is exported with no readPermission`);
    else if (read !== LINK_PERMISSION) problems.push(`${who} readPermission is ${read}, expected ${LINK_PERMISSION}`);
    if (write && write !== LINK_PERMISSION) problems.push(`${who} writePermission is ${write}, expected ${LINK_PERMISSION}`);
    if (p.attrs.grantUriPermissions === 'true' || p.kids.some((k) => k.name === 'grant-uri-permission')) {
      problems.push(`${who} grants URI permissions`);
    }
  }

  for (const a of els.filter((e) => e.name === 'activity' && inApp(e))) {
    const filters = a.kids.filter((k) => k.name === 'intent-filter');
    const exported = a.attrs.exported === 'true' || (a.attrs.exported === undefined && filters.length > 0);
    if (!exported) continue;
    const headless = (a.attrs.theme ?? '').includes('NoDisplay');
    const linkFilter = filters.some((f) => f.kids.some((k) => k.name === 'action' && ACTION.test(k.attrs.name ?? '')));
    // Started by an explicit intent: still a link action when only link callers may start it.
    if (!linkFilter && !(headless && a.attrs.permission === LINK_PERMISSION)) continue;
    const name = a.attrs.name ?? '';
    const who = `activity ${name}`;
    if (a.attrs.permission !== LINK_PERMISSION) problems.push(`${who} is a link action but its permission is ${a.attrs.permission ?? 'missing'}, expected ${LINK_PERMISSION}`);
    if (headless && !allow.some((x) => x === name || (name.startsWith('.') && x.endsWith(name)))) {
      problems.push(`${who} is a link action that runs headless (${a.attrs.theme}); link actions must show a screen`);
    }
  }

  const uses = els.some((e) => e.name !== 'permission' && e.name !== 'uses-permission'
    && [e.attrs.permission, e.attrs.readPermission, e.attrs.writePermission].includes(LINK_PERMISSION));
  const named = (tag: string) => els.filter((e) => e.name === tag && e.attrs.name === LINK_PERMISSION);
  const declared = named('permission');
  if (uses && declared.length === 0) problems.push(`${LINK_PERMISSION} is used on a component but not declared with <permission>`);
  if (uses && named('uses-permission').length === 0) problems.push(`${LINK_PERMISSION} is used on a component but missing <uses-permission>`);
  for (const d of declared) if (d.attrs.protectionLevel !== 'signature') problems.push(`${LINK_PERMISSION} protectionLevel is ${d.attrs.protectionLevel ?? 'missing'}, expected signature`);
  return problems;
}
