(() => {
  // Re-injection cannot replace a script already running in the tab.
  if (window.__oaVersion) return;
  window.__oaVersion = chrome.runtime.getManifest().version;

  const core = window.__oaCore.create({
    requestInput: async (request) => {
      try {
        return await chrome.runtime.sendMessage({ type: 'INPUT', ...request });
      } catch {
        return 'unavailable';
      }
    },
    control: (type) => {
      const message = type === 'pause' ? 'PAUSE_REQUESTED' : 'RESUME_REQUESTED';
      chrome.runtime.sendMessage({ type: message }).catch(() => {});
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'AGENT_STATE') {
      core.render(message);
      return;
    }

    if (message.type === 'SCAN') {
      sendResponse({ reason: core.scanSensitive() });
      return;
    }

    if (message.type === 'DOM') {
      sendResponse(core.dom());
      return;
    }

    if (message.type === 'EXEC') {
      core.exec(message.step).then(sendResponse);
      return true;
    }
  });

  chrome.runtime
    .sendMessage({ type: 'GET_STATE' })
    .then((state) => state && core.render(state))
    .catch(() => {});
})();
