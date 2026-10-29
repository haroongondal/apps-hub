# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

The engineering rules, VPN Gate CSV contract and scoring formula are in the imported AGENTS.md. `OpenCode.md` is an identical copy for a different agent; edit AGENTS.md and leave `opencode.jsonc` alone.

## Commands

```bash
pnpm --filter open_tunnel_vpn test        # node --test, six files listed in package.json
pnpm --filter open_tunnel_vpn typecheck
cd apps/open_tunnel_vpn/android && ./gradlew :open-tunnel-native:testDebugUnitTest :app:assembleDebug   # needs JAVA_HOME
```

`packages/open-tunnel-core` has its own tests: `pnpm --filter open-tunnel-core test`.

## Things that aren't obvious

- Phase prompts are `.opencode/commands/phase1.md` to `phase4.md`; plans and session logs for phases 2 to 4 are in `docs/`. Read the relevant log before changing that area.
- The OpenVPN engine is `android/app/libs/ics-openvpn.aar`, built by `vendor/ics-openvpn/build-aar.sh`. Don't edit the AAR; rebuild it. ics-openvpn is GPLv2, which is why this app is GPL-2.0-only while the rest of the repo has no licence file.
- The Android tunnel is split across `modules/open-tunnel-native` (Expo module: `TunnelStateRegistry`, `TunnelEventBus`, `TrafficTicker`) and `android/app/.../OpenTunnelVpnService.kt` with the engines in `engines/`. iOS mirrors it with `ios/OpenTunnelPacketTunnel/` (Network Extension) and the module's Swift files.
- Native config comes from `plugin/opentunnel-android-config.js` (manifest posture, scoped cleartext) as well as the committed `android/`; check both when a manifest setting seems to vanish.
- Unit tests use a real `node:sqlite` rather than mocks for the cache, so they exercise the actual SQL.
