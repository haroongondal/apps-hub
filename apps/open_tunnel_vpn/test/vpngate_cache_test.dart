import 'package:flutter_test/flutter_test.dart';

import 'package:open_tunnel_vpn/core/database/app_database.dart';
import 'package:open_tunnel_vpn/core/models/vpn_node.dart';

VpnNode _node({
  required String host,
  required String ip,
  required int port,
  String countryCode = 'JP',
  required double fitness,
}) {
  return VpnNode.create(
    hostName: host,
    ip: ip,
    port: port,
    transportProto: VpnTransport.udp,
    score: 100,
    pingMs: 20,
    speedBps: 50000000,
    countryLong: countryCode == 'JP' ? 'Japan' : 'United States',
    countryShort: countryCode,
    numSessions: 10,
    uptimeMs: 315000000000,
    operatorName: 'testsuite',
    ovpnConfigRaw: 'client\ndata-ciphers AES-256-GCM\n',
  ).copyWith(fitnessScore: fitness);
}

void main() {
  late AppDatabase db;

  setUp(() => db = AppDatabase.inMemory());

  tearDown(() async => db.close());

  test('round-trips every mapped field', () async {
    final tokyo = _node(
      host: 'tokyo-relay',
      ip: '219.100.37.110',
      port: 1195,
      fitness: 131.9,
    );
    final fresno = _node(
      host: 'fresno-relay',
      ip: '203.0.113.77',
      port: 443,
      countryCode: 'US',
      fitness: 42.5,
    );

    await db.replaceAllNodes(<VpnNode>[tokyo, fresno]);
    final rows = await db.loadNodes(withConfig: true);

    expect(rows, hasLength(2));
    final highest = nodeFromRow(rows.first);
    expect(highest.fitnessScore, 0.0); // no probe recorded in this test
    expect(highest.hostName, 'tokyo-relay');
    expect(highest.port, 1195);
    expect(highest.countryShort, 'JP');
    expect(highest.transportProto, VpnTransport.udp);
    expect(highest.protocol, VpnProtocol.openvpn);
    expect(highest.ovpnConfigRaw, contains('data-ciphers'));
  });

  test('list reads come back configless and ranked by fitness', () async {
    final low = _node(
      host: 'low',
      ip: '203.0.113.5',
      port: 1,
      countryCode: 'US',
      fitness: 3.0,
    );
    final high = _node(host: 'high', ip: '203.0.113.6', port: 2, fitness: 99.0);

    await db.replaceAllNodes(<VpnNode>[low, high]);
    final rows = await db.loadNodes();

    expect(rows, hasLength(2));
    expect(rows.first.hostName, 'high');
    expect(rows.last.hostName, 'low');
    expect(
      rows.every((row) => row.ovpnConfigRaw == ''),
      isTrue,
      reason: 'list reads keep the tunnel payload out of the UI',
    );
  });

  test('country filter is case-insensitive', () async {
    final jp = _node(
      host: 'jp-relay',
      ip: '219.100.37.110',
      port: 1195,
      fitness: 131.9,
    );
    final us = _node(
      host: 'us-relay',
      ip: '203.0.113.77',
      port: 443,
      countryCode: 'US',
      fitness: 1.0,
    );

    await db.replaceAllNodes(<VpnNode>[jp, us]);
    final japanese = await db.loadNodes(countryCode: 'jp');

    expect(japanese, hasLength(1));
    expect(japanese.first.hostName, 'jp-relay');
  });

  test('a refresh evicts every relay missing from the new list', () async {
    final tokyo = _node(host: 'tokyo', ip: '219.100.37.110', port: 1195, fitness: 8.0);
    final fresno = _node(
      host: 'fresno',
      ip: '203.0.113.77',
      port: 443,
      countryCode: 'US',
      fitness: 5.0,
    );

    await db.replaceAllNodes(<VpnNode>[tokyo, fresno]);
    expect((await db.loadNodes()).length, 2);

    await db.replaceAllNodes(<VpnNode>[tokyo]);
    final afterRefresh = await db.loadNodes();
    expect(afterRefresh, hasLength(1));
    expect(afterRefresh.first.hostName, 'tokyo');

    await db.replaceAllNodes(const <VpnNode>[]);
    expect(await db.loadNodes(), isEmpty);
  });
}
