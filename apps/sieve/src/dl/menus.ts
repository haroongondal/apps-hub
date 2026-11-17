import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { parseAddInput } from '@apps-hub/sieve-core/src/dl-view.ts';
import { fromExtensionPage } from './engine-link.ts';
import { collectAll, collectSelected, normaliseLinks } from './links.ts';
import { onDownloadsChanged, readDownloads } from './settings-store.ts';

export const MENU_LINK = 'dl-link';
export const MENU_SELECTION = 'dl-selection';
export const MENU_PAGE = 'dl-page';

type Info = { menuItemId: string | number; linkUrl?: string; selectionText?: string; pageUrl?: string; frameId?: number };
type TabLike = { id?: number; url?: string };

// One chain: a rebuild waits for the previous one, so overlapping calls cannot create an item twice,
// and it reads the settings when its turn comes, so an older read cannot win over a newer change.
let chain: Promise<void> = Promise.resolve();
const checked = () => void chrome.runtime.lastError; // a duplicate id would otherwise be an unchecked lastError
export function rebuildMenus(): Promise<void> {
  const next = chain.then(async () => {
    const settings = await readDownloads();
    await chrome.contextMenus.removeAll();
    if (!settings.on) return;
    chrome.contextMenus.create({ id: MENU_LINK, title: T.ctxLink, contexts: ['link'] }, checked);
    chrome.contextMenus.create({ id: MENU_SELECTION, title: T.ctxSelection, contexts: ['selection'] }, checked);
    chrome.contextMenus.create({ id: MENU_PAGE, title: T.ctxPage, contexts: ['page', 'frame'] }, checked);
  });
  chain = next.catch(() => {});
  return next;
}

async function scan(func: () => string[], tab: TabLike | undefined, frameId: number): Promise<string[]> {
  if (tab?.id === undefined) return [];
  try {
    const [first] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frameId] }, func });
    return normaliseLinks(Array.isArray(first?.result) ? (first.result as string[]) : []);
  } catch {
    return []; // a page Chrome never lets extensions script
  }
}

export async function onMenuClicked(info: Info, tab: TabLike | undefined): Promise<void> {
  if (!(await readDownloads()).on) return;
  let urls: string[] = [];
  if (info.menuItemId === MENU_LINK) urls = normaliseLinks([info.linkUrl ?? '']);
  else if (info.menuItemId === MENU_SELECTION) {
    urls = await scan(collectSelected, tab, info.frameId ?? 0);
    if (!urls.length) urls = parseAddInput(info.selectionText ?? '').urls; // links typed as text
  } else if (info.menuItemId === MENU_PAGE) urls = await scan(collectAll, tab, info.frameId ?? 0);
  else return;
  if (!urls.length) return;
  await chrome.storage.session.set({ dlPrefill: { urls, referrer: info.pageUrl ?? tab?.url ?? '' } });
  const page = chrome.runtime.getURL('downloads.html');
  // tabs.query hides the URL of our own pages without the `tabs` permission, so it cannot find the list page; getContexts can.
  const open = (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).find((c) => c.documentUrl?.startsWith(page) && c.tabId >= 0);
  if (!open) await chrome.tabs.create({ url: `${page}#add` });
  else {
    // A fresh query makes this a real navigation; a fragment alone would not reload the page, and update-then-reload raced the fragment change.
    await chrome.tabs.update(open.tabId, { active: true, url: `${page}?r=${Date.now()}#add` });
    await chrome.windows.update(open.windowId, { focused: true });
  }
}

export function initMenus(): void {
  chrome.contextMenus.onClicked.addListener((info, tab) => void onMenuClicked(info, tab).catch((e) => console.error('Sieve menu click failed', e)));
  const rebuild = () => void rebuildMenus().catch((e) => console.error('Sieve could not build the menus', e));
  chrome.runtime.onInstalled.addListener(rebuild);
  onDownloadsChanged(rebuild);
  chrome.runtime.onMessage.addListener((m: unknown, sender, sendResponse) => {
    const msg = m as Record<string, unknown> | null;
    if (msg?.type !== 'dl-menu-click' || !fromExtensionPage(sender)) return false;
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
    const info: Info = { menuItemId: str(msg.menuItemId) ?? '', linkUrl: str(msg.linkUrl), selectionText: str(msg.selectionText), pageUrl: str(msg.pageUrl), frameId: num(msg.frameId) };
    onMenuClicked(info, { id: num(msg.tabId), url: info.pageUrl }).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  });
  rebuild();
}
