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

## Wiring that spans files

Domain logic is pure TypeScript in `packages/*` and reaches the platform through an injected port, so `node --test` runs it against a fake. Platform code lives in Expo local modules (`apps/<app>/modules/*`, Kotlin and Swift) behind a thin TS adapter. Example: `NetLensNativeBinding` in `packages/core/src/native-binding.ts` is implemented by `createNetLensNativeBinding()` in `apps/netlens/modules/netlens-core/src/index.ts` and faked in `packages/core` tests. A new native function or event therefore touches four places that must stay in step: the TS contract, the adapter, the Kotlin side and the Swift side.

`packages/open-tunnel-core` is Hermes-safe (no `node:crypto` or `Buffer`) and takes sockets as an injected `TcpProbeFn`.
