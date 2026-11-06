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
  for (const input of [undefined, null, 'x', 42, true, [], [1, 2], { version: 9 }, { version: '1' }, { version: null }]) {
    assert.deepEqual(validateSettings(input), DEFAULT_SETTINGS, JSON.stringify(input));
  }
});

test('a missing version is read as version 1, so partial input keeps what it set', () => {
  const out = validateSettings({ blocking: { lists: { ads: false } } });
  assert.equal(out.blocking.lists.ads, false);
  assert.deepEqual(out.blocking.lists, { ...DEFAULT_SETTINGS.blocking.lists, ads: false });
  assert.equal(validateSettings({ enabled: false }).enabled, false);
  assert.equal(validateSettings({ version: undefined, enabled: false }).enabled, false);
  assert.deepEqual(validateSettings({}), DEFAULT_SETTINGS);
});

test('the {version: 1} path never aliases DEFAULT_SETTINGS', () => {
  const out = validateSettings({ version: 1 });
  assert.notEqual(out, DEFAULT_SETTINGS);
  assert.notEqual(out.blocking, DEFAULT_SETTINGS.blocking);
  assert.notEqual(out.blocking.lists, DEFAULT_SETTINGS.blocking.lists);
  assert.notEqual(out.blocking.allowlist, DEFAULT_SETTINGS.blocking.allowlist);
  assert.notEqual(out.blocking.youtubeAllowedChannels, DEFAULT_SETTINGS.blocking.youtubeAllowedChannels);
  const snapshot = structuredClone(DEFAULT_SETTINGS);
  out.blocking.lists.ads = false;
  out.blocking.allowlist.push({ kind: 'site', host: 'x.com' });
  assert.deepEqual(DEFAULT_SETTINGS, snapshot);
});

test('hostile JSON with __proto__ keys at every level neither throws nor pollutes', () => {
  const evil = '{"__proto__":{"polluted":1},"version":1,"enabled":false,"blocking":{"__proto__":{"polluted":2},'
    + '"lists":{"__proto__":{"ads":false},"constructor":{"prototype":{"polluted":3}}},'
    + '"allowlist":[{"kind":"site","host":"a.com","__proto__":{"polluted":4}}],'
    + '"youtubeAllowedChannels":[{"id":"UC1","name":"One","__proto__":{"polluted":5}}]}}';
  const out = validateSettings(JSON.parse(evil));
  assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(out.enabled, false);
  assert.deepEqual(out.blocking.lists, DEFAULT_SETTINGS.blocking.lists);
  assert.deepEqual(out.blocking.allowlist, [{ kind: 'site', host: 'a.com' }]);
  assert.deepEqual(out.blocking.youtubeAllowedChannels, [{ id: 'UC1', name: 'One' }]);
  assert.equal(Object.getPrototypeOf(out.blocking.lists), Object.prototype);
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

function sites(...hosts: unknown[]) {
  return validateSettings({ version: 1, blocking: { allowlist: hosts.map((host) => ({ kind: 'site', host })) } }).blocking.allowlist;
}

test('allowlist: empty labels, a numeric last label that is not IPv4, and padded hosts', () => {
  const hosts = ['.a.com', 'a..com', '.', 'example.123', '01.2.3.4', '1.2.3', ' Sub.A.com '];
  assert.deepEqual(sites(...hosts), [{ kind: 'site', host: 'sub.a.com' }]);
});

test('allowlist: one trailing dot is stripped, so a tab host like example.com. still works', () => {
  assert.deepEqual(sites('example.com.'), [{ kind: 'site', host: 'example.com' }]);
  assert.deepEqual(sites('example.com.', 'Example.com', 'a.com..', '.'), [{ kind: 'site', host: 'example.com' }]);
});

test('allowlist: labels follow DNS rules (hyphens inside, at most 63 characters, host at most 253)', () => {
  const label63 = 'a'.repeat(63);
  const long = Array.from({ length: 5 }, () => label63).join('.');
  assert.deepEqual(sites('-a.com', 'a-.com', 'a_b.com', `${'a'.repeat(64)}.com`, long, 'a-b.com', `${label63}.com`), [
    { kind: 'site', host: 'a-b.com' },
    { kind: 'site', host: `${label63}.com` },
  ]);
});

test('allowlist: hex and other numeric-looking last labels that are not a plain IPv4 are dropped', () => {
  assert.deepEqual(sites('example.0x10', '0x7f.0.0.1', '127.1', '1.2.3.4'), [{ kind: 'site', host: '1.2.3.4' }]);
});

test('allowlist: www. is a host of its own, not folded into the bare domain', () => {
  assert.deepEqual(sites('www.example.com'), [{ kind: 'site', host: 'www.example.com' }]);
  assert.deepEqual(sites('www.example.com', 'example.com'), [
    { kind: 'site', host: 'www.example.com' },
    { kind: 'site', host: 'example.com' },
  ]);
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

test('allowlist: page urls lose any username and password', () => {
  const out = validateSettings({
    version: 1,
    blocking: { allowlist: [{ kind: 'page', url: 'https://user:secret@a.com/p#x' }, { kind: 'page', url: 'https://a.com/p' }] },
  });
  assert.deepEqual(out.blocking.allowlist, [{ kind: 'page', url: 'https://a.com/p' }]);
});

test('allowlist: a page whose host Chrome refuses in a match pattern is dropped; IPv4 hosts and ports stay', () => {
  const out = validateSettings({
    version: 1,
    blocking: {
      allowlist: [
        { kind: 'page', url: 'http://a*b.com/p' },
        { kind: 'page', url: 'http://a_b.com/p' },
        { kind: 'page', url: 'http://[::1]/p' },
        { kind: 'page', url: 'https://127.0.0.1:8443/x' },
        { kind: 'page', url: 'http://localhost:8080/y' },
      ],
    },
  });
  assert.deepEqual(out.blocking.allowlist, [
    { kind: 'page', url: 'https://127.0.0.1:8443/x' },
    { kind: 'page', url: 'http://localhost:8080/y' },
  ]);
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

test('channels: id and name are stored trimmed, and dedupe uses the trimmed id', () => {
  const out = validateSettings({
    version: 1,
    blocking: {
      youtubeAllowedChannels: [
        { id: ' UC1 ', name: '  One ' },
        { id: 'UC1', name: 'One again' },
      ],
    },
  });
  assert.deepEqual(out.blocking.youtubeAllowedChannels, [{ id: 'UC1', name: 'One' }]);
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
