import type { DnrRule } from './compile.ts';
import { ALLOW_FIRST_ID, allowRules, excludePatterns } from './allowlist.ts';
import { FEATURES, isHost, type FeatureKey, type Settings } from './settings.ts';

// What apps/sieve/build.mjs writes to dist/meta.json.
export interface BuildMeta {
  listsAt: string; // when the oldest downloaded list was fetched (ISO date): a plain rebuild reuses the cached lists
  maxPriority: number;
  features: Record<FeatureKey, { ruleset: string | null; ruleCount: number; hasGenericCss: boolean; genericExcept: string[]; allowIds: number[]; modifyIds: number[] }>;
  scriptlets: string[];
}

export interface Registration {
  id: string;
  js?: string[];
  css?: string[];
  world?: 'MAIN';
  matches: string[];
  excludeMatches: string[];
  allFrames: true;
  runAt: 'document_start';
}

export interface BlockingPlan {
  enableRulesets: string[];
  disableRulesets: string[];
  registrations: Registration[];
  dynamicRules: DnrRule[];
}

// myExceptHosts: the hosts of My filters' `#@#` exceptions. They leave the registered generic CSS, as a list's own
// genericExcept hosts do, so inject.ts gives them the generic CSS per page without the excepted selectors.
export function blockingPlan(settings: Settings, meta: BuildMeta, myRules: DnrRule[], myExceptHosts: string[] = []): BlockingPlan {
  const b = settings.blocking;
  const shipped = FEATURES.filter((f) => meta.features[f].ruleset !== null);
  const rulesetOf = (f: FeatureKey) => meta.features[f].ruleset as string;
  if (!settings.enabled || b.paused) return { enableRulesets: [], disableRulesets: shipped.map(rulesetOf), registrations: [], dynamicRules: [] };

  const sites = b.allowlist.flatMap((e) => (e.kind === 'site' ? [e.host] : []));
  const pages = b.allowlist.flatMap((e) => (e.kind === 'page' ? [e.url] : []));
  const where = (except: string[] = []) => ({
    matches: ['http://*/*', 'https://*/*'],
    excludeMatches: excludePatterns([...new Set([...sites, ...except])], pages),
    allFrames: true as const,
    runAt: 'document_start' as const,
  });
  // `*` (every site) and `google.*` can't be match patterns, and one bad pattern voids the registration.
  const mine = myExceptHosts.filter(isHost);
  const registrations: Registration[] = FEATURES.filter((f) => b.lists[f] && meta.features[f].hasGenericCss).map((f) => ({
    id: `generic-${f}`,
    css: [`cosmetic/${f}.generic.css`],
    ...where([...meta.features[f].genericExcept, ...mine]),
  }));
  if (b.denyNotifications) registrations.push({ id: 'deny-notifications', js: ['notify-deny.js'], world: 'MAIN', ...where() });

  // Above every list rule and every My filters rule, so the allowlist also beats `$important`.
  const priority = myRules.reduce((max, r) => Math.max(max, r.priority ?? 1), meta.maxPriority) + 1;
  return {
    enableRulesets: shipped.filter((f) => b.lists[f]).map(rulesetOf),
    disableRulesets: shipped.filter((f) => !b.lists[f]).map(rulesetOf),
    registrations,
    dynamicRules: [...myRules, ...allowRules(b.allowlist, ALLOW_FIRST_ID, priority)],
  };
}
