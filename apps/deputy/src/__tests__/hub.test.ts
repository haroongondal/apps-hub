import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('Deputy links the AI hub client, whose manifest brings the AI_HUB permission and the hub query', () => {
  assert.equal(JSON.parse(read('package.json')).dependencies['ai-hub-client'], 'workspace:*');
  assert.match(read('modules/deputy-agent/android/build.gradle'), /implementation project\(':ai-hub-client'\)/);
  const client = readFileSync(join(root, '..', '..', 'packages', 'ai-hub-client', 'android', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  assert.match(client, /<uses-permission android:name="com\.haroon\.permission\.AI_HUB" \/>/);
  assert.match(client, /<package android:name="com\.haroon\.aihub" \/>/);
});
