import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:crypto/crypto.dart' as crypto;
import 'package:flutter_test/flutter_test.dart';

import 'package:open_tunnel_vpn/core/models/vpn_node.dart';
import 'package:open_tunnel_vpn/core/network/latency_prober.dart';
import 'package:open_tunnel_vpn/core/network/vpngate_service.dart';

/// Realistic 15-column VPN Gate rows modeled on the live payload: a
/// `*vpn_servers` marker line, a `#`-prefixed header, comma-separated ASCII
/// metadata, and a base64 OpenVPN config as the final field.
const String _headerLine =
    '#HostName,IP,Score,Ping,Speed,CountryLong,CountryShort,NumVpnSessions,'
    'Uptime,TotalUsers,TotalTraffic,LogType,Operator,Message,'
    'OpenVPN_ConfigData_Base64';

String _ovpnConfig({
  int port = 1195,
  String proto = 'udp',
  String remote = '1.2.3.4',
  bool includeRemote = true,
  List<String> legacyDirectives = const <String>[],
}) {
  final buffer = StringBuffer()
    ..writeln('##################################')
    ..writeln('# OpenVPN 2.0 sample produced by VPN Gate')
    ..writeln('##################################')
    ..writeln()
    ..writeln('client')
    ..writeln('dev tun')
    ..writeln('proto $proto');
  if (includeRemote) {
    buffer.writeln('remote $remote $port');
  }
  buffer
    ..writeln('resolv-retry infinite')
    ..writeln('nobind')
    ..writeln('auth-user-pass')
    ..writeln('persist-key')
    ..writeln('persist-tun');
  for (final directive in legacyDirectives) {
    buffer.writeln(directive);
  }
  buffer
    ..writeln()
    ..writeln('<ca>')
    ..writeln('-----BEGIN CERTIFICATE-----')
    ..writeln('MIIAb2d1ZXN0Y2VydA==')
    ..writeln('-----END CERTIFICATE-----')
    ..writeln('</ca>');
  return buffer.toString();
}

String _csvRow({
  String host = 'public-vpn-155',
  String ip = '219.100.37.110',
  int score = 1579190,
  int ping = 20,
  int speedBps = 183498662,
  int sessions = 100,
  int uptimeSec = 112305311,
  String operatorText = 'Daiyuu Nobori_ Japan. Academic Use Only.',
  String message = '',
  required String ovpnConfig,
}) {
  final encoded = base64Encode(utf8.encode(ovpnConfig));
  return '$host,$ip,$score,$ping,$speedBps,Japan,JP,$sessions,$uptimeSec,'
      '8229093,464887703812776,2weeks,$operatorText,$message,$encoded';
}

Stream<String> _csvStream({required List<String> rows}) async* {
  yield '*vpn_servers';
  yield _headerLine;
  yield* Stream<String>.fromIterable(rows);
  yield '';
  yield '*';
}

VpnNode _udpNode() => _parseOne(_csvRow(ovpnConfig: _ovpnConfig()));

VpnNode _parseOne(String row) {
  final node = parseVpnGateCsvRow(row);
  expect(node, isNotNull, reason: 'fixture row must decode');
  return node!;
}

void main() {
  group('VPN Gate CSV tokenizer', () {
    test('skips markers, header, blank and footer lines, keeps order',
        () async {
      final nodes = await parseVpnGateCsv(
        _csvStream(rows: <String>[
          _csvRow(ip: '219.100.37.110', ovpnConfig: _ovpnConfig(port: 1195)),
          _csvRow(
            host: 'public-vpn-9',
            ip: '219.100.37.9',
            ovpnConfig: _ovpnConfig(port: 443, proto: 'tcp'),
          ),
        ]),
      ).toList();

      expect(nodes, hasLength(2));
      expect(nodes[0].hostName, 'public-vpn-155');
      expect(nodes[0].port, 1195);
      expect(nodes[1].hostName, 'public-vpn-9');
      expect(nodes[1].port, 443);
      expect(nodes[1].transportProto, VpnTransport.tcp);
    });

    test('falls back to documented defaults without remote/proto', () async {
      final node = await parseVpnGateCsv(_csvStream(rows: <String>[
        _csvRow(
          ovpnConfig: _ovpnConfig(
            includeRemote: false,
            port: 12345,
          ),
        ),
      ])).first;

      expect(node.port, kDefaultVpnGatePort);
      expect(node.transportProto, kDefaultVpnGateTransport);
    });

    test('maps CSV columns onto model fields without shift', () async {
      final node = _udpNode();

      expect(node.ip, '219.100.37.110');
      expect(node.score, 1579190);
      expect(node.pingMs, 20);
      expect(node.speedBps, 183498662);
      expect(node.speedMbps, closeTo(183.498662, 0.000001));
      expect(node.numSessions, 100);
      // Upstream uptime is seconds; the model carries milliseconds.
      expect(node.uptimeMs, 112305311000);
      expect(node.uptimeSec, 112305311);
      expect(node.countryShort, 'JP');
      expect(node.countryLong, 'Japan');
      expect(node.operatorName, contains('Nobori'));
      expect(node.protocol, VpnProtocol.openvpn);
      expect(node.ovpnConfigRaw, contains('data-ciphers'));
    });

    test('never throws on short, blank, marker, or undecodable rows',
        () async {
      final garbageRow = _csvRow(ovpnConfig: 'placeholder');
      final brokenPayload = garbageRow.replaceRange(
        garbageRow.lastIndexOf(',') + 1,
        null,
        '!!!not@base64!!!',
      );
      final lines = <String>[
        '',
        '   ',
        '*vpn_servers',
        _headerLine,
        // Too few columns.
        'only,two,columns',
        // Full prefix but no config payload column.
        'public-vpn-1,219.100.37.1,100,20,100000,Japan,JP,10,6000,1,2,none,x',
        brokenPayload,
        '*',
      ];

      final nodes = await parseVpnGateCsv(
        Stream<String>.fromIterable(lines),
      ).toList();
      expect(nodes, isEmpty);
    });
  });

  group('OpenVPN sanitizer', () {
    test('injects compat ciphers exactly once after the client preamble',
        () async {
      final config = _parseOne(
        _csvRow(ovpnConfig: _ovpnConfig()),
      ).ovpnConfigRaw;

      final lines = config.split('\n');
      final clientIndex = lines.indexWhere((line) => line.trim() == 'client');
      expect(clientIndex, greaterThanOrEqualTo(0));
      expect(lines[clientIndex + 1], kInjectedCipherDirectives[0]);
      expect(lines[clientIndex + 2], kInjectedCipherDirectives[1]);
      expect(
        lines.where((line) => line.trim() == kInjectedCipherDirectives[0])
            .length,
        1,
      );
      expect(
        lines.where((line) => line.trim() == kInjectedCipherDirectives[1])
            .length,
        1,
      );

      final fallback = RegExp(r'^\s*data-ciphers-fallback\s', multiLine: true);
      expect(fallback.allMatches(config).length, 1);
    });

    test('strips legacy directives rejected by OpenVPN 2.6+', () async {
      final node = await parseVpnGateCsv(_csvStream(rows: <String>[
        _csvRow(
          ovpnConfig: _ovpnConfig(
            port: 443,
            proto: 'tcp',
            legacyDirectives: <String>[
              'cipher AES-256-CBC',
              'data-ciphers AES-256-CBC',
              'data-ciphers-fallback AES-128-CBC',
              'comp-lzo no',
            ],
          ),
        ),
      ])).first;

      expect(node.ovpnConfigRaw, isNot(contains('cipher AES-256-CBC')));
      expect(node.ovpnConfigRaw, isNot(contains('comp-lzo')));
      final injected = RegExp(r'^\s*data-ciphers\s', multiLine: true)
          .allMatches(node.ovpnConfigRaw)
          .length;
      expect(injected, 1);
    });

    test('is idempotent', () {
      final raw = _ovpnConfig(
        legacyDirectives: <String>['cipher AES-128-CBC', 'comp-lzo no'],
      );
      final once = sanitizeOpenVpnConfig(raw);
      final twice = sanitizeOpenVpnConfig(once);

      expect(twice, once);
    });
  });

  group('model identity and scoring', () {
    test('id is derived from the probe endpoint', () {
      final expected = crypto.sha256
          .convert(utf8.encode('219.100.37.110:1195'))
          .toString();
      expect(_udpNode().id, expected);
      expect(vpnNodeIdFor('219.100.37.110', 1195), expected);
    });

    test('fitness formula matches the contracted weights', () {
      // Falls back to the static ping (20 ms) because no probe ran.
      const speedMbps = 183.498662;
      const rttMs = 20;
      const uptimeSec = 112305311;
      const sessions = 100;
      final expected = 40 * (speedMbps / 100) -
          0.35 * rttMs +
          10 * (math.log(uptimeSec + 1) / math.ln10) -
          0.15 * sessions;

      expect(computeFitnessScore(_udpNode()), closeTo(expected, 0.01));
    });

    test('fallback RTT equals the static ping before any probe', () {
      final node = _udpNode();
      expect(node.measuredRttMs, isNull);
      expect(
        computeFitnessScore(node),
        computeFitnessScore(node.copyWith(measuredRttMs: 20)),
      );
    });

    test('copyWith does not mutate and copies remain distinct', () {
      final original = _udpNode();
      final probed = original.copyWith(measuredRttMs: 42, fitnessScore: 98.5);

      expect(original.measuredRttMs, isNull);
      expect(original.fitnessScore, 0.0);
      expect(probed.measuredRttMs, 42);
      expect(probed.fitnessScore, 98.5);
      expect(probed.id, original.id);
      expect(probed, original); // identity equality follows id
    });
  });

  group('TCP latency prober', () {
    test('ranks the reachable node above an unreachable one', () async {
      final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      server.listen((socket) => socket.destroy());
      final openPort = server.port;

      // Bind, capture the port, release, and rely on loopback refusal.
      final temp = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      final closedPort = temp.port;
      await temp.close();

      final reachable = VpnNode.create(
        hostName: 'loopback-open',
        ip: '127.0.0.1',
        port: openPort,
        transportProto: VpnTransport.tcp,
        score: 100,
        pingMs: 50,
        speedBps: 200000000,
        countryLong: 'Local',
        countryShort: 'LOC',
        numSessions: 10,
        uptimeMs: 315000000000,
        operatorName: 'testsuite',
        ovpnConfigRaw: 'client',
      );
      final dead = VpnNode.create(
        hostName: 'loopback-dead',
        ip: '127.0.0.1',
        port: closedPort,
        transportProto: VpnTransport.tcp,
        score: 3000,
        pingMs: 0,
        speedBps: 10000000,
        countryLong: 'Local',
        countryShort: 'LOC',
        numSessions: 100,
        uptimeMs: 60000,
        operatorName: 'testsuite',
        ovpnConfigRaw: 'client',
      );

      final ranked = await const LatencyProber().probeAndScoreNodes(
        <VpnNode>[dead, reachable],
        timeout: const Duration(milliseconds: 1200),
      );

      expect(ranked.first.id, reachable.id);
      expect(ranked.first.measuredRttMs, isNotNull);
      expect(ranked.first.measuredRttMs, lessThanOrEqualTo(1200));
      expect(ranked.last.id, dead.id);
      expect(ranked.last.measuredRttMs, isNull);
      expect(ranked.length, 2);

      await server.close();
    });

    test('never mutates the input list or its nodes', () async {
      // Loopback dead port: the probe must fail locally, never touch the net.
      final temp = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      final closedPort = temp.port;
      await temp.close();

      final original = VpnNode.create(
        hostName: 'mutate-target',
        ip: '127.0.0.1',
        port: closedPort,
        transportProto: VpnTransport.tcp,
        score: 1,
        pingMs: 5,
        speedBps: 5000,
        countryLong: 'Local',
        countryShort: 'LOC',
        numSessions: 1,
        uptimeMs: 1000,
        operatorName: 'testsuite',
        ovpnConfigRaw: 'client',
      );
      final input = <VpnNode>[original];

      final result = await const LatencyProber().probeAndScoreNodes(
        input,
        timeout: const Duration(milliseconds: 50),
      );

      expect(identical(result.first, original), isFalse);
      expect(original.measuredRttMs, isNull);
      expect(original.fitnessScore, 0.0);
      expect(result.first.measuredRttMs, isNull); // loopback refused this port
      expect(identical(result, input), isFalse);
      expect(input.length, 1);
    });

    test('concurrency stays bounded by the argument', () async {
      final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      server.listen((socket) => socket.destroy());

      final candidates = <VpnNode>[
        for (var i = 0; i < 24; i++)
          VpnNode.create(
            hostName: 'node-$i',
            ip: '127.0.0.1',
            port: server.port,
            transportProto: VpnTransport.tcp,
            score: i,
            pingMs: 50,
            speedBps: 10000000,
            countryLong: 'Local',
            countryShort: 'LOC',
            numSessions: 10,
            uptimeMs: 1000000,
            operatorName: 'testsuite',
            ovpnConfigRaw: 'client',
          ),
      ];

      final results = await const LatencyProber().probeAndScoreNodes(
        candidates,
        concurrency: 3,
        timeout: const Duration(milliseconds: 1200),
      );

      expect(results.length, 24);
      // Highest fitness first; ties keep whoever sorted first by comparator.
      for (var i = 1; i < results.length; i++) {
        expect(
          results[i].fitnessScore,
          lessThanOrEqualTo(results[i - 1].fitnessScore),
        );
      }

      await server.close();
    });
  });
}
