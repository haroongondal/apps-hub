/**
 * VPN Gate CSV parser test suite (node --test).
 * Port of the Dart `VPN Gate CSV tokenizer` fixture set: 15-column rows,
 * last-comma base64 splitting, documented defaults, column mapping without
 * shift, and non-throwing garbage handling.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_VPN_GATE_PORT,
  DEFAULT_VPN_GATE_TRANSPORT,
  parseVpnGateCsv,
  parseVpnGateCsvRow,
  type VpnNode,
} from '../vpngate.ts';
import { csvRow, csvStream, HEADER_LINE, makeNode, ovpnConfig } from './fixtures.ts';

function parseOne(row: string): VpnNode {
  const node = parseVpnGateCsvRow(row);
  assert.ok(node, 'fixture row must decode');
  return node;
}

const udpNode = (): VpnNode => parseOne(csvRow({ ovpnConfig: ovpnConfig() }));

test('skips markers, header, blank and footer lines, keeps order', async () => {
  const nodes = await collect(parseVpnGateCsv(csvStream([
    csvRow({ ip: '219.100.37.110', ovpnConfig: ovpnConfig({ port: 1195 }) }),
    csvRow({
      host: 'public-vpn-9',
      ip: '219.100.37.9',
      ovpnConfig: ovpnConfig({ port: 443, proto: 'tcp' }),
    }),
  ])));

  assert.equal(nodes.length, 2);
  assert.equal(nodes[0]!.hostName, 'public-vpn-155');
  assert.equal(nodes[0]!.port, 1195);
  assert.equal(nodes[1]!.hostName, 'public-vpn-9');
  assert.equal(nodes[1]!.port, 443);
  assert.equal(nodes[1]!.transportProto, 'tcp');
});

test('falls back to documented defaults without remote/proto', async () => {
  const node = parseOne(
    csvRow({
      ovpnConfig: ovpnConfig({ includeRemote: false, port: 12345 }),
    }),
  );
  assert.equal(node.port, DEFAULT_VPN_GATE_PORT);
  assert.equal(node.transportProto, DEFAULT_VPN_GATE_TRANSPORT);
});

test('maps CSV columns onto model fields without shift', () => {
  const node = udpNode();
  assert.equal(node.ip, '219.100.37.110');
  assert.equal(node.score, 1579190);
  assert.equal(node.pingMs, 20);
  assert.equal(node.speedBps, 183498662);
  assert.ok(Math.abs(node.speedBps / 1000000 - 183.498662) < 0.000001);
  assert.equal(node.numSessions, 100);
  // Upstream uptime is seconds; the model carries milliseconds.
  assert.equal(node.uptimeMs, 112305311000);
  assert.equal(node.countryShort, 'JP');
  assert.equal(node.countryLong, 'Japan');
  assert.match(node.operatorName, /Nobori/);
  assert.equal(node.protocol, 'openvpn');
  assert.match(node.ovpnConfigRaw, /data-ciphers/);
  // Same identity as the model-level fixture node.
  assert.equal(node.id, makeNode().id);
});

test('never throws on short, blank, marker, or undecodable rows', async () => {
  const garbageRow = csvRow({ ovpnConfig: 'placeholder' });
  const brokenPayload =
    garbageRow.slice(0, garbageRow.lastIndexOf(',') + 1) + '!!!not@base64!!!';
  const lines: string[] = [
    '',
    '   ',
    '*vpn_servers',
    HEADER_LINE,
    // Too few columns.
    'only,two,columns',
    // Full prefix but no config payload column.
    'public-vpn-1,219.100.37.1,100,20,100000,Japan,JP,10,6000,1,2,none,x',
    brokenPayload,
    '*',
  ];

  const nodes = await collect(parseVpnGateCsv(lines));
  assert.equal(nodes.length, 0);
});

async function collect(
  source: AsyncIterable<VpnNode> | Iterable<VpnNode>,
): Promise<VpnNode[]> {
  const items: VpnNode[] = [];
  for await (const item of source) {
    items.push(item);
  }
  return items;
}
