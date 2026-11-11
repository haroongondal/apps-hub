import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { DEFAULT_YOUTUBE, type YouTubeSettings } from '@apps-hub/sieve-core/src/youtube-settings.ts';
import { screenshotName } from '@apps-hub/sieve-core/src/screenshot.ts';
import { onYouTubeMessage } from '../yt-handler.ts';

type Reply = { ok: boolean; message?: string };

// Slow reads and writes, so two saves that overlap without the lock would lose one.
function setup(options: { setFails?: boolean; downloadFails?: boolean } = {}) {
  const store = new Map<string, unknown>();
  const tabs: unknown[] = [];
  const downloads: unknown[] = [];
  (globalThis as unknown as Record<string, unknown>).chrome = {
    runtime: { getURL: (path: string) => `chrome-extension://sieve/${path}` },
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          await sleep(3);
          return Object.fromEntries([keys].flat().filter((k) => store.has(k)).map((k) => [k, structuredClone(store.get(k))]));
        },
        set: async (items: Record<string, unknown>) => {
          await sleep(3);
          if (options.setFails) throw new Error('QUOTA_BYTES quota exceeded');
          for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v));
        },
      },
    },
    tabs: { create: async (props: unknown) => void tabs.push(props) },
    downloads: {
      download: async (options_: unknown) => {
        if (options.downloadFails) throw new Error('Invalid filename');
        downloads.push(options_);
        return 1;
      },
    },
  };
  // `false` means no later reply: one given at once still counts.
  const send = async (message: unknown) => {
    let respond: (r: Reply) => void = () => {};
    const replied = new Promise<Reply>((r) => (respond = r));
    const handled = onYouTubeMessage(message, {} as chrome.runtime.MessageSender, (r) => respond(r as Reply));
    return { handled, reply: handled ? await replied : await Promise.race([replied, undefined]) };
  };
  return { store, tabs, downloads, send, youtube: () => store.get('youtube') as YouTubeSettings | undefined };
}

test('two concurrent yt-set messages both land', async () => {
  const { send, youtube } = setup();
  const [a, b] = await Promise.all([send({ type: 'yt-set', patch: { player: { cinema: true } } }), send({ type: 'yt-set', patch: { player: { expand: true } } })]);
  assert.deepEqual([a.handled, a.reply, b.reply], [true, { ok: true }, { ok: true }]);
  assert.equal(youtube()?.player.cinema, true);
  assert.equal(youtube()?.player.expand, true);
});

test('a patch is validated before it is stored', async () => {
  const { send, youtube } = setup();
  await send({ type: 'yt-set', patch: { volume: { level: 900 } } });
  assert.equal(youtube()?.volume.level, 100);
  assert.deepEqual({ ...youtube(), volume: { ...youtube()!.volume, level: 50 } }, DEFAULT_YOUTUBE);
});

test('a patch that is not an object leaves storage unchanged and answers ok', async () => {
  const { send, store } = setup();
  assert.deepEqual((await send({ type: 'yt-set', patch: 'x' })).reply, { ok: true });
  assert.equal(store.has('youtube'), false);
});

test('a failed write answers with a message', async () => {
  const { send } = setup({ setFails: true });
  const errors = console.error;
  console.error = () => {};
  const { reply } = await send({ type: 'yt-set', patch: { theme: { dark: true } } });
  console.error = errors;
  assert.equal(reply?.ok, false);
  assert.match(reply?.message ?? '', /could not save/);
});

test('open-settings opens the YouTube section of the settings page', async () => {
  const { send, tabs } = setup();
  const { handled } = await send({ type: 'open-settings', section: 'youtube' });
  assert.equal(handled, false);
  assert.deepEqual(tabs, [{ url: 'chrome-extension://sieve/options.html#youtube' }]);
});

test('other messages are left to the other listeners', async () => {
  const { send, tabs, store } = setup();
  assert.equal((await send({ type: 'pick' })).handled, false);
  assert.equal((await send(null)).handled, false);
  assert.equal((await send({ type: 'open-settings', section: 'other' })).handled, false);
  assert.equal(tabs.length + store.size, 0);
});

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('yt-screenshot saves a PNG in the Sieve folder of Downloads, under a name a title cannot change', async () => {
  const { send, downloads } = setup();
  const { handled, reply } = await send({ type: 'yt-screenshot', dataUrl: PNG, title: 'a/b:c*?"<>|d', seconds: 5 });
  assert.deepEqual([handled, reply], [true, { ok: true }]);
  assert.deepEqual(downloads, [{ url: PNG, filename: 'Sieve/' + screenshotName('a/b:c*?"<>|d', 5), conflictAction: 'uniquify', saveAs: false }]);
  assert.equal((downloads[0] as { filename: string }).filename, 'Sieve/a b c d 0-05.png');
});

test('yt-screenshot copes with a missing title and time', async () => {
  const { send, downloads } = setup();
  await send({ type: 'yt-screenshot', dataUrl: PNG });
  await send({ type: 'yt-screenshot', dataUrl: PNG, title: 7, seconds: 'x' });
  assert.deepEqual(downloads.map((d) => (d as { filename: string }).filename), ['Sieve/YouTube video 0-00.png', 'Sieve/YouTube video 0-00.png']);
});

test('yt-screenshot refuses anything that is not a PNG data URL, or is too big, without downloading', async () => {
  const { send, downloads } = setup();
  const message = 'the picture is not a PNG or is too big';
  for (const dataUrl of ['data:image/jpeg;base64,/9j/4AAQ', 'https://example.com/a.png', 42, undefined, PNG + 'A'.repeat(64 * 1024 * 1024)]) {
    assert.deepEqual((await send({ type: 'yt-screenshot', dataUrl, title: 't', seconds: 1 })).reply, { ok: false, message });
  }
  assert.equal(downloads.length, 0);
});

test('a failed download answers with the browser\'s message', async () => {
  const { send } = setup({ downloadFails: true });
  assert.deepEqual((await send({ type: 'yt-screenshot', dataUrl: PNG, title: 't', seconds: 1 })).reply, { ok: false, message: 'Invalid filename' });
});
