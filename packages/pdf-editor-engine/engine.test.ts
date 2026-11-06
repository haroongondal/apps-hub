import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file: string) => fs.readFileSync(new URL(file, import.meta.url), 'utf8');

// PDF.js 3.11.174 is in CVE-2024-4367's range; loading with isEvalSupported: false is the upstream mitigation
test('every getDocument call in core.js loads with eval off', () => {
  const calls = read('./core.js').match(/getDocument\(.*/g) ?? [];
  assert.ok(calls.length > 0, 'core.js calls pdfjsLib.getDocument');
  for (const call of calls) assert.match(call, /isEvalSupported: false/, call);
});

test('the mobile page keeps a CSP with no eval and no web hosts', () => {
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(read('./mobile.html'))?.[1];
  assert.ok(csp, 'mobile.html carries a CSP meta');
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-eval|https?:|\*/);
});
