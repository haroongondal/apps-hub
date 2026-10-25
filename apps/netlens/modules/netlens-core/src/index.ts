/**
 * Adapter wiring the native `netlens-core` module to the pure-TS
 * `NetLensNativeBinding` port defined in @apps-hub/core. Mockable at the
 * boundary: packages/core tests inject fakes instead of this adapter.
 *
 * Note (Expo SDK 52+): requireNativeModule returns an object that IS an
 * EventEmitter, so listeners hang straight off the module.
 */
import type {
  ListenerHandle,
  NetLensNativeBinding,
  ScanEventListener,
  ScanEventName,
} from '@apps-hub/core';
import NetLensCore from './NetlensCoreModule';

export function createNetLensNativeBinding(): NetLensNativeBinding {
  return {
    async detectInterface() {
      const raw = await NetLensCore.getNetworkInterfaceInfo();
      if (!raw || typeof raw.localIp !== 'string') return null;
      const cidrPrefix = Number(raw.cidrPrefix ?? 24);
      return {
        localIp: raw.localIp as string,
        cidrPrefix: Number.isFinite(cidrPrefix) ? cidrPrefix : 24,
        gatewayIp: typeof raw.gatewayIp === 'string' ? raw.gatewayIp : null,
      };
    },
    addListener<E extends ScanEventName>(
      event: E,
      listener: ScanEventListener<E>,
    ): ListenerHandle {
      const subscription = NetLensCore.addListener(event, listener as never);
      return {
        remove: () => {
          subscription.remove();
        },
      };
    },
    async startTcpScan({ hostIps, ports, timeoutMs }) {
      await NetLensCore.startTcpScan([...hostIps], [...ports], timeoutMs);
    },
    async stopTcpScan() {
      await NetLensCore.stopTcpScan();
    },
    async startServiceDiscovery(timeoutMs) {
      await NetLensCore.startServiceDiscovery(timeoutMs);
    },
    async stopServiceDiscovery() {
      await NetLensCore.stopServiceDiscovery();
    },
  };
}
