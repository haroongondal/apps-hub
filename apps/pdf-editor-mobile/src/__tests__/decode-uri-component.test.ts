import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// The copy this app ships: expo-router → query-string 7 → decode-uri-component 0.2.2, patched in /patches for
// GHSA-vcc3-ghjq-m6fr and GHSA-qr28-fpjm-wq7f (the fixed 0.5.1 is ESM-only and breaks query-string's require()).
const fromRouter = createRequire(createRequire(import.meta.url).resolve('expo-router/package.json'));
const decode: (input: string) => string = createRequire(fromRouter.resolve('query-string'))('decode-uri-component');

test('decode-uri-component keeps its answers', () => {
  const cases: [string, string][] = [
    ['st%C3%A5le', 'ståle'],
    ['a+b', 'a b'],
    ['%C2', '�'],
    ['%C2%B5%', 'µ%'],
    ['%ab%C2%B5', '%abµ'],
    ['%FE%FF', '��'],
    ['%E0%A4%A', '%E0%A4%A'],
  ];
  for (const [input, out] of cases) assert.equal(decode(input), out, input);
});

test('a crafted link with broken escapes decodes in linear time', () => {
  const start = performance.now();
  decode('%C2'.repeat(20000) + '%' + 'a%ab'.repeat(20000));
  assert.ok(performance.now() - start < 2000, 'the unpatched decoder takes minutes here');
});
