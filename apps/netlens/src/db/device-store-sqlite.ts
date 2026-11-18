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

export interface SettingsStore {
  getSetting(key: string): Promise<string | null>;
  /** A null value deletes the row. */
  setSetting(key: string, value: string | null): Promise<void>;
}

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
  mdns_name: string | null;
  friendly_name: string | null;
  model: string | null;
  netbios_name: string | null;
  person: string | null;
  mac: string | null;
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
    mdnsName: row.mdns_name,
    friendlyName: row.friendly_name,
    model: row.model,
    netbiosName: row.netbios_name,
    person: row.person,
    mac: row.mac,
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
    device.mdnsName,
    device.friendlyName,
    device.model,
    device.netbiosName,
    device.person,
    device.mac,
  ];
}

// expo-sqlite does not order statements per database, so a name write and a
// detail-sheet save for the same row could land out of order. Module level
// because expo-sqlite reuses one native connection across screen mounts.
let writeChain: Promise<unknown> = Promise.resolve();

function serialized<T>(write: () => Promise<T>): Promise<T> {
  const run = writeChain.then(write);
  writeChain = run.catch(() => undefined);
  return run;
}

function createStore(db: SQLiteDatabase): DeviceStore & SettingsStore {
  return {
    upsertNetwork(network: StoredNetwork): Promise<void> {
      return serialized(async () => {
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
      });
    },

    async listDevices(networkId: string): Promise<StoredDevice[]> {
      const rows = await db.getAllAsync<DeviceRow>(
        `SELECT * FROM devices WHERE network_id = ? ORDER BY last_seen_at DESC`,
        [networkId],
      );
      return rows.map(rowToDevice);
    },

    insertDevice(device: StoredDevice): Promise<number> {
      return serialized(async () => {
        const result = await db.runAsync(
          `INSERT INTO devices (
             network_id, identity_key, last_ip, hostname, custom_name,
             vendor_or_model, open_ports_csv, mdns_services_csv,
             is_trusted, first_seen_at, last_seen_at,
             mdns_name, friendly_name, model, netbios_name,
             person, mac
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          deviceToParams(device),
        );
        return Number(result.lastInsertRowId);
      });
    },

    updateDevice(device: StoredDevice): Promise<void> {
      if (device.id === null) {
        return Promise.reject(new Error('updateDevice requires a stored row id'));
      }
      const id = device.id;
      return serialized(async () => {
        await db.runAsync(
          `UPDATE devices SET
             network_id = ?, identity_key = ?, last_ip = ?, hostname = ?,
             custom_name = ?, vendor_or_model = ?, open_ports_csv = ?,
             mdns_services_csv = ?, is_trusted = ?, first_seen_at = ?,
             last_seen_at = ?, mdns_name = ?, friendly_name = ?, model = ?,
             netbios_name = ?, person = ?, mac = ?
           WHERE id = ?`,
          [...deviceToParams(device), id],
        );
      });
    },

    async getSetting(key: string): Promise<string | null> {
      const row = await db.getFirstAsync<{ value: string | null }>(
        'SELECT value FROM settings WHERE key = ?',
        [key],
      );
      return row?.value ?? null;
    },

    setSetting(key: string, value: string | null): Promise<void> {
      return serialized(async () => {
        if (value === null) {
          await db.runAsync('DELETE FROM settings WHERE key = ?', [key]);
          return;
        }
        await db.runAsync(
          `INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [key, value],
        );
      });
    },
  };
}

/**
 * Version 1 adds the four name columns; version 2 adds person, mac and the settings table.
 * They stay out of SCHEMA_SQL on purpose: fresh installs get them through here too.
 */
async function migrate(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version < 1) {
    await db.withTransactionAsync(async () => {
      for (const column of ['mdns_name', 'friendly_name', 'model', 'netbios_name']) {
        await db.execAsync(`ALTER TABLE devices ADD COLUMN ${column} TEXT`);
      }
      await db.execAsync('PRAGMA user_version = 1');
    });
  }
  if (version < 2) {
    await db.withTransactionAsync(async () => {
      await db.execAsync('ALTER TABLE devices ADD COLUMN person TEXT');
      await db.execAsync('ALTER TABLE devices ADD COLUMN mac TEXT');
      await db.execAsync('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
      await db.execAsync('PRAGMA user_version = 2');
    });
  }
}

/**
 * Opens (and migrates) the local NetLens database, returning the port
 * implementation. The connection is kept for the app's lifetime; closing is
 * handled by the OS on process exit, which is acceptable for a scanner tool.
 */
export async function openDeviceStore(): Promise<DeviceStore & SettingsStore> {
  const db = await openDatabaseAsync(DATABASE_NAME);
  await db.execAsync(SCHEMA_SQL);
  await migrate(db);
  return createStore(db);
}
