# PacketTunnel (iOS Network Extension)

This directory is the intended home of `PacketTunnelProvider.swift` and the
`PacketTunnel` target's `Info.plist` / entitlements.

The target itself must be created in Xcode; see
[`docs/ios-network-extension.md`](../../docs/ios-network-extension.md).

Hard rule: this process never fetches or parses the VPN Gate CSV. It reads one
sanitized config string from App Group `group.com.opentunnel.vpn`. Peak memory
must stay below 12 MB.
