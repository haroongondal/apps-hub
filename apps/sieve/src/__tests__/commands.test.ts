import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onCommand } from '../commands.ts';

function setup(sendFails = false) {
  const sent: unknown[][] = [];
  let opened = 0;
  (globalThis as unknown as Record<string, unknown>).chrome = {
    runtime: { openOptionsPage: async () => void opened++ },
    tabs: {
      sendMessage: async (...args: unknown[]) => {
        sent.push(args);
        if (sendFails) throw new Error('Could not establish connection. Receiving end does not exist.');
      },
    },
  };
  return { sent, opened: () => opened };
}

const tab = (id: number) => ({ id }) as chrome.tabs.Tab;

test('yt-loop goes to the tab with no frame id, so every frame gets it', async () => {
  const { sent } = setup();
  await onCommand('yt-loop', tab(7));
  assert.deepEqual(sent, [[7, { type: 'yt-command', action: 'loop' }]]);
});

test('a quality command sends the id after yt-', async () => {
  const { sent } = setup();
  await onCommand('yt-quality-hd1080', tab(3));
  assert.deepEqual(sent, [[3, { type: 'yt-command', action: 'quality-hd1080' }]]);
});

test('open-settings opens the settings page and sends nothing', async () => {
  const { sent, opened } = setup();
  await onCommand('open-settings');
  assert.equal(opened(), 1);
  assert.deepEqual(sent, []);
});

test('an unknown command, a missing tab or a tab with no id send nothing', async () => {
  const { sent, opened } = setup();
  await onCommand('yt-nope', tab(7));
  await onCommand('yt-loop');
  await onCommand('yt-loop', {} as chrome.tabs.Tab);
  await onCommand('_execute_action', tab(7));
  assert.deepEqual(sent, []);
  assert.equal(opened(), 0);
});

test('a tab with no receiver (not YouTube) does not throw', async () => {
  const { sent } = setup(true);
  await onCommand('yt-loop', tab(7));
  assert.equal(sent.length, 1);
});
