/**
 * Injectable contract implemented by the `netlens-core` Expo module
 * (src/index.ts adapter) and faked in unit tests. Keeping this port pure TS
 * lets the engine run under Jest-equivalent node --test with a fake native
 * module and under Metro with the real one.
 */
import type {
  InterfaceInfo,
  ListenerHandle,
  ScanEventName,
  ScanEventListener,
} from './model.ts';

export interface TcpScanStartParams {
  hostIps: readonly string[];
  ports: readonly number[];
  timeoutMs: number;
}

export interface NetLensNativeBinding {
  detectInterface(): Promise<InterfaceInfo | null>;
  addListener<E extends ScanEventName>(
    event: E,
    listener: ScanEventListener<E>,
  ): ListenerHandle;
  startTcpScan(params: TcpScanStartParams): Promise<void>;
  stopTcpScan(): Promise<void>;
  startServiceDiscovery(timeoutMs: number): Promise<void>;
  stopServiceDiscovery(): Promise<void>;
}
