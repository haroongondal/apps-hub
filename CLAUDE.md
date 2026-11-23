# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

AGENTS.md (imported above) holds the hard rules and the toolchain. `apps/open_tunnel_vpn/AGENTS.md` adds OpenTunnel's rules; read it before touching that app or `packages/open-tunnel-core`. Release/Store and UI/PDF-engine details load from `.claude/rules/` when you work in those paths.

## Commands

Run from the repo root. Node ≥ 22, pnpm via corepack. Android builds need `JAVA_HOME` and `ANDROID_HOME` exported ([docs/toolchain.md](docs/toolchain.md)).

```bash
pnpm install
pnpm test                 # every workspace package's "test" script
pnpm typecheck            # tsc --noEmit per package
pnpm doctor               # expo-doctor per app
pnpm --filter netlens android          # run an app on a device/emulator

# One test file / one test (TS runs directly under node's type stripping, no Jest)
node --test packages/core/src/__tests__/ping-engine.test.ts
node --test --test-name-pattern="parse" packages/open-tunnel-core/src/__tests__/parser.test.ts

pnpm --filter pdf-editor-desktop test:e2e   # Electron suites open real windows; not part of `pnpm test`
pnpm --filter design-editor test:e2e
```

Native gates (Gradle JVM tests, iOS simulator build) are in AGENTS.md under "Verification Commands".

## Gotchas

- **Each package's `test` script lists its test files by name** (`node --test a.test.ts b.test.ts …`), so a new `*.test.ts` does nothing until you add it to that `package.json`. Only `tools/release` globs.
- Node strips types: write erasable TypeScript only (no enums, namespaces or parameter properties) and import with the `.ts` extension (`packages/config/tsconfig.base.json` sets `allowImportingTsExtensions` and `verbatimModuleSyntax`).
- `pnpm install` blocks dependency build scripts. The allowed ones are in `allowBuilds` in `pnpm-workspace.yaml`; use the `upgrading-dependencies` skill when pnpm refuses an install.
- Each app's `android/` is a committed Expo prebuild (iOS too, except Store), not regenerated at build time.
- Several Claude sessions share this checkout and the test phone (the owner and Deputy use the phone too). The `coord` plugin (`coord@claude-agent-workflow`; source in `~/Documents/claude-agent-workflow`, not in this repo), enabled in `.claude/settings.json`, makes sessions take turns: claim `device:<ro.serialno>` before installing on or driving the phone, and an app's folder before a build-install-test loop.

## Wiring that spans files

Domain logic is pure TypeScript in `packages/*` and reaches the platform through an injected port, so `node --test` runs it against a fake. Platform code lives in Expo local modules (`apps/<app>/modules/*`, Kotlin and Swift) behind a thin TS adapter. Example: `NetLensNativeBinding` in `packages/core/src/native-binding.ts` is implemented by `createNetLensNativeBinding()` in `apps/netlens/modules/netlens-core/src/index.ts` and faked in `packages/core` tests. A new native function or event therefore touches four places that must stay in step: the TS contract, the adapter, the Kotlin side and the Swift side.

`packages/open-tunnel-core` is Hermes-safe (no `node:crypto` or `Buffer`) and takes sockets as an injected `TcpProbeFn`.

## Apps working together (Autopilot)

The owner's apps are meant to talk to each other over one private channel that only apps signed with the shared release key can use: Inflow spots things to do, Deputy runs them on the owner's tap, Halo shows them on the edge and always-on screen, Design Editor makes cards. Design: `docs/superpowers/specs/2026-11-18-autopilot-design.md`; progress: `docs/handoffs/autopilot.md`.

**Whenever you design or plan a new app or a new feature in an existing app** (a new Store app, AI in Design Editor, a new Inflow or Halo capability, …), read that design first, and give your design or plan a "Works with the other apps" section that answers:

- What can this app or feature **give** the others (signals, text, files, actions it can do on request)?
- What could it **use** from them (Inflow's messages, ledger and to-dos; Deputy running a task; Halo's edge, always-on screen and bubble; Design Editor's canvas and on-device photo search)?
- Does it join the channel (declare `com.haroon.permission.AUTOPILOT`, follow the shared contract in `packages/app-link-contract`) now or later? Say which, and why.
- Does it keep the channel's privacy rules: items blocked from AI, OTPs, Strongroom and Inflow's own items never cross; the lock screen shows titles only; nothing starts without the owner's tap?

Bring the best one or two ideas to the owner as a question; don't build them unasked. Add any idea that isn't built to "Later ideas" in the Autopilot design.
