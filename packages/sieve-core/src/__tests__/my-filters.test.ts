import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileFilters, plainReason, withNewLines } from '../index.ts';
import { checkRegexesWithRe2 } from '../node-regex.ts';

await checkRegexesWithRe2();

test('what the compiler says about a bad My filters line comes out in plain words, and an unknown message as it is', async () => {
  const lines = [
    'not a filter ##',
    '/ab(?=c)/',
    '||x.com^$frobnicate=1',
    'example.com##a[b=',
    "example.com#%#//scriptlet('trusted-set-cookie', 'a', 'b')",
    'example.com##+js(nosuch)',
    '$third-party',
    'example.com##div:has-text(x)',
    '||x.com^$redirect=noopjs',
    '||x.com^$domain=',
    'example.com##+js(aopr',
    'example.com##',
  ];
  const out = await compileFilters(lines.join('\n'), { firstId: 1, trusted: true, scriptlets: ['abort-on-property-read'] });
  const said = [...out.errors, ...out.skipped].sort((a, b) => a.line - b.line).map((e) => [e.line, plainReason(e.reason)]);
  assert.deepEqual(said, [
    [1, "Sieve can't read this line as a filter. Check it for typos and stray spaces."],
    [2, "Chrome can't run this regular expression. Take out lookarounds and back-references, or block a plain address."],
    [3, "Sieve doesn't know the option $frobnicate. Check its spelling, or remove it."],
    [4, "This selector isn't valid CSS. Check its brackets and quotes."],
    [5, "trusted-set-cookie isn't available in this build"],
    [6, "nosuch isn't available in this build"],
    [7, 'This filter would block every site. Add an address, or limit it with $domain=.'],
    [8, "Chrome can't run extended selectors such as :has-text(). Use a plain CSS selector."],
    [9, "Sieve can't swap a request for a stand-in file. Remove $redirect to block the request instead."],
    [10, 'An option is missing its value after =. Add the value, or remove the option.'],
    [11, "This scriptlet call isn't complete. Check its brackets and quotes."],
    [12, 'This filter has nothing after ##. Add a selector.'],
  ]);
  assert.equal(plainReason('Some message Sieve has not seen'), 'Some message Sieve has not seen');
});

test('withNewLines adds the lines saved elsewhere since the page loaded, keeps the owner deletions, and adds nothing twice', () => {
  assert.deepEqual(withNewLines('a\nb\nmine', 'a\nb', 'a\nb\nlocalhost##.pick'), { text: 'a\nb\nmine\nlocalhost##.pick', added: 1 });
  assert.deepEqual(withNewLines('a\nmine\n', 'a\nb', 'a\nb\nlocalhost##.pick'), { text: 'a\nmine\nlocalhost##.pick', added: 1 });
  assert.deepEqual(withNewLines('a\nlocalhost##.pick', 'a', 'a\nlocalhost##.pick'), { text: 'a\nlocalhost##.pick', added: 0 });
  assert.deepEqual(withNewLines('', '', 'localhost##.pick'), { text: 'localhost##.pick', added: 1 });
  assert.deepEqual(withNewLines('mine', 'a', 'a'), { text: 'mine', added: 0 });
});
