import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_URL, forwardMatch, forwardReset, onPanelConnect } from '../panels.ts';

(globalThis as unknown as { chrome: unknown }).chrome = { runtime: { getURL: (path: string) => `chrome-extension://sieve/${path}` } };

function port(name: string, url: string | null = 'chrome-extension://sieve/panel.html?tab=1') {
  const sent: unknown[] = [];
  const onDisconnect: (() => void)[] = [];
  let open = true;
  const fake = {
    name,
    sender: url === null ? undefined : { url },
    sent,
    postMessage: (m: unknown) => {
      if (!open) throw new Error('Attempting to use a disconnected port object');
      sent.push(m);
    },
    disconnect: () => void (open = false),
    onDisconnect: { addListener: (f: () => void) => void onDisconnect.push(f) },
    isOpen: () => open,
    // Chrome fires onDisconnect on the side that did not close the port.
    closeFromPanel: () => {
      open = false;
      for (const f of onDisconnect) f();
    },
  };
  return fake;
}
const connect = (p: ReturnType<typeof port>) => onPanelConnect(p as unknown as chrome.runtime.Port);
const match = (tabId: number, url = 'https://ads.example/x.js') =>
  ({ request: { tabId, url, type: 'script' }, rule: { rulesetId: 'ads', ruleId: 5 } }) as chrome.declarativeNetRequest.MatchedRuleInfoDebug;

test('a match and a reset reach every panel connected for that tab, and no other tab', () => {
  const a = port('panel:10');
  const b = port('panel:10');
  const other = port('panel:11');
  [a, b, other].forEach(connect);
  forwardMatch(match(10), 1234);
  forwardReset(10);
  const message = { url: 'https://ads.example/x.js', type: 'script', rulesetId: 'ads', ruleId: 5, at: 1234 };
  assert.deepEqual(a.sent, [message, { reset: true }]);
  assert.deepEqual(b.sent, [message, { reset: true }]);
  assert.deepEqual(other.sent, []);
  [a, b, other].forEach((p) => p.closeFromPanel());
});

test('a panel that disconnected gets nothing more, and a tab with no panel does no work', () => {
  const a = port('panel:20');
  connect(a);
  a.closeFromPanel();
  forwardMatch(match(20), 1);
  assert.deepEqual(a.sent, []);
  let built = false;
  const request = { tabId: 21, get url() { built = true; return ''; } };
  forwardMatch({ request, rule: {} } as unknown as chrome.declarativeNetRequest.MatchedRuleInfoDebug, 1);
  assert.equal(built, false, 'no message is built for a tab with no panel');
  assert.doesNotThrow(() => forwardReset(21));
});

test('a port that closed without telling us is dropped, and the other panels still get the message', () => {
  const dead = port('panel:30');
  const live = port('panel:30');
  [dead, live].forEach(connect);
  dead.disconnect();
  assert.doesNotThrow(() => forwardMatch(match(30), 1));
  forwardMatch(match(30), 2);
  assert.equal(live.sent.length, 2);
  live.closeFromPanel();
});

test('only a port named panel:<tab id> from the extension is kept', () => {
  const stranger = port('something-else');
  const fromPage = port('panel:40', 'https://example.com/');
  const noSender = port('panel:40', null);
  const badName = port('panel:x');
  [stranger, fromPage, noSender, badName].forEach(connect);
  forwardMatch(match(40), 1);
  assert.deepEqual([stranger, fromPage, noSender, badName].map((p) => p.sent.length), [0, 0, 0, 0]);
  assert.deepEqual([stranger, fromPage, noSender, badName].map((p) => p.isOpen()), [true, false, false, true]);
});

test('an enormous address is cut', () => {
  const a = port('panel:50');
  connect(a);
  forwardMatch(match(50, `https://ads.example/${'a'.repeat(MAX_URL * 3)}`), 1);
  assert.equal((a.sent[0] as { url: string }).url.length, MAX_URL);
  a.closeFromPanel();
});
