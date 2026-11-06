import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, FEATURES, validateSettings } from '../index.ts';

test('FEATURES lists the six features in order', () => {
  assert.deepEqual(FEATURES, ['ads', 'trackers', 'distraction', 'cookies', 'antiadblock', 'ai']);
});

test('defaults: every list is on except ai, nothing paused or allowlisted', () => {
  assert.equal(DEFAULT_SETTINGS.version, 1);
  assert.equal(DEFAULT_SETTINGS.enabled, true);
  assert.equal(DEFAULT_SETTINGS.blocking.paused, false);
  assert.equal(DEFAULT_SETTINGS.blocking.denyNotifications, true);
  assert.equal(DEFAULT_SETTINGS.blocking.lists.ai, false);
  for (const key of FEATURES) {
    if (key !== 'ai') assert.equal(DEFAULT_SETTINGS.blocking.lists[key], true, key);
  }
  assert.deepEqual(DEFAULT_SETTINGS.blocking.allowlist, []);
  assert.equal(DEFAULT_SETTINGS.blocking.myFilters, '');
  assert.deepEqual(DEFAULT_SETTINGS.blocking.youtubeAllowedChannels, []);
});

test('unusable input gives the defaults', () => {
  for (const input of [undefined, null, 'x', 42, true, [], [1, 2], { version: 9 }, { version: '1' }]) {
    assert.deepEqual(validateSettings(input), DEFAULT_SETTINGS, JSON.stringify(input));
  }
});

test('a partial lists object keeps what was set and fills the rest', () => {
  const out = validateSettings({ version: 1, blocking: { lists: { ads: false } } });
  assert.equal(out.blocking.lists.ads, false);
  assert.deepEqual(out.blocking.lists, { ...DEFAULT_SETTINGS.blocking.lists, ads: false });
});

test('non-boolean switches fall back to their defaults', () => {
  const out = validateSettings({
    version: 1,
    enabled: 'no',
    blocking: { paused: 1, denyNotifications: null, lists: { ads: 'false', ai: true, trackers: 0 } },
  });
  assert.equal(out.enabled, true);
  assert.equal(out.blocking.paused, false);
  assert.equal(out.blocking.denyNotifications, true);
  assert.equal(out.blocking.lists.ads, true);
  assert.equal(out.blocking.lists.trackers, true);
  assert.equal(out.blocking.lists.ai, true);
});

test('real booleans are kept', () => {
  const out = validateSettings({
    version: 1,
    enabled: false,
    blocking: { paused: true, denyNotifications: false },
  });
  assert.equal(out.enabled, false);
  assert.equal(out.blocking.paused, true);
  assert.equal(out.blocking.denyNotifications, false);
});

test('allowlist: hosts lowercased and deduped, bad hosts and pages dropped, hash removed', () => {
  const out = validateSettings({
    version: 1,
    blocking: {
      allowlist: [
        { kind: 'site', host: 'Example.COM' },
        { kind: 'site', host: 'example.com' },
        { kind: 'site', host: 'not a host!' },
        { kind: 'page', url: 'ftp://x/y' },
        { kind: 'page', url: 'https://a.com/p#frag' },
      ],
    },
  });
  assert.deepEqual(out.blocking.allowlist, [
    { kind: 'site', host: 'example.com' },
    { kind: 'page', url: 'https://a.com/p' },
  ]);
});

test('allowlist: IPv4 and localhost hosts are accepted, bad IPv4 and junk entries are not', () => {
  const out = validateSettings({
    version: 1,
    blocking: {
      allowlist: [
        { kind: 'site', host: '192.168.1.10' },
        { kind: 'site', host: '999.1.1.1' },
        { kind: 'site', host: '1.2.3.4.5' },
        { kind: 'site', host: 'localhost' },
        { kind: 'site', host: 'xn--mnchen-3ya.de' },
        { kind: 'site', host: '' },
        { kind: 'site', host: 7 },
        { kind: 'other', host: 'a.com' },
        null,
        'a.com',
        42,
      ],
    },
  });
  assert.deepEqual(out.blocking.allowlist, [
    { kind: 'site', host: '192.168.1.10' },
    { kind: 'site', host: 'localhost' },
    { kind: 'site', host: 'xn--mnchen-3ya.de' },
  ]);
});

test('allowlist: empty labels, a numeric last label that is not IPv4, and padded hosts', () => {
  const hosts = ['.a.com', 'a..com', 'a.com.', '.', 'example.123', '01.2.3.4', '1.2.3', ' Sub.A.com '];
  const out = validateSettings({
    version: 1,
    blocking: { allowlist: hosts.map((host) => ({ kind: 'site', host })) },
  });
  assert.deepEqual(out.blocking.allowlist, [{ kind: 'site', host: 'sub.a.com' }]);
});

test('allowlist: pages keep http(s) only, drop the hash, and dedupe; junk urls are dropped', () => {
  const out = validateSettings({
    version: 1,
    blocking: {
      allowlist: [
        { kind: 'page', url: 'http://a.com/p?q=1#x' },
        { kind: 'page', url: 'http://a.com/p?q=1#y' },
        { kind: 'page', url: 'file:///etc/passwd' },
        { kind: 'page', url: 'chrome://settings' },
        { kind: 'page', url: 'javascript:alert(1)' },
        { kind: 'page', url: 'not a url' },
        { kind: 'page', url: 5 },
      ],
    },
  });
  assert.deepEqual(out.blocking.allowlist, [{ kind: 'page', url: 'http://a.com/p?q=1' }]);
});

test('allowlist that is not an array becomes empty', () => {
  assert.deepEqual(validateSettings({ version: 1, blocking: { allowlist: 'a.com' } }).blocking.allowlist, []);
});

test('channels: kept when id and name are non-empty strings, deduped by id', () => {
  const out = validateSettings({
    version: 1,
    blocking: {
      youtubeAllowedChannels: [
        { id: 'UC1', name: 'One' },
        { id: 'UC1', name: 'One again' },
        { id: 'UC2', name: '' },
        { id: '', name: 'No id' },
        { id: 'UC3' },
        { id: 'UC6', name: '   ' },
        { id: 3, name: 'Num' },
        { id: 'UC4', name: 'Four', extra: true },
        null,
        'UC5',
      ],
    },
  });
  assert.deepEqual(out.blocking.youtubeAllowedChannels, [
    { id: 'UC1', name: 'One' },
    { id: 'UC4', name: 'Four' },
  ]);
});

test('unknown keys are dropped at every level', () => {
  const out = validateSettings({
    version: 1,
    extra: 1,
    blocking: { extra: 2, lists: { extra: true, ads: true } },
  });
  assert.deepEqual(out, DEFAULT_SETTINGS);
  assert.deepEqual(Object.keys(out).sort(), ['blocking', 'enabled', 'version']);
  assert.equal('extra' in out.blocking.lists, false);
});

test('myFilters keeps strings as typed and turns anything else into an empty string', () => {
  assert.equal(validateSettings({ version: 1, blocking: { myFilters: 42 } }).blocking.myFilters, '');
  assert.equal(validateSettings({ version: 1, blocking: { myFilters: '||ads.example^\n' } }).blocking.myFilters, '||ads.example^\n');
});

test('a missing or non-object blocking section gives the defaults', () => {
  assert.deepEqual(validateSettings({ version: 1, enabled: false }).blocking, DEFAULT_SETTINGS.blocking);
  assert.deepEqual(validateSettings({ version: 1, blocking: 'x' }).blocking, DEFAULT_SETTINGS.blocking);
  assert.deepEqual(validateSettings({ version: 1, blocking: [] }).blocking, DEFAULT_SETTINGS.blocking);
});

test('results are fresh: mutating one never changes DEFAULT_SETTINGS or the next result', () => {
  const snapshot = structuredClone(DEFAULT_SETTINGS);
  const a = validateSettings(undefined);
  a.enabled = false;
  a.blocking.lists.ads = false;
  a.blocking.allowlist.push({ kind: 'site', host: 'x.com' });
  a.blocking.youtubeAllowedChannels.push({ id: 'a', name: 'b' });
  assert.deepEqual(DEFAULT_SETTINGS, snapshot);
  assert.deepEqual(validateSettings(undefined), snapshot);
  assert.notEqual(validateSettings(undefined), DEFAULT_SETTINGS);
});

test('valid settings round-trip unchanged', () => {
  const s = validateSettings({
    version: 1,
    enabled: false,
    blocking: {
      paused: true,
      lists: { ads: false, trackers: true, distraction: false, cookies: true, antiadblock: false, ai: true },
      denyNotifications: false,
      allowlist: [{ kind: 'site', host: 'a.com' }, { kind: 'page', url: 'https://b.com/x' }],
      myFilters: '##.ad',
      youtubeAllowedChannels: [{ id: 'UC1', name: 'One' }],
    },
  });
  assert.deepEqual(validateSettings(JSON.parse(JSON.stringify(s))), s);
});
