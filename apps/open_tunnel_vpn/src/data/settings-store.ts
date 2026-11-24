/**
 * Persisted app preferences — a tiny key-value table inside the same local
 * sqlite database as the node cache (phase-4 plan G4). The store keeps only
 * opaque, non-sensitive choices: the kill-switch preference, the excluded
 * app-id list, and the node id (sha256 of `ip:port`) of the last start
 * attempt so a restart can label a still-connected tunnel, whether the
 * owner has confirmed the firewall's first-enable sheet, and the Trusted Wi-Fi
 * switch with the Wi-Fi names and access points marked trusted (location-like
 * data: it is never logged or sent anywhere). It never stores
 * tunnel configs, keys, or credentials; the whole database dies with the
 * app and OS backups are disabled (privacy rule #5).
 */
import { parseTrustedNetworks, type TrustedNetwork } from '../tunnel/trusted-wifi.ts';
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
  /** True once the owner confirmed the firewall's consent sheet (shown on the first enable only). */
  readonly firewallConsented: boolean;
  /** Connect automatically on any network that is not a trusted Wi-Fi. Off until the owner decides otherwise. */
  readonly trustedWifiEnabled: boolean;
  /** Wi-Fi names and access points the user marked trusted; never leave the phone. */
  readonly trustedNetworks: readonly TrustedNetwork[];
  /** Shields: warn (Halo's red pulse) and protect (Trusted Wi-Fi) on networks the owner does not trust. Off by default. */
  readonly shieldsEnabled: boolean;
}

export const DEFAULT_SETTINGS: TunnelSettings = {
  killSwitchEnabled: true,
  disallowedApps: [],
  lastNodeId: null,
  firewallConsented: false,
  trustedWifiEnabled: false,
  trustedNetworks: [],
  shieldsEnabled: false,
};

const KEY_KILL_SWITCH = 'killSwitchEnabled';
const KEY_DISALLOWED_APPS = 'disallowedApps';
const KEY_LAST_NODE_ID = 'lastNodeId';
const KEY_FIREWALL_CONSENT = 'firewallConsented';
const KEY_TRUSTED_WIFI = 'trustedWifiEnabled';
const KEY_TRUSTED_NETWORKS = 'trustedNetworks';
const KEY_SHIELDS = 'shieldsEnabled';

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
    const firewallConsented = await this.readBool(KEY_FIREWALL_CONSENT, DEFAULT_SETTINGS.firewallConsented);
    const trustedWifiEnabled = await this.readBool(KEY_TRUSTED_WIFI, DEFAULT_SETTINGS.trustedWifiEnabled);
    const trustedNetworks = parseTrustedNetworks(await this.readJson(KEY_TRUSTED_NETWORKS));
    const shieldsEnabled = await this.readBool(KEY_SHIELDS, DEFAULT_SETTINGS.shieldsEnabled);
    return {
      killSwitchEnabled,
      disallowedApps,
      lastNodeId: lastNodeId === '' ? null : lastNodeId,
      firewallConsented,
      trustedWifiEnabled,
      trustedNetworks,
      shieldsEnabled,
    };
  }

  async setShieldsEnabled(enabled: boolean): Promise<void> {
    await this.open();
    await this.writeValue(KEY_SHIELDS, enabled ? 'true' : 'false');
  }

  async setTrustedWifiEnabled(enabled: boolean): Promise<void> {
    await this.open();
    await this.writeValue(KEY_TRUSTED_WIFI, enabled ? 'true' : 'false');
  }

  async setTrustedNetworks(networks: readonly TrustedNetwork[]): Promise<void> {
    await this.open();
    await this.writeValue(KEY_TRUSTED_NETWORKS, JSON.stringify(parseTrustedNetworks(networks)));
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

  /** Remembers that the owner confirmed the firewall's consent sheet; it never un-sets. */
  async setFirewallConsented(): Promise<void> {
    await this.open();
    await this.writeValue(KEY_FIREWALL_CONSENT, 'true');
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

  private async readJson(key: string): Promise<unknown> {
    const raw = await this.readValue(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
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
