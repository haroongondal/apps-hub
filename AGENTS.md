# AGENTS.md — Operating Rules for the AI Agent

This file is auto-loaded on every prompt so the rules below are never forgotten. Before writing any code, read `docs/PRD.md` and `docs/SPEC.md`. Feature work arrives as the phase prompts stored in `docs/PROMPTS.md` — execute them strictly in order (Phase 1 → 4), one phase per session, and do not skip ahead.

## 1. Platform Rules (never violate)

1. Android-only: Kotlin + Gradle (Kotlin DSL). Never write iOS, Flutter, React Native, or desktop code in this repo.
2. Target matrix: `minSdk 26` · `compileSdk` / `targetSdk` 35 · JVM 17 · Kotlin 2.x. Versions are pinned in `gradle/libs.versions.toml`, always latest stable.
3. **Metadata-only privacy rule**: never read, store, log, or transmit packet payload bytes anywhere in this codebase. Parsers may copy at most the protocol header length. Any violation = immediate revert.
4. Every socket opened by NetLens itself (DNS forwarder, relays, diagnostic probes) must be `VpnService.protect()`-ed so it bypasses our own tunnel (no feedback loops).
5. App-owned traffic never uses cleartext HTTP: `networkSecurityConfig` blocks cleartext, and all endpoints named in the SPEC are HTTPS.
6. Room: any schema change ⇒ bump the DB version, add a `Migration`, and add a migration unit test. Never edit an already-released entity in place.
7. Concurrency: no blocking I/O on `Dispatchers.Main`. DAO and network calls are `suspend` or `Flow`. The tunnel read loop is pinned to a single IO thread (`Dispatchers.IO.limitedParallelism(1)`).
8. `NetVpnService` always handles `onRevoke()` (system revoke) and keeps `startTunnel()` / `stopTunnel()` symmetrical: close the `ParcelFileDescriptor`, cancel the read loop, then `stopSelf()`.

## 2. Commands — run them, never predict them

| Purpose | Command |
| --- | --- |
| Build | `./gradlew assembleDebug` |
| Unit tests | `./gradlew testDebugUnitTest` |
| Lint | `./gradlew lintDebug` |
| Instrumented (requires emulator) | `./gradlew connectedDebugAndroidTest` |

Never claim green output without actually seeing it in the terminal.

## 3. Conventions

- `applicationId` is `com.netlens.app`; package layout follows SPEC §1.2: `vpn/ dns/ relay/ diag/ data/ ui/ di/`.
- UI: Jetpack Compose + Material 3 only. ViewModels expose a single `StateFlow<UiState>`. All user-visible strings live in `strings.xml`.
- DI: Hilt (`@HiltAndroidApp`, `@AndroidEntryPoint`, modules in `di/`).
- Errors: sealed error types at repository boundaries; log with tagged `Log.w`; never `printStackTrace()` or swallow exceptions.
- Comments explain *why*, not *what*. No stray TODOs — unfinished work must carry `// TODO(phase-4)` with a description.

## 4. Boundaries and Conflict Resolution

- Build only what the PRD and SPEC define. Precedence when sources conflict: **SPEC > PRD > phase-prompt wording > your own preference.**
- Never delete or rewrite `docs/PRD.md` or `docs/SPEC.md`. Instead append progress to `docs/IMPLEMENTATION.md` — one entry per completed step: date, phase, what was done, and the test evidence.
- If something is genuinely ambiguous (device-specific behavior, missing decision), ask the user one short question rather than guessing silently.
- Do not touch signing configs, CI configuration, or generated files.

## 5. Definition of Done (per task)

1. `./gradlew assembleDebug` and affected unit tests are actually run and green.
2. The feature satisfies its `AC-*` numbers in PRD §4.
3. No new lint errors and no violations of the metadata-only rule (Platform Rule 3).
4. A `docs/IMPLEMENTATION.md` entry has been added.
