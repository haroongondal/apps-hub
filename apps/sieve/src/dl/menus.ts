import type { DownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';
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

// One chain: a rebuild waits for the previous one, so overlapping calls cannot create an item twice.
let chain: Promise<void> = Promise.resolve();
export function rebuildMenus(settings: DownloadSettings): Promise<void> {
  const next = chain.then(async () => {
    await chrome.contextMenus.removeAll();
    if (!settings.on) return;
    chrome.contextMenus.create({ id: MENU_LINK, title: T.ctxLink, contexts: ['link'] });
    chrome.contextMenus.create({ id: MENU_SELECTION, title: T.ctxSelection, contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU_PAGE, title: T.ctxPage, contexts: ['page', 'frame'] });
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
  const [open] = await chrome.tabs.query({ url: `${page}*` });
  if (open?.id === undefined) await chrome.tabs.create({ url: `${page}#add` });
  else {
    await chrome.tabs.update(open.id, { active: true, url: `${page}#add` });
    if (open.windowId !== undefined) await chrome.windows.update(open.windowId, { focused: true });
  }
}

export function initMenus(): void {
  chrome.contextMenus.onClicked.addListener((info, tab) => void onMenuClicked(info, tab).catch((e) => console.error('Sieve menu click failed', e)));
  const rebuild = (s: DownloadSettings) => void rebuildMenus(s).catch((e) => console.error('Sieve could not build the menus', e));
  chrome.runtime.onInstalled.addListener(() => void readDownloads().then(rebuild));
  onDownloadsChanged(rebuild);
  chrome.runtime.onMessage.addListener((m: unknown, sender, sendResponse) => {
    const msg = m as Record<string, unknown> | null;
    if (msg?.type !== 'dl-menu-click' || !fromExtensionPage(sender)) return false;
    const info = { menuItemId: msg.menuItemId, linkUrl: msg.linkUrl, selectionText: msg.selectionText, pageUrl: msg.pageUrl, frameId: msg.frameId } as Info;
    onMenuClicked(info, { id: msg.tabId as number | undefined, url: msg.pageUrl as string | undefined }).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  });
  void readDownloads().then(rebuild, (e) => console.error('Sieve could not read the download settings', e));
}
