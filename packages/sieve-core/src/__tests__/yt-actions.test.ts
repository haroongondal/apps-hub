import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROW_ORDER, SETTINGS_COMMAND, YT_ACTIONS, actionOfCommand, commandsManifest } from '../yt-actions.ts';

test('commandsManifest has 29 actions plus open-settings, descriptions only, no keys', () => {
  const m = commandsManifest();
  assert.equal(YT_ACTIONS.length, 29);
  assert.equal(Object.keys(m).length, 30);
  for (const v of Object.values(m)) assert.deepEqual(Object.keys(v), ['description']);
  assert.equal(m['yt-loop'].description, 'YouTube: loop on or off');
  assert.equal(m['yt-quality-hd1080'].description, 'YouTube: quality 1080p');
  assert.equal(m['yt-quality-auto'].description, 'YouTube: quality auto');
  assert.equal(m['open-settings'].description, 'Open Sieve settings');
  assert.equal(SETTINGS_COMMAND, 'open-settings');
});

test('actionOfCommand maps yt-<id> back to the id and nothing else', () => {
  assert.equal(actionOfCommand('yt-loop'), 'loop');
  assert.equal(actionOfCommand('yt-nope'), null);
  assert.equal(actionOfCommand('open-settings'), null);
  for (const a of YT_ACTIONS) assert.equal(actionOfCommand(`yt-${a.id}`), a.id);
});

test('action ids are unique and the row order is fixed', () => {
  const ids = YT_ACTIONS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ROW_ORDER.length, 13);
  assert.equal(new Set(ROW_ORDER).size, 13);
  assert.equal(ROW_ORDER.indexOf('pip'), ROW_ORDER.indexOf('screenshot') + 1);
  assert.equal(ROW_ORDER.indexOf('download'), ROW_ORDER.indexOf('settings') - 1);
  assert.deepEqual(ROW_ORDER, ['loop', 'speed-down', 'speed', 'speed-up', 'boost', 'cinema', 'expand', 'filters', 'flip', 'screenshot', 'pip', 'download', 'settings']);
});
