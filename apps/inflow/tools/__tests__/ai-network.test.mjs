import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// Inflow has no AI network code of its own any more: AI goes through AI hub on the phone. These pin that it stays that way.
const root = join(import.meta.dirname, '..', '..');
const main = join(root, 'modules', 'inflow-core', 'android', 'src', 'main');
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
const kotlin = files(main).filter((f) => f.endsWith('.kt'));
const read = (f) => readFileSync(f, 'utf8');

test('no source opens an http connection or names an AI provider address', () => {
  for (const f of kotlin) {
    const text = read(f);
    for (const word of ['HttpURLConnection', 'api.groq.com', 'generativelanguage', 'OkHttp']) assert.ok(!text.includes(word) || (word === 'generativelanguage' && f.endsWith('AiSwitch.kt')), `${f} mentions ${word}`); // AiSwitch.kt reads the old default address to decide the upgrade, nothing is sent there
  }
});

test('the only way to AI is the hub client, built in one file', () => {
  const users = kotlin.filter((f) => read(f).includes('AiHubClient(')).map((f) => f.slice(f.lastIndexOf('/') + 1));
  assert.deepEqual(users, ['AiConfig.kt']);
});

test('the TypeScript side has no AI key or model screen', () => {
  const src = files(join(root, 'src')).filter((f) => /\.tsx?$/.test(f) && !f.includes('__tests__'));
  for (const f of src) assert.ok(!/addAiKey|removeAiKey|testAiKey|setAiModel|knownModels/.test(read(f)), f);
});
