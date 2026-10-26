# Pigeon contracts

Phase 2 creates `vpn_bridge.dart` here with:

- `VpnTunnelConfig`, `VpnStatusState`, `VpnProtocol`
- `@HostApi() VpnHostApi` — start, stop, state, open system VPN settings
- `@FlutterApi() VpnStateCallback` — state transitions and traffic counters

Generated outputs:

- `lib/core/network/vpn_bridge.g.dart`
- `android/app/src/main/kotlin/com/opentunnel/open_tunnel_vpn/VpnBridge.g.kt`
- `ios/Runner/VpnBridge.g.swift`

Regenerate with `dart run pigeon --input pigeons/vpn_bridge.dart`. Never
hand-edit generated files.
