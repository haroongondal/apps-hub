import 'dart:convert';
import 'dart:io';

import 'package:open_tunnel_vpn/core/models/vpn_node.dart';
import 'package:open_tunnel_vpn/core/network/latency_prober.dart';
import 'package:open_tunnel_vpn/core/network/vpngate_service.dart';

/// One-off smoke check against a real VPN Gate payload.
///
/// Usage: `dart run tool/vpngate_smoke.dart path/to/vpngate.csv`
/// Prints aggregate statistics only; never prints config text or secret
/// material, in line with the workspace privacy rules.
Future<void> main(List<String> args) async {
  final path = args.isEmpty
      ? 'build/tmp_vpngate.csv'
      : args.first;
  final file = File(path);
  if (!file.existsSync()) {
    stderr.writeln('missing payload file: $path');
    exitCode = 66;
    return;
  }

  var total = 0;
  var parsed = 0;
  final nodes = <VpnNode>[];
  final lines = file
      .openRead()
      .transform(utf8.decoder)
      .transform(const LineSplitter());
  await for (final line in lines) {
    total++;
    final node = parseVpnGateCsvRow(line);
    if (node != null) {
      nodes.add(node);
      parsed++;
    }
  }

  final scored = await const LatencyProber().probeAndScoreNodes(
    nodes,
    concurrency: 16,
    timeout: const Duration(milliseconds: 600),
  );

  final countries = <String, int>{};
  for (final node in nodes) {
    countries[node.countryShort] = (countries[node.countryShort] ?? 0) + 1;
  }
  final rankedCountries = countries.entries.toList()
    ..sort((a, b) => b.value.compareTo(a.value));

  final probed = scored.where((n) => n.measuredRttMs != null).length;
  stderr.writeln('=== VPN Gate smoke ===');
  stderr.writeln('lines=$total parsed=$parsed probedOk=$probed');
  stderr.writeln(
    'topCountries=${rankedCountries.take(5).map((e) => '${e.key}:${e.value}').join(' ')}',
  );
  for (final node in scored.take(5)) {
    stderr.writeln(
      'top=${node.label} fitness=${node.fitnessScore.toStringAsFixed(1)} '
      '${node.measuredRttMs == null ? 'probe-failed (static ${node.pingMs}ms)'
          : 'rtt=${node.measuredRttMs}ms'} '
      'speed=${node.speedMbps.toStringAsFixed(1)}Mbps',
    );
  }
  if (nodes.isEmpty) {
    stderr.writeln('SMOKE FAILED: live payload parsed to zero nodes');
    exitCode = 1;
  }
}
