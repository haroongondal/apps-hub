import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// Inflow's only network code is Gmail over IMAP/TLS; these pin that surface so a change to it fails here first.
const app = join(import.meta.dirname, '..', '..');
const read = (...p) => readFileSync(join(app, ...p), 'utf8');
const client = read('modules', 'inflow-core', 'android', 'src', 'main', 'java', 'expo', 'modules', 'inflowcore', 'android', 'GmailClient.kt');

test('the Gmail client talks only to imap.gmail.com:993 and checks the server identity', () => {
  assert.match(client, /HOST = "imap\.gmail\.com"/);
  assert.match(client, /PORT = 993\b/);
  assert.match(client, /"mail\.imaps\.ssl\.checkserveridentity", "true"/);
});

test('neither manifest allows cleartext traffic or asks for package or contact access', () => {
  const manifests = [
    read('modules', 'inflow-core', 'android', 'src', 'main', 'AndroidManifest.xml'),
    read('android', 'app', 'src', 'main', 'AndroidManifest.xml'),
  ];
  for (const m of manifests) {
    assert.doesNotMatch(m, /usesCleartextTraffic="true"/);
    assert.doesNotMatch(m, /QUERY_ALL_PACKAGES/);
    assert.doesNotMatch(m, /READ_CONTACTS/);
  }
});
