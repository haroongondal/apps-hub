import { requireNativeModule } from 'expo';

export interface ServiceState {
  /** Switched on in Settings; it may not be bound yet right after a boot. */
  accessibilityEnabled: boolean;
  notificationsAllowed: boolean;
  batteryUnrestricted: boolean;
}

export interface TreeDump {
  pkg: string | null;
  nodes: number;
  text: string;
}

interface DeputyAgentApi {
  getServiceState(): ServiceState;
  openAccessibilitySettings(): void;
  openAppInfo(): void;
  openBatterySettings(): void;
  /** False when the service isn't connected, so the caller must send the owner to Accessibility settings. */
  disableService(): boolean;
  /** Debug: waits so the owner can switch apps, then dumps the app in front. Never dumps Deputy's own screens. */
  dumpForegroundTree(delaySeconds: number): Promise<TreeDump>;
  copyToClipboard(text: string): void;
  armForegroundProbe(): void;
  getSpikeReport(): string;
  clearSpikeReport(): void;
  /** Debug (spike S5): tries four screenshots with gaps and reports each outcome and latency. */
  probeScreenshots(delaySeconds: number): Promise<string>;
  /** Debug (spike S4): sets the focused text field in another app to its text plus "Deputy test", then checks it changed. */
  probeTyping(delaySeconds: number): Promise<string>;
}

export default requireNativeModule<DeputyAgentApi>('DeputyAgent');
