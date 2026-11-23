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

/** `android:exported` is true for `true` and for any `@bool/...` reference (fail closed: a reference could resolve to true). */
const isTrue = (v: string | undefined) => v === 'true' || (v?.startsWith('@') ?? false);

/**
 * Checks an AndroidManifest.xml text against the link rules and returns the problems (empty is clean):
 * a link provider, action or action alias refuses callers without the signature permission, a provider
 * has no `path-permission` (it would replace the permission for its path), link actions are not
 * services or receivers, and the permission is declared as `signature`. `allowHeadless` lists
 * activities (full class name, or the `.dotted` name written in the manifest) that are grandfathered as headless.
 *
 * Limits: "a link action shows a screen" is a code-review rule. The audit only catches the `NoDisplay`
 * theme substring; it cannot prove a screen is shown (a translucent theme, or `finish()` in `onCreate`,
 * passes). An `<activity-alias>` is judged by its own filters and by whether its `targetActivity` is a
 * link action in the same manifest; its theme is not read.
 */
export function auditManifest(xml: string, opts: { allowHeadless?: string[] } = {}): string[] {
  const allow = opts.allowHeadless ?? [];
  const els = all(parse(xml));
  const problems: string[] = [];
  const inApp = (e: El) => e.parent?.name === 'application';
  const filtersOf = (e: El) => e.kids.filter((k) => k.name === 'intent-filter');
  const hasLinkFilter = (e: El) => filtersOf(e).some((f) => f.kids.some((k) => k.name === 'action' && ACTION.test(k.attrs.name ?? '')));
  const exportedComponent = (e: El) => isTrue(e.attrs.exported) || (e.attrs.exported === undefined && filtersOf(e).length > 0);
  const headlessTheme = (e: El) => (e.attrs.theme ?? '').includes('NoDisplay');
  const isLinkActivity = (a: El) => hasLinkFilter(a) || (headlessTheme(a) && a.attrs.permission === LINK_PERMISSION);

  for (const p of els.filter((e) => e.name === 'provider' && inApp(e) && isTrue(e.attrs.exported))) {
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
    if (p.kids.some((k) => k.name === 'path-permission')) problems.push(`${who} has a path-permission, which replaces the provider permission for its path`);
  }

  const activities = els.filter((e) => e.name === 'activity' && inApp(e));
  for (const a of activities) {
    if (!exportedComponent(a)) continue;
    // Started by an explicit intent: still a link action when only link callers may start it.
    if (!isLinkActivity(a)) continue;
    const name = a.attrs.name ?? '';
    const who = `activity ${name}`;
    if (a.attrs.permission !== LINK_PERMISSION) problems.push(`${who} is a link action but its permission is ${a.attrs.permission ?? 'missing'}, expected ${LINK_PERMISSION}`);
    if (headlessTheme(a) && !allow.some((x) => x === name || (name.startsWith('.') && x.endsWith(name)))) {
      problems.push(`${who} is a link action that runs headless (${a.attrs.theme}); link actions must show a screen`);
    }
  }

  // An alias carries its own permission and replaces the target's: an unguarded alias opens the target.
  for (const al of els.filter((e) => e.name === 'activity-alias' && inApp(e))) {
    const target = activities.find((a) => a.attrs.name === al.attrs.targetActivity);
    const link = hasLinkFilter(al) || (exportedComponent(al) && target !== undefined && isLinkActivity(target));
    if (link && al.attrs.permission !== LINK_PERMISSION) {
      problems.push(`activity-alias ${al.attrs.name} is a link action but its permission is ${al.attrs.permission ?? 'missing'}, expected ${LINK_PERMISSION}`);
    }
  }

  for (const c of els.filter((e) => (e.name === 'service' || e.name === 'receiver') && inApp(e) && exportedComponent(e) && hasLinkFilter(e))) {
    problems.push(`${c.name} ${c.attrs.name} is exported with a link action filter; link actions must be activities that show a screen`);
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
