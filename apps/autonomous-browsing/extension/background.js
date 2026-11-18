const HOST_NAME = 'com.cd.browser.automation';
const DEFAULTS = {
  state: 'idle',
  targetTabId: null,
  reason: null,
  skipScanOnce: false,
};
const NAV_TIMEOUT_MS = 20000;

const CONTROL_TYPES = new Set(['pause', 'resume', 'stop', 'abandon']);
const MAX_TRACKED_ABANDONED = 64;

let port = null;
let lock = Promise.resolve();
let inFlightStepId = null;
let attachedTabId = null;
let inputMode = 'auto';
const abandoned = new Set();

function inputCommands({ action, x, y, text, submit }) {
  if (action === 'click') {
    const at = { x, y, clickCount: 1 };
    return [
      ['Input.dispatchMouseEvent', { ...at, type: 'mouseMoved', button: 'none', buttons: 0 }],
      ['Input.dispatchMouseEvent', { ...at, type: 'mousePressed', button: 'left', buttons: 1 }],
      ['Input.dispatchMouseEvent', { ...at, type: 'mouseReleased', button: 'left', buttons: 0 }],
    ];
  }

  const commands = [['Input.insertText', { text }]];
  if (!submit) return commands;
  const key = {
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  };
  commands.push(['Input.dispatchKeyEvent', { ...key, type: 'keyDown', text: '\r' }]);
  commands.push(['Input.dispatchKeyEvent', { ...key, type: 'keyUp' }]);
  return commands;
}

async function ensureAttached(tabId) {
  if (inputMode === 'synthetic') return false;
  if (attachedTabId === tabId) return true;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    attachedTabId = tabId;
    return true;
  } catch (error) {
    // A restarted worker forgets the tab while the attachment itself survives.
    if (error.message.includes('already attached')) {
      attachedTabId = tabId;
      return true;
    }
    console.warn(`[agent] trusted input unavailable: ${error.message}`);
    return false;
  }
}

async function detachDebugger() {
  if (attachedTabId === null) return;
  const tabId = attachedTabId;
  attachedTabId = null;
  await chrome.debugger.detach({ tabId }).catch(() => {});
}

async function dispatchInput(tabId, request) {
  if (!(await ensureAttached(tabId))) return 'unavailable';
  let sent = 0;
  try {
    for (const [method, params] of inputCommands(request)) {
      await chrome.debugger.sendCommand({ tabId }, method, params);
      sent += 1;
    }
    return 'ok';
  } catch (error) {
    attachedTabId = null;
    console.warn(`[agent] trusted input failed: ${error.message}`);
    return sent === 0 ? 'unavailable' : 'failed';
  }
}

function serialize(task) {
  const next = lock.then(task, task);
  lock = next.catch(() => {});
  return next;
}

function markAbandoned(id) {
  abandoned.add(id);
  // The app abandons an id when it stops waiting; usually the reply then
  // arrives and clears it. One that never arrives would otherwise leak.
  if (abandoned.size > MAX_TRACKED_ABANDONED)
    abandoned.delete(abandoned.values().next().value);
}

function reply(id, payload) {
  if (abandoned.delete(id)) return;
  toApp({ id, ...payload });
}

const readState = () => chrome.storage.session.get(DEFAULTS);
const writeState = patch => chrome.storage.session.set(patch);

function connectHost() {
  if (port) return port;
  const opened = chrome.runtime.connectNative(HOST_NAME);
  opened.onMessage.addListener(message => {
    if (CONTROL_TYPES.has(message.type)) void control(message);
    else serialize(() => handle(message));
  });
  opened.onDisconnect.addListener(() => {
    const failure = chrome.runtime.lastError;
    if (failure)
      console.error(`[agent] native host disconnected: ${failure.message}`);
    if (port === opened) port = null;
  });
  port = opened;
  return opened;
}

function toApp(message) {
  try {
    connectHost().postMessage(message);
  } catch {
    port = null;
  }
}

async function setState(patch) {
  await writeState(patch);
  const { state, reason, targetTabId } = await readState();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    const payload =
      tab.id === targetTabId
        ? { state, reason }
        : { state: 'idle', reason: null };
    chrome.tabs
      .sendMessage(tab.id, { type: 'AGENT_STATE', ...payload })
      .catch(() => {});
  }
}

async function ensureInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['page-core.js', 'content.js'],
    });
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.__oaVersion ?? null,
    });
    const expected = chrome.runtime.getManifest().version;
    if (injected.result !== expected) {
      return `this tab is running automation script ${
        injected.result ?? '(none)'
      } but the extension is ${expected} — reload the tab`;
    }
    return null;
  } catch (error) {
    return error.message;
  }
}

async function targetTab() {
  const { targetTabId } = await readState();
  if (targetTabId == null) throw new Error('no target tab');
  return targetTabId;
}

function assertNavigable(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`navigation blocked: "${url}" is not a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `navigation blocked: ${parsed.protocol} is not allowed (http and https only)`
    );
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error(
      `navigation blocked: ${parsed.hostname} was given credentials embedded in the URL`
    );
  }
}

function navigate(tabId, url) {
  assertNavigable(url);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error(`navigation to ${url} timed out`));
    }, NAV_TIMEOUT_MS);

    function onUpdated(changedId, info) {
      if (changedId !== tabId || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url }).catch(error => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      reject(error);
    });
  });
}

// captureVisibleTab takes a windowId, so an inactive target would capture another page.
async function capture(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active) {
    throw new Error(
      'the automated tab is no longer the visible one in its window — switch back to it, then resume'
    );
  }
  try {
    return await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 60,
    });
  } catch (error) {
    throw new Error(`could not screenshot the tab: ${error.message}`);
  }
}

function captureOrReason(tabId) {
  return capture(tabId).then(
    dataUrl => ({ dataUrl }),
    error => ({ error: error.message })
  );
}

async function runStep(id, step) {
  inFlightStepId = id;
  try {
    const tabId = await targetTab();
    const injectionFailure = await ensureInjected(tabId);

    // An assert writes nothing, and holding one reports the wrong problem.
    if (step.kind !== 'assert') {
      const { skipScanOnce } = await readState();
      if (skipScanOnce) {
        await writeState({ skipScanOnce: false });
      } else {
        const scan = await chrome.tabs
          .sendMessage(tabId, { type: 'SCAN' })
          .catch(() => null);
        if (scan && scan.reason) {
          await setState({ state: 'paused', reason: scan.reason });
          toApp({ type: 'paused', reason: scan.reason, auto: true });
          reply(id, { ok: false, held: true, error: scan.reason });
          return;
        }
      }
    }

    if (step.kind === 'navigate') {
      await navigate(tabId, step.url);
      reply(id, { ok: true });
      return;
    }

    if (step.kind === 'screenshot') {
      reply(id, { ok: true, value: await capture(tabId) });
      return;
    }

    if (injectionFailure)
      throw new Error(`cannot act on this page: ${injectionFailure}`);

    const result = await chrome.tabs.sendMessage(tabId, { type: 'EXEC', step });
    reply(id, result);
  } finally {
    if (inFlightStepId === id) inFlightStepId = null;
  }
}

async function snapshot(id) {
  const tabId = await targetTab();
  const injectionFailure = await ensureInjected(tabId);

  // A run may legitimately start on an unreadable chrome:// or new-tab page and navigate away.
  const [tab, shot, page] = await Promise.all([
    chrome.tabs.get(tabId),
    captureOrReason(tabId),
    injectionFailure
      ? { dom: '', title: null, blockedBy: null }
      : chrome.tabs.sendMessage(tabId, { type: 'DOM' }),
  ]);
  reply(id, {
    ok: true,
    url: tab.url ?? '',
    title: page.title ?? null,
    screenshot: shot.dataUrl ?? '',
    screenshotError: shot.error ?? null,
    dom: page.dom ?? '',
    domError: injectionFailure,
    blockedBy: page.blockedBy ?? null,
  });
}

async function control(message) {
  try {
    if (message.type === 'pause') {
      await setState({ state: 'paused', reason: message.reason ?? null });
    } else if (message.type === 'resume') {
      await setState({ state: 'active', reason: null, skipScanOnce: true });
    } else if (message.type === 'stop') {
      if (inFlightStepId) markAbandoned(inFlightStepId);
      await detachDebugger();
      await setState({
        state: 'idle',
        targetTabId: null,
        reason: null,
        skipScanOnce: false,
      });
    } else if (message.type === 'abandon') {
      markAbandoned(message.id);
    }
  } catch (error) {
    console.error(`[agent] ${message.type} failed:`, error);
  }
}

async function handle(message) {
  try {
    if (message.type === 'start') {
      const [active] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (!active) throw new Error('no active tab to automate');
      inputMode = message.inputMode ?? 'auto';
      await setState({
        state: 'active',
        targetTabId: active.id,
        reason: null,
        skipScanOnce: false,
      });
      await ensureAttached(active.id);
      reply(message.id, {
        ok: true,
        tabId: active.id,
        version: chrome.runtime.getManifest().version,
      });
    } else if (message.type === 'step') {
      await runStep(message.id, message.step);
    } else if (message.type === 'snapshot') {
      await snapshot(message.id);
    }
  } catch (error) {
    if (message.id) reply(message.id, { ok: false, error: error.message });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'INPUT') {
    const tabId = sender.tab?.id;
    if (tabId == null) sendResponse('unavailable');
    else void dispatchInput(tabId, message).then(sendResponse);
    return true;
  }

  if (message.type === 'GET_STATE') {
    void readState().then(({ state, reason, targetTabId }) => {
      const fromTarget = sender.tab && sender.tab.id === targetTabId;
      sendResponse(
        fromTarget ? { state, reason } : { state: 'idle', reason: null }
      );
    });
    return true;
  }

  if (message.type === 'PAUSE_REQUESTED') {
    void setState({ state: 'paused', reason: null }).then(() =>
      toApp({ type: 'paused', reason: 'paused by the user', auto: false })
    );
  }

  if (message.type === 'RESUME_REQUESTED') {
    void setState({ state: 'active', reason: null, skipScanOnce: true }).then(
      () => toApp({ type: 'resumed' })
    );
  }
});

chrome.debugger.onDetach.addListener(source => {
  if (source.tabId === attachedTabId) attachedTabId = null;
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === attachedTabId) attachedTabId = null;
  serialize(async () => {
    const { targetTabId } = await readState();
    if (tabId !== targetTabId) return;
    await setState({ state: 'idle', targetTabId: null, reason: null });
    toApp({ type: 'target-closed' });
  });
});

chrome.runtime.onStartup.addListener(connectHost);
chrome.runtime.onInstalled.addListener(connectHost);

// MV3 kills an idle service worker after ~30s, taking the native port with it.
chrome.alarms.create('host-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'host-keepalive') connectHost();
});

connectHost();
