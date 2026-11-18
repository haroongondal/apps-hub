import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SYNC_URL } from '../sync-url.ts';

const pkg = fileURLToPath(new URL('../../', import.meta.url));

function build(syncUrl?: string): { manifest: any; background: string } {
  const out = mkdtempSync(join(tmpdir(), 'sg-build-'));
  const env: Record<string, string | undefined> = { ...process.env, STRONGROOM_OUT: out, STRONGROOM_SYNC_URL: syncUrl };
  if (syncUrl === undefined) delete env.STRONGROOM_SYNC_URL;
  try {
    execFileSync(process.execPath, ['build.mjs'], { cwd: pkg, env, stdio: 'pipe' });
    return { manifest: JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')), background: readFileSync(join(out, 'background.js'), 'utf8') };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

test('the extension and the phone talk to the same vault server', () => {
  const kotlin = readFileSync(join(pkg, '../strongroom/modules/strongroom-vault/android/src/main/java/expo/modules/strongroomvault/android/SyncConfig.kt'), 'utf8');
  const phone = kotlin.match(/const val BASE_URL = "([^"]*)"/)?.[1];
  assert.match(SYNC_URL, /^https:\/\/[a-z0-9.-]+\.workers\.dev$/);
  assert.equal(SYNC_URL, phone);
});

test('the default build asks only for the vault server origin', () => {
  const { manifest, background } = build();
  assert.deepEqual(manifest.host_permissions, [`${SYNC_URL}/*`]);
  assert.deepEqual(manifest.permissions, ['storage', 'alarms', 'activeTab']);
  assert.ok(background.includes(SYNC_URL));
  assert.ok(!background.includes('127.0.0.1'));
});

test('an empty build-time address builds without sync', () => {
  const { manifest } = build('');
  assert.equal('host_permissions' in manifest, false);
});

test('a build-time server address becomes the only host permission', () => {
  const { manifest, background } = build('http://127.0.0.1:4321/');
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1:4321/*']);
  assert.deepEqual(manifest.permissions, ['storage', 'alarms', 'activeTab']);
  assert.ok(background.includes('http://127.0.0.1:4321/'));
});

test('the store description and the setup text make no claim that a sync build breaks', () => {
  const { description } = JSON.parse(readFileSync(join(pkg, 'src/manifest.json'), 'utf8'));
  const popup = readFileSync(join(pkg, 'src/popup.ts'), 'utf8');
  assert.doesNotMatch(description, /stays on this computer|never leaves|nothing leaves/i);
  assert.match(description, /encrypted/);
  assert.match(description, /sync/i);
  assert.ok(description.length <= 132, String(description.length));
  assert.doesNotMatch(popup, /Nothing leaves it/);
});

test('the anti-goal disclosure (anyone who can use this browser profile can use this vault) is on both the Settings and unlock screens', () => {
  const popup = readFileSync(join(pkg, 'src/popup.ts'), 'utf8');
  assert.match(popup, /anyone who can use this browser profile can use this vault/i);
  const [settingsScreen] = popup.match(/async function settingsScreen\(\)[\s\S]*?\n}/) ?? [];
  const [unlockScreen] = popup.match(/async function unlockScreen\(\)[\s\S]*?\n}/) ?? [];
  assert.match(settingsScreen ?? '', /PROFILE_NOTICE/, 'settingsScreen');
  assert.match(unlockScreen ?? '', /PROFILE_NOTICE/, 'unlockScreen');
});

test('a build refuses a server address that is not https, except on this computer', () => {
  assert.throws(() => build('http://vault.example.com'), /https/);
  assert.ok(build('https://vault.example.com/').manifest.host_permissions[0] === 'https://vault.example.com/*');
});
