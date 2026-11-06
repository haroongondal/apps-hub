import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOW_FIRST_ID, allowRules, excludePatterns, isAllowed } from '../index.ts';

const site = (host: string) => ({ kind: 'site' as const, host });
const page = (url: string) => ({ kind: 'page' as const, url });

test('a site entry covers the host and its subdomains, not look-alikes', () => {
  assert.equal(isAllowed('https://shop.example.com/a', [site('example.com')]), true);
  assert.equal(isAllowed('https://example.com/', [site('example.com')]), true);
  assert.equal(isAllowed('https://notexample.com/', [site('example.com')]), false);
  assert.equal(isAllowed('https://example.com.evil.net/', [site('example.com')]), false);
});

test('a www. entry is its own host: it does not cover the bare domain', () => {
  assert.equal(isAllowed('https://example.com/', [site('www.example.com')]), false);
  assert.equal(isAllowed('https://www.example.com/', [site('www.example.com')]), true);
});

test('a tab hostname with a trailing dot still matches', () => {
  assert.equal(isAllowed('https://example.com./x', [site('example.com')]), true);
});

test('a page entry matches the same page with any hash, ignoring userinfo', () => {
  assert.equal(isAllowed('https://a.com/p?q=1#x', [page('https://a.com/p?q=1')]), true);
  assert.equal(isAllowed('https://user:pw@a.com/p?q=1', [page('https://a.com/p?q=1')]), true);
  assert.equal(isAllowed('https://a.com/p?q=2', [page('https://a.com/p?q=1')]), false);
  assert.equal(isAllowed('https://a.com/p/more', [page('https://a.com/p')]), false);
});

test('IP and localhost entries match exactly', () => {
  assert.equal(isAllowed('http://10.0.0.1:8080/', [site('10.0.0.1')]), true);
  assert.equal(isAllowed('http://110.0.0.1/', [site('10.0.0.1')]), false);
  assert.equal(isAllowed('https://localhost:8443/ads.html', [site('localhost')]), true);
});

test('isAllowed never throws and says no for bad, non-web and IPv6 addresses', () => {
  for (const url of ['', 'not a url', 'chrome://extensions', 'file:///Users/x/a.html', 'http://[::1]/', 'https://[2001:db8::1]:8443/x']) {
    assert.equal(isAllowed(url, [site('example.com'), site('extensions'), page('https://a.com/')]), false, url);
  }
  assert.equal(isAllowed('https://example.com/', []), false);
});

test('a site entry becomes one allowAllRequests rule for main and sub frames', () => {
  assert.deepEqual(allowRules([site('example.com')], 1_000_000, 500), [
    { id: 1_000_000, priority: 500, action: { type: 'allowAllRequests' }, condition: { requestDomains: ['example.com'], resourceTypes: ['main_frame', 'sub_frame'] } },
  ]);
});

test('a page entry becomes an anchored, escaped, case-sensitive regex that allows a hash', () => {
  const [rule] = allowRules([page('https://a.com/p.html?q=(1)+x')], 7, 9);
  assert.equal(rule.id, 7);
  assert.equal(rule.priority, 9);
  assert.deepEqual(rule.action, { type: 'allowAllRequests' });
  const regex = rule.condition.regexFilter as string;
  assert.equal(regex, '^https://a\\.com/p\\.html\\?q=\\(1\\)\\+x(#.*)?$');
  assert.equal(rule.condition.isUrlFilterCaseSensitive, true);
  assert.deepEqual(rule.condition.resourceTypes, ['main_frame', 'sub_frame']);
  const re = new RegExp(regex);
  assert.ok(re.test('https://a.com/p.html?q=(1)+x'));
  assert.ok(re.test('https://a.com/p.html?q=(1)+x#top'));
  assert.ok(!re.test('https://a.com/pxhtml?q=(1)+x'));
  assert.ok(!re.test('https://a.com/p.html?q=(1)+xy'));
});

test('rule ids count up from firstId in entry order', () => {
  const ids = allowRules([site('a.com'), page('https://b.com/'), site('c.com')], ALLOW_FIRST_ID, 2).map((r) => r.id);
  assert.deepEqual(ids, [ALLOW_FIRST_ID, ALLOW_FIRST_ID + 1, ALLOW_FIRST_ID + 2]);
  assert.equal(ALLOW_FIRST_ID, 1_000_000);
});

test('excludePatterns: hosts with their subdomains, IPs exactly, pages as a prefix', () => {
  assert.deepEqual(excludePatterns(['example.com', '10.0.0.1'], ['https://a.com/p']), ['*://*.example.com/*', '*://10.0.0.1/*', '*://a.com/p*']);
  assert.deepEqual(excludePatterns([], []), []);
});

test('excludePatterns drops a page port, which Chrome refuses after `*://`; a pattern with no port matches every port', () => {
  assert.deepEqual(excludePatterns(['localhost'], ['http://localhost:8080/x?y=1']), ['*://*.localhost/*', '*://localhost/x?y=1*']);
  assert.deepEqual(excludePatterns([], ['https://[2001:db8::1]:8443/x']), ['*://[2001:db8::1]/x*']);
});
