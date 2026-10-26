import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../models/vpn_node.dart';

part 'app_database.g.dart';

/// Local cache of the current VPN Gate node list.
///
/// The cache never leaves the device: there is no sync, no upload, and Flutter's
/// default backup behavior is disabled via `android:allowBackup="false"` in the
/// app manifest. iOS keeps the database inside the app container, which is
/// removed on uninstall.
@DataClassName('VpnNodeRow')
class VpnNodes extends Table {
  TextColumn get id => text()();
  TextColumn get hostName => text()();
  TextColumn get ip => text()();
  IntColumn get port => integer()();
  TextColumn get transportProto => text()();
  IntColumn get score => integer()();
  IntColumn get pingMs => integer()();
  IntColumn get speedBps => integer()();
  TextColumn get countryLong => text()();
  TextColumn get countryShort => text()();
  IntColumn get numSessions => integer()();
  IntColumn get uptimeMs => integer()();
  TextColumn get operatorName => text()();
  TextColumn get ovpnConfigRaw => text()();
  TextColumn get protocol => text()();
  IntColumn get measuredRttMs => integer().nullable()();
  RealColumn get fitnessScore => real().withDefault(const Constant(0.0))();

  /// UTC epoch milliseconds of the most recent refresh that wrote this row.
  IntColumn get fetchedAtMs => integer()();

  /// UTC epoch milliseconds of the last successful latency probe, or `null`.
  IntColumn get probedAtMs => integer().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

@DriftDatabase(tables: [VpnNodes])
class AppDatabase extends _$AppDatabase {
  AppDatabase(QueryExecutor? executor) : super(executor ?? _openOnDisk());

  /// Opens the shared on-disk cache used by the shipping app.
  AppDatabase.onDisk() : super(_openOnDisk());

  /// Opens an empty in-memory database for tests.
  AppDatabase.inMemory() : super(NativeDatabase.memory());

  @override
  int get schemaVersion => 1;

  static LazyDatabase _openOnDisk() => LazyDatabase(() async {
        final dir = await getApplicationSupportDirectory();
        final file = File(p.join(dir.path, 'opentunnel.sqlite3'));
        return NativeDatabase.createInBackground(file);
      });

  /// Replaces the cached node list atomically. Rows absent from [nodes] are
  /// removed so stale relays never linger after a refresh.
  Future<void> replaceAllNodes(List<VpnNode> nodes) =>
      transaction(() async {
        final companions = <VpnNodesCompanion>[
          for (final node in nodes)
            _nodeToCompanion(
              node,
              fetchedAtMs: DateTime.now().toUtc().millisecondsSinceEpoch,
            ),
        ];
        await batch((batch) {
          batch.insertAllOnConflictUpdate(vpnNodes, companions);
        });
        final keepIds = <String>[for (final node in nodes) node.id];
        await (delete(vpnNodes)..where((tbl) => tbl.id.isNotIn(keepIds))).go();
      });

  /// Loads cached nodes, highest fitness first.
  ///
  /// When `withConfig` is false the sanitized OpenVPN payload is blanked so
  /// list pages stay small; pass `true` only to prepare a tunnel start.
  Future<List<VpnNodeRow>> loadNodes({
    String? countryCode,
    bool? withConfig,
    int? limit,
  }) {
    final query = select(vpnNodes);
    if (countryCode != null) {
      query.where(
        (tbl) => tbl.countryShort.upper().equals(countryCode.toUpperCase()),
      );
    }
    query.orderBy([(tbl) => OrderingTerm.desc(tbl.fitnessScore)]);
    if (limit != null) {
      query.limit(limit);
    }
    return query.get().then((rows) {
      if (withConfig ?? false) {
        return rows;
      }
      return <VpnNodeRow>[
        for (final row in rows)
          row.copyWith(ovpnConfigRaw: ''),
      ];
    });
  }
}

VpnNodesCompanion _nodeToCompanion(VpnNode node, {required int fetchedAtMs}) {
  return VpnNodesCompanion.insert(
    id: node.id,
    hostName: node.hostName,
    ip: node.ip,
    port: node.port,
    transportProto: node.transportProto == VpnTransport.udp ? 'udp' : 'tcp',
    score: node.score,
    pingMs: node.pingMs,
    speedBps: node.speedBps,
    countryLong: node.countryLong,
    countryShort: node.countryShort,
    numSessions: node.numSessions,
    uptimeMs: node.uptimeMs,
    operatorName: node.operatorName,
    ovpnConfigRaw: node.ovpnConfigRaw,
    protocol: node.protocol == VpnProtocol.wireguard ? 'wireguard' : 'openvpn',
    measuredRttMs: Value(node.measuredRttMs),
    fitnessScore: Value(node.fitnessScore),
    fetchedAtMs: fetchedAtMs,
  );
}

VpnNode nodeFromRow(VpnNodeRow row) {
  return VpnNode.create(
    hostName: row.hostName,
    ip: row.ip,
    port: row.port,
    transportProto:
        row.transportProto == 'tcp' ? VpnTransport.tcp : VpnTransport.udp,
    score: row.score,
    pingMs: row.pingMs,
    speedBps: row.speedBps,
    countryLong: row.countryLong,
    countryShort: row.countryShort,
    numSessions: row.numSessions,
    uptimeMs: row.uptimeMs,
    operatorName: row.operatorName,
    ovpnConfigRaw: row.ovpnConfigRaw,
    protocol: row.protocol == 'wireguard'
        ? VpnProtocol.wireguard
        : VpnProtocol.openvpn,
  );
}
