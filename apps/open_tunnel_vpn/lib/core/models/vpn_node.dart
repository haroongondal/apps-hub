import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:meta/meta.dart';

/// Tunnel payload protocol served by a node.
///
/// VPN Gate column 15 (index 14) is always OpenVPN data; `wireguard` only ever
/// occurs when the user imports a genuine `.conf` payload.
enum VpnProtocol { openvpn, wireguard }

/// Underlying transport advertised in a node's OpenVPN config.
enum VpnTransport { tcp, udp }

/// Stable node identifier derived from the probe endpoint.
///
/// VPN Gate rotates host names, but `[ip]:[port]` is what the app actually
/// connects to, so the identity is keyed on it.
String vpnNodeIdFor(String ip, int port) =>
    sha256.convert(utf8.encode('$ip:$port')).toString();

/// An immutable VPN Gate relay candidate.
@immutable
class VpnNode {
  /// Creates a node. Prefer [VpnNode.create] or [VpnNode.fromCsvRow] so that
  /// [id] is derived from the connection endpoint instead of passed in.
  const VpnNode({
    required this.id,
    required this.hostName,
    required this.ip,
    required this.port,
    required this.transportProto,
    required this.score,
    required this.pingMs,
    required this.speedBps,
    required this.countryLong,
    required this.countryShort,
    required this.numSessions,
    required this.uptimeMs,
    required this.operatorName,
    required this.ovpnConfigRaw,
    this.protocol = VpnProtocol.openvpn,
    this.measuredRttMs,
    this.fitnessScore = 0,
  });

  /// Builds a node with its [id] computed from the probe endpoint.
  factory VpnNode.create({
    required String hostName,
    required String ip,
    required int port,
    required VpnTransport transportProto,
    required int score,
    required int pingMs,
    required int speedBps,
    required String countryLong,
    required String countryShort,
    required int numSessions,
    required int uptimeMs,
    required String operatorName,
    required String ovpnConfigRaw,
    VpnProtocol protocol = VpnProtocol.openvpn,
  }) {
    return VpnNode(
      id: vpnNodeIdFor(ip, port),
      hostName: hostName,
      ip: ip,
      port: port,
      transportProto: transportProto,
      score: score,
      pingMs: pingMs,
      speedBps: speedBps,
      countryLong: countryLong,
      countryShort: countryShort,
      numSessions: numSessions,
      uptimeMs: uptimeMs,
      operatorName: operatorName,
      ovpnConfigRaw: ovpnConfigRaw,
      protocol: protocol,
    );
  }

  /// SHA-256 hex of `$ip:$port`.
  final String id;
  final String hostName;

  /// Probe endpoint. The `remote` line inside [ovpnConfigRaw] may be a rotating
  /// host name; the CSV `IP` column is the stable address.
  final String ip;
  final int port;
  final VpnTransport transportProto;

  /// Upstream heuristic score from the VPN Gate API.
  final int score;
  final int pingMs;
  final int speedBps;
  final String countryLong;
  final String countryShort;
  final int numSessions;

  /// Uptime in milliseconds. Upstream reports seconds; the UI-probe result and
  /// the scoring formula both work in whole seconds via [uptimeSec].
  final int uptimeMs;
  final String operatorName;

  /// Sanitized OpenVPN text. Never log, persist outside local storage, or ship
  /// this to a remote endpoint.
  final String ovpnConfigRaw;
  final VpnProtocol protocol;

  /// TCP handshake RTT in milliseconds, or `null` when the probe failed.
  final int? measuredRttMs;

  /// Composite fitness score, filled by the latency prober.
  final double fitnessScore;

  double get speedMbps => speedBps / 1000000;
  int get uptimeSec => uptimeMs ~/ 1000;

  /// A short, non-sensitive label for diagnostics.
  String get label => '$countryShort/$hostName:$port';

  VpnNode copyWith({
    int? measuredRttMs,
    double? fitnessScore,
  }) {
    return VpnNode(
      id: id,
      hostName: hostName,
      ip: ip,
      port: port,
      transportProto: transportProto,
      score: score,
      pingMs: pingMs,
      speedBps: speedBps,
      countryLong: countryLong,
      countryShort: countryShort,
      numSessions: numSessions,
      uptimeMs: uptimeMs,
      operatorName: operatorName,
      ovpnConfigRaw: ovpnConfigRaw,
      protocol: protocol,
      measuredRttMs: measuredRttMs ?? this.measuredRttMs,
      fitnessScore: fitnessScore ?? this.fitnessScore,
    );
  }

  @override
  bool operator ==(Object other) => other is VpnNode && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'VpnNode($label rtt=${measuredRttMs ?? 'null'})';
}
