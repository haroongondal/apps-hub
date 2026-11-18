/** Device control actions: exact request lines and reply parsing against a fake tcpFetch (node --test). */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dlnaGetMute,
  dlnaGetVolume,
  dlnaSetMute,
  dlnaSetVolume,
  dlnaTransport,
  plugGetPower,
  plugSetPower,
  rokuKey,
  wledGet,
  wledSet,
} from '../device-actions.ts';
import type { RokuKey } from '../device-actions.ts';
import type { SoapService } from '../upnp-soap.ts';
import type { InterfaceInfo } from '../model.ts';

const iface: InterfaceInfo = { localIp: '192.168.1.20', cidrPrefix: 24, gatewayIp: '192.168.1.1' };
const IP = '192.168.1.50';
const RC = 'urn:schemas-upnp-org:service:RenderingControl:1';
const AVT = 'urn:schemas-upnp-org:service:AVTransport:1';
const rendering: SoapService = { serviceType: RC, control: { ip: IP, port: 49152, path: '/rc' } };
const transport: SoapService = { serviceType: AVT, control: { ip: IP, port: 49152, path: '/avt' } };

const http = (body: string, status = 200): string =>
  `HTTP/1.0 ${status} X\r\nContent-Type: text/plain\r\n\r\n${body}`;
const soapOk = (action: string, type: string, values: Record<string, string> = {}): string =>
  http(
    `<s:Envelope xmlns:s="x"><s:Body><u:${action}Response xmlns:u="${type}">` +
      Object.entries(values).map(([k, v]) => `<${k}>${v}</${k}>`).join('') +
      `</u:${action}Response></s:Body></s:Envelope>`,
  );

/** Records every request; the handler gets the request line ("GET /x") and the whole request. */
function fake(handler: (line: string, request: string) => string | null) {
  const requests: string[] = [];
  const lines: string[] = [];
  return {
    requests,
    lines,
    tcpFetch: async (_ip: string, port: number, request: string) => {
      requests.push(request);
      const line = request.split(' HTTP/')[0];
      lines.push(`${port} ${line}`);
      return handler(line, request);
    },
  };
}

test('rokuKey POSTs :8060/keypress/<key> with an empty body and is true only on 200', async () => {
  const b = fake(() => http(''));
  assert.equal(await rokuKey(b, iface, IP, 'VolumeUp'), true);
  assert.deepEqual(b.lines, ['8060 POST /keypress/VolumeUp']);
  assert.match(b.requests[0], /Content-Length: 0\r\n/);
  assert.equal(await rokuKey(fake(() => http('', 202)), iface, IP, 'Home'), false);
  assert.equal(await rokuKey(fake(() => null), iface, IP, 'Home'), false);
});

test('rokuKey refuses a key outside the list without a request', async () => {
  const b = fake(() => http(''));
  assert.equal(await rokuKey(b, iface, IP, 'Home/../x' as RokuKey), false);
  assert.equal(await rokuKey(b, iface, IP, 'Lit_a' as RokuKey), false);
  assert.equal(b.requests.length, 0);
});

test('dlnaTransport sends InstanceID, plus Speed=1 for Play only', async () => {
  const b = fake((_l, req) => soapOk(/#(\w+)"/.exec(req)![1], AVT));
  assert.equal(await dlnaTransport(b, iface, transport, 'Play'), true);
  assert.equal(await dlnaTransport(b, iface, transport, 'Pause'), true);
  assert.match(b.requests[0], /SOAPAction: "urn:schemas-upnp-org:service:AVTransport:1#Play"/);
  assert.match(b.requests[0], /<InstanceID>0<\/InstanceID><Speed>1<\/Speed><\/u:Play>/);
  assert.match(b.requests[1], /<InstanceID>0<\/InstanceID><\/u:Pause>/);
  assert.deepEqual(b.lines, ['49152 POST /avt', '49152 POST /avt']);
  const fault = fake(() => http('<Fault><errorCode>701</errorCode></Fault>', 500));
  assert.equal(await dlnaTransport(fault, iface, transport, 'Next'), false);
});

test('dlnaGetVolume sends InstanceID then Channel and parses CurrentVolume as an integer 0-100', async () => {
  const b = fake(() => soapOk('GetVolume', RC, { CurrentVolume: '42' }));
  assert.equal(await dlnaGetVolume(b, iface, rendering), 42);
  assert.match(b.requests[0], /#GetVolume"/);
  assert.match(b.requests[0], /<InstanceID>0<\/InstanceID><Channel>Master<\/Channel>/);
  for (const bad of ['101', '-1', '4.5', 'abc', '']) {
    assert.equal(await dlnaGetVolume(fake(() => soapOk('GetVolume', RC, { CurrentVolume: bad })), iface, rendering), null, bad);
  }
  assert.equal(await dlnaGetVolume(fake(() => soapOk('GetVolume', RC)), iface, rendering), null);
  assert.equal(await dlnaGetVolume(fake(() => null), iface, rendering), null);
});

test('dlnaSetVolume clamps 0-100, rounds, and does not send NaN', async () => {
  const b = fake(() => soapOk('SetVolume', RC));
  assert.equal(await dlnaSetVolume(b, iface, rendering, 140), true);
  assert.match(b.requests[0], /<InstanceID>0<\/InstanceID><Channel>Master<\/Channel><DesiredVolume>100<\/DesiredVolume>/);
  await dlnaSetVolume(b, iface, rendering, -5);
  assert.match(b.requests[1], /<DesiredVolume>0<\/DesiredVolume>/);
  await dlnaSetVolume(b, iface, rendering, 33.6);
  assert.match(b.requests[2], /<DesiredVolume>34<\/DesiredVolume>/);
  assert.equal(await dlnaSetVolume(b, iface, rendering, NaN), false);
  assert.equal(b.requests.length, 3);
});

test('dlnaGetMute / dlnaSetMute use CurrentMute and DesiredMute 1/0', async () => {
  for (const [raw, want] of [['1', true], ['true', true], ['0', false], ['false', false], ['maybe', null]] as const) {
    const b = fake(() => soapOk('GetMute', RC, { CurrentMute: raw }));
    assert.equal(await dlnaGetMute(b, iface, rendering), want, raw);
  }
  const b = fake(() => soapOk('SetMute', RC));
  assert.equal(await dlnaSetMute(b, iface, rendering, true), true);
  assert.equal(await dlnaSetMute(b, iface, rendering, false), true);
  assert.match(b.requests[0], /#SetMute"/);
  assert.match(b.requests[0], /<Channel>Master<\/Channel><DesiredMute>1<\/DesiredMute>/);
  assert.match(b.requests[1], /<DesiredMute>0<\/DesiredMute>/);
});

const gen1 = { kind: 'shelly', gen: 1 } as const;
const gen2 = { kind: 'shelly', gen: 2 } as const;
const tasmota = { kind: 'tasmota', locked: false } as const;

test('Shelly Gen1 get and set use /relay/0 and read ison', async () => {
  const b = fake((line) => http(JSON.stringify({ ison: line.includes('turn=on') })));
  assert.equal(await plugGetPower(b, iface, IP, gen1), false);
  assert.equal(await plugSetPower(b, iface, IP, gen1, true), true);
  assert.equal(await plugSetPower(b, iface, IP, gen1, false), false);
  assert.deepEqual(b.lines, ['80 GET /relay/0', '80 GET /relay/0?turn=on', '80 GET /relay/0?turn=off']);
});

test('Shelly Gen2 set sends Switch.Set then reads the new state from Switch.GetStatus', async () => {
  let on = false;
  const b = fake((line) => {
    if (line.includes('Switch.Set')) { on = line.endsWith('on=true'); return http('{"was_on":false}'); }
    return http(JSON.stringify({ id: 0, output: on }));
  });
  assert.equal(await plugGetPower(b, iface, IP, gen2), false);
  assert.equal(await plugSetPower(b, iface, IP, gen2, true), true);
  assert.deepEqual(b.lines, [
    '80 GET /rpc/Switch.GetStatus?id=0',
    '80 GET /rpc/Switch.Set?id=0&on=true',
    '80 GET /rpc/Switch.GetStatus?id=0',
  ]);
  assert.equal(await plugSetPower(b, iface, IP, gen2, false), false);
  assert.equal(b.lines[3], '80 GET /rpc/Switch.Set?id=0&on=false');
});

test('Shelly Gen2 set returns null when Switch.Set fails, without a status read', async () => {
  const b = fake(() => http('', 500));
  assert.equal(await plugSetPower(b, iface, IP, gen2, true), null);
  assert.equal(b.lines.length, 1);
});

test('a plug reply with a non-boolean or missing field is null', async () => {
  assert.equal(await plugGetPower(fake(() => http('{"output":"true"}')), iface, IP, gen2), null);
  assert.equal(await plugGetPower(fake(() => http('{"output":1}')), iface, IP, gen2), null);
  assert.equal(await plugGetPower(fake(() => http('{}')), iface, IP, gen1), null);
  assert.equal(await plugGetPower(fake(() => http('not json')), iface, IP, gen1), null);
  assert.equal(await plugGetPower(fake(() => http('{"ison":true}', 401)), iface, IP, gen1), null);
  assert.equal(await plugGetPower(fake(() => null), iface, IP, gen1), null);
});

test('Tasmota get and set use /cm?cmnd=Power and read POWER or POWER1', async () => {
  const b = fake((line) => http(line.endsWith('Power') ? '{"POWER":"off"}' : '{"POWER1":"ON"}'));
  assert.equal(await plugGetPower(b, iface, IP, tasmota), false);
  assert.equal(await plugSetPower(b, iface, IP, tasmota, true), true);
  assert.equal(await plugSetPower(b, iface, IP, tasmota, false), true);
  assert.deepEqual(b.lines, ['80 GET /cm?cmnd=Power', '80 GET /cm?cmnd=Power%20On', '80 GET /cm?cmnd=Power%20Off']);
  assert.equal(await plugGetPower(fake(() => http('{"POWER":"TOGGLE"}')), iface, IP, tasmota), null);
  assert.equal(await plugGetPower(fake(() => http('{"POWER":true}')), iface, IP, tasmota), null);
});

test('a locked Tasmota makes no request', async () => {
  const b = fake(() => http('{"POWER":"ON"}'));
  const locked = { kind: 'tasmota', locked: true } as const;
  assert.equal(await plugGetPower(b, iface, IP, locked), null);
  assert.equal(await plugSetPower(b, iface, IP, locked, true), null);
  assert.equal(b.requests.length, 0);
});

test('wledGet reads on and bri from GET /json/state', async () => {
  const b = fake(() => http('{"on":true,"bri":128,"seg":[]}'));
  assert.deepEqual(await wledGet(b, iface, IP), { on: true, bri: 128 });
  assert.deepEqual(b.lines, ['80 GET /json/state']);
  assert.equal(await wledGet(fake(() => http('{"on":"yes","bri":1}')), iface, IP), null);
  assert.equal(await wledGet(fake(() => http('{"on":true,"bri":256}')), iface, IP), null);
  assert.equal(await wledGet(fake(() => http('{"on":true,"bri":1.5}')), iface, IP), null);
  assert.equal(await wledGet(fake(() => http('{"on":true}')), iface, IP), null);
  assert.equal(await wledGet(fake(() => http('{"on":true,"bri":1}', 404)), iface, IP), null);
});

test('wledSet POSTs JSON with v:true, only the given fields, bri clamped 1-255', async () => {
  const b = fake(() => http('{"on":true,"bri":255,"seg":[]}'));
  assert.deepEqual(await wledSet(b, iface, IP, { on: true, bri: 999 }), { on: true, bri: 255 });
  assert.deepEqual(b.lines, ['80 POST /json/state']);
  assert.match(b.requests[0], /Content-Type: application\/json\r\n/);
  assert.equal(b.requests[0].split('\r\n\r\n')[1], '{"on":true,"bri":255,"v":true}');
  await wledSet(b, iface, IP, { bri: 0 });
  assert.equal(b.requests[1].split('\r\n\r\n')[1], '{"bri":1,"v":true}');
  await wledSet(b, iface, IP, { on: false });
  assert.equal(b.requests[2].split('\r\n\r\n')[1], '{"on":false,"v":true}');
  await wledSet(b, iface, IP, { bri: 12.6 });
  assert.equal(b.requests[3].split('\r\n\r\n')[1], '{"bri":13,"v":true}');
  await wledSet(b, iface, IP, { bri: NaN });
  assert.equal(b.requests[4].split('\r\n\r\n')[1], '{"v":true}');
  assert.equal(await wledSet(fake(() => http('{}', 500)), iface, IP, { on: true }), null);
});

test('an off-LAN ip makes zero requests and every function fails closed', async () => {
  const b = fake(() => http('{"on":true,"bri":1,"ison":true,"output":true}'));
  const off = '8.8.8.8';
  const offSvc: SoapService = { serviceType: RC, control: { ip: off, port: 80, path: '/rc' } };
  assert.equal(await rokuKey(b, iface, off, 'Home'), false);
  assert.equal(await dlnaTransport(b, iface, offSvc, 'Play'), false);
  assert.equal(await dlnaGetVolume(b, iface, offSvc), null);
  assert.equal(await dlnaSetVolume(b, iface, offSvc, 5), false);
  assert.equal(await dlnaGetMute(b, iface, offSvc), null);
  assert.equal(await dlnaSetMute(b, iface, offSvc, true), false);
  assert.equal(await plugGetPower(b, iface, off, gen1), null);
  assert.equal(await plugSetPower(b, iface, off, gen2, true), null);
  assert.equal(await plugSetPower(b, iface, off, tasmota, true), null);
  assert.equal(await wledGet(b, iface, off), null);
  assert.equal(await wledSet(b, iface, off, { on: true }), null);
  assert.equal(b.requests.length, 0);
});

test('a throwing tcpFetch yields false or null, never a throw', async () => {
  const b = { tcpFetch: async (): Promise<string | null> => { throw new Error('boom'); } };
  assert.equal(await rokuKey(b, iface, IP, 'Home'), false);
  assert.equal(await plugGetPower(b, iface, IP, gen1), null);
  assert.equal(await wledGet(b, iface, IP), null);
  assert.equal(await dlnaGetVolume(b, iface, rendering), null);
});
