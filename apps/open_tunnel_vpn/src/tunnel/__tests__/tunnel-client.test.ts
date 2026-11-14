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
import { createTunnelClient, settled, type TunnelSnapshot } from '../tunnel-client.ts';

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

test('settled waits through connecting and resolves with the outcome', async () => {
  const standIn = standInBinding();
  const client = createTunnelClient(standIn.binding);
  standIn.statusListener?.({ state: 'connecting' });
  const outcome = settled(client);
  standIn.statusListener?.({ state: 'reasserting' });
  standIn.statusListener?.({ state: 'error', message: 'AUTH_FAILED' });
  assert.equal(await outcome, 'error');
  assert.equal(await settled(client), 'error');
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

test('a relay config cached before the current sanitizer is sanitized again at connect', () => {
  const cached = createVpnNode({
    ...vpnGateNode(),
    ovpnConfigRaw: 'client\nremote 198.51.100.77 1199\nproto tcp\nwritepid firewall.db\n<ca>\nMIIabc\n</ca>\n',
  });
  const config = buildTunnelConfigFromNode(cached, { enableKillSwitch: true });
  assert.doesNotMatch(config.configText, /writepid/);
  assert.match(config.configText, /^remote-cert-tls server$/m);
  assert.match(config.configText, /^verify-x509-name opengw\.net name$/m);
  assert.equal(config.serverPort, 1199);
});

test('a WireGuard payload is handed over untouched', () => {
  const payload = wireguardPayload();
  const node = createVpnNode({ ...vpnGateNode(), ovpnConfigRaw: payload });
  assert.equal(buildTunnelConfigFromNode(node, { enableKillSwitch: true }).configText, payload);
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

test('native CodedError rejections surface their typed code verbatim', async () => {
  const standIn = standInBinding();
  standIn.nativeApi.startTunnel = async () => {
    // The real Expo Modules shape: a plain Error subclass carrying the
    // native reject code (`CodedError.code`) with the reason as `message`.
    throw Object.assign(
      new Error('openvpn engine unavailable on iOS: ics-openvpn port is gated pending the GPLv2 license decision (G1)'),
      { code: OPEN_TUNNEL_ERROR_CODES.ENGINE_UNAVAILABLE },
    );
  };
  const client = createTunnelClient(standIn.binding);
  const snapshot = await client.startTunnel(validConfig());
  assert.equal(snapshot.state, 'error');
  assert.equal(
    snapshot.message,
    `${OPEN_TUNNEL_ERROR_CODES.ENGINE_UNAVAILABLE}: openvpn engine unavailable on iOS: ics-openvpn port is gated pending the GPLv2 license decision (G1)`,
  );
});

test('a rejection without a tunnel code keeps the conservative start-failure code', async () => {
  const standIn = standInBinding();
  standIn.nativeApi.startTunnel = async () => {
    throw new Error('socket exploded');
  };
  const client = createTunnelClient(standIn.binding);
  const snapshot = await client.startTunnel(validConfig());
  assert.equal(snapshot.state, 'error');
  assert.equal(
    snapshot.message,
    `${OPEN_TUNNEL_ERROR_CODES.SERVICE_START_FAILED}: socket exploded`,
  );
});

test('stopTunnel commits disconnecting synchronously, before the native stop resolves', async () => {
  const standIn = standInBinding();
  const client = createTunnelClient(standIn.binding);
  standIn.statusListener?.({ state: 'connected' });
  standIn.trafficListener?.({ bytesIn: 900, bytesOut: 100, connectedDurationSec: 3 });
  const states: TunnelSnapshot['state'][] = [];
  const handle = client.subscribe(({ state }) => states.push(state));
  states.length = 0; // the subscription replay is not part of this assertion
  // The native stop hangs until released, isolating the synchronous window.
  // The executor runs synchronously, so `releaseStop` is assigned before
  // any await below.
  let releaseStop!: () => void;
  standIn.nativeApi.stopTunnel = () =>
    new Promise((resolve) => {
      releaseStop = () => resolve(null);
    });
  const stopping = client.stopTunnel();
  // The commit runs before the first await, so the shield already reads
  // disconnecting on the first tap — no multi-tap power-off.
  assert.deepEqual(states, ['disconnecting']);
  assert.equal(client.getSnapshot().state, 'disconnecting');
  assert.equal(client.getSnapshot().message, null);
  assert.deepEqual(client.getSnapshot().traffic, {
    bytesIn: 900,
    bytesOut: 100,
    connectedDurationSec: 3,
  });
  releaseStop();
  await stopping;
  // Without a native event the state holds; the promise alone changes nothing.
  assert.equal(client.getSnapshot().state, 'disconnecting');
  handle.remove();
  client.dispose();
});

test('the native DISCONNECTED event lands normally after the optimistic stop', async () => {
  const standIn = standInBinding();
  const client = createTunnelClient(standIn.binding);
  standIn.statusListener?.({ state: 'connecting' });
  standIn.statusListener?.({ state: 'connected' });
  standIn.trafficListener?.({ bytesIn: 5, bytesOut: 6, connectedDurationSec: 2 });
  assert.equal((await client.stopTunnel()).state, 'disconnecting');
  standIn.statusListener?.({ state: 'disconnected' });
  const settledSnap = client.getSnapshot();
  assert.equal(settledSnap.state, 'disconnected');
  assert.equal(settledSnap.message, null);
  assert.equal(settledSnap.code, null);
  assert.deepEqual(settledSnap.traffic, { bytesIn: 5, bytesOut: 6, connectedDurationSec: 2 });
  client.dispose();
});

test('stopTunnel from an idle or errored state never fabricates disconnecting, and still calls the binding', async () => {
  const standIn = standInBinding();
  const client = createTunnelClient(standIn.binding);
  // Idle: nothing to power off, so the state stays honest.
  const idle = await client.stopTunnel();
  assert.equal(idle.state, 'disconnected');
  assert.equal(standIn.stopCount, 1, 'the binding call still runs');

  // Errored: the terminal state holds (the terminal rule), and a later
  // disconnected event cannot silently resurrect it.
  standIn.statusListener?.({ state: 'connecting' });
  standIn.statusListener?.({ state: 'error', message: 'engine exploded' });
  const errored = await client.stopTunnel();
  assert.equal(errored.state, 'error');
  assert.equal(errored.message, 'engine exploded');
  assert.equal(standIn.stopCount, 2);
  standIn.statusListener?.({ state: 'disconnected' });
  assert.equal(client.getSnapshot().state, 'error');
  client.dispose();
});

test('an error status event carries its typed code; every other commit clears it', async () => {
  const standIn = standInBinding();
  const client = createTunnelClient(standIn.binding);
  standIn.statusListener?.({ state: 'connecting' });
  standIn.statusListener?.({
    state: 'error',
    message: 'auth rejected by the relay',
    code: OPEN_TUNNEL_ERROR_CODES.AUTH_FAILED,
  });
  const errored = client.getSnapshot();
  assert.equal(errored.state, 'error');
  assert.equal(errored.code, 'ERR_AUTH_FAILED');
  assert.equal(errored.message, 'auth rejected by the relay');

  // Traffic ticks ride through the error without inventing or clearing a code.
  standIn.trafficListener?.({ bytesIn: 10, bytesOut: 20, connectedDurationSec: 1 });
  assert.equal(client.getSnapshot().code, 'ERR_AUTH_FAILED');

  // The next explicit start clears both the message and the code.
  await client.startTunnel(validConfig());
  const restarted = client.getSnapshot();
  assert.equal(restarted.state, 'connecting');
  assert.equal(restarted.code, null);
  assert.equal(restarted.message, null);
  client.dispose();
});

test('refresh() restores the native state with a null code (process-restore path)', async () => {
  const standIn = standInBinding();
  const client = createTunnelClient(standIn.binding);
  const idle = await client.refresh();
  assert.equal(idle.state, 'disconnected');
  assert.equal(idle.code, null);

  // getState carries only the state string, so a restored error keeps the
  // fallback wording and no typed code.
  standIn.binding.getState = async () => 'error';
  const restored = await client.refresh();
  assert.equal(restored.state, 'error');
  assert.equal(restored.code, null);
  assert.equal(restored.message, 'tunnel error (native wording unavailable)');
  client.dispose();
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
