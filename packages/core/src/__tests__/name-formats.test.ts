/**
 * Name lookup wire formats (node --test): DNS PTR, NetBIOS node status, the
 * SSDP description request, a minimal HTTP split and UPnP XML fields.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNetbiosStatusRequest,
  buildPtrQuery,
  extractDeviceDescription,
  parseHttpResponse,
  parseNetbiosStatus,
  parsePtrAnswer,
  ssdpDescriptionRequest,
} from '../name-formats.ts';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const header = (id: number, flags: number, qd: number, an: number) => [
  id >> 8,
  id & 0xff,
  flags >> 8,
  flags & 0xff,
  0,
  qd,
  0,
  an,
  0,
  0,
  0,
  0,
];

function ptrReply(id = 0x1234, flags = 0x8180): number[] {
  const query = buildPtrQuery('192.168.1.23', 0x1234);
  return [
    ...header(id, flags, 1, 1),
    ...query.slice(12),
    ...[0xc0, 0x0c, 0, 12, 0, 1, 0, 0, 0x0e, 0x10, 0, 16],
    10,
    ...ascii('Galaxy-S24'),
    3,
    ...ascii('lan'),
    0,
  ];
}

test('buildPtrQuery asks for PTR/IN with recursion desired', () => {
  const q = buildPtrQuery('192.168.1.23', 0x1234);
  assert.deepEqual(q.slice(0, 12), [0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]);
  assert.equal(q.length, 43);
  assert.deepEqual(q.slice(-4), [0, 12, 0, 1]);
  assert.deepEqual(q.slice(12, 15), [2, ...ascii('23')]);
});

test('parsePtrAnswer returns the first PTR name without the trailing dot', () => {
  assert.equal(parsePtrAnswer(ptrReply(), 0x1234), 'Galaxy-S24.lan');
});

test('parsePtrAnswer rejects a wrong id, an error code and no answers', () => {
  assert.equal(parsePtrAnswer(ptrReply(), 0x9999), null);
  assert.equal(parsePtrAnswer(ptrReply(0x1234, 0x8183), 0x1234), null);
  const noAnswer = ptrReply();
  noAnswer[7] = 0;
  assert.equal(parsePtrAnswer(noAnswer, 0x1234), null);
  assert.equal(parsePtrAnswer(ptrReply(0x1234, 0x0100), 0x1234), null);
});

test('parsePtrAnswer rejects every truncation of a valid reply', () => {
  const full = ptrReply();
  for (let n = 0; n < full.length; n++) {
    assert.equal(parsePtrAnswer(full.slice(0, n), 0x1234), null, `cut at ${n}`);
  }
});

test('parsePtrAnswer gives up on a compression pointer loop', () => {
  const query = buildPtrQuery('192.168.1.23', 0x1234);
  const head = [
    ...header(0x1234, 0x8180, 1, 1),
    ...query.slice(12),
    ...[0xc0, 0x0c, 0, 12, 0, 1, 0, 0, 0x0e, 0x10, 0, 2],
  ];
  assert.equal(parsePtrAnswer([...head, 0xc0, head.length], 0x1234), null);
  const a = head.length;
  assert.equal(parsePtrAnswer([...head, 0xc0, a + 2, 0xc0, a], 0x1234), null);
});

test('buildNetbiosStatusRequest is the 50-byte NBSTAT query', () => {
  const r = buildNetbiosStatusRequest(0x42);
  assert.equal(r.length, 50);
  assert.deepEqual(r.slice(0, 4), [0, 0x42, 0, 0]);
  assert.deepEqual(r.slice(12, 14), [0x20, 0x43]);
  assert.deepEqual(r.slice(15, 45), Array(30).fill(0x41));
  assert.equal(r[45], 0);
  assert.deepEqual(r.slice(-4), [0, 0x21, 0, 1]);
});

function nbEntry(name: string, suffix: number, flags: number): number[] {
  return [...ascii(name.padEnd(15, ' ')), suffix, flags >> 8, flags & 0xff];
}

function netbiosReply(entries: number[][], id = 0x42): number[] {
  const answerName = buildNetbiosStatusRequest(0).slice(12, 46);
  const rdata = [entries.length, ...entries.flat()];
  return [
    ...[id >> 8, id & 0xff, 0x84, 0x00, 0, 0, 0, 1, 0, 0, 0, 0],
    ...answerName,
    ...[0, 0x21, 0, 1, 0, 0, 0, 0, 0, rdata.length],
    ...rdata,
  ];
}

test('parseNetbiosStatus picks the unique 0x00 machine name', () => {
  const reply = netbiosReply([
    nbEntry('WORKGROUP', 0x00, 0x8400),
    nbEntry('ALI-LAPTOP', 0x00, 0x0400),
  ]);
  assert.equal(parseNetbiosStatus(reply, 0x42), 'ALI-LAPTOP');
});

test('parseNetbiosStatus skips group names and other suffixes', () => {
  assert.equal(
    parseNetbiosStatus(netbiosReply([nbEntry('WORKGROUP', 0x00, 0x8400)]), 0x42),
    null,
  );
  assert.equal(
    parseNetbiosStatus(netbiosReply([nbEntry('ALI-LAPTOP', 0x20, 0x0400)]), 0x42),
    null,
  );
  assert.equal(parseNetbiosStatus(netbiosReply([]), 0x42), null);
});

test('parseNetbiosStatus rejects a wrong id and every truncation', () => {
  const full = netbiosReply([nbEntry('ALI-LAPTOP', 0x00, 0x0400)]);
  assert.equal(parseNetbiosStatus(full, 0x43), null);
  for (let n = 0; n < full.length; n++) {
    assert.equal(parseNetbiosStatus(full.slice(0, n), 0x42), null, `cut at ${n}`);
  }
  assert.equal(parseNetbiosStatus(full, 0x42), 'ALI-LAPTOP');
});

test('parseNetbiosStatus rejects a name count larger than the data', () => {
  const reply = netbiosReply([nbEntry('ALI-LAPTOP', 0x00, 0x0400)]);
  reply[reply.length - 19] = 5;
  assert.equal(parseNetbiosStatus(reply, 0x42), null);
});

test('ssdpDescriptionRequest builds the exact request for a same-host private URL', () => {
  assert.deepEqual(
    ssdpDescriptionRequest('http://192.168.1.10:49152/desc.xml', '192.168.1.10'),
    {
      ip: '192.168.1.10',
      port: 49152,
      request:
        'GET /desc.xml HTTP/1.0\r\nHost: 192.168.1.10:49152\r\nConnection: close\r\n\r\n',
    },
  );
  const bare = ssdpDescriptionRequest('http://192.168.1.10', '192.168.1.10');
  assert.equal(bare?.port, 80);
  assert.equal(
    bare?.request,
    'GET / HTTP/1.0\r\nHost: 192.168.1.10:80\r\nConnection: close\r\n\r\n',
  );
});

test('ssdpDescriptionRequest refuses anything outside the trust boundary', () => {
  const ip = '192.168.1.10';
  assert.equal(ssdpDescriptionRequest('https://192.168.1.10/x', ip), null);
  assert.equal(ssdpDescriptionRequest('http://192.168.1.11/x', ip), null);
  assert.equal(ssdpDescriptionRequest('http://8.8.8.8/x', '8.8.8.8'), null);
  assert.equal(ssdpDescriptionRequest('http://tv.local/x', ip), null);
  assert.equal(ssdpDescriptionRequest('http://192.168.1.10/a\r\nX: y', ip), null);
  assert.equal(ssdpDescriptionRequest('http://192.168.1.10:0/x', ip), null);
  assert.equal(ssdpDescriptionRequest('http://192.168.1.10:65536/x', ip), null);
  assert.equal(ssdpDescriptionRequest('http://192.168.1.10:80@8.8.8.8/x', ip), null);
  assert.equal(ssdpDescriptionRequest('http://192.168.1.10/x', '192.168.1.11'), null);
  assert.equal(ssdpDescriptionRequest('http://999.1.1.1/x', '999.1.1.1'), null);
  for (const bad of ['\x00', '\x01', '\x1f', '\x7f', '\u0085', '\u00e9']) {
    assert.equal(ssdpDescriptionRequest(`http://192.168.1.10/a${bad}b`, ip), null);
  }
  assert.ok(ssdpDescriptionRequest('http://192.168.1.10:65535/x', ip));
});

test('parseHttpResponse splits the status and body', () => {
  assert.deepEqual(
    parseHttpResponse('HTTP/1.1 200 OK\r\nContent-Type: text/xml\r\n\r\n<root/>'),
    { status: 200, body: '<root/>' },
  );
  assert.deepEqual(parseHttpResponse('HTTP/1.0 404 Not Found\r\n\r\n'), {
    status: 404,
    body: '',
  });
  assert.equal(parseHttpResponse('garbage'), null);
  assert.equal(parseHttpResponse('HTTP/1.1 200 OK\r\nContent-Type: text/xml'), null);
});

test('extractDeviceDescription reads the first of each tag and decodes five entities', () => {
  assert.deepEqual(
    extractDeviceDescription(
      '<root><device><friendlyName>Living Room &amp; Den</friendlyName>' +
        '<manufacturer>Samsung</manufacturer><modelName>Q60</modelName></device></root>',
    ),
    { friendlyName: 'Living Room & Den', manufacturer: 'Samsung', modelName: 'Q60' },
  );
  assert.deepEqual(extractDeviceDescription('<root/>'), {
    friendlyName: null,
    manufacturer: null,
    modelName: null,
  });
  const first = extractDeviceDescription(
    '<friendlyName>A</friendlyName><deviceList><friendlyName>B</friendlyName></deviceList>',
  );
  assert.equal(first.friendlyName, 'A');
  assert.equal(
    extractDeviceDescription(
      '<friendlyName>&lt;a&gt; &quot;b&quot; &apos;c&apos; &amp;lt;</friendlyName>',
    ).friendlyName,
    '<a> "b" \'c\' &lt;',
  );
});

test('extractDeviceDescription returns nothing for a document with a DOCTYPE or entity declaration', () => {
  const none = { friendlyName: null, manufacturer: null, modelName: null };
  const body = '<root><friendlyName>Tv</friendlyName></root>';
  assert.deepEqual(extractDeviceDescription('<!ENTITY x "y">' + body), none);
  assert.deepEqual(extractDeviceDescription('<!doctype r [<!entity x "y">]>' + body), none);
  assert.equal(extractDeviceDescription(body).friendlyName, 'Tv');
});

test('extractDeviceDescription ignores comments and unclosed tags', () => {
  assert.deepEqual(
    extractDeviceDescription(
      '<!-- <modelName>Nope</modelName> --><root><modelName>Q60</modelName>' +
        '<!--a--><manufacturer>Sam<!-- x -->sung</manufacturer></root>',
    ),
    { friendlyName: null, manufacturer: 'Samsung', modelName: 'Q60' },
  );
  assert.equal(extractDeviceDescription('<friendlyName>never closed').friendlyName, null);
  assert.equal(extractDeviceDescription('<friendlyNameX>a</friendlyNameX>').friendlyName, null);
  assert.equal(extractDeviceDescription('<friendlyName/><x/>').friendlyName, null);
});

test('extractDeviceDescription stays linear on hostile 64 KB bodies', () => {
  const none = { friendlyName: null, manufacturer: null, modelName: null };
  for (const opener of ['<!ENTITY ', '<!--', '<friendlyName ', '<manufacturer a="']) {
    const hostile = opener.repeat(Math.ceil(65536 / opener.length));
    const started = performance.now();
    const result = extractDeviceDescription(hostile);
    const elapsed = performance.now() - started;
    assert.deepEqual(result, none, opener);
    assert.ok(elapsed < 100, `${opener} took ${elapsed.toFixed(0)} ms`);
  }
});
