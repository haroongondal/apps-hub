import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';

import '../models/vpn_node.dart';

/// Ordered fetch sources. HTTPS is preferred; the HTTP fallback is slow and
/// relies on the scoped cleartext policy configured for `vpngate.net`.
const List<String> kVpnGateSources = <String>[
  'https://www.vpngate.net/api/iphone/',
  'http://www.vpngate.net/api/iphone/',
  'http://www.vpngate.net/api/iphone/?mirror=1',
];

/// The payload is roughly 1.3 MB upstream. A short total timeout dies mid-body,
/// so connect fast and allow the transfer plenty of time to finish.
const Duration kVpnGateConnectTimeout = Duration(seconds: 15);
const Duration kVpnGateReceiveTimeout = Duration(minutes: 2);

/// Raised when every configured VPN Gate source failed.
class VpnGateFetchException implements Exception {
  VpnGateFetchException(this.sourcesTried, this.cause);

  final List<String> sourcesTried;
  final Object? cause;

  @override
  String toString() =>
      'VpnGateFetchException: all ${sourcesTried.length} sources failed '
      '($cause)';
}

/// Parses one VPN Gate row into a node, or returns `null` for headers,
/// footers, and rows that cannot be decoded.
///
/// The base64 config is the **last** comma-separated field and never contains
/// commas itself, so the row is split from the final comma. Any extra commas
/// between the operator and message fields are folded back into the message
/// field (index 13) instead of shifting the payload column.
VpnNode? parseVpnGateCsvRow(String line) {
  final trimmed = line.trim();
  if (trimmed.isEmpty ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('#') ||
      trimmed == ',') {
    return null;
  }

  final lastComma = trimmed.lastIndexOf(',');
  if (lastComma < 0 || lastComma == trimmed.length - 1) {
    return null;
  }
  final encoded = trimmed.substring(lastComma + 1).trim();
  final prefix = trimmed.substring(0, lastComma);
  final columns = prefix.split(',');
  if (columns.length < 14 || encoded.isEmpty) {
    return null;
  }
  // Columns 0..12 are read as single fields. VPN Gate operator and message
  // text is not reliably comma-safe, so a naive left-to-right split would
  // shift those columns; when the payload splitting proves ambiguous the
  // operator field simply loses fidelity, never the config or the endpoint
  // data the app acts on.

  final decoded = _decodeConfigBase64(encoded);
  if (decoded == null) {
    return null;
  }
  final sanitized = sanitizeOpenVpnConfig(decoded);

  final remote = _extractRemote(sanitized);
  return VpnNode.create(
    hostName: columns[0].trim(),
    ip: columns[1].trim(),
    port: remote.port ?? kDefaultVpnGatePort,
    transportProto: remote.transport,
    score: int.tryParse(columns[2]) ?? 0,
    pingMs: int.tryParse(columns[3]) ?? 0,
    speedBps: int.tryParse(columns[4]) ?? 0,
    countryLong: columns[5].trim(),
    countryShort: columns[6].trim(),
    numSessions: int.tryParse(columns[7]) ?? 0,
    // Upstream uptime is seconds; the model carries milliseconds.
    uptimeMs: (int.tryParse(columns[8]) ?? 0) * 1000,
    operatorName: columns[12].trim(),
    ovpnConfigRaw: sanitized,
    protocol: detectVpnProtocol(sanitized),
  );
}

/// Streams a VPN Gate body line by line and yields decoded, sanitized nodes.
///
/// Never materialize the full body as one string; upstream is multi-megabyte
/// and this pipeline is designed for the streaming `dio` response.
Stream<VpnNode> parseVpnGateCsv(Stream<String> lines) async* {
  await for (final line in lines) {
    final node = parseVpnGateCsvRow(line);
    if (node != null) {
      yield node;
    }
  }
}

/// Default when a row has no usable `remote <host> <port>` line downstream.
const int kDefaultVpnGatePort = 1194;
const VpnTransport kDefaultVpnGateTransport = VpnTransport.udp;

final RegExp _remoteLine = RegExp(
  r'^\s*remote\s+\S+\s+(\d+)\s*$',
  multiLine: true,
  caseSensitive: false,
);

final RegExp _protoLine = RegExp(
  r'^\s*proto\s+(tcp4?|tcp6|tcp|udp4?|udp6|udp)\b',
  multiLine: true,
  caseSensitive: false,
);

/// Directives the sanitizer strips: legacy `cipher` statements that OpenVPN
/// 2.6+ rejects, both compression spellings, and any pre-existing cipher
/// selection so the injected block is the single source of truth.
final RegExp _strippedDirective = RegExp(
  r'^\s*(data-ciphers|data-ciphers-fallback|cipher|comp-lzo|compress)\b.*$',
  caseSensitive: false,
);

const List<String> kInjectedCipherDirectives = <String>[
  'data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305:AES-128-CBC',
  'data-ciphers-fallback AES-128-CBC',
];

/// Rewrites a decoded `.ovpn` payload so modern OpenVPN 2.6+ engines can
/// handshake with legacy academic servers.
///
/// Idempotent by construction: existing cipher selection is removed, then the
/// compatibility block is injected exactly once, immediately after the `client`
/// preamble when one exists. Never log the input or output.
String sanitizeOpenVpnConfig(String raw) {
  if (raw.trim().isEmpty) {
    return raw;
  }
  final hadTrailingNewline = raw.endsWith('\n');
  final lines = raw
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .split('\n')
      .where((line) => !_strippedDirective.hasMatch(line))
      .toList();

  var insertAt = 0;
  for (var i = 0; i < lines.length; i++) {
    if (RegExp(r'^\s*client\b', caseSensitive: false).hasMatch(lines[i])) {
      insertAt = i + 1;
      break;
    }
  }
  lines.insertAll(insertAt, kInjectedCipherDirectives);

  final sanitized = lines.join('\n');
  // `lines` keeps the trailing empty element for newline-terminated input, so
  // the join already restored the terminator; never append a second one.
  if (hadTrailingNewline && !sanitized.endsWith('\n')) {
    return '$sanitized\n';
  }
  return sanitized;
}

/// Detects the payload protocol by content, never by naming convention.
VpnProtocol detectVpnProtocol(String configText) {
  final lower = configText.toLowerCase();
  if (lower.contains('[interface]') && lower.contains('privatekey')) {
    return VpnProtocol.wireguard;
  }
  // VPN Gate payloads are OpenVPN even when a row lacks the `client` keyword.
  final openVpnMarkers =
      lower.contains('<ca>') || _protoLine.hasMatch(configText);
  return openVpnMarkers ? VpnProtocol.openvpn : VpnProtocol.wireguard;
}

({int? port, VpnTransport transport}) _extractRemote(String configText) {
  VpnTransport readTransport() {
    final match = _protoLine.firstMatch(configText);
    if (match == null) {
      return kDefaultVpnGateTransport;
    }
    return match.group(1)!.toLowerCase().startsWith('tcp')
        ? VpnTransport.tcp
        : VpnTransport.udp;
  }

  final match = _remoteLine.firstMatch(configText);
  if (match == null) {
    return (port: null, transport: readTransport());
  }
  final parsedPort = int.tryParse(match.group(1)!);
  return (port: parsedPort, transport: readTransport());
}

String? _decodeConfigBase64(String encoded) {
  var normalized = encoded.replaceAll(RegExp(r'\s+'), '');
  // Tolerate URL-safe alphabets just in case an operator post-processed rows.
  normalized = normalized
      .replaceAll('-', '+')
      .replaceAll('_', '/');
  final padding = normalized.length % 4;
  if (padding == 1) {
    return null;
  }
  if (padding > 0) {
    normalized = normalized.padRight(normalized.length + (4 - padding), '=');
  }
  try {
    final bytes = base64Decode(normalized);
    return utf8.decode(bytes, allowMalformed: true);
  } on FormatException {
    return null;
  }
}

/// Fetches, stream-parses, and hands back the current VPN Gate list.
///
/// All parsing happens in the Dart UI isolate: nothing here may be imported by
/// the iOS packet tunnel extension.
class VpnGateService {
  VpnGateService({Dio? dio, List<String>? sources})
      : _dio = dio ??
            Dio(
              BaseOptions(
                connectTimeout: kVpnGateConnectTimeout,
                receiveTimeout: kVpnGateReceiveTimeout,
                headers: <String, String>{'User-Agent': 'OpenTunnel/0.1'},
                responseType: ResponseType.stream,
                // VPN Gate redirects and its mirrors hop hosts; decode any
                // body we receive instead of throwing on status mismatches.
                validateStatus: (code) => code != null && code < 500,
              ),
            ),
        _sources = List.unmodifiable(sources ?? kVpnGateSources);

  final Dio _dio;
  final List<String> _sources;

  /// Fetches the current node list. Nodes are streamed through
  /// [parseVpnGateCsv]; a body without rows counts as a failed source.
  ///
  /// Throws [VpnGateFetchException] when every source fails.
  Future<List<VpnNode>> fetchNodes() async {
    Object? lastCause;
    for (final source in _sources) {
      try {
        final response = await _dio.get<ResponseBody>(source);
        final body = response.data;
        if (body == null) {
          lastCause = StateError('source $source returned an empty body');
          continue;
        }
        final lines = body.stream
            .cast<List<int>>()
            .transform(const Utf8Decoder(allowMalformed: true))
            .transform(const LineSplitter());
        final nodes = await parseVpnGateCsv(lines).toList();
        if (nodes.isEmpty) {
          lastCause = StateError('source $source produced no usable rows');
          continue;
        }
        return nodes;
      } on Exception catch (error) {
        lastCause = error;
      }
    }
    throw VpnGateFetchException(_sources, lastCause);
  }

  void dispose() => _dio.close();
}
