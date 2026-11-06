import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// The rules live only in the committed prebuild, so a re-run `expo prebuild` would silently drop them.
const main = join(import.meta.dirname, '..', '..', 'android', 'app', 'src', 'main');

test('the manifest points at the data extraction rules', () => {
  const manifest = readFileSync(join(main, 'AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.match(manifest, /android:allowBackup="false"/);
});

test('cloud backup and device transfer both exclude every app data domain', () => {
  const rules = readFileSync(join(main, 'res', 'xml', 'data_extraction_rules.xml'), 'utf8');
  for (const section of ['cloud-backup', 'device-transfer']) {
    const body = rules.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))?.[1];
    assert.ok(body, `<${section}> is missing`);
    for (const domain of ['root', 'file', 'database', 'sharedpref']) {
      assert.match(body, new RegExp(`<exclude domain="${domain}" path="\\." />`), `${section} doesn't exclude ${domain}`);
    }
  }
});
