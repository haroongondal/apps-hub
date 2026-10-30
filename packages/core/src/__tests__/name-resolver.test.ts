/** Name orchestrator (node --test): bounded lookups against a fake binding. */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { DeviceNames } from '../device-names.ts';
import {
  buildNetbiosStatusRequest,
  buildPtrQuery,
} from '../name-formats.ts';
import {
  NAME_CONCURRENCY,
  NAME_LOOKUP_TIMEOUT_MS,
  SSDP_DESCRIPTION_MAX_BYTES,
  resolveDeviceNames,
} from '../name-resolver.ts';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const header = (id: number, flags: number, qd: number, an: number) => [
  id >> 8, id & 0xff, flags >> 8, flags & 0xff, 0, qd, 0, an, 0, 0, 0, 0,
];
const idOf = (request: readonly number[]) => (request[0] << 8) | request[1];

// Same fixtures as name-formats.test.ts, with the id taken from the request.
function ptrReply(request: readonly number[]): number[] {
  return [
    ...header(idOf(request), 0x8180, 1, 1),
    ...request.slice(12),
    ...[0xc0, 0x0c, 0, 12, 0, 1, 0, 0, 0x0e, 0x10, 0, 16],
    10, ...ascii('Galaxy-S24'), 3, ...ascii('lan'), 0,
  ];
}

function netbiosReply(request: readonly number[]): number[] {
  const id = idOf(request);
  const entry = [...ascii('ALI-LAPTOP'.padEnd(15, ' ')), 0x00, 0x04, 0x00];
  const rdata = [1, ...entry];
  return [
    ...[id >> 8, id & 0xff, 0x84, 0x00, 0, 0, 0, 1, 0, 0, 0, 0],
    ...buildNetbiosStatusRequest(0).slice(12, 46),
    ...[0, 0x21, 0, 1, 0, 0, 0, 0, 0, rdata.length],
    ...rdata,
  ];
}

const HTTP_OK =
  'HTTP/1.1 200 OK\r\nContent-Type: text/xml\r\n\r\n' +
  '<root><device><friendlyName>Living Room &amp; Den</friendlyName>' +
  '<manufacturer>Samsung</manufacturer><modelName>Q60</modelName></device></root>';

type Udp = [ip: string, port: number, payload: readonly number[], timeoutMs: number];
type Tcp = [ip: string, port: number, request: string, timeoutMs: number, maxBytes: number];

class FakeBinding {
  udpCalls: Udp[] = [];
  tcpCalls: Tcp[] = [];
  delayMs = 0;
  inFlight = 0;
  maxInFlight = 0;
  udpOverride: ((ip: string, port: number) => Promise<number[] | null>) | null = null;
  tcpReply: string | null = HTTP_OK;

  async udpRequest(
    ip: string,
    port: number,
    payload: readonly number[],
    timeoutMs: number,
  ): Promise<number[] | null> {
    this.udpCalls.push([ip, port, payload, timeoutMs]);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      if (this.udpOverride) return await this.udpOverride(ip, port);
      return port === 53 ? ptrReply(payload) : netbiosReply(payload);
    } finally {
      this.inFlight -= 1;
    }
  }

  async tcpFetch(
    ip: string,
    port: number,
    request: string,
    timeoutMs: number,
    maxBytes: number,
  ): Promise<string | null> {
    this.tcpCalls.push([ip, port, request, timeoutMs, maxBytes]);
    return this.tcpReply;
  }
}

const NONE: DeviceNames = {
  hostname: null,
  mdnsName: null,
  friendlyName: null,
  model: null,
  netbiosName: null,
};

const target = (ip: string, ssdpLocation: string | null = null, mdnsName: string | null = null) => ({
  ip,
  ssdpLocation,
  mdnsName,
});

test('constants match the contract', () => {
  assert.equal(NAME_CONCURRENCY, 16);
  assert.equal(NAME_LOOKUP_TIMEOUT_MS, 1500);
  assert.equal(SSDP_DESCRIPTION_MAX_BYTES, 65536);
});

test('one target: PTR to the gateway, NetBIOS to the device, mDNS cleaned', async () => {
  const binding = new FakeBinding();
  const seen: [string, DeviceNames][] = [];
  const result = await resolveDeviceNames(
    binding,
    [target('192.168.1.23', null, ' Living Room TV\n')],
    '192.168.1.1',
    (ip, names) => seen.push([ip, names]),
  );

  const expected: DeviceNames = {
    hostname: 'Galaxy-S24.lan',
    netbiosName: 'ALI-LAPTOP',
    mdnsName: 'Living Room TV',
    friendlyName: null,
    model: null,
  };
  assert.deepEqual(result.get('192.168.1.23'), expected);
  assert.deepEqual(seen, [['192.168.1.23', expected]]);

  assert.equal(binding.udpCalls.length, 2);
  const ptr = binding.udpCalls.find((c) => c[1] === 53)!;
  const nb = binding.udpCalls.find((c) => c[1] === 137)!;
  assert.equal(ptr[0], '192.168.1.1');
  assert.equal(ptr[3], 1500);
  assert.deepEqual(ptr[2], buildPtrQuery('192.168.1.23', idOf(ptr[2])));
  assert.equal(nb[0], '192.168.1.23');
  assert.equal(nb[3], 1500);
  assert.deepEqual(nb[2], buildNetbiosStatusRequest(idOf(nb[2])));
  assert.equal(binding.tcpCalls.length, 0);
});

test('never more than 16 targets in flight', async () => {
  const binding = new FakeBinding();
  binding.delayMs = 5;
  const targets = Array.from({ length: 40 }, (_, i) => target(`192.168.1.${i + 10}`));
  const result = await resolveDeviceNames(binding, targets, null);
  assert.equal(result.size, 40);
  assert.equal(binding.udpCalls.length, 40);
  assert.ok(binding.maxInFlight <= 16, `max in flight ${binding.maxInFlight}`);
  assert.ok(binding.maxInFlight > 1, 'runs in parallel');
});

test('a rejecting or null udpRequest still gives an entry, and the promise resolves', async () => {
  const binding = new FakeBinding();
  binding.udpOverride = async (ip) => {
    if (ip === '192.168.1.30') throw new Error('socket closed');
    return null;
  };
  const seen: string[] = [];
  const result = await resolveDeviceNames(
    binding,
    [target('192.168.1.30'), target('192.168.1.31')],
    null,
    (ip) => seen.push(ip),
  );
  assert.deepEqual(result.get('192.168.1.30'), NONE);
  assert.deepEqual(result.get('192.168.1.31'), NONE);
  assert.deepEqual(seen.sort(), ['192.168.1.30', '192.168.1.31']);
});

test('a throwing onNames does not reject the pass', async () => {
  const result = await resolveDeviceNames(
    new FakeBinding(),
    [target('192.168.1.23')],
    null,
    () => {
      throw new Error('listener bug');
    },
  );
  assert.equal(result.get('192.168.1.23')?.netbiosName, 'ALI-LAPTOP');
});

test('no gateway means no call to port 53', async () => {
  const binding = new FakeBinding();
  await resolveDeviceNames(binding, [target('192.168.1.23')], null);
  assert.equal(binding.udpCalls.filter((c) => c[1] === 53).length, 0);
  assert.equal(binding.udpCalls.filter((c) => c[1] === 137).length, 1);
});

test('SSDP location for another host is never fetched', async () => {
  const binding = new FakeBinding();
  await resolveDeviceNames(
    binding,
    [target('192.168.1.23', 'http://192.168.1.99/d.xml')],
    null,
  );
  assert.equal(binding.tcpCalls.length, 0);
});

test('SSDP description gives friendlyName and a clean manufacturer + model', async () => {
  const binding = new FakeBinding();
  const result = await resolveDeviceNames(
    binding,
    [target('192.168.1.23', 'http://192.168.1.23:8080/d.xml')],
    null,
  );
  assert.deepEqual(binding.tcpCalls, [
    [
      '192.168.1.23',
      8080,
      'GET /d.xml HTTP/1.0\r\nHost: 192.168.1.23:8080\r\nConnection: close\r\n\r\n',
      1500,
      65536,
    ],
  ]);
  const names = result.get('192.168.1.23')!;
  assert.equal(names.friendlyName, 'Living Room & Den');
  assert.equal(names.model, 'Samsung Q60');
});

test('a missing manufacturer or model never renders as the word null', async () => {
  const binding = new FakeBinding();
  const t = target('192.168.1.23', 'http://192.168.1.23/d.xml');
  const modelFor = async (xml: string) => {
    binding.tcpReply = `HTTP/1.1 200 OK\r\n\r\n${xml}`;
    return (await resolveDeviceNames(binding, [t], null)).get(t.ip)?.model;
  };
  assert.equal(await modelFor('<root><modelName>Q60</modelName></root>'), 'Q60');
  assert.equal(await modelFor('<root><manufacturer>Samsung</manufacturer></root>'), 'Samsung');
  assert.equal(await modelFor('<root/>'), null);
});

test('only HTTP 200 bodies are read; redirects, junk and null give no name', async () => {
  const binding = new FakeBinding();
  const t = target('192.168.1.23', 'http://192.168.1.23/d.xml');
  for (const reply of [
    'HTTP/1.1 302 Found\r\n\r\n',
    'HTTP/1.1 302 Found\r\n\r\n<friendlyName>Evil</friendlyName>',
    'not http',
    null,
  ]) {
    binding.tcpReply = reply;
    const names = (await resolveDeviceNames(binding, [t], null)).get(t.ip)!;
    assert.equal(names.friendlyName, null, String(reply));
    assert.equal(names.model, null, String(reply));
  }
});

test('network names are sanitised before they are stored', async () => {
  const binding = new FakeBinding();
  binding.tcpReply = 'HTTP/1.1 200 OK\r\n\r\n<friendlyName>  Den‮ TV\n </friendlyName>';
  const result = await resolveDeviceNames(
    binding,
    [target('192.168.1.23', 'http://192.168.1.23/d.xml', '\u0000')],
    null,
  );
  const names = result.get('192.168.1.23')!;
  assert.equal(names.friendlyName, 'Den TV');
  assert.equal(names.mdnsName, null);
});
