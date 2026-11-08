import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptlets } from '@adguard/scriptlets';
import { blocksRequest, compileFilters, scriptletKey, stripSections } from '../index.ts';
import { checkRegexesWithRe2 } from '../node-regex.ts';

await checkRegexesWithRe2();

test('network filters become DNR rules numbered from firstId', async () => {
  const out = await compileFilters('||ads.example^$third-party\n@@||ads.example/ok^', { firstId: 1 });
  assert.deepEqual(out.rules.map((r) => r.id), [1, 2]);
  assert.deepEqual(out.allowIds, [2]);
  assert.equal(out.sources[1], '||ads.example^$third-party');
  assert.equal(out.sources[2], '@@||ads.example/ok^');
  assert.ok(out.maxPriority >= Math.max(...out.rules.map((r) => r.priority ?? 1)));
  assert.deepEqual(out.errors, []);
});

test('a rule that only changes response headers or strips query parameters is listed in modifyIds, and a block or allow rule is not', async () => {
  const out = await compileFilters("||ads.example^\n||csp.example^$csp=script-src-attr 'none'\n@@||ads.example/ok^\n||rp.example^$removeparam=utm_source", { firstId: 1 });
  const idsOf = (type: string) => out.rules.filter((r) => r.action.type === type).map((r) => r.id);
  assert.equal(idsOf('modifyHeaders').length, 1);
  assert.equal(idsOf('redirect').length, 1);
  assert.deepEqual(out.modifyIds, [...idsOf('modifyHeaders'), ...idsOf('redirect')].sort((a, b) => a - b));
  assert.deepEqual(out.allowIds, idsOf('allow'));
  assert.equal(out.rules.length, 4);
});

test('blocksRequest: a block and a plain redirect block the request; a redirect that only rewrites the address does not', () => {
  assert.equal(blocksRequest({ type: 'block' }), true);
  assert.equal(blocksRequest({ type: 'redirect', redirect: { extensionPath: '/x.js' } }), true);
  assert.equal(blocksRequest({ type: 'redirect', redirect: { transform: { queryTransform: { removeParams: ['a'] } } } }), false);
  for (const type of ['allow', 'allowAllRequests', 'modifyHeaders', 'upgradeScheme']) assert.equal(blocksRequest({ type }), false, type);
});

test('element hiding fills generic, hide and unhide, with no DNR rules', async () => {
  const out = await compileFilters('##.banner\nexample.com##.promo\nexample.com#@#.banner', { firstId: 1 });
  assert.deepEqual(out.cosmetic.generic, ['.banner']);
  assert.deepEqual(out.cosmetic.hide, { 'example.com': ['.promo'] });
  assert.deepEqual(out.cosmetic.unhide, { 'example.com': ['.banner'] });
  assert.deepEqual(out.rules, []);
});

test('a negated domain exempts that site from the selector', async () => {
  const out = await compileFilters('~foo.com##.ad\n~sub.bar.com,bar.com##.zzz', { firstId: 1 });
  assert.deepEqual(out.cosmetic.generic, ['.ad']);
  assert.deepEqual(out.cosmetic.hide, { 'bar.com': ['.zzz'] });
  assert.deepEqual(out.cosmetic.unhide, { 'foo.com': ['.ad'], 'sub.bar.com': ['.zzz'] });
});

test('filter domains are keyed the way Chrome gives hostnames, and * means every site', async () => {
  const out = await compileFilters('Пример.рф##.ad\nExample.COM##.x\n*##.all\n||пример.рф^', { firstId: 1 });
  assert.deepEqual(out.cosmetic.hide, { 'xn--e1afmkfd.xn--p1ai': ['.ad'], 'example.com': ['.x'] });
  assert.deepEqual(out.cosmetic.generic, ['.all']);
  assert.deepEqual(out.rules, [], 'the converter would turn a non-ASCII address into a rule that matches nothing');
  assert.deepEqual(out.errors.map((e) => e.line), [4]);
});

test(':-abp-has and :if become native :has', async () => {
  const out = await compileFilters('example.com#?#div:-abp-has(> .ad)\nexample.org##div:if(.ad)', { firstId: 1 });
  assert.deepEqual(out.cosmetic.hide, { 'example.com': ['div:has(> .ad)'], 'example.org': ['div:has(.ad)'] });
});

test('extended CSS that Chrome cannot run is dropped', async () => {
  const out = await compileFilters('example.com#?#div:-abp-contains(Sponsored)', { firstId: 1 });
  assert.equal(out.dropped['extended-css'], 1);
  assert.deepEqual(out.cosmetic.hide, {});
  assert.deepEqual(out.errors, []);
});

test('ABP snippets and uBO +js become AdGuard scriptlet calls', async () => {
  const out = await compileFilters('example.com#$#abort-on-property-read adsbygoogle\nexample.com##+js(set-constant, foo, 1)', { firstId: 1 });
  const calls = out.cosmetic.scriptlets['example.com'];
  assert.deepEqual(calls, [
    { name: 'abort-on-property-read', args: ['adsbygoogle'] },
    { name: 'set-constant', args: ['foo', '1'] },
  ]);
  for (const call of calls) assert.equal(typeof scriptlets.getScriptletFunction(call.name), 'function', call.name);
});

test('scriptlet exceptions fill scriptletExcept, an empty one exempts every scriptlet', async () => {
  const out = await compileFilters('example.com#@#+js(set-constant, foo, 1)\nexample.org#@#+js()', { firstId: 1 });
  assert.deepEqual(out.cosmetic.scriptletExcept, {
    'example.com': [scriptletKey({ name: 'set-constant', args: ['foo', '1'] })],
    'example.org': ['*'],
  });
  assert.equal(scriptletKey({ name: 'a', args: ['b'] }), '["a","b"]');
});

test('unknown scriptlets and raw JS are dropped', async () => {
  const out = await compileFilters('example.com##+js(no-such-scriptlet, foo)\nexample.com#%#window.x=1', { firstId: 1 });
  assert.equal(out.dropped['unknown-scriptlet'], 1);
  assert.equal(out.dropped['raw-js'], 1);
  assert.deepEqual(out.cosmetic.scriptlets, {});
});

test('$generichide and $elemhide exceptions list their hosts', async () => {
  const out = await compileFilters('@@||example.com^$generichide\n@@||example.org^$elemhide', { firstId: 1 });
  assert.deepEqual(out.cosmetic.generichide, ['example.com']);
  assert.deepEqual(out.cosmetic.elemhide, ['example.org']);
  assert.deepEqual(out.rules, []);
});

test('bad lines are listed by line number and the good ones still compile', async () => {
  const out = await compileFilters('||[\nnot a filter at all ##\n||ok.example^', { firstId: 1 });
  assert.equal(out.rules.length, 1);
  assert.equal(out.sources[1], '||ok.example^');
  assert.deepEqual(out.errors.map((e) => [e.line, e.text]), [[1, '||['], [2, 'not a filter at all ##']]);
  for (const e of out.errors) assert.ok(e.reason.length > 0);
});

test('comments, headers, blank lines and CRLF are skipped silently', async () => {
  const out = await compileFilters('[Adblock Plus 2.0]\r\n! Title: x\r\n\r\n||ok.example^\r\n', { firstId: 5 });
  assert.deepEqual(out.rules.map((r) => r.id), [5]);
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.dropped, {});
});

test('regexes past regexLimit are dropped', async () => {
  const out = await compileFilters('/ban+er[0-9]/\n/foo(bar|baz)/', { firstId: 1, regexLimit: 1 });
  assert.equal(out.rules.filter((r) => r.condition.regexFilter).length, 1);
  assert.equal(out.dropped['regex-limit'], 1);
});

test('a regex Chrome cannot run is an error on its line', async () => {
  const out = await compileFilters('||ok.example^\n/a(?!b)/', { firstId: 1 });
  assert.equal(out.rules.length, 1);
  assert.deepEqual(out.errors.map((e) => e.line), [2]);
});

test('a $document exception also turns off cosmetic filtering and scriptlets on that site', async () => {
  const out = await compileFilters('@@||example.com^$document\n@@||example.org^$doc', { firstId: 1 });
  assert.equal(out.rules.length, 2);
  assert.deepEqual(out.allowIds, [1, 2]);
  assert.ok(out.rules.every((r) => r.action.type === 'allowAllRequests'));
  assert.deepEqual(out.cosmetic.elemhide, ['example.com', 'example.org']);
  assert.deepEqual(out.cosmetic.scriptletExcept, { 'example.com': ['*'], 'example.org': ['*'] });
});

test('trusted-* scriptlets are dropped unless the list is trusted', async () => {
  const text = "example.com#%#//scriptlet('trusted-set-cookie', 'a', 'b')";
  const untrusted = await compileFilters(text, { firstId: 1 });
  assert.equal(untrusted.dropped['trusted-scriptlet'], 1);
  assert.deepEqual(untrusted.cosmetic.scriptlets, {});
  const trusted = await compileFilters(text, { firstId: 1, trusted: true });
  assert.deepEqual(trusted.cosmetic.scriptlets, { 'example.com': [{ name: 'trusted-set-cookie', args: ['a', 'b'] }] });
  assert.deepEqual(trusted.dropped, {});
});

test('hide exceptions: $specifichide, both kinds at once, URL-style patterns, from=, and $badfilter', async () => {
  const out = await compileFilters(
    [
      '@@||a.com^$specifichide',
      '@@||b.com^$generichide,elemhide',
      '@@||c.com^$generichide,badfilter',
      '@@|https://d.com/$generichide',
      '@@://localhost/$generichide',
      '@@$generichide,from=f.com|~g.f.com',
      '@@||h.com^$constructor',
    ].join('\n'),
    { firstId: 1 },
  );
  assert.deepEqual(out.cosmetic.elemhide, ['a.com', 'b.com']);
  assert.deepEqual(out.cosmetic.generichide, ['b.com', 'd.com', 'localhost', 'f.com']);
  assert.deepEqual(out.errors.map((e) => [e.line, e.reason]), [[7, 'Unknown modifier: constructor']]);
  assert.deepEqual(out.dropped, {});
});

test('procedural selectors are caught before conversion, and :has is never nested', async () => {
  const out = await compileFilters(
    [
      'example.com##.ad:matches-media((min-width: 800px))',
      '##div:remove-attr(x)',
      '##.a:remove-class(b)',
      '##:spath(> .x)',
      '##div:if(:has(.ad))',
      'example.com#?#div:-abp-has(:-abp-has(.x))',
    ].join('\n'),
    { firstId: 1 },
  );
  assert.equal(out.dropped['extended-css'], 6);
  assert.deepEqual(out.cosmetic.generic, []);
  assert.deepEqual(out.cosmetic.hide, {});
});

test('a selector that could break the generated stylesheet is an error, quoted text is fine', async () => {
  const out = await compileFilters('##div /* x\n##.a */\n##.a;b\nexample.com##div[style="width: 1px;"]', { firstId: 1 });
  assert.deepEqual(out.errors.map((e) => e.line), [1, 2, 3]);
  assert.deepEqual(out.cosmetic.hide, { 'example.com': ['div[style="width: 1px;"]'] });
  assert.deepEqual(out.cosmetic.generic, []);
});

test('a backslash outside quotes cannot smuggle a quote or end the stylesheet rule', async () => {
  const out = await compileFilters(
    ['##div\\"a"', '##a\\"b"c', '##div\\', 'example.com#@#div\\', '##.a\\:b', '##a\\3A b', '##[x="q\\"r"]'].join('\n'),
    { firstId: 1 },
  );
  assert.deepEqual(out.errors.map((e) => e.line), [1, 2, 3, 4]);
  assert.deepEqual(out.cosmetic.generic, ['.a\\:b', 'a\\3A b', '[x="q\\"r"]']);
  assert.deepEqual(out.cosmetic.unhide, {});
});

test('a hide exception with other modifiers stays cosmetic, unless it also names $document', async () => {
  const out = await compileFilters(
    ['@@||a.com^$generichide,third-party', '@@||b.com^$elemhide,important', '@@||c.com^$generichide,document'].join('\n'),
    { firstId: 1 },
  );
  assert.deepEqual(out.cosmetic.generichide, ['a.com', 'c.com']);
  assert.deepEqual(out.cosmetic.elemhide, ['b.com', 'c.com']);
  assert.equal(out.rules.length, 1);
  assert.equal(out.rules[0].action.type, 'allowAllRequests');
  assert.deepEqual(out.errors, []);
});

test('a block filter with no address and no domain is too general', async () => {
  const out = await compileFilters('$third-party\n*$script\n$third-party,domain=a.com\n$removeparam=utm_source', { firstId: 1 });
  assert.deepEqual(out.errors.map((e) => e.line), [1, 2]);
  assert.match(out.errors[0].reason, /too general/);
  assert.equal(out.rules.length, 2);
});

test('a dropped filter keeps its line in skipped, and filterLines counts every line that is not blank or a comment', async () => {
  const out = await compileFilters(
    ['! a comment', '', '||a.com^', 'example.com##div:has-text(x)', '#also a comment', '||x.com^$redirect=noopjs', 'example.com#%#window.x=1', '||y.com^$foo'].join('\n'),
    { firstId: 1 },
  );
  assert.deepEqual(out.skipped, [
    { line: 4, text: 'example.com##div:has-text(x)', reason: 'extended-css' },
    { line: 6, text: '||x.com^$redirect=noopjs', reason: 'redirect' },
    { line: 7, text: 'example.com#%#window.x=1', reason: 'raw-js' },
  ]);
  assert.deepEqual(out.dropped, { 'extended-css': 1, redirect: 1, 'raw-js': 1 });
  assert.deepEqual(out.errors.map((e) => e.line), [8]);
  assert.equal(out.filterLines, 5);
  assert.equal(out.rules.length, 1);
});

test('with scriptlets given, a scriptlet outside them is an error on its line; exceptions and listed ones pass', async () => {
  const out = await compileFilters(
    ['example.com##+js(aopr, x)', "example.com#%#//scriptlet('trusted-set-cookie', 'a', 'b')", 'example.com##+js(nosuch, y)', 'example.com#@#+js(set-constant, z, 1)'].join('\n'),
    { firstId: 1, trusted: true, scriptlets: ['abort-on-property-read'] },
  );
  assert.deepEqual(out.errors.map((e) => [e.line, e.reason]), [
    [2, "trusted-set-cookie isn't available in this build"],
    [3, "nosuch isn't available in this build"],
  ]);
  assert.deepEqual(out.cosmetic.scriptlets, { 'example.com': [{ name: 'abort-on-property-read', args: ['x'] }] });
  assert.deepEqual(out.cosmetic.scriptletExcept, { 'example.com': [scriptletKey({ name: 'set-constant', args: ['z', '1'] })] });
});

test('stripSections drops the named sections up to the next one', () => {
  assert.equal(
    stripSections('a\n! easylist_cookie_general_block.txt\nb\n! fanboy_social_general_block.txt\nc', ['easylist_cookie_']),
    'a\n! fanboy_social_general_block.txt\nc',
  );
});
