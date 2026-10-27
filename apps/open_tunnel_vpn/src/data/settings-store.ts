/**
 * Persisted app preferences — a tiny key-value table inside the same local
 * sqlite database as the node cache (phase-4 plan G4). The store keeps only
 * opaque, non-sensitive choices: the kill-switch preference, the excluded
 * app-id list, and the node id (sha256 of `ip:port`) of the last start
 * attempt so a restart can label a still-connected tunnel. It never stores
 * tunnel configs, keys, or credentials; the whole database dies with the
 * app and OS backups are disabled (privacy rule #5).
 */
import type { SqliteDriver } from './sqlite-driver.ts';

const SETTINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;

export interface TunnelSettings {
  /** Engine-owned packet blocking + system deep link (iOS: on-demand). */
  readonly killSwitchEnabled: boolean;
  /** App ids excluded from the tunnel (Android engine honors the list). */
  readonly disallowedApps: readonly string[];
  /** Node id of the last start attempt, or null before the first start. */
  readonly lastNodeId: string | null;
}

export const DEFAULT_SETTINGS: TunnelSettings = {
  killSwitchEnabled: true,
  disallowedApps: [],
  lastNodeId: null,
};

const KEY_KILL_SWITCH = 'killSwitchEnabled';
const KEY_DISALLOWED_APPS = 'disallowedApps';
const KEY_LAST_NODE_ID = 'lastNodeId';

export class AppSettingsStore {
  private readonly driver: SqliteDriver;
  private ready = false;

  constructor(driver: SqliteDriver) {
    this.driver = driver;
  }

  /** Creates the table when needed (same lazy-open pattern as the cache). */
  async open(): Promise<void> {
    if (this.ready) return;
    await this.driver.run(SETTINGS_TABLE_SQL, []);
    this.ready = true;
  }

  /** Reads all known preferences, falling back to defaults per key when a
   * row is missing or unreadable (recovery path, never a thrown read). */
  async loadSettings(): Promise<TunnelSettings> {
    await this.open();
    const killSwitchEnabled = await this.readBool(KEY_KILL_SWITCH, DEFAULT_SETTINGS.killSwitchEnabled);
    const disallowedApps = await this.readStringList(KEY_DISALLOWED_APPS);
    const lastNodeId = await this.readString(KEY_LAST_NODE_ID);
    return {
      killSwitchEnabled,
      disallowedApps,
      lastNodeId: lastNodeId === '' ? null : lastNodeId,
    };
  }

  async setKillSwitchEnabled(enabled: boolean): Promise<void> {
    await this.open();
    await this.writeValue(KEY_KILL_SWITCH, enabled ? 'true' : 'false');
  }

  /** Stores the excluded app ids (trimmed, deduplicated, order kept). */
  async setDisallowedApps(apps: readonly string[]): Promise<void> {
    await this.open();
    const cleaned: string[] = [];
    for (const app of apps) {
      const trimmed = typeof app === 'string' ? app.trim() : '';
      if (trimmed.length > 0 && !cleaned.includes(trimmed)) cleaned.push(trimmed);
    }
    await this.writeValue(KEY_DISALLOWED_APPS, JSON.stringify(cleaned));
  }

  /** Persists the start-target node id (opaque sha256 hex); null clears it. */
  async setLastNodeId(nodeId: string | null): Promise<void> {
    await this.open();
    await this.writeValue(KEY_LAST_NODE_ID, nodeId ?? '');
  }

  private async readValue(key: string): Promise<string | null> {
    const rows = await this.driver.all(
      'SELECT value FROM app_settings WHERE key = ?',
      [key],
    );
    const value = rows[0]?.value;
    return typeof value === 'string' ? value : null;
  }

  private async writeValue(key: string, value: string): Promise<void> {
    await this.driver.run(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  private async readBool(key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.readValue(key);
    if (raw === null) return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return fallback;
  }

  private async readString(key: string): Promise<string | null> {
    const raw = await this.readValue(key);
    if (raw === null) return null;
    return raw.length > 0 ? raw : null;
  }

  private async readStringList(key: string): Promise<readonly string[]> {
    const raw = await this.readValue(key);
    if (raw === null) return DEFAULT_SETTINGS.disallowedApps;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return DEFAULT_SETTINGS.disallowedApps;
      return parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      return DEFAULT_SETTINGS.disallowedApps;
    }
  }
}
