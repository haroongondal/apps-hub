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

test('the server address is empty in the source until the Worker is deployed', () => {
  assert.equal(SYNC_URL, '');
});

test('defaultBuildHasNoSyncOrigin', () => {
  const { manifest, background } = build();
  assert.equal('host_permissions' in manifest, false);
  assert.deepEqual(manifest.permissions, ['storage', 'alarms', 'activeTab']);
  assert.ok(!background.includes('127.0.0.1'));
});

test('a build-time server address becomes the only host permission', () => {
  const { manifest, background } = build('http://127.0.0.1:4321/');
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1:4321/*']);
  assert.deepEqual(manifest.permissions, ['storage', 'alarms', 'activeTab']);
  assert.ok(background.includes('http://127.0.0.1:4321/'));
});

test('a build refuses a server address that is not https, except on this computer', () => {
  assert.throws(() => build('http://vault.example.com'), /https/);
  assert.ok(build('https://vault.example.com/').manifest.host_permissions[0] === 'https://vault.example.com/*');
});
