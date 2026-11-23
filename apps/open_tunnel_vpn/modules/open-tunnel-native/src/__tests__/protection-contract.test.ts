/** Kill switch and network contract: the adapter against a stand-in; Kotlin and Swift checked as source text. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bindProtection, createProtectionBinding, normalizeKillSwitchStatus, type ProtectionNativeApi } from '../index.ts';

const NATIVE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const kotlinModule = readFileSync(
  join(NATIVE_ROOT, 'android/src/main/java/expo/modules/opentunnelnative/OpenTunnelNativeModule.kt'),
  'utf8',
);
const swiftModule = readFileSync(join(NATIVE_ROOT, 'ios/OpenTunnelNativeModule.swift'), 'utf8');

const PROTECTION_FUNCTIONS = ['getKillSwitchStatus'];
const PROTECTION_EVENTS = ['onKillSwitchChanged'];

test('both platforms declare every protection function and event', () => {
  for (const name of PROTECTION_FUNCTIONS) {
    assert.match(kotlinModule, new RegExp(`AsyncFunction\\("${name}"\\)`), `Kotlin is missing ${name}`);
    assert.match(swiftModule, new RegExp(`AsyncFunction\\("${name}"\\)`), `Swift is missing ${name}`);
  }
  for (const event of PROTECTION_EVENTS) {
    assert.match(kotlinModule, new RegExp(`"${event}"`), `Kotlin is missing ${event}`);
    assert.match(swiftModule, new RegExp(`Events\\([^)]*"${event}"`), `Swift is missing ${event}`);
  }
});

test('the kill switch payload keys match on both platforms', () => {
  for (const key of ['blocking', 'alwaysOn', 'lockdown']) {
    assert.match(kotlinModule, new RegExp(`"${key}" to`), `Kotlin is missing ${key}`);
    assert.match(swiftModule, new RegExp(`"${key}":`), `Swift is missing ${key}`);
  }
});

test('a malformed kill switch status reads as not blocking and unknown', () => {
  assert.deepEqual(normalizeKillSwitchStatus(null), { blocking: false, alwaysOn: null, lockdown: null });
  assert.deepEqual(normalizeKillSwitchStatus({ blocking: 'yes', alwaysOn: 1, lockdown: 'true' }), {
    blocking: false,
    alwaysOn: null,
    lockdown: null,
  });
  assert.deepEqual(normalizeKillSwitchStatus({ blocking: true, alwaysOn: true, lockdown: false }), {
    blocking: true,
    alwaysOn: true,
    lockdown: false,
  });
});

test('the adapter normalizes reads and events and removes its subscription', async () => {
  let listener: ((payload: unknown) => void) | null = null;
  let removed = 0;
  const native: ProtectionNativeApi = {
    getKillSwitchStatus: async () => ({ blocking: true, alwaysOn: null, lockdown: null }),
    addListener: (_event, next) => {
      listener = next;
      return { remove: () => void (removed += 1) };
    },
  };
  const protection = bindProtection(native);
  assert.deepEqual(await protection.getKillSwitchStatus(), { blocking: true, alwaysOn: null, lockdown: null });
  const seen: boolean[] = [];
  const handle = protection.addOnKillSwitchChanged((blocking) => seen.push(blocking));
  listener!({ blocking: true });
  listener!({ blocking: 'no' });
  handle.remove();
  assert.deepEqual(seen, [true, false]);
  assert.equal(removed, 1);
});

test('off a device the binding reports no block, never a protected state', async () => {
  const protection = createProtectionBinding({ platform: 'unavailable' });
  assert.deepEqual(await protection.getKillSwitchStatus(), { blocking: false, alwaysOn: null, lockdown: null });
});
