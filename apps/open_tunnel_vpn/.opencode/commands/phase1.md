---
description: Phase 1 — VPN Gate ingestion, CSV stream parser, OVPN sanitizer, TCP scorer
---

Read `AGENTS.md` and follow every rule in it. Implement Phase 1 completely.
Do not stop at a plan: create the files, run the commands, and fix failures.

## 1. `lib/core/models/vpn_node.dart`

Create an immutable Dart class `VpnNode` with final fields, `copyWith`, and no
mutable public state. Compute `id` once in a factory constructor (the primary
constructor is not `const` because it hashes):

- `id` — SHA-256 hex of `"$ip:$port"`, computed once at construction.
- `hostName`, `ip`, `port` (int), `transportProto` (`tcp` / `udp`)
- `score` (int, upstream), `pingMs` (int, upstream), `speedBps` (int)
- `countryLong`, `countryShort`, `numSessions`, `uptimeMs`, `operatorName`
- `ovpnConfigRaw` (sanitized OpenVPN text), `protocol`
  (`enum VpnProtocol { openvpn, wireguard }`)
- `measuredRttMs` (int?, set after probing), `fitnessScore` (double)
- `speedMbps` getter and `uptimeSec` getter.

Add `VpnNode.fromCsvRow(List<String> columns)` only if it keeps the parser thin;
otherwise keep mapping in the service.

## 2. `lib/core/network/vpngate_service.dart`

- Use `dio` with a 15 s **connect** timeout and a 120 s **receive** timeout. The
  payload is ~1.3 MB and the upstream server is frequently slow; a 15 s total
  timeout fails in practice. Fallback order:
  `https://www.vpngate.net/api/iphone/`,
  `http://www.vpngate.net/api/iphone/`,
  documented community mirrors.
  Treat an empty body or a body without `*vpn_servers` as a failed source and
  try the next. Surface cached nodes immediately while refreshing.
- Stream the body (`ResponseType.stream`) and split lines incrementally. Never
  hold the whole multi-MB payload as one String.
- Skip lines starting with `*` or `#` and blank lines.
- Split each row into 15 fields **without** naive `line.split(',')`. The base64
  column is last and contains no commas: take everything after the final comma
  as index 14, then split the prefix into the first 14 fields. If the message or
  operator contains extra commas, fold them into index 13 rather than shifting
  the base64 field. Rows with fewer than 15 columns are skipped, not thrown.
  Trim trailing `\r` from CRLF rows.
- Base64-decode index 14, tolerating whitespace and missing padding.
- Extract `remote <host> <port>` and `proto <tcp|udp>` with RegExp from the
  decoded text. Default to port 1194 / udp when absent.
- Sanitize before storing:
  - Remove existing `data-ciphers` / `data-ciphers-fallback` lines.
  - Inject exactly once, immediately after the `client`/`dev tun` preamble:
    `data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305:AES-128-CBC`
    and `data-ciphers-fallback AES-128-CBC`.
  - Strip directives known to break OpenVPN 2.6+ consumers when they are
    obsolete (`cipher AES-128-CBC` may stay only if `data-ciphers` includes it;
    do not emit both conflicting `compress` and `comp-lzo`).
  - Never log decoded configs or key material.
- Expose `Future<List<VpnNode>> fetchNodes()` and make the parser a separately
  testable pure function, e.g. `Stream<VpnNode> parseCsv(Stream<String> lines)`.
- Decode/sanitize work stays in the Dart UI process. Nothing in this file may be
  imported by the iOS extension.

## 3. `lib/core/network/latency_prober.dart`

Implement:

```dart
Future<List<VpnNode>> probeAndScoreNodes(
  List<VpnNode> candidates, {
  int concurrency = 8,
  Duration timeout = const Duration(milliseconds: 1500),
});
```

- Bounded worker pool (a `Pool`-style loop or `Stream`/`Future` batching); do not
  spawn one future per node unbounded.
- `Socket.connect(node.ip, node.port, timeout: timeout)`, stopwatch around it,
  `socket.destroy()` in `finally` whether connect succeeds or fails.
- On failure keep `measuredRttMs == null` and penalize via the upstream `pingMs`
  fallback rather than dropping the node.
- Score:
  `40 * (speedMbps / 100) - 0.35 * rttMs + 10 * log10(uptimeSec + 1) - 0.15 * numSessions`.
  Use measured RTT when present, otherwise `pingMs`. Return a new sorted list,
  highest fitness first; do not mutate input nodes.

## 4. Tests — `test/vpngate_parser_test.dart`

Use a realistic fixture with at least 3 rows including a quoted operator/message
containing commas if the format allows it, a short row, and a non-base64 row.
Cover:

- header/footer skipping and 15-column indexing (guards against off-by-one on
  column 14);
- base64 decode, port/proto extraction, defaults;
- sanitizer idempotency (inject once, not twice);
- fitness ordering and socket timeout behavior with a local `ServerSocket`;
- malformed rows never throw.

Run `flutter analyze` and `flutter test`. Both must pass. Report the exact
counts. Do not create UI or native code in this phase.
