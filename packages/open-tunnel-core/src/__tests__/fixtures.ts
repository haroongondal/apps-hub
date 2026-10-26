/**
 * Shared test fixtures. Import from test files freely — this module
 * registers no tests of its own, so node --test never double-counts.
 */
import { createVpnNode, type VpnNode } from '../vpn-node.ts';

/** Text model-level fixture mirroring the Dart test's canonical node. */
export function makeNode(
  overrides?: Partial<Parameters<typeof createVpnNode>[0]>,
): VpnNode {
  return createVpnNode({
    hostName: 'public-vpn-155',
    ip: '219.100.37.110',
    port: 1195,
    transportProto: 'udp',
    score: 1579190,
    pingMs: 20,
    speedBps: 183498662,
    countryLong: 'Japan',
    countryShort: 'JP',
    numSessions: 100,
    uptimeMs: 112305311000,
    operatorName: 'Daiyuu Nobori_ Japan. Academic Use Only.',
    ovpnConfigRaw: 'client',
    ...overrides,
  });
}

/** Realistic 15-column VPN Gate row header modeled on the live payload. */
export const HEADER_LINE =
  '#HostName,IP,Score,Ping,Speed,CountryLong,CountryShort,NumVpnSessions,' +
  'Uptime,TotalUsers,TotalTraffic,LogType,Operator,Message,' +
  'OpenVPN_ConfigData_Base64';

export interface OvpnConfigOptions {
  port?: number;
  proto?: string;
  remote?: string;
  includeRemote?: boolean;
  legacyDirectives?: readonly string[];
}

export function ovpnConfig(options: OvpnConfigOptions = {}): string {
  const { port = 1195, proto = 'udp', remote = '1.2.3.4', includeRemote = true } = options;
  const legacy = options.legacyDirectives ?? [];
  const lines: string[] = [
    '##################################',
    '# OpenVPN 2.0 sample produced by VPN Gate',
    '##################################',
    '',
    'client',
    'dev tun',
    `proto ${proto}`,
  ];
  if (includeRemote) {
    lines.push(`remote ${remote} ${port}`);
  }
  lines.push(
    'resolv-retry infinite',
    'nobind',
    'auth-user-pass',
    'persist-key',
    'persist-tun',
  );
  for (const directive of legacy) {
    lines.push(directive);
  }
  lines.push(
    '',
    '<ca>',
    '-----BEGIN CERTIFICATE-----',
    'MIIAb2d1ZXN0Y2VydA==',
    '-----END CERTIFICATE-----',
    '</ca>',
  );
  return lines.join('\n') + '\n';
}

export interface CsvRowOptions extends OvpnConfigOptions {
  host?: string;
  ip?: string;
  score?: number;
  ping?: number;
  speedBps?: number;
  sessions?: number;
  uptimeSec?: number;
  operatorText?: string;
  message?: string;
  ovpnConfig: string;
}

export function csvRow(options: CsvRowOptions): string {
  const {
    host = 'public-vpn-155',
    ip = '219.100.37.110',
    score = 1579190,
    ping = 20,
    speedBps = 183498662,
    sessions = 100,
    uptimeSec = 112305311,
    operatorText = 'Daiyuu Nobori_ Japan. Academic Use Only.',
    message = '',
  } = options;
  const encoded = Buffer.from(options.ovpnConfig, 'utf8').toString('base64');
  return (
    `${host},${ip},${score},${ping},${speedBps},Japan,JP,${sessions},${uptimeSec},` +
    `8229093,464887703812776,2weeks,${operatorText},${message},${encoded}`
  );
}

/** Full VPN Gate body shape: marker, header, rows, blank, footer. */
export function csvStream(rows: readonly string[]): string[] {
  return ['*vpn_servers', HEADER_LINE, ...rows, '', '*'];
}
