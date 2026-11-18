/** Control actions for detected devices. Every request goes through httpRequest / soapCall, so the LAN guard applies. */
import { httpRequest, parseJsonObject } from './lan-http.ts';
import type { HttpTarget } from './lan-http.ts';
import type { DetectedControl } from './device-controls.ts';
import type { InterfaceInfo } from './model.ts';
import type { NetLensNativeBinding } from './native-binding.ts';
import { soapCall } from './upnp-soap.ts';
import type { SoapService } from './upnp-soap.ts';

type Binding = Pick<NetLensNativeBinding, 'tcpFetch'>;

const ROKU_KEYS = ['Home', 'Back', 'Up', 'Down', 'Left', 'Right', 'Select', 'Play', 'VolumeUp', 'VolumeDown', 'VolumeMute', 'PowerOff'] as const;
export type RokuKey = (typeof ROKU_KEYS)[number];

/** Runtime check too: the key goes into a request path. */
export async function rokuKey(binding: Binding, iface: InterfaceInfo, ip: string, key: RokuKey): Promise<boolean> {
  if (!ROKU_KEYS.includes(key)) return false;
  // An empty body makes httpRequest send Content-Length: 0, which Roku wants on a POST.
  const res = await httpRequest(binding, iface, { ip, port: 8060, path: `/keypress/${key}` }, { method: 'POST', body: '' });
  return res?.status === 200;
}

// ---- DLNA ----

const MASTER: Array<[string, string]> = [['InstanceID', '0'], ['Channel', 'Master']];

export async function dlnaTransport(
  binding: Binding,
  iface: InterfaceInfo,
  transport: SoapService,
  action: 'Play' | 'Pause' | 'Next' | 'Previous',
): Promise<boolean> {
  const args: Array<[string, string]> = action === 'Play' ? [['InstanceID', '0'], ['Speed', '1']] : [['InstanceID', '0']];
  return (await soapCall(binding, iface, transport, action, args)).ok;
}

export async function dlnaGetVolume(binding: Binding, iface: InterfaceInfo, rendering: SoapService): Promise<number | null> {
  const r = await soapCall(binding, iface, rendering, 'GetVolume', MASTER);
  const raw = r.ok ? r.values.CurrentVolume : undefined;
  if (raw === undefined || !/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 100 ? n : null;
}

export async function dlnaSetVolume(binding: Binding, iface: InterfaceInfo, rendering: SoapService, level: number): Promise<boolean> {
  if (Number.isNaN(level)) return false;
  const volume = Math.min(100, Math.max(0, Math.round(level)));
  return (await soapCall(binding, iface, rendering, 'SetVolume', [...MASTER, ['DesiredVolume', String(volume)]])).ok;
}

export async function dlnaGetMute(binding: Binding, iface: InterfaceInfo, rendering: SoapService): Promise<boolean | null> {
  const r = await soapCall(binding, iface, rendering, 'GetMute', MASTER);
  const raw = r.ok ? r.values.CurrentMute : undefined;
  return raw === '1' || raw === 'true' ? true : raw === '0' || raw === 'false' ? false : null;
}

export async function dlnaSetMute(binding: Binding, iface: InterfaceInfo, rendering: SoapService, muted: boolean): Promise<boolean> {
  return (await soapCall(binding, iface, rendering, 'SetMute', [...MASTER, ['DesiredMute', muted ? '1' : '0']])).ok;
}

// ---- Smart plugs ----

type Plug = Extract<DetectedControl, { kind: 'shelly' | 'tasmota' }>;

async function getJson(binding: Binding, iface: InterfaceInfo, ip: string, path: string): Promise<Record<string, unknown> | null> {
  const res = await httpRequest(binding, iface, { ip, port: 80, path }, {});
  return res?.status === 200 ? parseJsonObject(res.body) : null;
}

const asBool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

// Tasmota says "ON"/"OFF" under POWER, or POWER1 on a multi-relay build.
function tasmotaPower(j: Record<string, unknown> | null): boolean | null {
  for (const key of ['POWER', 'POWER1']) {
    const v = j?.[key];
    if (typeof v === 'string' && /^(on|off)$/i.test(v)) return v.toLowerCase() === 'on';
  }
  return null;
}

export async function plugGetPower(binding: Binding, iface: InterfaceInfo, ip: string, c: Plug): Promise<boolean | null> {
  if (c.kind === 'tasmota') return c.locked ? null : tasmotaPower(await getJson(binding, iface, ip, '/cm?cmnd=Power'));
  return c.gen === 1
    ? asBool((await getJson(binding, iface, ip, '/relay/0'))?.ison)
    : asBool((await getJson(binding, iface, ip, '/rpc/Switch.GetStatus?id=0'))?.output);
}

/** Returns the state the device reports after the command, not the one asked for. */
export async function plugSetPower(binding: Binding, iface: InterfaceInfo, ip: string, c: Plug, on: boolean): Promise<boolean | null> {
  if (c.kind === 'tasmota') {
    return c.locked ? null : tasmotaPower(await getJson(binding, iface, ip, `/cm?cmnd=Power%20${on ? 'On' : 'Off'}`));
  }
  if (c.gen === 1) return asBool((await getJson(binding, iface, ip, `/relay/0?turn=${on ? 'on' : 'off'}`))?.ison);
  // Gen2 answers {"was_on":…}, so read the new state back.
  if (!(await getJson(binding, iface, ip, `/rpc/Switch.Set?id=0&on=${on}`))) return null;
  return plugGetPower(binding, iface, ip, c);
}

// ---- WLED ----

export interface WledState {
  on: boolean;
  bri: number;
}

function wledState(res: { status: number; body: string } | null): WledState | null {
  const j = res?.status === 200 ? parseJsonObject(res.body) : null;
  const bri = j?.bri;
  return typeof j?.on === 'boolean' && typeof bri === 'number' && Number.isInteger(bri) && bri >= 0 && bri <= 255
    ? { on: j.on, bri }
    : null;
}

const WLED: Omit<HttpTarget, 'ip'> = { port: 80, path: '/json/state' };

export async function wledGet(binding: Binding, iface: InterfaceInfo, ip: string): Promise<WledState | null> {
  return wledState(await httpRequest(binding, iface, { ip, ...WLED }, {}));
}

export async function wledSet(binding: Binding, iface: InterfaceInfo, ip: string, change: { on?: boolean; bri?: number }): Promise<WledState | null> {
  const body: Record<string, unknown> = {};
  if (typeof change.on === 'boolean') body.on = change.on;
  if (typeof change.bri === 'number' && !Number.isNaN(change.bri)) body.bri = Math.min(255, Math.max(1, Math.round(change.bri)));
  body.v = true; // asks WLED to reply with the full state
  const res = await httpRequest(binding, iface, { ip, ...WLED }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return wledState(res);
}
