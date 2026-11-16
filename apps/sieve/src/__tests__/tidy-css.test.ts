import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8');
const css = read('../yt/tidy.css').replace(/\/\*[\s\S]*?\*\//g, '');
const names = read('../yt/tidy-selectors.ts');
const tidy = read('../yt/tidy.ts');

// A whole token, so a name that is only part of a recorded one (ytd-comment in ytd-comments) does not count.
const recorded = (t: string): boolean => new RegExp(`${/^[a-z]/.test(t) ? '(^|[^\\w-])' : ''}${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(names);
const rules = css.split('}').flatMap((block) => (block.includes('{') ? [block.slice(0, block.indexOf('{'))] : []));
const selectors = rules.flatMap((head) => head.split(',').map((s) => s.trim()).filter(Boolean));

test('tidy.css has rules, each gated by a flag on <html>', () => {
  assert.ok(selectors.length >= 15);
  for (const s of selectors) assert.match(s, /^html\[sieve-yt~="[a-z-]+"\] \S/, s);
});

test('every element, class, id and attribute tidy.css names is recorded in tidy-selectors.ts', () => {
  for (const s of selectors) {
    const rest = s.replace(/^html\[sieve-yt~="[a-z-]+"\] /, '');
    const attributes = rest.match(/\[[^\]]+\]/g) ?? [];
    const plain = rest.replace(/\[[^\]]+\]/g, ' ').replace(/:has\(|\)/g, ' ');
    const tokens = [...attributes, ...(plain.match(/[.#]?[a-z][a-z0-9_-]*/g) ?? [])];
    assert.ok(tokens.length > 0, s);
    for (const t of tokens) assert.ok(recorded(t), `${t} (in "${s}") is not in tidy-selectors.ts`);
  }
});

test('the flags tidy.css gates on are the ones tidy.ts sets, and the other way round', () => {
  const inCss = new Set([...css.matchAll(/sieve-yt~="([a-z-]+)"/g)].map((m) => m[1]));
  const inTs = new Set([...tidy.matchAll(/\['(hide-[a-z]+)', '/g)].map((m) => m[1]));
  assert.ok(inCss.size >= 5);
  assert.deepEqual([...inCss].sort(), [...inTs].sort());
});
