/** UPnP internet gateway client: description parsing, discovery, router facts, counters, port mappings (node --test). */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deletePortMapping,
  discoverIgd,
  findIgdServices,
  getRouterFacts,
  listPortMappings,
  rateBps,
  readByteCounters,
} from '../igd.ts';
import type { IgdServices } from '../igd.ts';
import type { HttpTarget } from '../lan-http.ts';
import type { InterfaceInfo, ServiceEvent } from '../model.ts';

const iface: InterfaceInfo = { localIp: '192.168.1.20', cidrPrefix: 24, gatewayIp: '192.168.1.1' };
const location: HttpTarget = { ip: '192.168.1.1', port: 5000, path: '/rootDesc.xml' };
const IP2 = 'urn:schemas-upnp-org:service:WANIPConnection:2';
const PPP1 = 'urn:schemas-upnp-org:service:WANPPPConnection:1';
const COMMON = 'urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1';

const service = (type: string, controlURL: string, extra = ''): string =>
  `<service><serviceType>${type}</serviceType><serviceId>urn:upnp-org:serviceId:x</serviceId>` +
  `<SCPDURL>/x.xml</SCPDURL><controlURL>${controlURL}</controlURL><eventSubURL>/evt</eventSubURL>${extra}</service>`;

const IP2_XML =
  '<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion>' +
  '<device><deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:2</deviceType><friendlyName>Router</friendlyName>' +
  '<serviceList><service><serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType><controlURL>/ctl/L3F</controlURL></service></serviceList>' +
  '<deviceList><device><deviceType>urn:schemas-upnp-org:device:WANDevice:2</deviceType>' +
  `<serviceList>${service(COMMON, '/ctl/CmnIfCfg')}</serviceList>` +
  '<deviceList><device><deviceType>urn:schemas-upnp-org:device:WANConnectionDevice:2</deviceType>' +
  `<serviceList>${service(IP2, '/ctl/IPConn')}</serviceList></device></deviceList></device></deviceList></device></root>`;

const PPP_XML =
  '<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device>' +
  '<deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType><deviceList><device>' +
  `<serviceList>${service(COMMON, 'ctl/CmnIfCfg')}</serviceList><deviceList><device>` +
  `<serviceList>${service(PPP1, '/upnp/control/WANPPPConn1')}</serviceList></device></deviceList></device></deviceList></device></root>`;

test('findIgdServices reads a WANIPConnection:2 router, nested', () => {
  assert.deepEqual(findIgdServices(IP2_XML, location), {
    wan: { serviceType: IP2, control: { ip: '192.168.1.1', port: 5000, path: '/ctl/IPConn' } },
    common: { serviceType: COMMON, control: { ip: '192.168.1.1', port: 5000, path: '/ctl/CmnIfCfg' } },
  });
});

test('findIgdServices reads a WANPPPConnection:1 router and fixes a controlURL without a leading slash', () => {
  const igd = findIgdServices(PPP_XML, location);
  assert.equal(igd?.wan.serviceType, PPP1);
  assert.equal(igd?.wan.control.path, '/upnp/control/WANPPPConn1');
  assert.equal(igd?.common?.control.path, '/ctl/CmnIfCfg');
});

test('findIgdServices prefers WANIPConnection over WANPPPConnection and accepts any version', () => {
  const xml = `<root>${service(PPP1, '/ppp')}${service('urn:schemas-upnp-org:service:WANIPConnection:1', '/ip1')}</root>`;
  assert.equal(findIgdServices(xml, location)?.wan.control.path, '/ip1');
});

test('findIgdServices resolves against URLBase when present, falls back to location when it is bad', () => {
  const withBase = IP2_XML.replace('<device>', '<URLBase>http://192.168.1.1:49152/</URLBase><device>');
  assert.equal(findIgdServices(withBase, location)?.wan.control.port, 49152);
  const bad = IP2_XML.replace('<device>', '<URLBase>http://router.lan:49152/</URLBase><device>');
  assert.equal(findIgdServices(bad, location)?.wan.control.port, 5000);
});

test('findIgdServices keeps an absolute controlURL and decodes entities in it', () => {
  const xml = `<root>${service(IP2, 'http://192.168.1.1:2000/c?a=1&amp;b=2')}</root>`;
  assert.deepEqual(findIgdServices(xml, location)?.wan.control, { ip: '192.168.1.1', port: 2000, path: '/c?a=1&b=2' });
});

test('findIgdServices skips a WAN candidate it cannot parse and tries the next', () => {
  const xml = `<root>${service(IP2, 'https://192.168.1.1/ctl')}${service(PPP1, 'http://router.lan/ctl')}${service(IP2, '/ok')}</root>`;
  assert.equal(findIgdServices(xml, location)?.wan.control.path, '/ok');
  const none = `<root>${service(IP2, 'https://192.168.1.1/ctl')}${service(PPP1, 'http://router.lan/ctl')}</root>`;
  assert.equal(findIgdServices(none, location), null);
});

test('findIgdServices gives common null when its controlURL does not parse or it is absent', () => {
  const bad = `<root>${service(COMMON, 'http://router.lan/c')}${service(IP2, '/ok')}</root>`;
  assert.equal(findIgdServices(bad, location)?.common, null);
  assert.equal(findIgdServices(`<root>${service(IP2, '/ok')}</root>`, location)?.common, null);
});

test('findIgdServices refuses a serviceType that could break out of the SOAP envelope or header', () => {
  const evil = 'urn:schemas-upnp-org:service:WANIPConnection:1&quot; x=&quot;';
  assert.equal(findIgdServices(`<root>${service(evil, '/c')}</root>`, location), null);
});

test('findIgdServices returns null for no WAN service, garbage, entities and oversized input', () => {
  assert.equal(findIgdServices('<root></root>', location), null);
  assert.equal(findIgdServices('', location), null);
  assert.equal(findIgdServices(undefined as unknown as string, location), null);
  assert.equal(findIgdServices(`<!DOCTYPE x [<!ENTITY a "b">]>${IP2_XML}`, location), null);
  assert.equal(findIgdServices(`${IP2_XML}${' '.repeat(300_000)}`, location), null);
  assert.equal(findIgdServices(`<!-- ${service(IP2, '/hidden')} --><root></root>`, location), null);
  assert.equal(findIgdServices('<!--'.repeat(50_000), location), null);
});

test('findIgdServices stays linear on unclosed <service tags', () => {
  const start = performance.now();
  assert.equal(findIgdServices('<service '.repeat(29000), location), null);
  assert.equal(findIgdServices('<service>'.repeat(29000), location), null);
  assert.ok(performance.now() - start < 200, `took ${performance.now() - start} ms`);
});

test('findIgdServices takes the first WANCommonInterfaceConfig', () => {
  const xml = `<root>${service(COMMON, '/first')}${service(COMMON, '/second')}${service(IP2, '/ok')}</root>`;
  assert.equal(findIgdServices(xml, location)?.common?.control.path, '/first');
});

// ---- fakes ----

const wrap = (body: string, status = 200): string => `HTTP/1.0 ${status} OK\r\nContent-Type: text/xml\r\n\r\n${body}`;
const soapOk = (action: string, type: string, fields: Record<string, string>): string =>
  wrap(
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="${type}">` +
      Object.entries(fields).map(([k, v]) => `<${k}>${v}</${k}>`).join('') +
      `</u:${action}Response></s:Body></s:Envelope>`,
  );
const soapFault = (code: number): string =>
  wrap(
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode>' +
      `<detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode></UPnPError></detail></s:Fault></s:Body></s:Envelope>`,
    500,
  );

/** Routes by SOAPAction (action name) or, for a GET, by path; returns null (no reply) when the handler does. */
function fakeBinding(handler: (key: string, request: string, ip: string, port: number) => string | null) {
  const calls: { ip: string; port: number; request: string; maxBytes?: number }[] = [];
  return {
    calls,
    tcpFetch: async (ip: string, port: number, request: string, _timeoutMs?: number, maxBytes?: number) => {
      calls.push({ ip, port, request, maxBytes });
      const action = /SOAPAction: "[^"#]*#([^"]*)"/.exec(request);
      return handler(action ? action[1] : request.split(' ')[1], request, ip, port);
    },
  };
}

const igd: IgdServices = {
  wan: { serviceType: IP2, control: { ip: '192.168.1.1', port: 5000, path: '/ctl/IPConn' } },
  common: { serviceType: COMMON, control: { ip: '192.168.1.1', port: 5000, path: '/ctl/CmnIfCfg' } },
};

test('discoverIgd fetches the gateway description and ignores ssdp events from other hosts', async () => {
  const b = fakeBinding((path) => (path === '/rootDesc.xml' ? wrap(IP2_XML) : null));
  const events: ServiceEvent[] = [
    { kind: 'ssdp', host: '192.168.1.50', location: 'http://192.168.1.50:5000/rootDesc.xml', usn: 'uuid:x::upnp:rootdevice' },
    { kind: 'mdns', host: '192.168.1.1', location: 'http://192.168.1.1:5000/rootDesc.xml' },
    { kind: 'ssdp', host: '192.168.1.1', location: 'http://192.168.1.1:5000/rootDesc.xml', usn: 'uuid:x::urn:schemas-upnp-org:device:InternetGatewayDevice:2' },
  ];
  const found = await discoverIgd(b, iface, events);
  assert.equal(found?.wan.control.path, '/ctl/IPConn');
  assert.equal(b.calls.length, 1);
  assert.equal(b.calls[0].ip, '192.168.1.1');
  assert.equal(await discoverIgd(b, iface, events.slice(0, 2)), null);
  assert.equal(b.calls.length, 1);
});

test('discoverIgd ignores an event whose host is not the gateway even if its LOCATION is the gateway', async () => {
  const b = fakeBinding(() => wrap(IP2_XML));
  const ev: ServiceEvent = { kind: 'ssdp', host: '192.168.1.50', location: 'http://192.168.1.1:5000/rootDesc.xml' };
  assert.equal(await discoverIgd(b, iface, [ev]), null);
  assert.equal(b.calls.length, 0);
});

test('discoverIgd asks for up to 256 KB of description', async () => {
  const b = fakeBinding(() => wrap(IP2_XML));
  await discoverIgd(b, iface, [{ kind: 'ssdp', host: '192.168.1.1', location: 'http://192.168.1.1:5000/rootDesc.xml' }]);
  assert.equal(b.calls[0].maxBytes, 262144);
});

test('discoverIgd rejects a description that moves the WAN service to another host and tries the next LOCATION', async () => {
  const evil = IP2_XML.replace('<device>', '<URLBase>http://192.168.1.99:5000/</URLBase><device>');
  const b = fakeBinding((path) => (path === '/evil.xml' ? wrap(evil) : wrap(IP2_XML)));
  const ev = (name: string): ServiceEvent => ({ kind: 'ssdp', host: '192.168.1.1', location: `http://192.168.1.1:1/${name}` });
  const found = await discoverIgd(b, iface, [ev('evil.xml'), ev('good.xml')]);
  assert.equal(found?.wan.control.ip, '192.168.1.1');
  assert.equal(b.calls.length, 2);
  const b2 = fakeBinding(() => wrap(evil));
  assert.equal(await discoverIgd(b2, iface, [ev('evil.xml')]), null);
});

test('discoverIgd drops a common service on another host but keeps the gateway WAN service', async () => {
  const xml = `<root>${service(IP2, '/ctl/IPConn')}${service(COMMON, 'http://192.168.1.99:5000/c')}</root>`;
  const b = fakeBinding(() => wrap(xml));
  const found = await discoverIgd(b, iface, [{ kind: 'ssdp', host: '192.168.1.1', location: 'http://192.168.1.1:5000/d.xml' }]);
  assert.equal(found?.wan.control.path, '/ctl/IPConn');
  assert.equal(found?.common, null);
});

test('discoverIgd needs a gateway and a LOCATION that points at that same gateway', async () => {
  const b = fakeBinding(() => wrap(IP2_XML));
  const ev = (location: string | null): ServiceEvent => ({ kind: 'ssdp', host: '192.168.1.1', location });
  assert.equal(await discoverIgd(b, { ...iface, gatewayIp: null }, [ev('http://192.168.1.1/d.xml')]), null);
  const elsewhere = [ev('http://192.168.1.77/d.xml'), ev('http://8.8.8.8/d.xml'), ev('http://router.lan/d.xml'), ev('https://192.168.1.1/d.xml'), ev(null), ev('')];
  assert.equal(await discoverIgd(b, iface, elsewhere), null);
  assert.equal(b.calls.length, 0);
});

test('discoverIgd tries IGD-looking events first, fetches each LOCATION once and stops at the first success', async () => {
  const b = fakeBinding((path) => (path === '/good.xml' ? wrap(IP2_XML) : wrap('<root></root>')));
  const events: ServiceEvent[] = [
    { kind: 'ssdp', host: '192.168.1.1', location: 'http://192.168.1.1:1/plain.xml', usn: 'uuid:x::upnp:rootdevice' },
    { kind: 'ssdp', host: '192.168.1.1', location: 'http://192.168.1.1:1/plain.xml', usn: 'uuid:x::upnp:rootdevice' },
    { kind: 'ssdp', host: '192.168.1.1', location: 'http://192.168.1.1:1/good.xml', usn: 'uuid:x::urn:schemas-upnp-org:service:WANIPConnection:2' },
  ];
  assert.ok(await discoverIgd(b, iface, events));
  assert.equal(b.calls.length, 1);
  assert.ok(b.calls[0].request.startsWith('GET /good.xml '));
  const b2 = fakeBinding(() => wrap('<root></root>'));
  assert.equal(await discoverIgd(b2, iface, events), null);
  assert.equal(b2.calls.length, 2, 'the duplicate LOCATION is fetched once');
});

test('discoverIgd tries at most 8 LOCATIONs, and a non-200 or silent reply is skipped', async () => {
  const b = fakeBinding((path) => (path === '/d0.xml' ? null : path === '/d1.xml' ? wrap(IP2_XML, 404) : wrap('<root></root>')));
  const events: ServiceEvent[] = Array.from({ length: 20 }, (_, i) => ({ kind: 'ssdp', host: '192.168.1.1', location: `http://192.168.1.1:1/d${i}.xml` }));
  assert.equal(await discoverIgd(b, iface, events), null);
  assert.equal(b.calls.length, 8);
});

test('getRouterFacts reads the three actions, line speed from the common service', async () => {
  const b = fakeBinding((action) => {
    if (action === 'GetExternalIPAddress') return soapOk(action, IP2, { NewExternalIPAddress: '203.0.113.7' });
    if (action === 'GetStatusInfo') return soapOk(action, IP2, { NewConnectionStatus: 'Connected', NewLastConnectionError: 'ERROR_NONE', NewUptime: '3600' });
    if (action === 'GetCommonLinkProperties') return soapOk(action, COMMON, { NewLayer1UpstreamMaxBitRate: '20000000', NewLayer1DownstreamMaxBitRate: '100000000' });
    return null;
  });
  assert.deepEqual(await getRouterFacts(b, iface, igd), {
    externalIp: '203.0.113.7',
    connected: true,
    uptimeSec: 3600,
    maxDownBps: 100000000,
    maxUpBps: 20000000,
  });
  const link = b.calls.find((c) => c.request.includes('GetCommonLinkProperties'));
  assert.ok(link?.request.startsWith('POST /ctl/CmnIfCfg '));
});

const ALL_NULL = { externalIp: null, connected: null, uptimeSec: null, maxDownBps: null, maxUpBps: null };

test('getRouterFacts leaves every field null when all calls fault 606', async () => {
  const b = fakeBinding(() => soapFault(606));
  assert.deepEqual(await getRouterFacts(b, iface, igd), ALL_NULL);
});

test('getRouterFacts makes no request for an off-LAN control URL', async () => {
  const b = fakeBinding(() => soapOk('GetExternalIPAddress', IP2, { NewExternalIPAddress: '203.0.113.7' }));
  const off = findIgdServices(`<root>${service(IP2, 'http://203.0.113.9/ctl')}</root>`, location);
  assert.deepEqual(off?.wan.control, { ip: '203.0.113.9', port: 80, path: '/ctl' });
  assert.deepEqual(await getRouterFacts(b, iface, off as IgdServices), ALL_NULL);
  assert.equal(b.calls.length, 0);
});

test('getRouterFacts: one failing call nulls only its fields; null common nulls the speeds', async () => {
  const b = fakeBinding((action) =>
    action === 'GetStatusInfo' ? soapFault(501) : soapOk(action, IP2, { NewExternalIPAddress: '198.51.100.4' }),
  );
  const facts = await getRouterFacts(b, iface, { ...igd, common: null });
  assert.deepEqual(facts, { ...ALL_NULL, externalIp: '198.51.100.4' });
  assert.equal(b.calls.some((c) => c.request.includes('GetCommonLinkProperties')), false);
});

test('getRouterFacts validates values: bad IP, disconnected, junk numbers, zero line speed', async () => {
  const b = fakeBinding((action) => {
    if (action === 'GetExternalIPAddress') return soapOk(action, IP2, { NewExternalIPAddress: 'not-an-ip' });
    if (action === 'GetStatusInfo') return soapOk(action, IP2, { NewConnectionStatus: 'Disconnected', NewUptime: '-5' });
    return soapOk(action, COMMON, { NewLayer1DownstreamMaxBitRate: '0', NewLayer1UpstreamMaxBitRate: '12abc' });
  });
  assert.deepEqual(await getRouterFacts(b, iface, igd), { ...ALL_NULL, connected: false });
  const c = fakeBinding((action) => soapOk(action, IP2, { NewExternalIPAddress: '' }));
  assert.equal((await getRouterFacts(c, iface, igd)).externalIp, null);
});

test('getRouterFacts never throws when the transport does', async () => {
  const b = { tcpFetch: async (): Promise<string | null> => { throw new Error('boom'); } };
  assert.deepEqual(await getRouterFacts(b, iface, igd), ALL_NULL);
});

test('readByteCounters reads both counters from the common service', async () => {
  const b = fakeBinding((action) =>
    action === 'GetTotalBytesReceived'
      ? soapOk(action, COMMON, { NewTotalBytesReceived: '123456' })
      : soapOk(action, COMMON, { NewTotalBytesSent: '789' }),
  );
  assert.deepEqual(await readByteCounters(b, iface, igd, 5000), { rx: 123456, tx: 789, atMs: 5000 });
  assert.ok(b.calls.every((c) => c.request.startsWith('POST /ctl/CmnIfCfg ')));
});

test('readByteCounters is null with no common service, a failure, or a non-numeric value', async () => {
  const ok = fakeBinding((action) => soapOk(action, COMMON, { NewTotalBytesReceived: '1', NewTotalBytesSent: '2' }));
  assert.equal(await readByteCounters(ok, iface, { ...igd, common: null }, 1), null);
  assert.equal(ok.calls.length, 0);
  const half = fakeBinding((action) =>
    action === 'GetTotalBytesSent' ? soapFault(401) : soapOk(action, COMMON, { NewTotalBytesReceived: '1' }),
  );
  assert.equal(await readByteCounters(half, iface, igd, 1), null);
  const junk = fakeBinding((action) => soapOk(action, COMMON, { NewTotalBytesReceived: 'x', NewTotalBytesSent: '2' }));
  assert.equal(await readByteCounters(junk, iface, igd, 1), null);
});

test('rateBps gives bits per second', () => {
  assert.deepEqual(rateBps({ rx: 1000, tx: 500, atMs: 0 }, { rx: 3000, tx: 500, atMs: 2000 }), { downBps: 8000, upBps: 0 });
});

test('rateBps corrects a 32-bit counter wrap', () => {
  assert.deepEqual(rateBps({ rx: 4294967000, tx: 0, atMs: 0 }, { rx: 200, tx: 125, atMs: 1000 }), { downBps: 3968, upBps: 1000 });
});

test('rateBps returns null for a reset, no elapsed time or non-finite input', () => {
  assert.equal(rateBps({ rx: 4e9, tx: 0, atMs: 0 }, { rx: 10, tx: 0, atMs: 100 }), null);
  assert.equal(rateBps({ rx: 0, tx: 0, atMs: 100 }, { rx: 5, tx: 5, atMs: 100 }), null);
  assert.equal(rateBps({ rx: 0, tx: 0, atMs: 100 }, { rx: 5, tx: 5, atMs: 50 }), null);
  assert.equal(rateBps({ rx: 0, tx: 0, atMs: 0 }, { rx: NaN, tx: 0, atMs: 1000 }), null);
  assert.equal(rateBps({ rx: 0, tx: 4e9, atMs: 0 }, { rx: 0, tx: 10, atMs: 100 }), null, 'upload cap');
  assert.equal(rateBps({ rx: 5e9, tx: 0, atMs: 0 }, { rx: 10, tx: 0, atMs: 1000 }), null, '64-bit counter reset is not a negative rate');
  assert.equal(rateBps({ rx: 0, tx: 5e9, atMs: 0 }, { rx: 0, tx: 10, atMs: 1000 }), null);
});

test('rateBps ignores a 64-bit counter reset that lands in 32-bit range', () => {
  // next > prev - 2^32, so a blind +2^32 would give a small positive rate.
  assert.equal(rateBps({ rx: 2 ** 32 + 1000, tx: 0, atMs: 0 }, { rx: 5000, tx: 0, atMs: 1000 }), null);
  assert.equal(rateBps({ rx: 0, tx: 2 ** 32 + 1000, atMs: 0 }, { rx: 0, tx: 5000, atMs: 1000 }), null);
});

const entry = (i: number, over: Record<string, string> = {}): string =>
  soapOk('GetGenericPortMappingEntry', IP2, {
    NewRemoteHost: '',
    NewExternalPort: String(8000 + i),
    NewProtocol: 'TCP',
    NewInternalPort: '80',
    NewInternalClient: '192.168.1.30',
    NewEnabled: '1',
    NewPortMappingDescription: `web ${i}`,
    NewLeaseDuration: '0',
    ...over,
  });

const indexOf = (request: string): number => Number(/<NewPortMappingIndex>(\d+)</.exec(request)?.[1]);

test('listPortMappings reads entries from index 0 and stops at the first fault', async () => {
  const b = fakeBinding((_a, request) =>
    indexOf(request) === 0 ? entry(0) : indexOf(request) === 1 ? entry(1, { NewProtocol: 'UDP', NewEnabled: 'false', NewRemoteHost: '198.51.100.2' }) : soapFault(713),
  );
  assert.deepEqual(await listPortMappings(b, iface, igd), [
    { remoteHost: '', externalPort: 8000, protocol: 'TCP', internalClient: '192.168.1.30', internalPort: 80, description: 'web 0', enabled: true },
    { remoteHost: '198.51.100.2', externalPort: 8001, protocol: 'UDP', internalClient: '192.168.1.30', internalPort: 80, description: 'web 1', enabled: false },
  ]);
  assert.equal(b.calls.length, 3);
});

test('listPortMappings stops at 64 entries when the router never faults', async () => {
  const b = fakeBinding((_a, request) => entry(indexOf(request)));
  assert.equal((await listPortMappings(b, iface, igd)).length, 64);
  assert.equal(b.calls.length, 64);
});

test('listPortMappings skips an entry that is ok but malformed and carries on', async () => {
  const b = fakeBinding((_a, request) => {
    const i = indexOf(request);
    if (i === 0) return entry(0, { NewExternalPort: '99999' });
    if (i === 1) return entry(1, { NewProtocol: 'SCTP' });
    if (i === 2) return entry(2, { NewInternalPort: 'x' });
    if (i === 3) return entry(3, { NewEnabled: 'true' });
    return soapFault(713);
  });
  const list = await listPortMappings(b, iface, igd);
  assert.deepEqual(list.map((m) => [m.externalPort, m.enabled]), [[8003, true]]);
  assert.equal(b.calls.length, 5);
});

test('listPortMappings is empty for an off-LAN router', async () => {
  const b = fakeBinding((_a, request) => entry(indexOf(request)));
  const off = { ...igd, wan: { ...igd.wan, control: { ip: '203.0.113.9', port: 80, path: '/ctl' } } };
  assert.deepEqual(await listPortMappings(b, iface, off), []);
  assert.equal(b.calls.length, 0);
});

test('deletePortMapping sends DeletePortMapping in UPnP argument order and returns ok', async () => {
  const b = fakeBinding((action) => (action === 'DeletePortMapping' ? soapOk(action, IP2, {}) : null));
  const m = { remoteHost: '', externalPort: 8000, protocol: 'TCP' as const, internalClient: '192.168.1.30', internalPort: 80, description: 'web', enabled: true };
  assert.equal(await deletePortMapping(b, iface, igd, m), true);
  assert.ok(b.calls[0].request.includes('<NewRemoteHost></NewRemoteHost><NewExternalPort>8000</NewExternalPort><NewProtocol>TCP</NewProtocol>'));
  assert.ok(b.calls[0].request.startsWith('POST /ctl/IPConn '));
  const fail = fakeBinding(() => soapFault(714));
  assert.equal(await deletePortMapping(fail, iface, igd, m), false);
});
