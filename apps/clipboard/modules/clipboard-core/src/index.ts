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
  /** JSON `{ light, dark }` palettes for the bubble, which draws without React Native. */
  setPalettes(json: string): void;
  addListener(event: 'onClip', listener: () => void): { remove(): void };
}

export default requireNativeModule<ClipboardCoreApi>('ClipboardCore');
