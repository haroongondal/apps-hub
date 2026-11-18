/** UPnP SOAP envelope building, response parsing and the soapCall wrapper (node --test). */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSoapEnvelope, parseSoapResponse, soapCall } from '../upnp-soap.ts';
import type { SoapService } from '../upnp-soap.ts';
import type { InterfaceInfo } from '../model.ts';

const WAN = 'urn:schemas-upnp-org:service:WANIPConnection:1';
const iface: InterfaceInfo = { localIp: '192.168.1.20', cidrPrefix: 24, gatewayIp: '192.168.1.1' };
const service: SoapService = { serviceType: WAN, control: { ip: '192.168.1.1', port: 5000, path: '/ctl/IPConn' } };

const ENVELOPE_OPEN =
  '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
  's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>';

const IP_RESPONSE =
  '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
  's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
  `<u:GetExternalIPAddressResponse xmlns:u="${WAN}"><NewExternalIPAddress>203.0.113.7</NewExternalIPAddress>` +
  '</u:GetExternalIPAddressResponse></s:Body></s:Envelope>';

const FAULT =
  '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>' +
  '<faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail>' +
  '<UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>713</errorCode>' +
  '<errorDescription>SpecifiedArrayIndexInvalid</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>';

test('buildSoapEnvelope wraps the action in the service namespace', () => {
  const xml = buildSoapEnvelope(WAN, 'GetExternalIPAddress', []);
  assert.equal(xml, `${ENVELOPE_OPEN}<u:GetExternalIPAddress xmlns:u="${WAN}"></u:GetExternalIPAddress></s:Body></s:Envelope>`);
});

test('buildSoapEnvelope keeps argument order and escapes values', () => {
  const xml = buildSoapEnvelope(WAN, 'AddPortMapping', [['NewB', 'a&b<'], ['NewA', `"x" > 'y'`], ['NewC', '']]);
  assert.ok(xml.includes('<NewB>a&amp;b&lt;</NewB><NewA>&quot;x&quot; &gt; &apos;y&apos;</NewA><NewC></NewC>'), xml);
});

test('parseSoapResponse reads a real GetExternalIPAddress reply', () => {
  assert.deepEqual(parseSoapResponse(200, IP_RESPONSE), { ok: true, values: { NewExternalIPAddress: '203.0.113.7' } });
});

test('parseSoapResponse takes several leaves, any prefix or none, and decodes entities', () => {
  const body =
    '<Envelope><Body><GetGenericPortMappingEntryResponse>' +
    '<NewRemoteHost/><NewExternalPort>8080</NewExternalPort><NewInternalClient></NewInternalClient>' +
    '<NewPortMappingDescription>a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#65;&#x42;</NewPortMappingDescription>' +
    '</GetGenericPortMappingEntryResponse></Body></Envelope>';
  assert.deepEqual(parseSoapResponse(200, body), {
    ok: true,
    values: {
      NewRemoteHost: '',
      NewExternalPort: '8080',
      NewInternalClient: '',
      NewPortMappingDescription: `a & b <c> "d" 'e' AB`,
    },
  });
});

test('parseSoapResponse skips elements that have child elements and does not double-decode', () => {
  const body =
    '<s:Body><u:XResponse xmlns:u="urn:x"><Wrap><Inner>1</Inner></Wrap><Leaf>&amp;lt;</Leaf></u:XResponse></s:Body>';
  assert.deepEqual(parseSoapResponse(200, body), { ok: true, values: { Leaf: '&lt;' } });
});

test('parseSoapResponse: an empty or self-closing Response gives no values', () => {
  assert.deepEqual(parseSoapResponse(200, '<s:Body><u:DeletePortMappingResponse xmlns:u="urn:x"/></s:Body>'), { ok: true, values: {} });
  assert.deepEqual(parseSoapResponse(200, '<s:Body><u:DeletePortMappingResponse xmlns:u="urn:x"></u:DeletePortMappingResponse></s:Body>'), { ok: true, values: {} });
});

test('parseSoapResponse reads the errorCode of a 500 fault', () => {
  assert.deepEqual(parseSoapResponse(500, FAULT), { ok: false, errorCode: 713 });
});

test('parseSoapResponse treats a 200 SOAP fault as a failure', () => {
  assert.deepEqual(parseSoapResponse(200, FAULT), { ok: false, errorCode: 713 });
});

test('parseSoapResponse: non-200 without an errorCode gives null', () => {
  assert.deepEqual(parseSoapResponse(404, '<html>nope</html>'), { ok: false, errorCode: null });
  assert.deepEqual(parseSoapResponse(500, ''), { ok: false, errorCode: null });
  assert.deepEqual(parseSoapResponse(500, '<errorCode>abc</errorCode>'), { ok: false, errorCode: null });
});

test('parseSoapResponse: a 200 with a garbage body is ok with no values', () => {
  assert.deepEqual(parseSoapResponse(200, 'not xml at all'), { ok: true, values: {} });
  assert.deepEqual(parseSoapResponse(200, ''), { ok: true, values: {} });
});

test('parseSoapResponse survives an out-of-range numeric entity', () => {
  const body = '<Body><XResponse><V>&#99999999999;x</V></XResponse></Body>';
  assert.deepEqual(parseSoapResponse(200, body), { ok: true, values: { V: '&#99999999999;x' } });
});

function fakeBinding(reply: string | null) {
  const calls: { ip: string; port: number; request: string }[] = [];
  return {
    calls,
    tcpFetch: async (ip: string, port: number, request: string) => {
      calls.push({ ip, port, request });
      return reply;
    },
  };
}

test('soapCall posts the envelope with SOAPAction and parses the reply', async () => {
  const b = fakeBinding(`HTTP/1.0 200 OK\r\nContent-Type: text/xml\r\n\r\n${IP_RESPONSE}`);
  const res = await soapCall(b, iface, service, 'GetExternalIPAddress');
  assert.deepEqual(res, { ok: true, values: { NewExternalIPAddress: '203.0.113.7' } });
  assert.equal(b.calls.length, 1);
  const { ip, port, request } = b.calls[0];
  assert.equal(ip, '192.168.1.1');
  assert.equal(port, 5000);
  const envelope = buildSoapEnvelope(WAN, 'GetExternalIPAddress', []);
  assert.ok(request.startsWith('POST /ctl/IPConn HTTP/1.0\r\n'), request);
  assert.ok(request.includes(`\r\nSOAPAction: "${WAN}#GetExternalIPAddress"\r\n`), request);
  assert.ok(request.includes('\r\nContent-Type: text/xml; charset="utf-8"\r\n'), request);
  assert.ok(request.endsWith(`\r\n\r\n${envelope}`), request);
});

test('soapCall sends args in order', async () => {
  const b = fakeBinding('HTTP/1.0 200 OK\r\n\r\n<Body><XResponse/></Body>');
  await soapCall(b, iface, service, 'AddPortMapping', [['NewA', '1'], ['NewB', '2']]);
  assert.ok(b.calls[0].request.includes('<NewA>1</NewA><NewB>2</NewB>'));
});

test('soapCall returns the fault errorCode from a 500 reply', async () => {
  const b = fakeBinding(`HTTP/1.0 500 Internal Server Error\r\n\r\n${FAULT}`);
  assert.deepEqual(await soapCall(b, iface, service, 'GetGenericPortMappingEntry', [['NewPortMappingIndex', '99']]), { ok: false, errorCode: 713 });
});

test('soapCall: no reply, or a target the LAN guard refuses, gives errorCode null', async () => {
  const none = fakeBinding(null);
  assert.deepEqual(await soapCall(none, iface, service, 'GetExternalIPAddress'), { ok: false, errorCode: null });
  const off = fakeBinding('HTTP/1.0 200 OK\r\n\r\n');
  const wan: SoapService = { serviceType: WAN, control: { ip: '8.8.8.8', port: 80, path: '/ctl' } };
  assert.deepEqual(await soapCall(off, iface, wan, 'GetExternalIPAddress'), { ok: false, errorCode: null });
  assert.equal(off.calls.length, 0);
});

test('parseSoapResponse stays linear on unterminated elements', () => {
  const start = performance.now();
  parseSoapResponse(200, '<xResponse>' + '<a '.repeat(21845));
  parseSoapResponse(200, '<xResponse>' + '<a>'.repeat(21845));
  parseSoapResponse(200, '<xResponse '.repeat(24000));
  parseSoapResponse(200, '<xResponse><a><b><c>'.repeat(14000));
  assert.ok(performance.now() - start < 200, `took ${performance.now() - start} ms`);
});
