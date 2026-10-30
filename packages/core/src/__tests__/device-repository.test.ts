/**
 * DeviceRepository suite (node --test) — Phase 3 invariants at the TS
 * boundary (SPEC §4, PRD FR-4):
 *   - AC-2: devices never stored for this network are flagged isNew = true
 *     and drive the "NEW" badge; offline probes never create rows.
 *   - Store rows keep custom_name and is_trusted through rescans (AC-3).
 *   - A stable SSDP USN preserves identity across IP changes (AC-3).
 *   - With no organic identifier, identity falls back to the IP, so a
 *     relocated device legitimately reads as a new identity.
 *   - network_id hashing is deterministic and kinds are orthogonal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveIdentityKey,
  hashNetworkId,
  isDeviceWorthy,
  openPortsCsvFor,
  reconcileScan,
  type DeviceStore,
  type ReconcileResult,
  type StoredDevice,
  type StoredNetwork,
} from '../device-repository.ts';
import type { DiscoveredHost } from '../model.ts';

/** In-memory DeviceStore double with call recording for assertions. */
class FakeStore implements DeviceStore {
  readonly networks = new Map<string, StoredNetwork>();
  readonly upserts: StoredNetwork[] = [];
  readonly updates: StoredDevice[] = [];
  private sequences = 0;

  private rows = new Map<string, StoredDevice>();

  async upsertNetwork(network: StoredNetwork): Promise<void> {
    this.upserts.push(network);
    this.networks.set(network.networkId, { ...network });
  }

  async listDevices(networkId: string): Promise<StoredDevice[]> {
    return [...this.rows.values()].filter((row) => row.networkId === networkId);
  }

  async insertDevice(device: StoredDevice): Promise<number> {
    this.sequences += 1;
    const row: StoredDevice = { ...device, id: this.sequences };
    this.rows.set(`${row.networkId}/${row.identityKey}`, row);
    return this.sequences;
  }

  async updateDevice(device: StoredDevice): Promise<void> {
    if (device.id === null) {
      throw new Error('updateDevice requires a row id');
    }
    this.updates.push(device);
    this.rows.set(`${device.networkId}/${device.identityKey}`, device);
  }
}

function host(
  ip: string,
  overrides: Partial<DiscoveredHost> = {},
): DiscoveredHost {
  return {
    ip,
    isReachable: true,
    rttMs: 12,
    winningPort: 80,
    outcome: 'open',
    ...overrides,
  };
}

function seedDevice(overrides: Partial<StoredDevice> = {}): StoredDevice {
  return {
    id: 1,
    networkId: 'net_a0b0c0d0',
    identityKey: 'ip:192.168.7.5',
    lastIp: '192.168.7.5',
    hostname: null,
    customName: null,
    vendorOrModel: null,
    openPortsCsv: '',
    mdnsServicesCsv: '',
    isTrusted: false,
    firstSeenAt: 1_000,
    lastSeenAt: 1_000,
    mdnsName: null,
    friendlyName: null,
    model: null,
    netbiosName: null,
    ...overrides,
  };
}

const NETWORK = {
  networkId: 'net_a0b0c0d0',
  subnetCidr: '192.168.7.0/24',
  gatewayIp: '192.168.7.1',
  enrichmentByIp: {} as Record<string, { usn?: string; vendorOrModel?: string }>,
};

interface ScanCall {
  hosts: readonly DiscoveredHost[];
  nowMs: number;
}

function runScan(
  store: DeviceStore,
  call: ScanCall,
): Promise<ReconcileResult> {
  return reconcileScan(
    {
      networkId: NETWORK.networkId,
      gatewayIp: NETWORK.gatewayIp,
      subnetCidr: NETWORK.subnetCidr,
      hosts: call.hosts,
      enrichmentByIp: NETWORK.enrichmentByIp,
    },
    store,
    call.nowMs,
  );
}

test('first scan flags every alive host as NEW and skips dead probes', async () => {
  const store = new FakeStore();
  const result = await runScan(store, {
    nowMs: 2_000,
    hosts: [
      host('192.168.7.1', { winningPort: 443, outcome: 'open' }),
      host('192.168.7.2', { winningPort: 445, outcome: 'refused', rttMs: 9 }),
      host('192.168.7.10', { isReachable: false, outcome: 'timeout' }),
    ],
  });

  assert.equal(result.newCount, 2);
  assert.equal(result.knownCount, 0);
  const inserted = result.devices.filter((row) => row.isNew);
  assert.deepEqual(
    inserted.map((row) => row.lastIp),
    ['192.168.7.1', '192.168.7.2'],
  );
  assert.ok(inserted.every((row) => row.seenThisScan));
  // The timeout probe must not have produced any row.
  assert.ok(result.devices.every((row) => row.lastIp !== '192.168.7.10'));
  assert.equal(inserted[0].networkId, NETWORK.networkId);
  assert.equal(inserted[0].openPortsCsv, '443');
  assert.equal(inserted[1].openPortsCsv, '445');
  assert.equal(inserted[1].isTrusted, false);
});

test('a rescan updates rows and preserves custom name and trust (AC-3 setup)', async () => {
  const store = new FakeStore();
  // Pre-seeded: user named and trusted this device after scan 1.
  await store.insertDevice(
    seedDevice({
      customName: 'Living Room TV',
      isTrusted: true,
      openPortsCsv: '80',
    }),
  );

  const result = await runScan(store, {
    nowMs: 5_000,
    hosts: [
      host('192.168.7.2', { winningPort: 445, outcome: 'refused' }),
      host('192.168.7.5', { winningPort: 22 }),
    ],
  });

  assert.equal(result.knownCount, 1);
  assert.equal(result.newCount, 1);
  const known = result.devices.find(
    (row) => row.identityKey === 'ip:192.168.7.5',
  );
  assert.ok(known);
  assert.equal(known.isNew, false);
  assert.equal(known.seenThisScan, true);
  assert.equal(known.customName, 'Living Room TV');
  assert.equal(known.isTrusted, true);
  assert.equal(known.lastSeenAt, 5_000);
  assert.notEqual(known.firstSeenAt, 5_000);
  // The update call itself carried the preserved fields through the port.
  assert.equal(store.updates.length, 1);
  assert.equal(store.updates[0].customName, 'Living Room TV');
  assert.equal(store.updates[0].isTrusted, true);
});

test('a stable USN keeps identity across an IP change (AC-3)', async () => {
  const store = new FakeStore();
  await store.insertDevice(
    seedDevice({
      identityKey: 'usn:uuid:device-123::upnp:rootdevice',
      lastIp: '192.168.7.5',
      customName: 'Printer',
    }),
  );
  const usn = 'UUID:device-123::upnp:rootdevice';

  const result = await reconcileScan(
    {
      networkId: 'net_a0b0c0d0',
      gatewayIp: NETWORK.gatewayIp,
      subnetCidr: NETWORK.subnetCidr,
      hosts: [host('192.168.7.77', { winningPort: 9100 })],
      enrichmentByIp: {
        '192.168.7.77': { usn, vendorOrModel: 'Kyocera/2.0 UPnP/1.0' },
      },
    },
    store,
    5_000,
  );

  assert.equal(result.newCount, 0);
  assert.equal(result.knownCount, 1);
  const known = result.devices[0];
  assert.equal(known.customName, 'Printer');
  assert.equal(known.lastIp, '192.168.7.77');
  assert.equal(known.vendorOrModel, 'Kyocera/2.0 UPnP/1.0');
  assert.equal(known.openPortsCsv, '9100');
  assert.equal(known.lastSeenAt, 5_000);
});

test('an IP-fallback identity legitimately reads as new after relocation', async () => {
  const store = new FakeStore();
  await store.insertDevice(
    seedDevice({ identityKey: 'ip:192.168.7.5', customName: 'Named box' }),
  );

  const result = await runScan(store, {
    nowMs: 5_000,
    hosts: [host('192.168.7.77', { winningPort: 8080 })],
  });

  assert.equal(result.newCount, 1);
  const stale = result.devices.find(
    (row) => row.identityKey === 'ip:192.168.7.5',
  );
  const fresh = result.devices.find(
    (row) => row.identityKey === 'ip:192.168.7.77',
  );
  assert.ok(fresh);
  assert.ok(stale);
  assert.equal(fresh.isNew, true);
  assert.equal(stale.isNew, false);
  assert.equal(stale.seenThisScan, false);
  assert.equal(stale.customName, 'Named box');
});

test('a named device is matched, not new, on the next scan', async () => {
  const store = new FakeStore();
  const id = await store.insertDevice(
    seedDevice({
      identityKey: 'ip:192.168.7.3',
      lastIp: '192.168.7.3',
      hostname: 'galaxy.lan',
      mdnsName: 'Galaxy',
    }),
  );
  const result = await reconcileScan(
    {
      networkId: NETWORK.networkId,
      gatewayIp: NETWORK.gatewayIp,
      subnetCidr: NETWORK.subnetCidr,
      hosts: [host('192.168.7.3')],
      enrichmentByIp: { '192.168.7.3': { usn: null, vendorOrModel: null } },
    },
    store,
    3_000,
  );
  const row = result.devices.find((d) => d.identityKey === 'ip:192.168.7.3');
  assert.ok(row);
  assert.equal(row.isNew, false);
  assert.equal(row.id, id);
  assert.equal(row.mdnsName, 'Galaxy');
  assert.equal(result.newCount, 0);
});

test('duplicate alive probes collapse to one identity row', async () => {
  const store = new FakeStore();
  const result = await runScan(store, {
    nowMs: 2_000,
    hosts: [
      host('192.168.7.9', { winningPort: 80 }),
      host('192.168.7.9', { winningPort: 22, outcome: 'refused' }),
    ],
  });
  assert.equal(result.devices.length, 1);
  assert.equal(result.newCount, 1);
});

test('every scan upserts the network row with a bumped scan time', async () => {
  const store = new FakeStore();
  await runScan(store, { nowMs: 2_000, hosts: [host('192.168.7.3')] });
  await runScan(store, { nowMs: 3_000, hosts: [host('192.168.7.4')] });

  assert.equal(store.upserts.length, 2);
  assert.deepEqual(
    store.upserts.map((row) => row.lastScannedAt),
    [2_000, 3_000],
  );
  assert.equal(store.upserts.at(-1)?.subnetCidr, NETWORK.subnetCidr);
});

test('identity helpers: precedence, CSV shaping, and network hashing', () => {
  assert.equal(
    deriveIdentityKey('192.168.7.3', { usn: 'uuid:abc' }),
    'usn:uuid:abc',
  );
  assert.equal(
    deriveIdentityKey('192.168.7.3', { hostname: 'Printer.lan' }),
    'host:printer.lan',
  );
  assert.equal(deriveIdentityKey('192.168.7.3', undefined), 'ip:192.168.7.3');

  assert.equal(isDeviceWorthy('open'), true);
  assert.equal(isDeviceWorthy('refused'), true);
  assert.equal(isDeviceWorthy('timeout'), false);
  assert.equal(isDeviceWorthy('unreachable'), false);

  assert.equal(openPortsCsvFor(host('192.168.7.9')), '80');
  assert.equal(openPortsCsvFor({ ...host('x'), winningPort: null }), '');

  const home = hashNetworkId('192.168.7.1', 24);
  assert.equal(home, hashNetworkId('192.168.7.1', 24));
  assert.notEqual(home, hashNetworkId('192.168.7.1', 16));
  assert.notEqual(home, hashNetworkId('192.168.8.1', 24));
  assert.match(home, /^net_[0-9a-f]{8}$/);
});
