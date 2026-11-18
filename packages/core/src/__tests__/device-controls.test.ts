import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectControls, findMediaServices } from '../device-controls.ts';
import type { HttpTarget } from '../lan-http.ts';
import type { InterfaceInfo } from '../model.ts';

const iface: InterfaceInfo = { localIp: '192.168.1.20', cidrPrefix: 24, gatewayIp: '192.168.1.1' };
const IP = '192.168.1.50';
const RC = 'urn:schemas-upnp-org:service:RenderingControl:1';
const AVT = 'urn:schemas-upnp-org:service:AVTransport:1';

const reply = (status: number, body = ''): string => `HTTP/1.0 ${status} X\r\n\r\n${body}`;

// Replies are keyed by port + path; anything else is silent (null), like a closed port.
function fake(replies: Record<string, string>) {
  const calls: { ip: string; key: string; request: string }[] = [];
  return {
    calls,
    binding: {
      tcpFetch: async (ip: string, port: number, request: string): Promise<string | null> => {
        const path = /^\w+ (\S+) /.exec(request)?.[1] ?? '';
        calls.push({ ip, key: `${port}${path}`, request });
        return replies[`${port}${path}`] ?? null;
      },
    },
  };
}

const service = (type: string, control: string): string =>
  `<service><serviceType>${type}</serviceType><serviceId>urn:upnp-org:serviceId:x</serviceId><SCPDURL>/x.xml</SCPDURL><controlURL>${control}</controlURL><eventSubURL>/evt</eventSubURL></service>`;

// Real shape: the media services sit in a MediaRenderer sub-device, not the root device.
const SONOS =
  '<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device>' +
  '<deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType><friendlyName>Living room</friendlyName>' +
  `<serviceList>${service('urn:schemas-upnp-org:service:DeviceProperties:1', '/DeviceProperties/Control')}</serviceList>` +
  '<deviceList><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>' +
  `<serviceList>${service(RC, '/MediaRenderer/RenderingControl/Control')}${service(AVT, '/MediaRenderer/AVTransport/Control')}</serviceList>` +
  '</device></deviceList></device></root>';

const location: HttpTarget = { ip: IP, port: 1400, path: '/xml/device_description.xml' };

test('a Roku reply gives roku', async () => {
  const f = fake({ '8060/query/device-info': reply(200, '<?xml version="1.0"?><device-info><model-name>Roku</model-name></device-info>') });
  assert.deepEqual(await detectControls(f.binding, iface, IP, []), [{ kind: 'roku' }]);
});

test('Shelly gen 2 and gen 1 are told apart', async () => {
  const g2 = fake({ '80/shelly': reply(200, '{"name":"x","gen":2,"id":"shellyplus1"}') });
  assert.deepEqual(await detectControls(g2.binding, iface, IP, []), [{ kind: 'shelly', gen: 2 }]);
  const g1 = fake({ '80/shelly': reply(200, '{"type":"SHSW-1","mac":"AA","auth":false}') });
  assert.deepEqual(await detectControls(g1.binding, iface, IP, []), [{ kind: 'shelly', gen: 1 }]);
  const other = fake({ '80/shelly': reply(200, '{"hello":1}') });
  assert.deepEqual(await detectControls(other.binding, iface, IP, []), []);
  const badGen = fake({ '80/shelly': reply(200, '{"gen":"2","type":"x"}') });
  assert.deepEqual(await detectControls(badGen.binding, iface, IP, []), []);
});

test('Tasmota is locked on 401 and unlocked on a POWER reply', async () => {
  const locked = fake({ '80/cm?cmnd=Power': reply(401, 'Unauthorized') });
  assert.deepEqual(await detectControls(locked.binding, iface, IP, []), [{ kind: 'tasmota', locked: true }]);
  const open = fake({ '80/cm?cmnd=Power': reply(200, '{"POWER":"ON"}') });
  assert.deepEqual(await detectControls(open.binding, iface, IP, []), [{ kind: 'tasmota', locked: false }]);
  const multi = fake({ '80/cm?cmnd=Power': reply(200, '{"POWER2":"OFF"}') });
  assert.deepEqual(await detectControls(multi.binding, iface, IP, []), [{ kind: 'tasmota', locked: false }]);
  const notTasmota = fake({ '80/cm?cmnd=Power': reply(200, '{"POWER":1}') });
  assert.deepEqual(await detectControls(notTasmota.binding, iface, IP, []), []);
});

test('WLED is recognised by its brand', async () => {
  const f = fake({ '80/json/info': reply(200, '{"ver":"0.14.0","brand":"WLED"}') });
  assert.deepEqual(await detectControls(f.binding, iface, IP, []), [{ kind: 'wled' }]);
  const other = fake({ '80/json/info': reply(200, '{"brand":"Other"}') });
  assert.deepEqual(await detectControls(other.binding, iface, IP, []), []);
});

test('findMediaServices reads a Sonos description with sub-devices', () => {
  assert.deepEqual(findMediaServices(SONOS, location), {
    rendering: { serviceType: RC, control: { ip: IP, port: 1400, path: '/MediaRenderer/RenderingControl/Control' } },
    transport: { serviceType: AVT, control: { ip: IP, port: 1400, path: '/MediaRenderer/AVTransport/Control' } },
  });
});

test('findMediaServices refuses other hosts, bad URNs, entities and oversize input', () => {
  const foreign = `<root>${service(RC, 'http://192.168.1.99:80/c')}${service(AVT, 'MediaRenderer/AVTransport/Control')}</root>`;
  const r = findMediaServices(foreign, location);
  assert.equal(r.rendering, null);
  assert.equal(r.transport?.control.path, '/MediaRenderer/AVTransport/Control');
  const evil = `<root>${service('urn:schemas-upnp-org:service:AVTransport:1"><x/', '/c')}</root>`;
  assert.deepEqual(findMediaServices(evil, location), { rendering: null, transport: null });
  assert.deepEqual(findMediaServices('<!DOCTYPE x [<!ENTITY a "b">]>' + SONOS, location), { rendering: null, transport: null });
  assert.deepEqual(findMediaServices(SONOS + ' '.repeat(262144), location), { rendering: null, transport: null });
  const first = `<root>${service(RC, 'http://192.168.1.99/c')}${service(RC, '/second')}</root>`;
  assert.equal(findMediaServices(first, location).rendering, null, 'the first service of a type decides');
});

test('a Sonos is found by the :1400 fallback when no location is given', async () => {
  const f = fake({ '1400/xml/device_description.xml': reply(200, SONOS) });
  const found = await detectControls(f.binding, iface, IP, []);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'dlna');
  assert.equal(found[0].kind === 'dlna' && found[0].rendering?.control.path, '/MediaRenderer/RenderingControl/Control');
});

test('DLNA fetches only the device\'s own locations (deduped, at most 4) and skips the fallback when one works', async () => {
  const f = fake({ '49152/desc.xml': reply(200, SONOS.replaceAll('/MediaRenderer', '/MR')) });
  const locs = [
    `http://${IP}:49152/desc.xml`,
    `http://${IP}:49152/desc.xml`,
    'http://192.168.1.99:49152/desc.xml',
    'https://192.168.1.50/x',
    ...[1, 2, 3, 4, 5].map((i) => `http://${IP}:49152/extra${i}.xml`),
  ];
  const found = await detectControls(f.binding, iface, IP, locs);
  assert.equal(found[0].kind === 'dlna' && found[0].transport?.control.path, '/MR/AVTransport/Control');
  assert.equal(f.calls.filter((c) => c.key.includes('desc.xml')).length, 1);
  assert.equal(f.calls.filter((c) => c.ip !== IP).length, 0);
  assert.equal(f.calls.filter((c) => c.key.startsWith('49152')).length, 4);
  assert.equal(f.calls.some((c) => c.key.startsWith('1400')), false);
});

test('a description with no media services gives no dlna entry', async () => {
  const f = fake({ '1400/xml/device_description.xml': reply(200, '<root><device><serviceList></serviceList></device></root>') });
  assert.deepEqual(await detectControls(f.binding, iface, IP, []), []);
});

test('results come in a stable order, a silent device gives [], and every request is a GET', async () => {
  const all = fake({
    '8060/query/device-info': reply(200, '<device-info/>'),
    '1400/xml/device_description.xml': reply(200, SONOS),
    '80/shelly': reply(200, '{"gen":2}'),
    '80/cm?cmnd=Power': reply(200, '{"POWER":"ON"}'),
    '80/json/info': reply(200, '{"brand":"WLED"}'),
  });
  assert.deepEqual((await detectControls(all.binding, iface, IP, [])).map((c) => c.kind), ['roku', 'dlna', 'shelly', 'tasmota', 'wled']);
  const silent = fake({});
  assert.deepEqual(await detectControls(silent.binding, iface, IP, [`http://${IP}:49152/d.xml`]), []);
  for (const c of [...all.calls, ...silent.calls]) assert.ok(c.request.startsWith('GET '), c.request);
  assert.equal(silent.calls.length >= 5, true);
});

test('an off-LAN ip makes no request, and a throwing binding gives []', async () => {
  const f = fake({ '80/shelly': reply(200, '{"gen":2}') });
  assert.deepEqual(await detectControls(f.binding, iface, '8.8.8.8', ['http://8.8.8.8/d.xml']), []);
  assert.equal(f.calls.length, 0);
  const boom = { tcpFetch: async (): Promise<string | null> => { throw new Error('boom'); } };
  assert.deepEqual(await detectControls(boom, iface, IP, []), []);
});
