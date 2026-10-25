import { requireNativeModule } from 'expo';

/**
 * JavaScript contract of the native `NetLensCore` module (see
 * docs/netlens/SPEC.md §3). Event payloads live in @apps-hub/core (module
 * src/index.ts adapter) so both platforms stay schema-identical. Expo
 * Modules runtime makes the module object itself an EventEmitter (SDK 52+),
 * so listeners attach directly via `addListener(name, cb)` → {remove}.
 */
export interface NetlensCoreApi {
  getNetworkInterfaceInfo(): Promise<Record<string, unknown> | null>;
  startTcpScan(hostIps: string[], ports: number[], timeoutMs: number): Promise<void>;
  stopTcpScan(): Promise<void>;
  startServiceDiscovery(timeoutMs: number): Promise<void>;
  stopServiceDiscovery(): Promise<void>;
  addListener(
    eventName: string,
    listener: (...args: any[]) => void,
  ): { remove(): void };
}

export default requireNativeModule<NetlensCoreApi>('NetLensCore');
