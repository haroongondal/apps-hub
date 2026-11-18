import type { InterfaceInfo } from './model.ts';
import type { NetLensNativeBinding } from './native-binding.ts';
import { probeHome } from './people.ts';
import { magicPacket, subnetBroadcast } from './wol.ts';

export const WAKE_PORT = 9;
export const WAKE_SENDS = 3;
export const WAKE_SEND_GAP_MS = 300;
export const WAKE_PROBE_EVERY_MS = 3000;
export const WAKE_WATCH_MS = 60_000;

export type WakeResult = 'awake' | 'no-answer' | 'failed' | 'cancelled';

/** Resolves after `ms`, or at once on abort; the timer is cleared either way. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

/**
 * Sends the magic packet 3 times, then probes `targetIp` every 3 s for up to 60 s.
 * Sends nothing unless called; never rejects. 'failed' means the first send did not go out
 * (no Wi-Fi, bad MAC or prefix, or the send was refused); later send errors are ignored.
 */
export async function wakeAndWatch(opts: {
  binding: Pick<NetLensNativeBinding, 'sendUdpBroadcast' | 'measureTcpHandshake'>;
  mac: string;
  iface: Pick<InterfaceInfo, 'localIp' | 'cidrPrefix'> | null;
  targetIp: string;
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}): Promise<WakeResult> {
  const { binding, iface, targetIp, signal, sleep = abortableSleep, now = Date.now } = opts;
  let packet: number[];
  let broadcastIp: string;
  try {
    if (iface === null) return 'failed';
    packet = magicPacket(opts.mac);
    broadcastIp = subnetBroadcast(iface.localIp, iface.cidrPrefix);
  } catch {
    return 'failed';
  }
  for (let i = 0; i < WAKE_SENDS; i += 1) {
    if (i > 0) await sleep(WAKE_SEND_GAP_MS, signal);
    if (signal.aborted) return 'cancelled';
    try {
      await binding.sendUdpBroadcast(broadcastIp, WAKE_PORT, packet);
    } catch {
      if (i === 0) return 'failed';
    }
  }
  const start = now();
  while (now() - start < WAKE_WATCH_MS) {
    await sleep(WAKE_PROBE_EVERY_MS, signal);
    if (signal.aborted) return 'cancelled';
    const up = await probeHome(binding, targetIp);
    if (signal.aborted) return 'cancelled';
    if (up) return 'awake';
  }
  return 'no-answer';
}
