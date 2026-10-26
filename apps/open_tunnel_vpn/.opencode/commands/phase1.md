---
description: Phase 1 — React Native port of the VPN Gate data layer (COMPLETED)
---

**Status: complete. Do not re-execute unless regenerating from the Dart
snapshot (`a8cf6e9`).**

Phase 1 was implemented first in Flutter (ingestion, parser, sanitizer,
prober, Drift cache — see the git history) and has been ported 1:1 to the
React Native workspace layout as part of the Flutter → React Native
migration. The live prompt now only verifies it:

- `packages/open-tunnel-core` — `vpn-node.ts`, `vpngate.ts`,
  `vpngate-service.ts`, `latency-prober.ts`, with Hermes-safe pure-TS
  sha256 / base64 / UTF-8 / line-splitting utilities (no `node:crypto`,
  `Buffer`, or `TextDecoder` at runtime).
- `apps/open_tunnel_vpn/src/data/node-cache.ts` — SQLite cache with Drift
  parity (atomic replace + eviction, configless list reads, case-insensitive
  country filter, fitness ordering), real `expo-sqlite` on device and real
  `node:sqlite` in tests.
- `apps/open_tunnel_vpn/App.tsx` — fetch → parse → cache → ranked list.

## Acceptance checks

```bash
pnpm test            # all workspace suites green
pnpm typecheck       # per-package tsc --noEmit green
```

- 22 `open-tunnel-core` tests: CSV tokenizer guarding column 14, sanitizer
  idempotency, fitness formula, node identity hashing, TCP prober behavior
  against real loopback sockets, source fallbacks on failed/empty bodies.
- 7 cache tests: field round-trips (including probe results), configless
  list reads, case-insensitive country filter, refresh eviction, limits,
  sha256-keyed identity.
- Latency probing is injected (`TcpProbeFn`): real on-device probing is the
  Phase 2 native module's job; the parser/scorer/cacher never touched the
  network in tests.
