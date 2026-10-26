/**
 * expo-sqlite implementation of the packages/core `DeviceStore` port
 * (SPEC §4 schema verbatim). Local-only storage: this database never
 * leaves the device, there is no sync, and F-Droid privacy rules hold
 * (the schema stores scan facts, names, and trusted flags — nothing else).
 */
import {
  openDatabaseAsync,
  type SQLiteBindValue,
  type SQLiteDatabase,
} from 'expo-sqlite';
import type { DeviceStore, StoredDevice, StoredNetwork } from '@apps-hub/core';

const DATABASE_NAME = 'netlens.db';

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS networks (
  network_id TEXT PRIMARY KEY,
  gateway_ip TEXT NOT NULL,
  subnet_cidr TEXT NOT NULL,
  custom_name TEXT,
  last_scanned_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  last_ip TEXT NOT NULL,
  hostname TEXT,
  custom_name TEXT,
  vendor_or_model TEXT,
  open_ports_csv TEXT NOT NULL,
  mdns_services_csv TEXT NOT NULL,
  is_trusted INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (network_id, identity_key)
);
`;

interface DeviceRow {
  id: number;
  network_id: string;
  identity_key: string;
  last_ip: string;
  hostname: string | null;
  custom_name: string | null;
  vendor_or_model: string | null;
  open_ports_csv: string;
  mdns_services_csv: string;
  is_trusted: number;
  first_seen_at: number;
  last_seen_at: number;
}

function rowToDevice(row: DeviceRow): StoredDevice {
  return {
    id: row.id,
    networkId: row.network_id,
    identityKey: row.identity_key,
    lastIp: row.last_ip,
    hostname: row.hostname,
    customName: row.custom_name,
    vendorOrModel: row.vendor_or_model,
    openPortsCsv: row.open_ports_csv,
    mdnsServicesCsv: row.mdns_services_csv,
    isTrusted: row.is_trusted === 1,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

function deviceToParams(device: StoredDevice): SQLiteBindValue[] {
  return [
    device.networkId,
    device.identityKey,
    device.lastIp,
    device.hostname,
    device.customName,
    device.vendorOrModel,
    device.openPortsCsv,
    device.mdnsServicesCsv,
    device.isTrusted ? 1 : 0,
    device.firstSeenAt,
    device.lastSeenAt,
  ];
}

function createStore(db: SQLiteDatabase): DeviceStore {
  return {
    async upsertNetwork(network: StoredNetwork): Promise<void> {
      await db.runAsync(
        `INSERT INTO networks (network_id, gateway_ip, subnet_cidr, custom_name, last_scanned_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(network_id) DO UPDATE SET
           gateway_ip = excluded.gateway_ip,
           subnet_cidr = excluded.subnet_cidr,
           last_scanned_at = excluded.last_scanned_at`,
        [
          network.networkId,
          network.gatewayIp,
          network.subnetCidr,
          network.customName,
          network.lastScannedAt,
        ],
      );
    },

    async listDevices(networkId: string): Promise<StoredDevice[]> {
      const rows = await db.getAllAsync<DeviceRow>(
        `SELECT * FROM devices WHERE network_id = ? ORDER BY last_seen_at DESC`,
        [networkId],
      );
      return rows.map(rowToDevice);
    },

    async insertDevice(device: StoredDevice): Promise<number> {
      const result = await db.runAsync(
        `INSERT INTO devices (
           network_id, identity_key, last_ip, hostname, custom_name,
           vendor_or_model, open_ports_csv, mdns_services_csv,
           is_trusted, first_seen_at, last_seen_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        deviceToParams(device),
      );
      return Number(result.lastInsertRowId);
    },

    async updateDevice(device: StoredDevice): Promise<void> {
      if (device.id === null) {
        throw new Error('updateDevice requires a stored row id');
      }
      await db.runAsync(
        `UPDATE devices SET
           network_id = ?, identity_key = ?, last_ip = ?, hostname = ?,
           custom_name = ?, vendor_or_model = ?, open_ports_csv = ?,
           mdns_services_csv = ?, is_trusted = ?, first_seen_at = ?,
           last_seen_at = ?
         WHERE id = ?`,
        [...deviceToParams(device), device.id],
      );
    },
  };
}

/**
 * Opens (and migrates) the local NetLens database, returning the port
 * implementation. The connection is kept for the app's lifetime; closing is
 * handled by the OS on process exit, which is acceptable for a scanner tool.
 */
export async function openDeviceStore(): Promise<DeviceStore> {
  const db = await openDatabaseAsync(DATABASE_NAME);
  await db.execAsync(SCHEMA_SQL);
  return createStore(db);
}
