/**
 * Tunnel-client state-machine tests (node --test, phase 2 plan §5).
 * Pure TS: native event → state mapping (error terminal, retry-out),
 * payload-derived protocol routing, and strict config validation. The
 * binding under test is created with an injected stand-in through
 * `createTunnelClient`, so no native surface is required here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createVpnNode, sanitizeOpenVpnConfig, type VpnNode } from 'open-tunnel-core';
import {
  OPEN_TUNNEL_ERROR_CODES,
  OPEN_TUNNEL_MODULE_NAME,
  OpenTunnelError,
  buildTunnelConfigFromNode,
  createOpenTunnelBinding,
  normalizeStatusState,
  validateTunnelConfig,
  type OpenTunnelBinding,
  type VpnStatusListener,
  type VpnTunnelConfig,
  type VpnTrafficListener,
} from 'open-tunnel-native';
import { createTunnelClient } from '../tunnel-client.ts';

interface StandInState {
  binding: OpenTunnelBinding;
  statusListener: VpnStatusListener | null;
  trafficListener: VpnTrafficListener | null;
  startedConfigs: VpnTunnelConfig[];
  stopCount: number;
  nativeApi: { startTunnel: (config: VpnTunnelConfig) => Promise<null>; stopTunnel: () => Promise<null> };
}

function standInBinding(): StandInState {
  const state: StandInState = {
    binding: null as unknown as OpenTunnelBinding,
    statusListener: null,
    trafficListener: null,
    startedConfigs: [],
    stopCount: 0,
    nativeApi: {
      startTunnel: async (config) => {
        state.startedConfigs.push(config);
        return null;
      },
      stopTunnel: async () => {
        state.stopCount += 1;
        return null;
      },
    },
  };
  const binding: OpenTunnelBinding = {
    async startTunnel(config) {
      await state.nativeApi.startTunnel(config);
      return null;
    },
    async stopTunnel() {
      await state.nativeApi.stopTunnel();
      return null;
    },
    async getState() {
      return 'disconnected';
    },
    async openSystemVpnSettings() {
      return true;
    },
    async tcpProbe() {
      return 12;
    },
    addOnStatusChanged(listener) {
      state.statusListener = listener;
      return { remove: () => (state.statusListener = null) };
    },
    addOnTrafficUpdate(listener) {
      state.trafficListener = listener;
      return { remove: () => (state.trafficListener = null) };
    },
  };
  state.binding = binding;
  return state;
}

function wireguardPayload(): string {
  // Minimal genuine payload shape (contains [Interface] + PrivateKey).
  return [
    '[Interface]',
    'PrivateKey = AK0TGQ5cLnByZXYtdmVyaWZpZWQtZm9ybWF0IHNvbWU=',
    'Address = 10.100.0.2/32',
    'DNS = 1.1.1.1',
    '',
    '[Peer]',
    'PublicKey = CJZpVVBzcC8zQnJpZWYgdmVyaWZpZWQ=',
    'Endpoint = 203.0.113.10:51820',
    'AllowedIPs = 0.0.0.0/0',
    '',
  ].join('\n');
}

function vpnGateNode(): VpnNode {
  const ovpn = sanitizeOpenVpnConfig(
    [
      'client',
      'remote 198.51.100.77 1199',
      'proto tcp',
      '<ca>',
      '-----BEGIN CERTIFICATE-----',
      'mIIabc123',
      '-----END CERTIFICATE-----',
      '</ca>',
    ].join('\n'),
  )!;
  return createVpnNode({
    hostName: 'us-beast',
    ip: '198.51.100.77',
    port: 1199,
    transportProto: 'tcp',
    score: 3120,
    pingMs: 96,
    speedBps: 8_000_000,
    countryLong: 'United States',
    countryShort: 'US',
    numSessions: 12,
    uptimeMs: 60_000 * 60 * 240,
    operatorName: 'academia',
    ovpnConfigRaw: ovpn,
  });
}

test('status events drive the state map; error is terminal until the next explicit start', async () => {
  const standIn = standInBinding();
  const client = createTunnelClient(standIn.binding);
  assert.equal(client.getSnapshot().state, 'disconnected');

  // native events (in the same shape the module emits) move the machine
  standIn.statusListener?.({ state: 'connecting' });
  assert.equal(client.getSnapshot().state, 'connecting');
  assert.equal(client.getSnapshot().message, null);

  standIn.statusListener?.({ state: 'connected' });
  assert.equal(client.getSnapshot().state, 'connected');

  standIn.trafficListener?.({ bytesIn: 1200, bytesOut: 300, connectedDurationSec: 1 });
  assert.deepEqual(client.getSnapshot().traffic, {
    bytesIn: 1200,
    bytesOut: 300,
    connectedDurationSec: 1,
  });

  // error carries the native wording and is terminal
  standIn.statusListener?.({ state: 'error', message: 'backend threw' });
  const errored = client.getSnapshot();
  assert.equal(errored.state, 'error');
  assert.equal(errored.message, 'backend threw');

  // events that follow an error do not silently resurrect the state
  standIn.statusListener?.({ state: 'disconnected' });
  assert.equal(client.getSnapshot().state, 'error');
  assert.equal(client.getSnapshot().message, 'backend threw');

  // the next explicit start transitions out and clears the message
  await client.startTunnel(validConfig());
  assert.equal(client.getSnapshot().state, 'connecting');
  assert.equal(client.getSnapshot().message, null);
  assert.deepEqual(standIn.startedConfigs, [validConfig()]);
  client.dispose();
});

test('refresh uses the native state (process restore path)', async () => {
  const standIn = standInBinding();
  const client = createTunnelClient(standIn.binding);
  const snap = await client.refresh();
  assert.equal(snap.state, 'disconnected');
  client.dispose();
});

test('configFromNode routes by payload — VPN Gate rows are OpenVPN, genuine .conf is WireGuard', () => {
  const client = createTunnelClient(standInBinding().binding);
  const openVpnConfig = client.configFromNode(vpnGateNode(), {
    enableKillSwitch: true,
  });
  assert.equal(openVpnConfig.protocol, 'openvpn');
  assert.equal(openVpnConfig.serverIp, '198.51.100.77');
  assert.equal(openVpnConfig.serverPort, 1199);
  assert.equal(
    openVpnConfig.configText.includes('data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305:AES-128-CBC'),
    true,
    'sanitized payload flows through byte-for-byte (no double injection)',
  );

  const node = createVpnNode({
    hostName: 'wg-relay',
    ip: '203.0.113.10',
    port: 51820,
    transportProto: 'udp',
    score: 0,
    pingMs: 40,
    speedBps: 1_000_000,
    countryLong: 'Testland',
    countryShort: 'TS',
    numSessions: 0,
    uptimeMs: 0,
    operatorName: 'who',
    ovpnConfigRaw: wireguardPayload(),
  });
  const wireguardConfig = buildTunnelConfigFromNode(node, { enableKillSwitch: true });
  assert.equal(wireguardConfig.protocol, 'wireguard');
  assert.equal(wireguardConfig.serverPort, 51820);
});

test('no remote line falls back to the upstream default port 1194', () => {
  const node = createVpnNode({
    hostName: 'noremote',
    ip: '192.0.2.55',
    port: 1194,
    transportProto: 'udp',
    score: 0,
    pingMs: 10,
    speedBps: 0,
    countryLong: 'OK',
    countryShort: 'OK',
    numSessions: 0,
    uptimeMs: 0,
    operatorName: 'o',
    ovpnConfigRaw: sanitizeOpenVpnConfig('<ca>\n-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----</ca>'),
  });
  const config = buildTunnelConfigFromNode(node, { enableKillSwitch: false });
  assert.equal(config.serverPort, 1194);
});

test('validateTunnelConfig rejects malformed contracts with typed codes', () => {
  assert.throws(
    () => validateTunnelConfig({}),
    (error: unknown) => error instanceof OpenTunnelError && error.code === OPEN_TUNNEL_ERROR_CODES.INVALID_CONFIG,
  );
  assert.throws(
    () => validateTunnelConfig(validConfigWith({ serverPort: 0 })),
    /serverPort/,
  );
  assert.throws(
    () => validateTunnelConfig(validConfigWith({ configText: '   ' })),
    /configText/,
  );
  // protocol/payload mismatch
  assert.throws(
    () => validateTunnelConfig(validConfigWith({ protocol: 'wireguard' })),
    /does not match/,
  );
});

test('iOS degrades typed when the native module is absent in this runtime (plan §4.3)', async () => {
  // The test host has no native module; `resolveNativeModule` must degrade
  // typed (not crash) with wording that no longer mentions a past phase.
  const ios = createOpenTunnelBinding({ platform: 'ios' });

  await assert.rejects(
    ios.startTunnel(validConfig()),
    (error: unknown) =>
      error instanceof OpenTunnelError &&
      error.code === OPEN_TUNNEL_ERROR_CODES.ENGINE_UNAVAILABLE &&
      error.message.includes('iOS module'),
  );
  await assert.rejects(
    ios.stopTunnel(),
    (error: unknown) => error instanceof OpenTunnelError && error.code === OPEN_TUNNEL_ERROR_CODES.ENGINE_UNAVAILABLE,
  );
  assert.equal(await ios.getState(), 'disconnected');
  assert.equal(await ios.openSystemVpnSettings(), false);
  await assert.rejects(
    ios.tcpProbe('198.51.100.77', 1199, 1500),
    (error: unknown) =>
      error instanceof OpenTunnelError &&
      error.code === OPEN_TUNNEL_ERROR_CODES.PROBE_FAILED &&
      error.message.includes('iOS module'),
  );

  // The Node/runtime path degrades identically and honestly.
  const nodeBinding = createOpenTunnelBinding({ platform: 'unavailable' });
  await assert.rejects(
    nodeBinding.startTunnel(validConfig()),
    (error: unknown) => error instanceof OpenTunnelError && error.code === OPEN_TUNNEL_ERROR_CODES.ENGINE_UNAVAILABLE,
  );
});

test('status coercion maps unknown native strings to the conservative default', () => {
  assert.equal(normalizeStatusState('connected'), 'connected');
  assert.equal(normalizeStatusState('wet-paint'), 'disconnected');
});

/** The PRESENCE contract strings stay coherent with the module name. */
test('module name is fixed for the native surface', () => {
  assert.equal(OPEN_TUNNEL_MODULE_NAME, 'OpenTunnelNative');
});

function validConfig(): VpnTunnelConfig {
  return {
    nodeId: 'a'.repeat(64),
    serverIp: '198.51.100.77',
    serverPort: 1199,
    protocol: 'openvpn',
    configText: sanitizeOpenVpnConfig('client\nremote 198.51.100.77 1199\nproto tcp'),
    dnsServers: ['1.1.1.1'],
    enableKillSwitch: true,
    disallowedApps: [],
  };
}

function validConfigWith(patch: Partial<VpnTunnelConfig>): VpnTunnelConfig {
  return { ...validConfig(), ...patch };
}
