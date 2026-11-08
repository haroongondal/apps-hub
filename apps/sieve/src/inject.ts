import { SCRIPTLETS } from './scriptlets.js';
import { isAllowed } from '@apps-hub/sieve-core/src/allowlist.ts';
import { hostCandidates } from '@apps-hub/sieve-core/src/hosts.ts';
import { pageInjections, scriptletArgs, storedCosmetic } from '@apps-hub/sieve-core/src/page.ts';
import { FEATURES, validateSettings, type Settings } from '@apps-hub/sieve-core/src/settings.ts';
import type { BuildMeta } from '@apps-hub/sieve-core/src/plan.ts';
import type { CosmeticSet } from '@apps-hub/sieve-core/src/compile.ts';

type Committed = chrome.webNavigation.WebNavigationTransitionCallbackDetails;

const RULE_END = '{display:none!important}';
// Frames that went away, and pages Chrome never lets extensions script (the Chrome Web Store).
const GONE = /No (?:tab|frame|document) with id|Invalid document id|was removed|showing error page|tab was closed|cannot be scripted/i;

const files = new Map<string, Promise<unknown>>();
function load<T>(path: string, read: (r: Response) => Promise<T>): Promise<T> {
  if (!files.has(path)) files.set(path, fetch(chrome.runtime.getURL(path)).then(read));
  return files.get(path) as Promise<T>;
}
const cosmetic = (f: string) => load(`cosmetic/${f}.json`, async (r) => ({ generic: [] as string[], ...((await r.json()) as Omit<CosmeticSet, 'generic'>) }));
const genericSelectors = (f: string) => load(`cosmetic/${f}.generic.css`, async (r) => (await r.text()).split('\n').filter(Boolean).map((l) => l.slice(0, -RULE_END.length)));

// The settings and My filters' hide data (`myCosmetic`, written when an item is picked), read once until either changes.
let stored: Promise<{ settings: Settings; mine: CosmeticSet }> | undefined;
export function forgetStored(): void {
  stored = undefined;
}

// shortcut: documentId -> top frame URL, oldest dropped past 1,000; a miss walks up with getFrame, raise it if that shows up in profiles.
const tops = new Map<string, string>();
async function topUrl(d: Committed): Promise<string | null> {
  let url = d.url;
  let parent = d.parentDocumentId;
  const walked = [d.documentId];
  while (parent) {
    const known = tops.get(parent);
    if (known !== undefined) {
      url = known;
      break;
    }
    const frame = await chrome.webNavigation.getFrame({ documentId: parent });
    if (!frame) return null;
    walked.push(parent);
    ({ url, parentDocumentId: parent } = frame);
  }
  for (const id of walked) tops.set(id, url);
  while (tops.size > 1000) tops.delete(tops.keys().next().value as string);
  return url;
}

function report(e: unknown): void {
  if (!GONE.test(e instanceof Error ? e.message : String(e))) console.error('Sieve could not apply the site filters to a page', e);
}

export async function onCommitted(d: Committed): Promise<void> {
  // A document seen before (a back/forward cache restore) already has its CSS and scriptlets.
  if (tops.has(d.documentId)) return;
  try {
    const [{ settings: s, mine }, meta, top] = await Promise.all([
      (stored ??= chrome.storage.local.get(['settings', 'myCosmetic']).then((r) => ({ settings: validateSettings(r.settings), mine: storedCosmetic(r.myCosmetic) }))),
      load('meta.json', (r) => r.json() as Promise<BuildMeta>),
      topUrl(d),
    ]);
    // The frame's own address too: the allow rule and the registered scripts treat an allowlisted site's iframe as allowlisted.
    if (!s.enabled || s.blocking.paused || top === null || isAllowed(top, s.blocking.allowlist) || isAllowed(d.url, s.blocking.allowlist)) return;

    const host = new URL(d.url).hostname;
    const candidates = new Set(hostCandidates(host));
    const features = FEATURES.filter((f) => s.blocking.lists[f]);
    const excluded = features.map((f) => meta.features[f].hasGenericCss && meta.features[f].genericExcept.some((h) => candidates.has(h)));
    const sets = await Promise.all(features.map(async (f, i) => (excluded[i] ? { ...(await cosmetic(f)), generic: await genericSelectors(f) } : cosmetic(f))));
    // My filters come last, after the lists, and only the lists have generic CSS to exclude.
    const { css, scriptlets } = pageInjections(host, [...sets, mine], (i) => excluded[i] === true);

    const target = { tabId: d.tabId, documentIds: [d.documentId] };
    await Promise.all([
      ...scriptlets
        .filter((c) => SCRIPTLETS[c.name])
        .map((c) => chrome.scripting.executeScript({ target, world: 'MAIN', injectImmediately: true, func: SCRIPTLETS[c.name], args: scriptletArgs(c) }).catch(report)),
      css && chrome.scripting.insertCSS({ target, css, origin: 'USER' }).catch(report),
    ]);
  } catch (e) {
    report(e);
  }
}
