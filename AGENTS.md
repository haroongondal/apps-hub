# AGENTS.md — NetLens Project Guidelines

## Tech Stack & Build
- Kotlin Multiplatform (KMP) + Compose Multiplatform (Android & iOS)
- Build Android Debug APK: `./gradlew :composeApp:assembleDebug`
- Run Unit Tests: `./gradlew :composeApp:testDebugUnitTest`
- Database: Room KMP (`androidx.room`) + `BundledSQLiteDriver`

## Hard Architectural & OS Constraints (NEVER VIOLATE)
1. **NO ARP TABLE SCRAPING:** Never read `/proc/net/arp` or execute `ip neigh`. They fail with `EACCES` on Android 11+ and iOS.
2. **TCP RST = HOST ALIVE:** In `TcpProbeScanner`, catching `ConnectException` (ECONNREFUSED) means the target IP is ONLINE and responded with a TCP RST. Only `SocketTimeoutException` or `NoRouteToHostException` means offline.
3. **CONCURRENCY:** Always bound subnet scanning with `kotlinx.coroutines.sync.Semaphore(64)`. Never launch 254 unthrottled threads or sockets simultaneously.
4. **MULTICAST LOCK:** On Android, always acquire `WifiManager.MulticastLock` before mDNS/SSDP discovery and release it in a `finally` block.
5. **F-DROID PURE FOSS:** Never add proprietary dependencies (no Firebase, no Google Play Services, no closed-source SDKs).
6. **MODERN ANDROID APIS:** Use `ConnectivityManager.getLinkProperties()` for IP/Gateway detection. Never use deprecated `WifiManager.getConnectionInfo()`.

## Code Style & Workflow
- Refer to `docs/PRD.md` (FR/AC IDs) and `docs/SPEC.md` before implementing features.
- Phased prompts live in `docs/PROMPTS.md` — execute one phase per chat, strictly in order (Phase 1 → 4).
- Run `./gradlew :composeApp:testDebugUnitTest` after implementing each module to verify compilation and tests before moving to the next phase.
