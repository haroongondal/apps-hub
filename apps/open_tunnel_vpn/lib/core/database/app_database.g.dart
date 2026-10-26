// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_database.dart';

// ignore_for_file: type=lint
class $VpnNodesTable extends VpnNodes
    with TableInfo<$VpnNodesTable, VpnNodeRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $VpnNodesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _hostNameMeta = const VerificationMeta(
    'hostName',
  );
  @override
  late final GeneratedColumn<String> hostName = GeneratedColumn<String>(
    'host_name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _ipMeta = const VerificationMeta('ip');
  @override
  late final GeneratedColumn<String> ip = GeneratedColumn<String>(
    'ip',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _portMeta = const VerificationMeta('port');
  @override
  late final GeneratedColumn<int> port = GeneratedColumn<int>(
    'port',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _transportProtoMeta = const VerificationMeta(
    'transportProto',
  );
  @override
  late final GeneratedColumn<String> transportProto = GeneratedColumn<String>(
    'transport_proto',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _scoreMeta = const VerificationMeta('score');
  @override
  late final GeneratedColumn<int> score = GeneratedColumn<int>(
    'score',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _pingMsMeta = const VerificationMeta('pingMs');
  @override
  late final GeneratedColumn<int> pingMs = GeneratedColumn<int>(
    'ping_ms',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _speedBpsMeta = const VerificationMeta(
    'speedBps',
  );
  @override
  late final GeneratedColumn<int> speedBps = GeneratedColumn<int>(
    'speed_bps',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _countryLongMeta = const VerificationMeta(
    'countryLong',
  );
  @override
  late final GeneratedColumn<String> countryLong = GeneratedColumn<String>(
    'country_long',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _countryShortMeta = const VerificationMeta(
    'countryShort',
  );
  @override
  late final GeneratedColumn<String> countryShort = GeneratedColumn<String>(
    'country_short',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _numSessionsMeta = const VerificationMeta(
    'numSessions',
  );
  @override
  late final GeneratedColumn<int> numSessions = GeneratedColumn<int>(
    'num_sessions',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _uptimeMsMeta = const VerificationMeta(
    'uptimeMs',
  );
  @override
  late final GeneratedColumn<int> uptimeMs = GeneratedColumn<int>(
    'uptime_ms',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _operatorNameMeta = const VerificationMeta(
    'operatorName',
  );
  @override
  late final GeneratedColumn<String> operatorName = GeneratedColumn<String>(
    'operator_name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _ovpnConfigRawMeta = const VerificationMeta(
    'ovpnConfigRaw',
  );
  @override
  late final GeneratedColumn<String> ovpnConfigRaw = GeneratedColumn<String>(
    'ovpn_config_raw',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _protocolMeta = const VerificationMeta(
    'protocol',
  );
  @override
  late final GeneratedColumn<String> protocol = GeneratedColumn<String>(
    'protocol',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _measuredRttMsMeta = const VerificationMeta(
    'measuredRttMs',
  );
  @override
  late final GeneratedColumn<int> measuredRttMs = GeneratedColumn<int>(
    'measured_rtt_ms',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _fitnessScoreMeta = const VerificationMeta(
    'fitnessScore',
  );
  @override
  late final GeneratedColumn<double> fitnessScore = GeneratedColumn<double>(
    'fitness_score',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(0.0),
  );
  static const VerificationMeta _fetchedAtMsMeta = const VerificationMeta(
    'fetchedAtMs',
  );
  @override
  late final GeneratedColumn<int> fetchedAtMs = GeneratedColumn<int>(
    'fetched_at_ms',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _probedAtMsMeta = const VerificationMeta(
    'probedAtMs',
  );
  @override
  late final GeneratedColumn<int> probedAtMs = GeneratedColumn<int>(
    'probed_at_ms',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    hostName,
    ip,
    port,
    transportProto,
    score,
    pingMs,
    speedBps,
    countryLong,
    countryShort,
    numSessions,
    uptimeMs,
    operatorName,
    ovpnConfigRaw,
    protocol,
    measuredRttMs,
    fitnessScore,
    fetchedAtMs,
    probedAtMs,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'vpn_nodes';
  @override
  VerificationContext validateIntegrity(
    Insertable<VpnNodeRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('host_name')) {
      context.handle(
        _hostNameMeta,
        hostName.isAcceptableOrUnknown(data['host_name']!, _hostNameMeta),
      );
    } else if (isInserting) {
      context.missing(_hostNameMeta);
    }
    if (data.containsKey('ip')) {
      context.handle(_ipMeta, ip.isAcceptableOrUnknown(data['ip']!, _ipMeta));
    } else if (isInserting) {
      context.missing(_ipMeta);
    }
    if (data.containsKey('port')) {
      context.handle(
        _portMeta,
        port.isAcceptableOrUnknown(data['port']!, _portMeta),
      );
    } else if (isInserting) {
      context.missing(_portMeta);
    }
    if (data.containsKey('transport_proto')) {
      context.handle(
        _transportProtoMeta,
        transportProto.isAcceptableOrUnknown(
          data['transport_proto']!,
          _transportProtoMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_transportProtoMeta);
    }
    if (data.containsKey('score')) {
      context.handle(
        _scoreMeta,
        score.isAcceptableOrUnknown(data['score']!, _scoreMeta),
      );
    } else if (isInserting) {
      context.missing(_scoreMeta);
    }
    if (data.containsKey('ping_ms')) {
      context.handle(
        _pingMsMeta,
        pingMs.isAcceptableOrUnknown(data['ping_ms']!, _pingMsMeta),
      );
    } else if (isInserting) {
      context.missing(_pingMsMeta);
    }
    if (data.containsKey('speed_bps')) {
      context.handle(
        _speedBpsMeta,
        speedBps.isAcceptableOrUnknown(data['speed_bps']!, _speedBpsMeta),
      );
    } else if (isInserting) {
      context.missing(_speedBpsMeta);
    }
    if (data.containsKey('country_long')) {
      context.handle(
        _countryLongMeta,
        countryLong.isAcceptableOrUnknown(
          data['country_long']!,
          _countryLongMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_countryLongMeta);
    }
    if (data.containsKey('country_short')) {
      context.handle(
        _countryShortMeta,
        countryShort.isAcceptableOrUnknown(
          data['country_short']!,
          _countryShortMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_countryShortMeta);
    }
    if (data.containsKey('num_sessions')) {
      context.handle(
        _numSessionsMeta,
        numSessions.isAcceptableOrUnknown(
          data['num_sessions']!,
          _numSessionsMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_numSessionsMeta);
    }
    if (data.containsKey('uptime_ms')) {
      context.handle(
        _uptimeMsMeta,
        uptimeMs.isAcceptableOrUnknown(data['uptime_ms']!, _uptimeMsMeta),
      );
    } else if (isInserting) {
      context.missing(_uptimeMsMeta);
    }
    if (data.containsKey('operator_name')) {
      context.handle(
        _operatorNameMeta,
        operatorName.isAcceptableOrUnknown(
          data['operator_name']!,
          _operatorNameMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_operatorNameMeta);
    }
    if (data.containsKey('ovpn_config_raw')) {
      context.handle(
        _ovpnConfigRawMeta,
        ovpnConfigRaw.isAcceptableOrUnknown(
          data['ovpn_config_raw']!,
          _ovpnConfigRawMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_ovpnConfigRawMeta);
    }
    if (data.containsKey('protocol')) {
      context.handle(
        _protocolMeta,
        protocol.isAcceptableOrUnknown(data['protocol']!, _protocolMeta),
      );
    } else if (isInserting) {
      context.missing(_protocolMeta);
    }
    if (data.containsKey('measured_rtt_ms')) {
      context.handle(
        _measuredRttMsMeta,
        measuredRttMs.isAcceptableOrUnknown(
          data['measured_rtt_ms']!,
          _measuredRttMsMeta,
        ),
      );
    }
    if (data.containsKey('fitness_score')) {
      context.handle(
        _fitnessScoreMeta,
        fitnessScore.isAcceptableOrUnknown(
          data['fitness_score']!,
          _fitnessScoreMeta,
        ),
      );
    }
    if (data.containsKey('fetched_at_ms')) {
      context.handle(
        _fetchedAtMsMeta,
        fetchedAtMs.isAcceptableOrUnknown(
          data['fetched_at_ms']!,
          _fetchedAtMsMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_fetchedAtMsMeta);
    }
    if (data.containsKey('probed_at_ms')) {
      context.handle(
        _probedAtMsMeta,
        probedAtMs.isAcceptableOrUnknown(
          data['probed_at_ms']!,
          _probedAtMsMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  VpnNodeRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return VpnNodeRow(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      hostName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}host_name'],
      )!,
      ip: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}ip'],
      )!,
      port: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}port'],
      )!,
      transportProto: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}transport_proto'],
      )!,
      score: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}score'],
      )!,
      pingMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}ping_ms'],
      )!,
      speedBps: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}speed_bps'],
      )!,
      countryLong: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}country_long'],
      )!,
      countryShort: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}country_short'],
      )!,
      numSessions: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}num_sessions'],
      )!,
      uptimeMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}uptime_ms'],
      )!,
      operatorName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}operator_name'],
      )!,
      ovpnConfigRaw: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}ovpn_config_raw'],
      )!,
      protocol: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}protocol'],
      )!,
      measuredRttMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}measured_rtt_ms'],
      ),
      fitnessScore: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}fitness_score'],
      )!,
      fetchedAtMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}fetched_at_ms'],
      )!,
      probedAtMs: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}probed_at_ms'],
      ),
    );
  }

  @override
  $VpnNodesTable createAlias(String alias) {
    return $VpnNodesTable(attachedDatabase, alias);
  }
}

class VpnNodeRow extends DataClass implements Insertable<VpnNodeRow> {
  final String id;
  final String hostName;
  final String ip;
  final int port;
  final String transportProto;
  final int score;
  final int pingMs;
  final int speedBps;
  final String countryLong;
  final String countryShort;
  final int numSessions;
  final int uptimeMs;
  final String operatorName;
  final String ovpnConfigRaw;
  final String protocol;
  final int? measuredRttMs;
  final double fitnessScore;

  /// UTC epoch milliseconds of the most recent refresh that wrote this row.
  final int fetchedAtMs;

  /// UTC epoch milliseconds of the last successful latency probe, or `null`.
  final int? probedAtMs;
  const VpnNodeRow({
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
    required this.protocol,
    this.measuredRttMs,
    required this.fitnessScore,
    required this.fetchedAtMs,
    this.probedAtMs,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['host_name'] = Variable<String>(hostName);
    map['ip'] = Variable<String>(ip);
    map['port'] = Variable<int>(port);
    map['transport_proto'] = Variable<String>(transportProto);
    map['score'] = Variable<int>(score);
    map['ping_ms'] = Variable<int>(pingMs);
    map['speed_bps'] = Variable<int>(speedBps);
    map['country_long'] = Variable<String>(countryLong);
    map['country_short'] = Variable<String>(countryShort);
    map['num_sessions'] = Variable<int>(numSessions);
    map['uptime_ms'] = Variable<int>(uptimeMs);
    map['operator_name'] = Variable<String>(operatorName);
    map['ovpn_config_raw'] = Variable<String>(ovpnConfigRaw);
    map['protocol'] = Variable<String>(protocol);
    if (!nullToAbsent || measuredRttMs != null) {
      map['measured_rtt_ms'] = Variable<int>(measuredRttMs);
    }
    map['fitness_score'] = Variable<double>(fitnessScore);
    map['fetched_at_ms'] = Variable<int>(fetchedAtMs);
    if (!nullToAbsent || probedAtMs != null) {
      map['probed_at_ms'] = Variable<int>(probedAtMs);
    }
    return map;
  }

  VpnNodesCompanion toCompanion(bool nullToAbsent) {
    return VpnNodesCompanion(
      id: Value(id),
      hostName: Value(hostName),
      ip: Value(ip),
      port: Value(port),
      transportProto: Value(transportProto),
      score: Value(score),
      pingMs: Value(pingMs),
      speedBps: Value(speedBps),
      countryLong: Value(countryLong),
      countryShort: Value(countryShort),
      numSessions: Value(numSessions),
      uptimeMs: Value(uptimeMs),
      operatorName: Value(operatorName),
      ovpnConfigRaw: Value(ovpnConfigRaw),
      protocol: Value(protocol),
      measuredRttMs: measuredRttMs == null && nullToAbsent
          ? const Value.absent()
          : Value(measuredRttMs),
      fitnessScore: Value(fitnessScore),
      fetchedAtMs: Value(fetchedAtMs),
      probedAtMs: probedAtMs == null && nullToAbsent
          ? const Value.absent()
          : Value(probedAtMs),
    );
  }

  factory VpnNodeRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return VpnNodeRow(
      id: serializer.fromJson<String>(json['id']),
      hostName: serializer.fromJson<String>(json['hostName']),
      ip: serializer.fromJson<String>(json['ip']),
      port: serializer.fromJson<int>(json['port']),
      transportProto: serializer.fromJson<String>(json['transportProto']),
      score: serializer.fromJson<int>(json['score']),
      pingMs: serializer.fromJson<int>(json['pingMs']),
      speedBps: serializer.fromJson<int>(json['speedBps']),
      countryLong: serializer.fromJson<String>(json['countryLong']),
      countryShort: serializer.fromJson<String>(json['countryShort']),
      numSessions: serializer.fromJson<int>(json['numSessions']),
      uptimeMs: serializer.fromJson<int>(json['uptimeMs']),
      operatorName: serializer.fromJson<String>(json['operatorName']),
      ovpnConfigRaw: serializer.fromJson<String>(json['ovpnConfigRaw']),
      protocol: serializer.fromJson<String>(json['protocol']),
      measuredRttMs: serializer.fromJson<int?>(json['measuredRttMs']),
      fitnessScore: serializer.fromJson<double>(json['fitnessScore']),
      fetchedAtMs: serializer.fromJson<int>(json['fetchedAtMs']),
      probedAtMs: serializer.fromJson<int?>(json['probedAtMs']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'hostName': serializer.toJson<String>(hostName),
      'ip': serializer.toJson<String>(ip),
      'port': serializer.toJson<int>(port),
      'transportProto': serializer.toJson<String>(transportProto),
      'score': serializer.toJson<int>(score),
      'pingMs': serializer.toJson<int>(pingMs),
      'speedBps': serializer.toJson<int>(speedBps),
      'countryLong': serializer.toJson<String>(countryLong),
      'countryShort': serializer.toJson<String>(countryShort),
      'numSessions': serializer.toJson<int>(numSessions),
      'uptimeMs': serializer.toJson<int>(uptimeMs),
      'operatorName': serializer.toJson<String>(operatorName),
      'ovpnConfigRaw': serializer.toJson<String>(ovpnConfigRaw),
      'protocol': serializer.toJson<String>(protocol),
      'measuredRttMs': serializer.toJson<int?>(measuredRttMs),
      'fitnessScore': serializer.toJson<double>(fitnessScore),
      'fetchedAtMs': serializer.toJson<int>(fetchedAtMs),
      'probedAtMs': serializer.toJson<int?>(probedAtMs),
    };
  }

  VpnNodeRow copyWith({
    String? id,
    String? hostName,
    String? ip,
    int? port,
    String? transportProto,
    int? score,
    int? pingMs,
    int? speedBps,
    String? countryLong,
    String? countryShort,
    int? numSessions,
    int? uptimeMs,
    String? operatorName,
    String? ovpnConfigRaw,
    String? protocol,
    Value<int?> measuredRttMs = const Value.absent(),
    double? fitnessScore,
    int? fetchedAtMs,
    Value<int?> probedAtMs = const Value.absent(),
  }) => VpnNodeRow(
    id: id ?? this.id,
    hostName: hostName ?? this.hostName,
    ip: ip ?? this.ip,
    port: port ?? this.port,
    transportProto: transportProto ?? this.transportProto,
    score: score ?? this.score,
    pingMs: pingMs ?? this.pingMs,
    speedBps: speedBps ?? this.speedBps,
    countryLong: countryLong ?? this.countryLong,
    countryShort: countryShort ?? this.countryShort,
    numSessions: numSessions ?? this.numSessions,
    uptimeMs: uptimeMs ?? this.uptimeMs,
    operatorName: operatorName ?? this.operatorName,
    ovpnConfigRaw: ovpnConfigRaw ?? this.ovpnConfigRaw,
    protocol: protocol ?? this.protocol,
    measuredRttMs: measuredRttMs.present
        ? measuredRttMs.value
        : this.measuredRttMs,
    fitnessScore: fitnessScore ?? this.fitnessScore,
    fetchedAtMs: fetchedAtMs ?? this.fetchedAtMs,
    probedAtMs: probedAtMs.present ? probedAtMs.value : this.probedAtMs,
  );
  VpnNodeRow copyWithCompanion(VpnNodesCompanion data) {
    return VpnNodeRow(
      id: data.id.present ? data.id.value : this.id,
      hostName: data.hostName.present ? data.hostName.value : this.hostName,
      ip: data.ip.present ? data.ip.value : this.ip,
      port: data.port.present ? data.port.value : this.port,
      transportProto: data.transportProto.present
          ? data.transportProto.value
          : this.transportProto,
      score: data.score.present ? data.score.value : this.score,
      pingMs: data.pingMs.present ? data.pingMs.value : this.pingMs,
      speedBps: data.speedBps.present ? data.speedBps.value : this.speedBps,
      countryLong: data.countryLong.present
          ? data.countryLong.value
          : this.countryLong,
      countryShort: data.countryShort.present
          ? data.countryShort.value
          : this.countryShort,
      numSessions: data.numSessions.present
          ? data.numSessions.value
          : this.numSessions,
      uptimeMs: data.uptimeMs.present ? data.uptimeMs.value : this.uptimeMs,
      operatorName: data.operatorName.present
          ? data.operatorName.value
          : this.operatorName,
      ovpnConfigRaw: data.ovpnConfigRaw.present
          ? data.ovpnConfigRaw.value
          : this.ovpnConfigRaw,
      protocol: data.protocol.present ? data.protocol.value : this.protocol,
      measuredRttMs: data.measuredRttMs.present
          ? data.measuredRttMs.value
          : this.measuredRttMs,
      fitnessScore: data.fitnessScore.present
          ? data.fitnessScore.value
          : this.fitnessScore,
      fetchedAtMs: data.fetchedAtMs.present
          ? data.fetchedAtMs.value
          : this.fetchedAtMs,
      probedAtMs: data.probedAtMs.present
          ? data.probedAtMs.value
          : this.probedAtMs,
    );
  }

  @override
  String toString() {
    return (StringBuffer('VpnNodeRow(')
          ..write('id: $id, ')
          ..write('hostName: $hostName, ')
          ..write('ip: $ip, ')
          ..write('port: $port, ')
          ..write('transportProto: $transportProto, ')
          ..write('score: $score, ')
          ..write('pingMs: $pingMs, ')
          ..write('speedBps: $speedBps, ')
          ..write('countryLong: $countryLong, ')
          ..write('countryShort: $countryShort, ')
          ..write('numSessions: $numSessions, ')
          ..write('uptimeMs: $uptimeMs, ')
          ..write('operatorName: $operatorName, ')
          ..write('ovpnConfigRaw: $ovpnConfigRaw, ')
          ..write('protocol: $protocol, ')
          ..write('measuredRttMs: $measuredRttMs, ')
          ..write('fitnessScore: $fitnessScore, ')
          ..write('fetchedAtMs: $fetchedAtMs, ')
          ..write('probedAtMs: $probedAtMs')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    hostName,
    ip,
    port,
    transportProto,
    score,
    pingMs,
    speedBps,
    countryLong,
    countryShort,
    numSessions,
    uptimeMs,
    operatorName,
    ovpnConfigRaw,
    protocol,
    measuredRttMs,
    fitnessScore,
    fetchedAtMs,
    probedAtMs,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is VpnNodeRow &&
          other.id == this.id &&
          other.hostName == this.hostName &&
          other.ip == this.ip &&
          other.port == this.port &&
          other.transportProto == this.transportProto &&
          other.score == this.score &&
          other.pingMs == this.pingMs &&
          other.speedBps == this.speedBps &&
          other.countryLong == this.countryLong &&
          other.countryShort == this.countryShort &&
          other.numSessions == this.numSessions &&
          other.uptimeMs == this.uptimeMs &&
          other.operatorName == this.operatorName &&
          other.ovpnConfigRaw == this.ovpnConfigRaw &&
          other.protocol == this.protocol &&
          other.measuredRttMs == this.measuredRttMs &&
          other.fitnessScore == this.fitnessScore &&
          other.fetchedAtMs == this.fetchedAtMs &&
          other.probedAtMs == this.probedAtMs);
}

class VpnNodesCompanion extends UpdateCompanion<VpnNodeRow> {
  final Value<String> id;
  final Value<String> hostName;
  final Value<String> ip;
  final Value<int> port;
  final Value<String> transportProto;
  final Value<int> score;
  final Value<int> pingMs;
  final Value<int> speedBps;
  final Value<String> countryLong;
  final Value<String> countryShort;
  final Value<int> numSessions;
  final Value<int> uptimeMs;
  final Value<String> operatorName;
  final Value<String> ovpnConfigRaw;
  final Value<String> protocol;
  final Value<int?> measuredRttMs;
  final Value<double> fitnessScore;
  final Value<int> fetchedAtMs;
  final Value<int?> probedAtMs;
  final Value<int> rowid;
  const VpnNodesCompanion({
    this.id = const Value.absent(),
    this.hostName = const Value.absent(),
    this.ip = const Value.absent(),
    this.port = const Value.absent(),
    this.transportProto = const Value.absent(),
    this.score = const Value.absent(),
    this.pingMs = const Value.absent(),
    this.speedBps = const Value.absent(),
    this.countryLong = const Value.absent(),
    this.countryShort = const Value.absent(),
    this.numSessions = const Value.absent(),
    this.uptimeMs = const Value.absent(),
    this.operatorName = const Value.absent(),
    this.ovpnConfigRaw = const Value.absent(),
    this.protocol = const Value.absent(),
    this.measuredRttMs = const Value.absent(),
    this.fitnessScore = const Value.absent(),
    this.fetchedAtMs = const Value.absent(),
    this.probedAtMs = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  VpnNodesCompanion.insert({
    required String id,
    required String hostName,
    required String ip,
    required int port,
    required String transportProto,
    required int score,
    required int pingMs,
    required int speedBps,
    required String countryLong,
    required String countryShort,
    required int numSessions,
    required int uptimeMs,
    required String operatorName,
    required String ovpnConfigRaw,
    required String protocol,
    this.measuredRttMs = const Value.absent(),
    this.fitnessScore = const Value.absent(),
    required int fetchedAtMs,
    this.probedAtMs = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       hostName = Value(hostName),
       ip = Value(ip),
       port = Value(port),
       transportProto = Value(transportProto),
       score = Value(score),
       pingMs = Value(pingMs),
       speedBps = Value(speedBps),
       countryLong = Value(countryLong),
       countryShort = Value(countryShort),
       numSessions = Value(numSessions),
       uptimeMs = Value(uptimeMs),
       operatorName = Value(operatorName),
       ovpnConfigRaw = Value(ovpnConfigRaw),
       protocol = Value(protocol),
       fetchedAtMs = Value(fetchedAtMs);
  static Insertable<VpnNodeRow> custom({
    Expression<String>? id,
    Expression<String>? hostName,
    Expression<String>? ip,
    Expression<int>? port,
    Expression<String>? transportProto,
    Expression<int>? score,
    Expression<int>? pingMs,
    Expression<int>? speedBps,
    Expression<String>? countryLong,
    Expression<String>? countryShort,
    Expression<int>? numSessions,
    Expression<int>? uptimeMs,
    Expression<String>? operatorName,
    Expression<String>? ovpnConfigRaw,
    Expression<String>? protocol,
    Expression<int>? measuredRttMs,
    Expression<double>? fitnessScore,
    Expression<int>? fetchedAtMs,
    Expression<int>? probedAtMs,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (hostName != null) 'host_name': hostName,
      if (ip != null) 'ip': ip,
      if (port != null) 'port': port,
      if (transportProto != null) 'transport_proto': transportProto,
      if (score != null) 'score': score,
      if (pingMs != null) 'ping_ms': pingMs,
      if (speedBps != null) 'speed_bps': speedBps,
      if (countryLong != null) 'country_long': countryLong,
      if (countryShort != null) 'country_short': countryShort,
      if (numSessions != null) 'num_sessions': numSessions,
      if (uptimeMs != null) 'uptime_ms': uptimeMs,
      if (operatorName != null) 'operator_name': operatorName,
      if (ovpnConfigRaw != null) 'ovpn_config_raw': ovpnConfigRaw,
      if (protocol != null) 'protocol': protocol,
      if (measuredRttMs != null) 'measured_rtt_ms': measuredRttMs,
      if (fitnessScore != null) 'fitness_score': fitnessScore,
      if (fetchedAtMs != null) 'fetched_at_ms': fetchedAtMs,
      if (probedAtMs != null) 'probed_at_ms': probedAtMs,
      if (rowid != null) 'rowid': rowid,
    });
  }

  VpnNodesCompanion copyWith({
    Value<String>? id,
    Value<String>? hostName,
    Value<String>? ip,
    Value<int>? port,
    Value<String>? transportProto,
    Value<int>? score,
    Value<int>? pingMs,
    Value<int>? speedBps,
    Value<String>? countryLong,
    Value<String>? countryShort,
    Value<int>? numSessions,
    Value<int>? uptimeMs,
    Value<String>? operatorName,
    Value<String>? ovpnConfigRaw,
    Value<String>? protocol,
    Value<int?>? measuredRttMs,
    Value<double>? fitnessScore,
    Value<int>? fetchedAtMs,
    Value<int?>? probedAtMs,
    Value<int>? rowid,
  }) {
    return VpnNodesCompanion(
      id: id ?? this.id,
      hostName: hostName ?? this.hostName,
      ip: ip ?? this.ip,
      port: port ?? this.port,
      transportProto: transportProto ?? this.transportProto,
      score: score ?? this.score,
      pingMs: pingMs ?? this.pingMs,
      speedBps: speedBps ?? this.speedBps,
      countryLong: countryLong ?? this.countryLong,
      countryShort: countryShort ?? this.countryShort,
      numSessions: numSessions ?? this.numSessions,
      uptimeMs: uptimeMs ?? this.uptimeMs,
      operatorName: operatorName ?? this.operatorName,
      ovpnConfigRaw: ovpnConfigRaw ?? this.ovpnConfigRaw,
      protocol: protocol ?? this.protocol,
      measuredRttMs: measuredRttMs ?? this.measuredRttMs,
      fitnessScore: fitnessScore ?? this.fitnessScore,
      fetchedAtMs: fetchedAtMs ?? this.fetchedAtMs,
      probedAtMs: probedAtMs ?? this.probedAtMs,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (hostName.present) {
      map['host_name'] = Variable<String>(hostName.value);
    }
    if (ip.present) {
      map['ip'] = Variable<String>(ip.value);
    }
    if (port.present) {
      map['port'] = Variable<int>(port.value);
    }
    if (transportProto.present) {
      map['transport_proto'] = Variable<String>(transportProto.value);
    }
    if (score.present) {
      map['score'] = Variable<int>(score.value);
    }
    if (pingMs.present) {
      map['ping_ms'] = Variable<int>(pingMs.value);
    }
    if (speedBps.present) {
      map['speed_bps'] = Variable<int>(speedBps.value);
    }
    if (countryLong.present) {
      map['country_long'] = Variable<String>(countryLong.value);
    }
    if (countryShort.present) {
      map['country_short'] = Variable<String>(countryShort.value);
    }
    if (numSessions.present) {
      map['num_sessions'] = Variable<int>(numSessions.value);
    }
    if (uptimeMs.present) {
      map['uptime_ms'] = Variable<int>(uptimeMs.value);
    }
    if (operatorName.present) {
      map['operator_name'] = Variable<String>(operatorName.value);
    }
    if (ovpnConfigRaw.present) {
      map['ovpn_config_raw'] = Variable<String>(ovpnConfigRaw.value);
    }
    if (protocol.present) {
      map['protocol'] = Variable<String>(protocol.value);
    }
    if (measuredRttMs.present) {
      map['measured_rtt_ms'] = Variable<int>(measuredRttMs.value);
    }
    if (fitnessScore.present) {
      map['fitness_score'] = Variable<double>(fitnessScore.value);
    }
    if (fetchedAtMs.present) {
      map['fetched_at_ms'] = Variable<int>(fetchedAtMs.value);
    }
    if (probedAtMs.present) {
      map['probed_at_ms'] = Variable<int>(probedAtMs.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('VpnNodesCompanion(')
          ..write('id: $id, ')
          ..write('hostName: $hostName, ')
          ..write('ip: $ip, ')
          ..write('port: $port, ')
          ..write('transportProto: $transportProto, ')
          ..write('score: $score, ')
          ..write('pingMs: $pingMs, ')
          ..write('speedBps: $speedBps, ')
          ..write('countryLong: $countryLong, ')
          ..write('countryShort: $countryShort, ')
          ..write('numSessions: $numSessions, ')
          ..write('uptimeMs: $uptimeMs, ')
          ..write('operatorName: $operatorName, ')
          ..write('ovpnConfigRaw: $ovpnConfigRaw, ')
          ..write('protocol: $protocol, ')
          ..write('measuredRttMs: $measuredRttMs, ')
          ..write('fitnessScore: $fitnessScore, ')
          ..write('fetchedAtMs: $fetchedAtMs, ')
          ..write('probedAtMs: $probedAtMs, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $VpnNodesTable vpnNodes = $VpnNodesTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [vpnNodes];
}

typedef $$VpnNodesTableCreateCompanionBuilder = VpnNodesCompanion Function({
  required String id,
  required String hostName,
  required String ip,
  required int port,
  required String transportProto,
  required int score,
  required int pingMs,
  required int speedBps,
  required String countryLong,
  required String countryShort,
  required int numSessions,
  required int uptimeMs,
  required String operatorName,
  required String ovpnConfigRaw,
  required String protocol,
  Value<int?> measuredRttMs,
  Value<double> fitnessScore,
  required int fetchedAtMs,
  Value<int?> probedAtMs,
  Value<int> rowid,
});
typedef $$VpnNodesTableUpdateCompanionBuilder = VpnNodesCompanion Function({
  Value<String> id,
  Value<String> hostName,
  Value<String> ip,
  Value<int> port,
  Value<String> transportProto,
  Value<int> score,
  Value<int> pingMs,
  Value<int> speedBps,
  Value<String> countryLong,
  Value<String> countryShort,
  Value<int> numSessions,
  Value<int> uptimeMs,
  Value<String> operatorName,
  Value<String> ovpnConfigRaw,
  Value<String> protocol,
  Value<int?> measuredRttMs,
  Value<double> fitnessScore,
  Value<int> fetchedAtMs,
  Value<int?> probedAtMs,
  Value<int> rowid,
});

class $$VpnNodesTableFilterComposer
    extends Composer<_$AppDatabase, $VpnNodesTable> {
  $$VpnNodesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get hostName => $composableBuilder(
    column: $table.hostName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get ip => $composableBuilder(
    column: $table.ip,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get port => $composableBuilder(
    column: $table.port,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get transportProto => $composableBuilder(
    column: $table.transportProto,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get score => $composableBuilder(
    column: $table.score,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get pingMs => $composableBuilder(
    column: $table.pingMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get speedBps => $composableBuilder(
    column: $table.speedBps,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get countryLong => $composableBuilder(
    column: $table.countryLong,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get countryShort => $composableBuilder(
    column: $table.countryShort,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get numSessions => $composableBuilder(
    column: $table.numSessions,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get uptimeMs => $composableBuilder(
    column: $table.uptimeMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get operatorName => $composableBuilder(
    column: $table.operatorName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get ovpnConfigRaw => $composableBuilder(
    column: $table.ovpnConfigRaw,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get protocol => $composableBuilder(
    column: $table.protocol,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get measuredRttMs => $composableBuilder(
    column: $table.measuredRttMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get fitnessScore => $composableBuilder(
    column: $table.fitnessScore,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get fetchedAtMs => $composableBuilder(
    column: $table.fetchedAtMs,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get probedAtMs => $composableBuilder(
    column: $table.probedAtMs,
    builder: (column) => ColumnFilters(column),
  );
}

class $$VpnNodesTableOrderingComposer
    extends Composer<_$AppDatabase, $VpnNodesTable> {
  $$VpnNodesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get hostName => $composableBuilder(
    column: $table.hostName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get ip => $composableBuilder(
    column: $table.ip,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get port => $composableBuilder(
    column: $table.port,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get transportProto => $composableBuilder(
    column: $table.transportProto,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get score => $composableBuilder(
    column: $table.score,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get pingMs => $composableBuilder(
    column: $table.pingMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get speedBps => $composableBuilder(
    column: $table.speedBps,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get countryLong => $composableBuilder(
    column: $table.countryLong,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get countryShort => $composableBuilder(
    column: $table.countryShort,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get numSessions => $composableBuilder(
    column: $table.numSessions,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get uptimeMs => $composableBuilder(
    column: $table.uptimeMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get operatorName => $composableBuilder(
    column: $table.operatorName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get ovpnConfigRaw => $composableBuilder(
    column: $table.ovpnConfigRaw,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get protocol => $composableBuilder(
    column: $table.protocol,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get measuredRttMs => $composableBuilder(
    column: $table.measuredRttMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get fitnessScore => $composableBuilder(
    column: $table.fitnessScore,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get fetchedAtMs => $composableBuilder(
    column: $table.fetchedAtMs,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get probedAtMs => $composableBuilder(
    column: $table.probedAtMs,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$VpnNodesTableAnnotationComposer
    extends Composer<_$AppDatabase, $VpnNodesTable> {
  $$VpnNodesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get hostName =>
      $composableBuilder(column: $table.hostName, builder: (column) => column);

  GeneratedColumn<String> get ip =>
      $composableBuilder(column: $table.ip, builder: (column) => column);

  GeneratedColumn<int> get port =>
      $composableBuilder(column: $table.port, builder: (column) => column);

  GeneratedColumn<String> get transportProto => $composableBuilder(
    column: $table.transportProto,
    builder: (column) => column,
  );

  GeneratedColumn<int> get score =>
      $composableBuilder(column: $table.score, builder: (column) => column);

  GeneratedColumn<int> get pingMs =>
      $composableBuilder(column: $table.pingMs, builder: (column) => column);

  GeneratedColumn<int> get speedBps =>
      $composableBuilder(column: $table.speedBps, builder: (column) => column);

  GeneratedColumn<String> get countryLong => $composableBuilder(
    column: $table.countryLong,
    builder: (column) => column,
  );

  GeneratedColumn<String> get countryShort => $composableBuilder(
    column: $table.countryShort,
    builder: (column) => column,
  );

  GeneratedColumn<int> get numSessions => $composableBuilder(
    column: $table.numSessions,
    builder: (column) => column,
  );

  GeneratedColumn<int> get uptimeMs =>
      $composableBuilder(column: $table.uptimeMs, builder: (column) => column);

  GeneratedColumn<String> get operatorName => $composableBuilder(
    column: $table.operatorName,
    builder: (column) => column,
  );

  GeneratedColumn<String> get ovpnConfigRaw => $composableBuilder(
    column: $table.ovpnConfigRaw,
    builder: (column) => column,
  );

  GeneratedColumn<String> get protocol =>
      $composableBuilder(column: $table.protocol, builder: (column) => column);

  GeneratedColumn<int> get measuredRttMs => $composableBuilder(
    column: $table.measuredRttMs,
    builder: (column) => column,
  );

  GeneratedColumn<double> get fitnessScore => $composableBuilder(
    column: $table.fitnessScore,
    builder: (column) => column,
  );

  GeneratedColumn<int> get fetchedAtMs => $composableBuilder(
    column: $table.fetchedAtMs,
    builder: (column) => column,
  );

  GeneratedColumn<int> get probedAtMs => $composableBuilder(
    column: $table.probedAtMs,
    builder: (column) => column,
  );
}

class $$VpnNodesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $VpnNodesTable,
          VpnNodeRow,
          $$VpnNodesTableFilterComposer,
          $$VpnNodesTableOrderingComposer,
          $$VpnNodesTableAnnotationComposer,
          $$VpnNodesTableCreateCompanionBuilder,
          $$VpnNodesTableUpdateCompanionBuilder,
          (
            VpnNodeRow,
            BaseReferences<_$AppDatabase, $VpnNodesTable, VpnNodeRow>,
          ),
          VpnNodeRow,
          PrefetchHooks Function()
        > {
  $$VpnNodesTableTableManager(_$AppDatabase db, $VpnNodesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$VpnNodesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$VpnNodesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$VpnNodesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> hostName = const Value.absent(),
                Value<String> ip = const Value.absent(),
                Value<int> port = const Value.absent(),
                Value<String> transportProto = const Value.absent(),
                Value<int> score = const Value.absent(),
                Value<int> pingMs = const Value.absent(),
                Value<int> speedBps = const Value.absent(),
                Value<String> countryLong = const Value.absent(),
                Value<String> countryShort = const Value.absent(),
                Value<int> numSessions = const Value.absent(),
                Value<int> uptimeMs = const Value.absent(),
                Value<String> operatorName = const Value.absent(),
                Value<String> ovpnConfigRaw = const Value.absent(),
                Value<String> protocol = const Value.absent(),
                Value<int?> measuredRttMs = const Value.absent(),
                Value<double> fitnessScore = const Value.absent(),
                Value<int> fetchedAtMs = const Value.absent(),
                Value<int?> probedAtMs = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => VpnNodesCompanion(
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
                measuredRttMs: measuredRttMs,
                fitnessScore: fitnessScore,
                fetchedAtMs: fetchedAtMs,
                probedAtMs: probedAtMs,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String hostName,
                required String ip,
                required int port,
                required String transportProto,
                required int score,
                required int pingMs,
                required int speedBps,
                required String countryLong,
                required String countryShort,
                required int numSessions,
                required int uptimeMs,
                required String operatorName,
                required String ovpnConfigRaw,
                required String protocol,
                Value<int?> measuredRttMs = const Value.absent(),
                Value<double> fitnessScore = const Value.absent(),
                required int fetchedAtMs,
                Value<int?> probedAtMs = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => VpnNodesCompanion.insert(
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
                measuredRttMs: measuredRttMs,
                fitnessScore: fitnessScore,
                fetchedAtMs: fetchedAtMs,
                probedAtMs: probedAtMs,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$VpnNodesTable, VpnNodeRow>(table),
                  BaseReferences<_$AppDatabase, $VpnNodesTable, VpnNodeRow>(
                    db,
                    table,
                    e,
                  ),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$VpnNodesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $VpnNodesTable,
      VpnNodeRow,
      $$VpnNodesTableFilterComposer,
      $$VpnNodesTableOrderingComposer,
      $$VpnNodesTableAnnotationComposer,
      $$VpnNodesTableCreateCompanionBuilder,
      $$VpnNodesTableUpdateCompanionBuilder,
      (VpnNodeRow, BaseReferences<_$AppDatabase, $VpnNodesTable, VpnNodeRow>),
      VpnNodeRow,
      PrefetchHooks Function()
    >;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$VpnNodesTableTableManager get vpnNodes =>
      $$VpnNodesTableTableManager(_db, _db.vpnNodes);
}
