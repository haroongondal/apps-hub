// Spike service worker: opens spike.html and stores what the probe relay sends.
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('spike.html') }));

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  let items = null;
  if (msg?.type === 'probe-result') items = { [`probe:${msg.result.strategy}`]: msg.result };
  if (msg?.type === 'fixture') items = { fixture: msg.fixture };
  if (msg?.type === 'streams') items = { [`streams:${msg.streams.strategy}`]: msg.streams };
  if (!items) return;
  (msg.type === 'streams' ? chrome.storage.session : chrome.storage.local).set(items).then(() => reply(true), (err) => reply({ error: String(err?.message ?? err) }));
  return true;
});
