import type { NetLensNativeBinding } from './native-binding.ts';

export interface KnownPort {
  port: number;
  label: string;
  web?: 'http' | 'https';
  risk?: string;
}

export const COMMON_PORTS: readonly KnownPort[] = [
  { port: 21, label: 'File transfer (FTP)', risk: 'Sends passwords unencrypted.' },
  { port: 22, label: 'Remote login (SSH)' },
  { port: 23, label: 'Remote login (Telnet)', risk: 'Sends passwords unencrypted. Turn it off if you can.' },
  { port: 53, label: 'DNS' },
  { port: 80, label: 'Web page', web: 'http' },
  { port: 139, label: 'Windows file sharing (old)' },
  { port: 443, label: 'Secure web page', web: 'https' },
  { port: 445, label: 'Windows file sharing' },
  { port: 548, label: 'Mac file sharing' },
  { port: 554, label: 'Camera stream (RTSP)' },
  { port: 631, label: 'Printer (IPP)' },
  { port: 1883, label: 'Smart home messages (MQTT)' },
  { port: 3389, label: 'Remote desktop', risk: 'Anyone on your Wi-Fi can try to log in.' },
  { port: 5000, label: 'Web app', web: 'http' },
  { port: 5001, label: 'Secure web app', web: 'https' },
  { port: 5900, label: 'Screen sharing (VNC)', risk: 'Anyone on your Wi-Fi can try to log in.' },
  { port: 8008, label: 'Chromecast' },
  { port: 8080, label: 'Web page', web: 'http' },
  { port: 8123, label: 'Home Assistant', web: 'http' },
  { port: 8443, label: 'Secure web page', web: 'https' },
  { port: 9100, label: 'Printer' },
  { port: 32400, label: 'Plex media server', web: 'http' },
  { port: 62078, label: 'Apple device sync' },
];

export const PORT_CHECK_TIMEOUT_MS = 800;
export const PORT_CHECK_CONCURRENCY = 8;

// Only `open` counts: `refused` (TCP RST) proves the host is alive but the port is closed.
export async function checkPorts(
  binding: Pick<NetLensNativeBinding, 'measureTcpHandshake'>,
  ip: string,
  ports: readonly KnownPort[] = COMMON_PORTS,
  timeoutMs: number = PORT_CHECK_TIMEOUT_MS,
): Promise<KnownPort[]> {
  const open = new Array<boolean>(ports.length).fill(false);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < ports.length) {
      const index = cursor++;
      try {
        const result = await binding.measureTcpHandshake(ip, ports[index].port, timeoutMs);
        open[index] = result.outcome === 'open';
      } catch {
        // A failed probe reads as closed; one bad port must not sink the check.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PORT_CHECK_CONCURRENCY, ports.length) }, worker));
  return ports.filter((_, index) => open[index]);
}

export function webUrlFor(ip: string, known: KnownPort): string | null {
  if (!known.web) return null;
  const isDefault = (known.web === 'http' && known.port === 80) || (known.web === 'https' && known.port === 443);
  return `${known.web}://${ip}${isDefault ? '' : `:${known.port}`}/`;
}
