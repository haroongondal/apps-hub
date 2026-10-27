/**
 * Local cache of the current VPN Gate node list.
 *
 * Port of the Drift database (`lib/core/database/app_database.dart`). SQL
 * runs through {@link SqliteDriver} so the app uses real `expo-sqlite`
 * locally and tests exercise the exact same statements against Node's
 * built-in SQLite (never a substitute).
 *
 * The cache never leaves the device: no sync, no upload, and backups are
 * disabled OS-side (see plugin/opentunnel-android-config.js); iOS keeps the
 * database inside the app container, removed on uninstall.
 */
import { createVpnNode, type VpnNode, type VpnProtocol, type VpnTransport } from 'open-tunnel-core';
import type { SqliteDriver, SqliteRowSet, SqlValue } from './sqlite-driver.ts';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS vpn_nodes (
  id TEXT PRIMARY KEY NOT NULL,
  host_name TEXT NOT NULL,
  ip TEXT NOT NULL,
  port INTEGER NOT NULL,
  transport_proto TEXT NOT NULL,
  score INTEGER NOT NULL,
  ping_ms INTEGER NOT NULL,
  speed_bps INTEGER NOT NULL,
  country_long TEXT NOT NULL,
  country_short TEXT NOT NULL,
  num_sessions INTEGER NOT NULL,
  uptime_ms INTEGER NOT NULL,
  operator_name TEXT NOT NULL,
  ovpn_config_raw TEXT NOT NULL,
  protocol TEXT NOT NULL,
  measured_rtt_ms INTEGER,
  fitness_score REAL NOT NULL DEFAULT 0.0,
  fetched_at_ms INTEGER NOT NULL,
  probed_at_ms INTEGER
);
`;

export interface LoadNodesOptions {
  countryCode?: string;
  /** When false, list reads blank the sanitized OpenVPN payload so pages
   * stay small; pass true only to prepare a tunnel start. */
  withConfig?: boolean;
  limit?: number;
}

export class VpnNodeCache {
  private readonly driver: SqliteDriver;
  private ready = false;

  constructor(driver: SqliteDriver) {
    this.driver = driver;
  }

  /** Creates the table when needed (schemaVersion 1). */
  async open(): Promise<void> {
    if (this.ready) return;
    await this.driver.run(CREATE_TABLE_SQL, []);
    this.ready = true;
  }

  /**
   * Replaces the cached node list atomically. Rows absent from `nodes` are
   * removed so stale relays never linger after a refresh.
   */
  async replaceAllNodes(nodes: readonly VpnNode[]): Promise<void> {
    await this.open();
    await this.driver.transaction(async () => {
      const fetchedAtMs = Date.now();
      for (const node of nodes) {
        await this.driver.run(
          `INSERT INTO vpn_nodes (
            id, host_name, ip, port, transport_proto, score, ping_ms,
            speed_bps, country_long, country_short, num_sessions, uptime_ms,
            operator_name, ovpn_config_raw, protocol, measured_rtt_ms,
            fitness_score, fetched_at_ms, probed_at_ms
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          ) ON CONFLICT(id) DO UPDATE SET
            host_name = excluded.host_name,
            ip = excluded.ip,
            port = excluded.port,
            transport_proto = excluded.transport_proto,
            score = excluded.score,
            ping_ms = excluded.ping_ms,
            speed_bps = excluded.speed_bps,
            country_long = excluded.country_long,
            country_short = excluded.country_short,
            num_sessions = excluded.num_sessions,
            uptime_ms = excluded.uptime_ms,
            operator_name = excluded.operator_name,
            ovpn_config_raw = excluded.ovpn_config_raw,
            protocol = excluded.protocol,
            measured_rtt_ms = excluded.measured_rtt_ms,
            fitness_score = excluded.fitness_score,
            fetched_at_ms = excluded.fetched_at_ms,
            probed_at_ms = excluded.probed_at_ms`,
          [
            node.id,
            node.hostName,
            node.ip,
            node.port,
            node.transportProto,
            node.score,
            node.pingMs,
            node.speedBps,
            node.countryLong,
            node.countryShort,
            node.numSessions,
            node.uptimeMs,
            node.operatorName,
            node.ovpnConfigRaw,
            node.protocol,
            node.measuredRttMs,
            node.fitnessScore,
            fetchedAtMs,
            node.measuredRttMs === null ? null : fetchedAtMs,
          ],
        );
      }
      const keepIds = nodes.map((node) => node.id);
      if (keepIds.length === 0) {
        await this.driver.run('DELETE FROM vpn_nodes', []);
      } else {
        const idSlots = keepIds.map(() => '?').join(', ');
        await this.driver.run(
          `DELETE FROM vpn_nodes WHERE id NOT IN (${idSlots})`,
          keepIds,
        );
      }
    });
  }

  /** Loads cached nodes, highest fitness first. */
  async loadNodes(options: LoadNodesOptions = {}): Promise<VpnNode[]> {
    await this.open();
    const { countryCode, withConfig = false, limit } = options;
    const params: SqlValue[] = [];
    let sql = `SELECT ${NODE_COLUMNS} FROM vpn_nodes`;
    if (countryCode !== undefined) {
      sql += ' WHERE country_short = ?';
      params.push(countryCode.toUpperCase());
    }
    sql += ' ORDER BY fitness_score DESC';
    if (limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(limit);
    }
    const rows = await this.driver.all(sql, params);
    return rows.map((row) => nodeFromRow(row, withConfig));
  }

  /** Loads one cached node by its primary key — the connect-time path that
   * re-fetches the sanitized payload for a node shown from a configless
   * list read. Resolves null when the id is unknown (cache replaced). */
  async getNode(
    id: string,
    options: { withConfig?: boolean } = {},
  ): Promise<VpnNode | null> {
    await this.open();
    const { withConfig = true } = options;
    const rows = await this.driver.all(
      `SELECT ${NODE_COLUMNS} FROM vpn_nodes WHERE id = ?`,
      [id],
    );
    if (rows.length === 0) return null;
    return nodeFromRow(rows[0]!, withConfig);
  }
}

/** Column list shared by both read paths. */
const NODE_COLUMNS =
  'id, host_name, ip, port, transport_proto, score, ping_ms, ' +
  'speed_bps, country_long, country_short, num_sessions, uptime_ms, ' +
  'operator_name, ovpn_config_raw, protocol, measured_rtt_ms, fitness_score';

function text(value: SqlValue): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function int(value: SqlValue): number {
  return typeof value === 'number' ? Math.trunc(value) : Number(value ?? 0);
}

function nullableInt(value: SqlValue): number | null {
  return value === null || value === undefined ? null : int(value);
}

function nodeFromRow(row: SqliteRowSet, withConfig: boolean): VpnNode {
  const base = createVpnNode({
    hostName: text(row.host_name),
    ip: text(row.ip),
    port: int(row.port),
    transportProto: text(row.transport_proto) === 'tcp' ? 'tcp' : 'udp',
    score: int(row.score),
    pingMs: int(row.ping_ms),
    speedBps: int(row.speed_bps),
    countryLong: text(row.country_long),
    countryShort: text(row.country_short),
    numSessions: int(row.num_sessions),
    uptimeMs: int(row.uptime_ms),
    operatorName: text(row.operator_name),
    // List reads keep the tunnel payload out of the UI.
    ovpnConfigRaw: withConfig ? text(row.ovpn_config_raw) : '',
    protocol: text(row.protocol) === 'wireguard' ? 'wireguard' : 'openvpn',
  });
  // Drift's nodeFromRow discarded these on restore; the cache round-trips
  // them so a probed node keeps its score across app restarts.
  return Object.freeze({
    ...base,
    measuredRttMs: nullableInt(row.measured_rtt_ms),
    fitnessScore: Number(row.fitness_score ?? 0),
  });
}
