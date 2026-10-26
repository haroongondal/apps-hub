import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import '../models/vpn_node.dart';

/// Weighted node fitness score.
///
/// `S = 40 * (speedMbps / 100) - 0.35 * rttMs + 10 * log10(uptimeSec + 1)
///      - 0.15 * numSessions`
///
/// `rttMs` is the measured TCP handshake RTT when available and falls back to
/// the static VPN Gate `Ping` column after a failed probe.
double computeFitnessScore(VpnNode node) {
  final rttMs = node.measuredRttMs ?? node.pingMs;
  return 40 * (node.speedMbps / 100) -
      0.35 * rttMs +
      10 * (math.log(node.uptimeSec + 1) / math.ln10) -
      0.15 * node.numSessions;
}

/// Measures real TCP handshake latency against candidate relays and scores
/// them with [computeFitnessScore].
///
/// The prober is deliberately network-cheap: bounded fan-out, short timeouts,
/// and sockets destroyed immediately after the handshake. UDP latency cannot
/// be measured client-side without a protocol-aware server, so the TCP
/// handshake (most VPN Gate hosts listen on both tcp and udp) is the proxy
/// metric. A failed probe keeps the node and falls back to the upstream
/// static ping instead of dropping it.
class LatencyProber {
  const LatencyProber();

  /// Returns new node copies ranked by [computeFitnessScore], highest first.
  /// Input nodes are never mutated.
  Future<List<VpnNode>> probeAndScoreNodes(
    List<VpnNode> candidates, {
    int concurrency = 8,
    Duration timeout = const Duration(milliseconds: 1500),
  }) async {
    if (candidates.isEmpty) {
      return const <VpnNode>[];
    }
    final workers = math.max(1, math.min(concurrency, candidates.length));
    final probed = List<VpnNode?>.filled(candidates.length, null);

    var nextIndex = 0;
    Future<void> worker() async {
      while (nextIndex < candidates.length) {
        final index = nextIndex++;
        final candidate = candidates[index];
        final rttMs = await _measureHandshakeRtt(candidate, timeout);
        probed[index] = candidate.copyWith(
          measuredRttMs: rttMs,
          fitnessScore: computeFitnessScore(
            candidate.copyWith(measuredRttMs: rttMs),
          ),
        );
      }
    }

    await Future.wait(<Future<void>>[for (var i = 0; i < workers; i++) worker()]);

    final results = probed.whereType<VpnNode>().toList();
    results.sort((a, b) => b.fitnessScore.compareTo(a.fitnessScore));
    return results;
  }

  Future<int?> _measureHandshakeRtt(VpnNode node, Duration timeout) async {
    Socket? socket;
    final stopwatch = Stopwatch()..start();
    try {
      socket = await Socket.connect(
        node.ip,
        node.port,
        timeout: timeout,
      );
      return stopwatch.elapsedMilliseconds;
    } on Exception {
      // Reachability failures are the expected outcome for dead relays.
      return null;
    } finally {
      socket?.destroy();
    }
  }
}
