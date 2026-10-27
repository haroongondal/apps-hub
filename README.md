# apps-hub

A monorepo of small, offline-first apps for Android, iOS and the Mac, built with React Native (Expo SDK 54) and
Electron, plus the private Android store that installs and updates them.

| App | Folder | What it is |
|---|---|---|
| NetLens | `apps/netlens` | LAN scanner and connectivity diagnostics. No telemetry, F-Droid-clean dependencies. |
| OpenTunnel | `apps/open_tunnel_vpn` | VPN client for free VPN Gate relays, no account needed. GPL-2.0-only. |
| PDF Editor | `apps/pdf-editor-mobile`, `apps/pdf-editor-desktop` | Offline PDF editor (Expo + WebView on phones, Electron on the Mac). |
| Design Editor | `apps/design-editor` | Offline Canva-style editor for the Mac (Electron). |
| Store | `apps/store` | Private Android store that installs and updates the apps above. |

Shared code lives in `packages/`: `ui` (design system used by every app), `core` (NetLens logic),
`open-tunnel-core` (VPN Gate ingestion), `pdf-editor-engine`, `store-manifest`. Tooling lives in `tools/`:
`release` (build, sign-check and publish to the Store) and `store-api` (the Store's Cloudflare Worker).

## Getting started

Needs Node 22+, pnpm (`corepack enable pnpm`), and for Android builds JDK 21 + the Android SDK. Full setup:
[docs/toolchain.md](docs/toolchain.md).

```bash
pnpm install
pnpm test        # unit tests in every package
pnpm typecheck
pnpm --filter netlens android     # run an app on a device or emulator
```

## Releases

Android builds go to the private Store, never to Google Play. Every push runs the tests on GitHub Actions; a push
to `main` also publishes each Store app whose code changed (its folder, its native module, or a shared package it
uses). To release by hand: `pnpm release <netlens|open-tunnel|pdf-editor|store> -m "What changed"`.
How it works, the secrets it needs and first-time phone setup: [docs/app-store.md](docs/app-store.md).

## Contributing

Read [AGENTS.md](AGENTS.md) first: it lists the rules every change must follow (shared UI only, no telemetry or
proprietary SDKs, NetLens scanning constraints). Each app may add its own `AGENTS.md`.

## Licence

OpenTunnel is GPL-2.0-only ([its LICENSE](apps/open_tunnel_vpn/LICENSE)). The rest of the repository has no
licence file yet.
