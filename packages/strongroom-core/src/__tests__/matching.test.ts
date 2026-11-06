import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Site } from '../entry.ts';
import { matches, normalizeHost, registrableDomain, siteFromUrl } from '../matching.ts';
import { loadPublicSuffixList, publicSuffixRegistrableDomain } from '../public-suffix.ts';

const android = '../../../../apps/strongroom/modules/strongroom-vault/android/src';
const read = (rel: string) => readFileSync(new URL(`${android}/${rel}`, import.meta.url), 'utf8');
loadPublicSuffixList(read('main/resources/public_suffix_list.dat'));

const s = (https: boolean, host: string): Site => ({ https, host });
const m = (saved: Site, requested: Site) => matches([saved], requested);

test('a subdomain matches the registrable domain, in both directions and across siblings', () => {
  assert.ok(m(s(true, 'example.com'), s(true, 'login.example.com')));
  assert.ok(m(s(true, 'login.example.com'), s(true, 'example.com')));
  assert.ok(m(s(true, 'a.example.com'), s(true, 'b.example.com')));
  assert.equal(registrableDomain('login.example.com'), 'example.com');
});

test('a lookalike domain never matches', () => {
  for (const host of ['example.com.evil.io', 'examp1e.com', 'evil-example.com', 'example.co', 'example.org', 'xexample.com']) {
    assert.ok(!m(s(true, 'example.com'), s(true, host)), host);
  }
});

test('the public suffix list is respected, private section included', () => {
  assert.ok(!m(s(true, 'a.github.io'), s(true, 'b.github.io')));
  assert.ok(m(s(true, 'a.github.io'), s(true, 'www.a.github.io')));
  assert.ok(!m(s(true, 'example.co.uk'), s(true, 'evil.co.uk')));
  assert.ok(!m(s(true, 'github.io'), s(true, 'a.github.io')));
});

test('a login saved over https never fills on http', () => {
  assert.ok(!m(s(true, 'example.com'), s(false, 'example.com')));
  assert.ok(m(s(true, 'example.com'), s(true, 'example.com')));
  assert.ok(m(s(false, 'example.com'), s(false, 'example.com')));
  assert.ok(m(s(false, 'example.com'), s(true, 'example.com')));
});

test('an IP address matches only itself, port included', () => {
  assert.ok(m(s(false, '192.168.1.1'), s(false, '192.168.1.1')));
  assert.ok(!m(s(false, '192.168.1.1'), s(false, '192.168.1.1:8080')));
  assert.ok(!m(s(false, '192.168.1.1:8080'), s(false, '192.168.1.1')));
  assert.ok(m(s(false, '192.168.1.1:8080'), s(false, '192.168.1.1:8080')));
  assert.ok(!m(s(false, '1.1.1.1'), s(false, '9.1.1.1')));
  assert.equal(registrableDomain('192.168.1.1'), null);
  assert.equal(registrableDomain('127.1'), null);
  assert.equal(registrableDomain('[::1]:8443'), null);
  assert.ok(m(s(false, '[::1]:8443'), s(false, '[::1]:8443')));
  assert.ok(!m(s(false, '[::1]:8443'), s(false, '[::1]')));
});

test('a registrable domain ignores the port', () => {
  assert.ok(m(s(true, 'example.com'), s(true, 'login.example.com:8443')));
  assert.equal(registrableDomain('login.example.com:8443'), 'example.com');
});

test('hosts normalise: case, trailing dot, IDN and ports', () => {
  assert.equal(normalizeHost('Example.COM.'), 'example.com');
  assert.equal(normalizeHost('bücher.de'), 'xn--bcher-kva.de');
  assert.equal(normalizeHost('BÜCHER.DE.'), 'xn--bcher-kva.de');
  assert.equal(normalizeHost('xn--bcher-kva.de'), 'xn--bcher-kva.de');
  assert.ok(m(s(true, 'Example.COM.'), s(true, 'example.com')));
  assert.ok(m(s(true, 'bücher.de'), s(true, 'xn--bcher-kva.de')));
  assert.equal(normalizeHost('192.168.1.1:8080'), '192.168.1.1:8080');
  assert.equal(normalizeHost('EXAMPLE.com.:8443'), 'example.com:8443');
  assert.equal(normalizeHost('[::1]:8443'), '[::1]:8443');
  assert.equal(normalizeHost('[::1]'), '[::1]');
});

test('IDNA deviation characters never normalise, so they cannot collapse onto another domain', () => {
  for (const h of ['faß.de', 'FAẞ.de', 'aς.com', 'a‌b.com', 'a‍b.com', 'faß.de:8443']) {
    assert.equal(normalizeHost(h), null, h);
    assert.equal(registrableDomain(h), null, h);
  }
  assert.equal(normalizeHost('xn--fa-hia.de'), 'xn--fa-hia.de');
  assert.equal(siteFromUrl('https://faß.de/'), null);
  assert.deepEqual(siteFromUrl('https://xn--fa-hia.de/'), s(true, 'xn--fa-hia.de'));
  assert.ok(!m(s(true, 'fass.de'), s(true, 'faß.de')));
  assert.ok(!m(s(true, 'faß.de'), s(true, 'fass.de')));
  assert.ok(!m(s(true, 'faß.de'), s(true, 'faß.de')));
  assert.ok(!m(s(true, 'fass.de'), s(true, 'xn--fa-hia.de')));
});

test('invalid hosts normalise to null', () => {
  const bad = ['', '.', 'a..b', 'exa mple.com', 'example.com:', 'example.com:0', 'example.com:65536', 'example.com:80:90',
    '::1', '[::1', '[::1]x', 'ex/ample.com', 'a@b.com', `${'x'.repeat(64)}.com`];
  for (const h of bad) assert.equal(normalizeHost(h), null, h);
});

test('siteFromUrl drops default ports and user info, and refuses other schemes', () => {
  assert.deepEqual(siteFromUrl('https://login.example.com/signin?x=1#y'), s(true, 'login.example.com'));
  assert.deepEqual(siteFromUrl('HTTPS://Example.COM:443'), s(true, 'example.com'));
  assert.deepEqual(siteFromUrl('http://example.com:80/'), s(false, 'example.com'));
  assert.deepEqual(siteFromUrl('http://example.com:443/'), s(false, 'example.com:443'));
  assert.deepEqual(siteFromUrl('https://192.168.1.1:8080/admin'), s(true, '192.168.1.1:8080'));
  assert.deepEqual(siteFromUrl('https://[::1]:8443/'), s(true, '[::1]:8443'));
  assert.deepEqual(siteFromUrl('https://evil.com@good.com/'), s(true, 'good.com'));
  assert.deepEqual(siteFromUrl('https://bücher.de/'), s(true, 'xn--bcher-kva.de'));
  for (const url of ['android://abc@com.example/', 'ftp://example.com/', 'example.com', 'https:///path', '']) {
    assert.equal(siteFromUrl(url), null, url);
  }
});

test('a host with no registrable domain matches only the identical host', () => {
  assert.ok(!m(s(false, 'printer'), s(false, 'scanner')));
  assert.ok(!m(s(false, '10.0.0.1'), s(false, '10.0.0.2')));
  assert.ok(m(s(false, 'printer'), s(false, 'printer')));
  assert.ok(m(s(false, '10.0.0.1'), s(false, '10.0.0.1')));
  assert.ok(!m(s(false, 'com'), s(false, 'example.com')));
  assert.ok(!m(s(false, 'example.com'), s(false, 'com')));
  assert.ok(!m(s(false, 'github.io'), s(false, 'a.github.io')));
  assert.ok(m(s(false, 'github.io'), s(false, 'github.io')));
});

test('a login matches when any one of its sites does', () => {
  assert.ok(matches([s(true, 'other.com'), s(true, 'example.com')], s(true, 'www.example.com')));
  assert.ok(!matches([], s(true, 'example.com')));
});

test('the public suffix list passes the upstream publicsuffix.org test cases', () => {
  const arg = (v: string) => (v === 'null' ? null : v.slice(1, -1));
  let cases = 0;
  for (const line of read('test/resources/test_psl.txt').split('\n').filter((l) => l.startsWith('checkPublicSuffix('))) {
    const [, input, expected] = /checkPublicSuffix\((null|'[^']*'), *(null|'[^']*')\);/.exec(line.trim())!;
    const host = arg(input) === null ? null : normalizeHost(arg(input)!);
    const want = arg(expected) === null ? null : normalizeHost(arg(expected)!);
    assert.equal(host === null ? null : publicSuffixRegistrableDomain(host), want, line);
    cases++;
  }
  assert.ok(cases >= 78, `only ${cases} cases parsed`);
});

test('empty labels give no registrable domain', () => {
  for (const h of ['', '.', '.com', 'example..com', 'example.com.']) assert.equal(publicSuffixRegistrableDomain(h), null, h);
  assert.equal(publicSuffixRegistrableDomain('a.github.io'), 'a.github.io');
  assert.equal(publicSuffixRegistrableDomain('github.io'), null);
});
