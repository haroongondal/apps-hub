/** The LAN guard and HTTP helper: every LAN request goes through this gate (node --test). */
import test from 'node:test';
import assert from 'node:assert/strict';

import { httpRequest, isLanTarget, parseHttpUrl, parseJsonObject } from '../lan-http.ts';
import type { HttpTarget } from '../lan-http.ts';
import type { InterfaceInfo } from '../model.ts';

const iface24: InterfaceInfo = { localIp: '192.168.1.20', cidrPrefix: 24, gatewayIp: '192.168.1.1' };
const target: HttpTarget = { ip: '192.168.1.1', port: 5000, path: '/ctl' };

function fakeBinding(reply: string | null | Error = 'HTTP/1.0 200 OK\r\n\r\nhi') {
  const calls: { ip: string; port: number; request: string; timeoutMs: number; maxBytes: number }[] = [];
  return {
    calls,
    tcpFetch: async (ip: string, port: number, request: string, timeoutMs: number, maxBytes: number) => {
      calls.push({ ip, port, request, timeoutMs, maxBytes });
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

test('isLanTarget accepts same-subnet private and refuses others', () => {
  assert.equal(isLanTarget('192.168.1.1', iface24), true);
  assert.equal(isLanTarget('192.168.2.1', iface24), false);
  assert.equal(isLanTarget('8.8.8.8', iface24), false);
  assert.equal(isLanTarget('10.0.0.1', iface24), false);
  assert.equal(isLanTarget('10.200.9.9', { localIp: '10.1.2.3', cidrPrefix: 16, gatewayIp: null }), false);
  assert.equal(isLanTarget('10.1.200.9', { localIp: '10.1.2.3', cidrPrefix: 16, gatewayIp: null }), true);
});

test('isLanTarget refuses the network and broadcast address but not at /31 or /32', () => {
  assert.equal(isLanTarget('192.168.1.0', iface24), false);
  assert.equal(isLanTarget('192.168.1.255', iface24), false);
  assert.equal(isLanTarget('192.168.1.254', iface24), true);
  assert.equal(isLanTarget('192.168.1.21', { ...iface24, cidrPrefix: 31 }), true);
  assert.equal(isLanTarget('192.168.1.20', { ...iface24, cidrPrefix: 32 }), true);
  assert.equal(isLanTarget('192.168.1.21', { ...iface24, cidrPrefix: 32 }), false);
});

test('isLanTarget refuses malformed IPs', () => {
  for (const ip of ['999.1.1.1', '192.168.1', '192.168.1.1.1', ' 192.168.1.1', '192.168.1.1 ', '192.168.1.1\n',
    '192.168.001.1', '192.168.1.1/24', '0xc0.168.1.1', '', 'router.local']) {
    assert.equal(isLanTarget(ip, iface24), false, JSON.stringify(ip));
  }
});

test('isLanTarget refuses an invalid or missing iface', () => {
  const bad: unknown[] = [
    null, undefined, {},
    { localIp: 'nope', cidrPrefix: 24, gatewayIp: null },
    { localIp: '8.8.8.8', cidrPrefix: 24, gatewayIp: null },
    { localIp: '192.168.1.20', cidrPrefix: 33, gatewayIp: null },
    { localIp: '192.168.1.20', cidrPrefix: -1, gatewayIp: null },
    { localIp: '192.168.1.20', cidrPrefix: 24.5, gatewayIp: null },
    { localIp: '192.168.1.20', cidrPrefix: '24', gatewayIp: null },
    { localIp: '192.168.1.20', cidrPrefix: NaN, gatewayIp: null },
  ];
  for (const i of bad) assert.equal(isLanTarget('192.168.1.1', i as InterfaceInfo), false, JSON.stringify(i));
});

test('isLanTarget: a very wide iface is invalid, a wide one still only allows private targets', () => {
  const wide0: InterfaceInfo = { localIp: '192.168.1.20', cidrPrefix: 0, gatewayIp: null };
  assert.equal(isLanTarget('8.8.8.8', wide0), false);
  assert.equal(isLanTarget('192.168.1.1', wide0), false);
  const wide8: InterfaceInfo = { localIp: '192.168.1.20', cidrPrefix: 8, gatewayIp: null };
  assert.equal(isLanTarget('192.0.2.1', wide8), false); // inside 192/8 but public
  assert.equal(isLanTarget('192.168.77.1', wide8), true);
});

test('parseHttpUrl reads absolute and relative URLs', () => {
  assert.deepEqual(parseHttpUrl('http://192.168.1.1:5000/rootDesc.xml'), { ip: '192.168.1.1', port: 5000, path: '/rootDesc.xml' });
  assert.deepEqual(parseHttpUrl('http://192.168.1.1'), { ip: '192.168.1.1', port: 80, path: '/' });
  assert.deepEqual(parseHttpUrl('/ctl/IPConn', target), { ip: '192.168.1.1', port: 5000, path: '/ctl/IPConn' });
  assert.deepEqual(parseHttpUrl('/ctl/IPConn?a=1', target), { ...target, path: '/ctl/IPConn?a=1' });
});

test('parseHttpUrl returns null for https, hostnames, bad ports, bad IPs and junk', () => {
  for (const u of ['https://192.168.1.1/', 'http://router.local/', 'http://192.168.1.1:70000/',
    'http://192.168.1.1:0/', 'http://999.1.1.1/', 'http://192.168.1/', 'http://192.168.1.1:80\r\n/x',
    'http://192.168.1.1/a b', 'http://192.168.1.1/a\r\nX: y', 'ctl/IPConn', '', ' http://192.168.1.1/']) {
    assert.equal(parseHttpUrl(u, target), null, JSON.stringify(u));
  }
  assert.equal(parseHttpUrl('/ctl'), null); // relative without a base
  assert.equal(parseHttpUrl('/a\r\nX: y', target), null);
});

test('httpRequest refuses an off-LAN target without calling tcpFetch', async () => {
  const b = fakeBinding();
  assert.equal(await httpRequest(b, iface24, { ip: '8.8.8.8', port: 80, path: '/' }, {}), null);
  assert.equal(b.calls.length, 0);
});

test('httpRequest builds the request and parses the reply', async () => {
  const b = fakeBinding();
  const r = await httpRequest(b, iface24, target, { headers: { Accept: 'text/xml' } });
  assert.deepEqual(r, { status: 200, body: 'hi' });
  assert.equal(b.calls.length, 1);
  assert.deepEqual(b.calls[0], {
    ip: '192.168.1.1', port: 5000, timeoutMs: 1500, maxBytes: 65536,
    request: 'GET /ctl HTTP/1.0\r\nHost: 192.168.1.1:5000\r\nConnection: close\r\nAccept: text/xml\r\n\r\n',
  });
});

test('httpRequest sends Content-Length in bytes', async () => {
  const b = fakeBinding();
  await httpRequest(b, iface24, target, { method: 'POST', body: 'é', timeoutMs: 900, maxBytes: 100 });
  const { request, timeoutMs, maxBytes } = b.calls[0];
  assert.match(request, /^POST \/ctl HTTP\/1\.0\r\n/);
  assert.ok(request.includes('Content-Length: 2\r\n'));
  assert.ok(request.endsWith('\r\n\r\né'));
  assert.equal(timeoutMs, 900);
  assert.equal(maxBytes, 100);
});

test('httpRequest sends no Content-Length without a body', async () => {
  const b = fakeBinding();
  await httpRequest(b, iface24, target, {});
  assert.ok(!/content-length/i.test(b.calls[0].request));
});

test('httpRequest refuses header injection, bad paths and bad ports without calling tcpFetch', async () => {
  const b = fakeBinding();
  const cases: [HttpTarget, Parameters<typeof httpRequest>[3]][] = [
    [{ ...target, path: '/a\r\nX: y' }, {}],
    [{ ...target, path: '/a\nX: y' }, {}],
    [{ ...target, path: '/a b' }, {}],
    [{ ...target, path: 'ctl' }, {}],
    [{ ...target, path: '' }, {}],
    [{ ...target, port: 0 }, {}],
    [{ ...target, port: 65536 }, {}],
    [{ ...target, port: 80.5 }, {}],
    [target, { headers: { 'X-A': 'b\r\nX-Evil: 1' } }],
    [target, { headers: { 'X-A': 'b\nc' } }],
    [target, { headers: { 'X-A\r\nX-Evil': 'b' } }],
    [target, { headers: { 'X A': 'b' } }],
    [target, { headers: { '': 'b' } }],
    [target, { headers: { host: 'evil' } }],
    [target, { headers: { 'Content-Length': '0' } }],
    [target, { headers: { CONNECTION: 'keep-alive' } }],
  ];
  for (const [t, init] of cases) assert.equal(await httpRequest(b, iface24, t, init), null, JSON.stringify([t, init]));
  assert.equal(b.calls.length, 0);
});

test('httpRequest returns null on no reply, an unparseable reply, or a throwing tcpFetch', async () => {
  assert.equal(await httpRequest(fakeBinding(null), iface24, target, {}), null);
  assert.equal(await httpRequest(fakeBinding('garbage'), iface24, target, {}), null);
  assert.equal(await httpRequest(fakeBinding(new Error('boom')), iface24, target, {}), null);
});

test('parseJsonObject accepts only plain objects', () => {
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
  for (const s of ['[1]', 'nope', 'null', '1', '"x"', '', 'true']) assert.equal(parseJsonObject(s), null, s);
});
