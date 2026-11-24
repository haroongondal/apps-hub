/**
 * Adapter wiring the native `netlens-core` module to the pure-TS
 * `NetLensNativeBinding` port defined in @apps-hub/core. Mockable at the
 * boundary: packages/core tests inject fakes instead of this adapter.
 *
 * Note (Expo SDK 52+): requireNativeModule returns an object that IS an
 * EventEmitter, so listeners hang straight off the module.
 */
import { parseDeputyOutcome, parseHomeWatchStatus, tcpFetchArgsError, udpBroadcastArgsError, udpRequestArgsError } from '@apps-hub/core';
import type {
  DeputyBinding,
  DnsResolution,
  HomeWatchBinding,
  ListenerHandle,
  NetLensNativeBinding,
  ProbeOutcome,
  ScanEventListener,
  ScanEventName,
  TcpHandshakeResult,
} from '@apps-hub/core';
import NetLensCore from './NetlensCoreModule';

function normalizeOutcome(raw: unknown): ProbeOutcome {
  return raw === 'open' || raw === 'refused' || raw === 'timeout' ? raw : 'unreachable';
}

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
    /**
     * SPEC §5 handshake measurement. Coercion mirrors detectInterface:
     * only open/refused carriers keep their RTT (hard rule #2) — a
     * misbehaving bridge cannot smuggle an RTT onto an offline verdict.
     */
    async measureTcpHandshake(ip, port, timeoutMs): Promise<TcpHandshakeResult> {
      const raw = (await NetLensCore.measureTcpHandshake(
        ip,
        port,
        timeoutMs,
      )) as Record<string, unknown> | null;
      if (!raw) return { outcome: 'unreachable', rttMs: null };
      const outcome = normalizeOutcome(raw.outcome);
      const measured =
        typeof raw.rttMs === 'number' && Number.isFinite(raw.rttMs)
          ? raw.rttMs
          : null;
      const carrying = outcome === 'open' || outcome === 'refused';
      return { outcome, rttMs: carrying ? measured : null };
    },
    /** SPEC §5 resolver bridge: strict field coercion, null passthrough. */
    async resolveHostname(hostname): Promise<DnsResolution | null> {
      const raw = (await NetLensCore.resolveHostname(
        hostname,
      )) as Record<string, unknown> | null;
      if (!raw) return null;
      const addresses = Array.isArray(raw.addresses)
        ? raw.addresses.filter((item): item is string => typeof item === 'string')
        : [];
      const durationMs =
        typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs)
          ? raw.durationMs
          : 0;
      return {
        hostname: typeof raw.hostname === 'string' ? raw.hostname : hostname,
        addresses,
        durationMs,
        success: raw.success === true && addresses.length > 0,
      };
    },
    /** Only a clean byte array counts as a reply; anything else is no reply. */
    async udpRequest(ip, port, payload, timeoutMs) {
      const problem = udpRequestArgsError(port, payload, timeoutMs);
      if (problem) throw new Error(problem);
      const raw: unknown = await NetLensCore.udpRequest(ip, port, [...payload], timeoutMs);
      const isByte = (n: unknown): n is number =>
        typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255;
      return Array.isArray(raw) && raw.every(isByte) ? raw : null;
    },
    async sendUdpBroadcast(ip, port, payload) {
      const problem = udpBroadcastArgsError(port, payload);
      if (problem) throw new Error(problem);
      await NetLensCore.sendUdpBroadcast(ip, port, [...payload]);
    },
    async tcpFetch(ip, port, request, timeoutMs, maxBytes) {
      const problem = tcpFetchArgsError(port, timeoutMs, maxBytes);
      if (problem) throw new Error(problem);
      const raw: unknown = await NetLensCore.tcpFetch(ip, port, request, timeoutMs, maxBytes);
      return typeof raw === 'string' ? raw : null;
    },
  };
}

export function createHomeWatchBinding(): HomeWatchBinding {
  return {
    async getHomeWatch() {
      return parseHomeWatchStatus(await NetLensCore.getHomeWatch());
    },
    async setHomeWatch(settings, snapshot) {
      return parseHomeWatchStatus(await NetLensCore.setHomeWatch({ ...settings }, snapshot ? { ...snapshot } : null));
    },
    async syncHome(home, snapshot) {
      return parseHomeWatchStatus(await NetLensCore.syncHomeWatch({ ...home }, { ...snapshot }));
    },
    async markDeviceMine(ip) {
      return parseHomeWatchStatus(await NetLensCore.markDeviceMine(ip));
    },
  };
}

export function createDeputyBinding(): DeputyBinding {
  return {
    async proposeDeputyTask({ task, context }) {
      try {
        return parseDeputyOutcome(await NetLensCore.proposeDeputyTask(task, context));
      } catch {
        return 'refused';
      }
    },
  };
}
