import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// The owner's AI address is the second network surface (after Gmail): these pin where it lives and how a key is kept from leaving it.
const main = join(import.meta.dirname, '..', '..', 'modules', 'inflow-core', 'android', 'src', 'main');
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
const sources = files(main).filter((f) => f.endsWith('.kt'));
const config = readFileSync(join(main, 'java', 'expo', 'modules', 'inflowcore', 'android', 'AiConfig.kt'), 'utf8');

test('HttpURLConnection appears only in the AI client and the Gmail client (Gmail itself speaks IMAP)', () => {
  const users = sources.filter((f) => readFileSync(f, 'utf8').includes('HttpURLConnection')).map((f) => f.slice(f.lastIndexOf('/') + 1)).sort();
  assert.ok(users.includes('AiConfig.kt'));
  assert.deepEqual(users.filter((u) => u !== 'AiConfig.kt' && u !== 'GmailClient.kt'), []);
});

test('an AI request goes only to an https address, is never redirected, and a key is read for its own address only', () => {
  assert.match(config, /startsWith\("https:\/\/"\)/);
  assert.match(config, /instanceFollowRedirects = false/);
  assert.match(config, /base_url = \?/);
});
