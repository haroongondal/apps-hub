import { SCRIPTLETS } from './scriptlets.js';
import { isAllowed } from '@apps-hub/sieve-core/src/allowlist.ts';
import { hostCandidates } from '@apps-hub/sieve-core/src/hosts.ts';
import { pageInjections } from '@apps-hub/sieve-core/src/page.ts';
import { FEATURES, validateSettings, type Settings } from '@apps-hub/sieve-core/src/settings.ts';
import type { BuildMeta } from '@apps-hub/sieve-core/src/plan.ts';
import type { CosmeticSet } from '@apps-hub/sieve-core/src/compile.ts';

type Committed = chrome.webNavigation.WebNavigationTransitionCallbackDetails;

const RULE_END = '{display:none!important}';
const GONE = /No (?:tab|frame|document) with id|Invalid document id|was removed|showing error page|tab was closed/i;

const files = new Map<string, Promise<unknown>>();
function load<T>(path: string, read: (r: Response) => Promise<T>): Promise<T> {
  if (!files.has(path)) files.set(path, fetch(chrome.runtime.getURL(path)).then(read));
  return files.get(path) as Promise<T>;
}
const cosmetic = (f: string) => load(`cosmetic/${f}.json`, async (r) => ({ generic: [] as string[], ...((await r.json()) as Omit<CosmeticSet, 'generic'>) }));
const genericSelectors = (f: string) => load(`cosmetic/${f}.generic.css`, async (r) => (await r.text()).split('\n').filter(Boolean).map((l) => l.slice(0, -RULE_END.length)));

let settings: Promise<Settings> | undefined;
export function forgetSettings(): void {
  settings = undefined;
}

// shortcut: documentId -> top frame URL, oldest dropped past 1,000; a miss walks up with getFrame, raise it if that shows up in profiles.
const tops = new Map<string, string>();
async function topUrl(d: Committed): Promise<string | null> {
  let url = d.url;
  let parent = d.parentDocumentId;
  while (parent) {
    const known = tops.get(parent);
    if (known !== undefined) {
      url = known;
      break;
    }
    const frame = await chrome.webNavigation.getFrame({ documentId: parent });
    if (!frame) return null;
    ({ url, parentDocumentId: parent } = frame);
  }
  tops.set(d.documentId, url);
  if (tops.size > 1000) tops.delete(tops.keys().next().value as string);
  return url;
}

function report(e: unknown): void {
  if (!GONE.test(e instanceof Error ? e.message : String(e))) console.error('Sieve could not apply the site filters to a page', e);
}

export async function onCommitted(d: Committed): Promise<void> {
  try {
    const [s, meta, top] = await Promise.all([
      (settings ??= chrome.storage.local.get('settings').then((r) => validateSettings(r.settings))),
      load('meta.json', (r) => r.json() as Promise<BuildMeta>),
      topUrl(d),
    ]);
    if (!s.enabled || s.blocking.paused || top === null || isAllowed(top, s.blocking.allowlist)) return;

    const host = new URL(d.url).hostname;
    const candidates = new Set(hostCandidates(host));
    const features = FEATURES.filter((f) => s.blocking.lists[f]);
    const excluded = features.map((f) => meta.features[f].hasGenericCss && meta.features[f].genericExcept.some((h) => candidates.has(h)));
    const sets = await Promise.all(features.map(async (f, i) => (excluded[i] ? { ...(await cosmetic(f)), generic: await genericSelectors(f) } : cosmetic(f))));
    const { css, scriptlets } = pageInjections(host, sets, (i) => excluded[i]);

    const target = { tabId: d.tabId, documentIds: [d.documentId] };
    await Promise.all([
      ...scriptlets
        .filter((c) => SCRIPTLETS[c.name])
        // The two arguments scriptlets.invoke passes: the source object, then the args array.
        .map((c) => chrome.scripting.executeScript({ target, world: 'MAIN', injectImmediately: true, func: SCRIPTLETS[c.name], args: [{ name: c.name, args: c.args, engine: 'extension', verbose: false }, c.args] }).catch(report)),
      css && chrome.scripting.insertCSS({ target, css, origin: 'USER' }).catch(report),
    ]);
  } catch (e) {
    report(e);
  }
}
