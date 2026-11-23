import { requireNativeModule } from 'expo';

export type ClipKind = 'text' | 'secret' | 'code' | 'image' | 'file';

export interface Clip {
  id: number;
  at: number;
  kind: ClipKind;
  /** Null for secrets and codes, which are never stored readable. */
  text: string | null;
  mime: string | null;
  source: string | null;
  /** An accessibility event type, or "app" when the app read the clipboard on open. */
  via: string;
  grabMs: number | null;
  /** Pinned clips never expire and are listed first. */
  pinned: boolean;
}

export interface ServiceState {
  enabled: boolean;
  connected: boolean;
}

interface ClipboardCoreApi {
  getServiceState(): ServiceState;
  openAccessibilitySettings(): void;
  captureNow(): void;
  recent(limit: number): Clip[];
  copy(id: number): boolean;
  remove(id: number): void;
  setPinned(id: number, pinned: boolean): void;
  /** How many days unpinned clips are kept: 7, 30, 90 or 365. */
  getRetentionDays(): number;
  setRetentionDays(days: number): void;
  /** Puts this text on the clipboard. */
  copyText(text: string): void;
  /** Opens an http(s) link, the dialer for a tel: uri, or the map for a geo: query; anything else is refused. False when nothing opened. */
  openAction(uri: string): boolean;
  /** Deletes every saved clip. */
  clearAll(): void;
  /** JSON `{ light, dark }` palettes for the bubble, which draws without React Native. */
  setPalettes(json: string): void;
  /** Whether Nexus may read pinned text clips through the link share. Off until the owner turns it on. */
  getNexusReadsPinned(): boolean;
  setNexusReadsPinned(on: boolean): void;
  /** Opens Inflow's "Add to-do?" screen with these extras; nothing is added until the owner taps Add there. */
  addToInflow(title: string, note: string, source: string): Promise<string>;
  addListener(event: 'onClip', listener: () => void): { remove(): void };
}

export default requireNativeModule<ClipboardCoreApi>('ClipboardCore');
