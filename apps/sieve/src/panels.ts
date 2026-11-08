// The DevTools panels that are open, by tab. Memory only: Chrome drops the ports when it stops the worker, and each panel connects again.
const ports = new Map<number, Set<chrome.runtime.Port>>();

export const MAX_URL = 2048;

function drop(tabId: number, port: chrome.runtime.Port): void {
  const open = ports.get(tabId);
  open?.delete(port);
  if (open?.size === 0) ports.delete(tabId);
}

export function onPanelConnect(port: chrome.runtime.Port): void {
  const name = /^panel:(\d+)$/.exec(port.name);
  if (!name) return;
  // A content script of ours runs in a web page, so its address is the page's, not the extension's.
  if (!port.sender?.url?.startsWith(chrome.runtime.getURL(''))) return port.disconnect();
  const tabId = Number(name[1]);
  let open = ports.get(tabId);
  if (!open) ports.set(tabId, (open = new Set()));
  open.add(port);
  port.onDisconnect.addListener(() => drop(tabId, port));
}

// Nothing in here may throw: the caller counts the match right after.
function send(tabId: number, message: () => object): void {
  try {
    const open = ports.get(tabId);
    if (!open) return;
    const body = message();
    for (const port of open) {
      try {
        port.postMessage(body);
      } catch {
        drop(tabId, port);
      }
    }
  } catch (e) {
    console.error('Sieve could not pass a blocked request to DevTools', e);
  }
}

export const forwardMatch = ({ request, rule }: chrome.declarativeNetRequest.MatchedRuleInfoDebug, at: number): void =>
  send(request.tabId, () => ({ url: request.url.slice(0, MAX_URL), type: request.type, rulesetId: rule.rulesetId, ruleId: rule.ruleId, at }));

export const forwardReset = (tabId: number): void => send(tabId, () => ({ reset: true }));
