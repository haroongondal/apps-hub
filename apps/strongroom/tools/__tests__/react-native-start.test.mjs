import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// A process the system starts only for autofill must not pay for React Native, and the committed prebuild is what decides that.
const src = join(import.meta.dirname, '..', '..', 'android', 'app', 'src', 'main', 'java', 'com', 'haroon', 'strongroom');
const application = readFileSync(join(src, 'MainApplication.kt'), 'utf8');
const activity = readFileSync(join(src, 'MainActivity.kt'), 'utf8');

test('MainApplication.onCreate does not start React Native', () => {
  const body = application.match(/override fun onCreate\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
  assert.doesNotMatch(body, /loadReactNative/);
  assert.doesNotMatch(body, /ApplicationLifecycleDispatcher/);
});

test('React Native still starts, from MainActivity before it is created', () => {
  assert.match(application, /fun startReactNative\(\)[\s\S]*loadReactNative\(this\)/);
  const body = activity.match(/override fun onCreate\(savedInstanceState: Bundle\?\) \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(body, 'onCreate is missing');
  const start = body.indexOf('startReactNative()');
  assert.ok(start >= 0, 'MainActivity.onCreate never starts React Native');
  assert.ok(start < body.indexOf('super.onCreate'), 'React Native must start before super.onCreate');
});
