import test from 'node:test';
import assert from 'node:assert/strict';

import type { NetworkInfo } from 'open-tunnel-native';
import {
  autoConnectDecision,
  describeNetwork,
  forgetNetwork,
  isTrusted,
  parseTrustedNetworks,
  trustNetwork,
  type AutoConnectInput,
} from '../trusted-wifi.ts';

const HOME: NetworkInfo = { connected: true, wifi: true, ssid: 'Home', bssid: 'aa:aa:aa:aa:aa:01' };
const HOME_OTHER_AP: NetworkInfo = { ...HOME, bssid: 'aa:aa:aa:aa:aa:02' };
const EVIL_TWIN: NetworkInfo = { ...HOME, bssid: 'ee:ee:ee:ee:ee:ee' };
const HIDDEN: NetworkInfo = { connected: true, wifi: true, ssid: null, bssid: null };
const MOBILE: NetworkInfo = { connected: true, wifi: false, ssid: null, bssid: null };
const OFFLINE: NetworkInfo = { connected: false, wifi: false, ssid: null, bssid: null };

test('a network is trusted only when its name and access point were both marked', () => {
  const trusted = trustNetwork(HOME, [])!;
  assert.equal(isTrusted(HOME, trusted), true);
  assert.equal(isTrusted(EVIL_TWIN, trusted), false);
  assert.equal(isTrusted(HIDDEN, trusted), false);
  assert.equal(isTrusted(MOBILE, trusted), false);
});

test('marking another access point of the same name adds it; marking twice changes nothing', () => {
  const once = trustNetwork(HOME, [])!;
  const both = trustNetwork(HOME_OTHER_AP, once)!;
  assert.deepEqual(both, [{ ssid: 'Home', bssids: ['aa:aa:aa:aa:aa:01', 'aa:aa:aa:aa:aa:02'] }]);
  assert.deepEqual(trustNetwork(HOME, both), both);
  assert.deepEqual(forgetNetwork('Home', both), []);
});

test('a network Android withheld cannot be marked trusted', () => {
  assert.equal(trustNetwork(HIDDEN, []), null);
  assert.equal(trustNetwork(MOBILE, []), null);
});

test('stored lists drop anything malformed', () => {
  assert.deepEqual(parseTrustedNetworks('nope'), []);
  assert.deepEqual(
    parseTrustedNetworks([{ ssid: 'Home', bssids: ['aa:aa:aa:aa:aa:01', 3] }, { ssid: '', bssids: ['x'] }, { ssid: 'Cafe', bssids: [] }, null]),
    [{ ssid: 'Home', bssids: ['aa:aa:aa:aa:aa:01'] }],
  );
});

const input = (network: NetworkInfo, over: Partial<AutoConnectInput> = {}): AutoConnectInput => ({
  enabled: true,
  network,
  trusted: trustNetwork(HOME, [])!,
  tunnelState: 'disconnected',
  scanning: false,
  ...over,
});

test('an untrusted or unreadable network connects automatically, a trusted one does not', () => {
  assert.equal(autoConnectDecision(null, input(EVIL_TWIN)).connect, true);
  assert.equal(autoConnectDecision(null, input(HIDDEN)).connect, true);
  assert.equal(autoConnectDecision(null, input(MOBILE)).connect, true);
  assert.equal(autoConnectDecision(null, input(HOME)).connect, false);
});

test('off by default means never, and a live tunnel or a running search is left alone', () => {
  assert.equal(autoConnectDecision(null, input(MOBILE, { enabled: false })).connect, false);
  for (const tunnelState of ['connecting', 'connected', 'reasserting', 'disconnecting'] as const) {
    assert.equal(autoConnectDecision(null, input(MOBILE, { tunnelState })).connect, false, tunnelState);
  }
  assert.equal(autoConnectDecision(null, input(MOBILE, { scanning: true })).connect, false);
  assert.equal(autoConnectDecision(null, input(MOBILE, { tunnelState: 'error' })).connect, true);
});

test('each network is decided once, and losing the network decides nothing', () => {
  const first = autoConnectDecision(null, input(MOBILE));
  assert.deepEqual(first, { key: 'mobile', connect: true });
  assert.deepEqual(autoConnectDecision(first.key, input(MOBILE)), { key: 'mobile', connect: false });
  assert.deepEqual(autoConnectDecision(first.key, input(OFFLINE)), { key: null, connect: false });
  assert.equal(autoConnectDecision(null, input(MOBILE)).connect, true);
});

test('the current network is described in plain words', () => {
  const trusted = trustNetwork(HOME, [])!;
  assert.equal(describeNetwork(HOME, trusted), 'Home, trusted');
  assert.equal(describeNetwork(EVIL_TWIN, trusted), 'Home, not trusted');
  assert.match(describeNetwork(HIDDEN, trusted), /Turn on Location and allow precise location/);
  assert.equal(describeNetwork(MOBILE, trusted), 'Mobile data, not trusted');
  assert.equal(describeNetwork(OFFLINE, trusted), 'No network');
  assert.equal(describeNetwork(null, trusted), 'Checking the network');
});
