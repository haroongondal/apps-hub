# Technical Specification — NetLens

Version 1.0 · Implements `docs/PRD.md` v1.0
Stack: Kotlin · Jetpack Compose · Hilt · Room · Coroutines/Flow · WorkManager

## 1. Architecture Overview

### 1.1 Layers

```text
UI (Compose screens) → ViewModel (StateFlow) → Repository → ┌ Room
                                                            ├ DiagnosticEngine
                                                            └ VpnController ←— NetVpnService (foreground service owning the tunnel)
```

`NetVpnService` owns the tunnel file descriptor; `VpnController` bridges the service and the repositories. UI never touches the service directly.

### 1.2 Modules and packages

Single Gradle module `:app`.

```text
com.netlens.app
├── NetLensApp.kt        # @HiltAndroidApp
├── MainActivity.kt
├── vpn/                 # NetVpnService, VpnController, PacketParser, TunnelStats
├── dns/                 # DnsInterceptor (UDP/53 proxy), DnsMap (ip→host cache)
├── relay/               # UdpRelay, TcpRelay state machine, NatTable
├── diag/                # DiagnosticEngine, Probe, probes/*, Scoring
├── data/                # RoomDatabase, entities/, daos/, repos/, RetentionWorker
├── ui/                  # dashboard/, diagnose/, history/, rules/, theme/
└── di/                  # Hilt modules
```

### 1.3 Data flow

TUN packets → `PacketParser` (5-tuple + counters; payload dropped immediately) → `NatTable` / relays forward out via protected sockets → events aggregated (1 Hz flush) → Room → `Flow` → UI.

### 1.4 Screens ↔ features

| Screen | Feature |
| --- | --- |
| Dashboard | FR-1 (toggle + live feed) |
| Diagnose | FR-2 |
| History | FR-3 |
| Rules | FR-4 |

### 1.5 Threading

- Tunnel read loop: one thread (`Dispatchers.IO.limitedParallelism(1)`).
- Room writes always on IO; UI collects Flows on Main; live-feed list updates debounced 250 ms.

## 2. Tech Stack and Conventions

- Kotlin 2.x, `compileSdk`/`targetSdk` 35, `minSdk` 26, JVM 17; version catalog in `gradle/libs.versions.toml` pinning latest stable of: AGP, Compose BOM, Hilt, Room, WorkManager, Coroutines, Lifecycle.
- Networking: raw platform sockets (`DatagramChannel`, `SocketChannel`) — no HTTP-client dependency inside the tunnel path; OkHttp allowed only for the HTTPS reachability probe.
- Persistence: Room with KSP; schema exports on.
- Tests: JUnit4 + Turbine + fakes; Robolectric for the header parser; DAO tests via `room-testing`.
- `networkSecurityConfig`: cleartext disabled for all domains.

## 3. Native Platform Networking

### 3.1 VpnService lifecycle

1. User hits the toggle → `VpnService.prepare()` → system consent dialog.
2. `establish()` with `Builder`:
   - `addAddress("10.111.0.1", 32)`
   - `addRoute("0.0.0.0", 0)` (IPv4-only; IPv6 traffic simply stays outside the tunnel — documented v1 limitation NL-1)
   - `setMtu(9000)`; `addDisallowedApplication(ownUid)` so NetLens bypasses itself (AC-FR1-5)
   - `setSession("NetLens")`
3. Foreground notification while active (live connection count).
4. `onRevoke()` → full stop path: close descriptor → cancel loops → `stopSelf()` → UI state reset.

### 3.2 Packet parsing rules

- Parse IPv4 header for version/IHL → 5-tuple `(protocol, srcIp, srcPort, dstIp, dstPort)`; copy at most header length; **drop payload buffers immediately** (AGENTS rule 3).
- TCP/UDP header: ports, and for accounting the segment length (TCP: IP total length − headers).
- Flow key = 5-tuple; a flow idles out after 90 s without traffic; counters update bytesUp/bytesDown.
- Parser is a pure function over `ByteBuffer` fixtures → fully unit-testable (AC-FR1-3 test lives here).

### 3.3 NAT and UDP relay

- `NatTable` maps `(fakeDstIp:fakePort) → (realIp:realPort)`; outbound UDP is re-emitted through a protected datagram socket; replies are matched back via the table.
- Table entries expire with the flow idle timeout.

### 3.4 TCP relay state machine (per flow)

Minimal userspace TCP: terminate the handshake locally, then relay payload-frames verbatim.

```text
LISTEN → SYN → open protected SocketChannel(dst) → send SYN-ACK
ESTABLISHED → relay frames; never parse application payload; only count bytes
CLOSE → FIN/FIN-ACK both directions → kill upstream socket → emit final counters
RST → immediate teardown both directions
```

Retransmissions from the device are dropped (the local kernel re-sends anyway). Acceptance test: Chrome loads a page end-to-end while the tunnel is active (AC-FR1-1/4 evidence).

### 3.5 DNS interceptor and hostname mapping

- UDP packets to port 53 are hijacked: parse the question domain, forward via a protected socket to the current active resolver (`LinkProperties.dnsServers`), parse the answer's A records.
- Register `ip → (uid, domain)` in `DnsMap` (per-session LRU, max 4096 entries) so connection rows can show a hostname (AC-FR1-2).
- The response is written back to the requesting app verbatim; NetLens never alters answers.

### 3.6 Platform auxiliary signals

- `ConnectivityManager.NetworkCallback` (capabilities, validation state) feeds the captive-portal hypothesis and Dashboard status chip.
- `TrafficStats` is the fallback accounting source when the tunnel is OFF.

### 3.7 Hard rules for this section

- Every app-owned socket (forwarder, relay, probe) is `protect()`-ed before use.
- No payload bytes are logged, persisted, or exported — anywhere, ever.

## 4. Database Schema (Room)

DB version **1** at first release. Exported schemas are committed. Entities:

```kotlin
@Entity(tableName = "sessions")
data class SessionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val startedAt: Long,        // epoch millis
    val endedAt: Long?,         // null while the tunnel is active
)

@Entity(
    tableName = "connection_events",
    foreignKeys = [ForeignKey(
        entity = SessionEntity::class, parentColumns = ["id"],
        childColumns = ["sessionId"], onDelete = ForeignKey.CASCADE)],
    indices = [
        Index("sessionId"), Index("appUid", "startedAt"),
        Index("remoteIp"), Index("remoteHost"),
    ],
)
data class ConnectionEventEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val sessionId: Long,
    val appUid: Int,            // Linux UID; package via PackageManager
    val packageName: String?,
    val protocol: String,       // "TCP" | "UDP"
    val localIp: String, val localPort: Int,
    val remoteIp: String, val remotePort: Int,
    val remoteHost: String?,    // from DnsMap, null when unknown
    val bytesUp: Long, val bytesDown: Long,
    val startedAt: Long, val lastSeenAt: Long, val closedAt: Long?,
)

@Entity(
    tableName = "dns_queries",
    indices = [Index("sessionId"), Index("appUid", "at"), Index("name")],
)
data class DnsQueryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val sessionId: Long,
    val appUid: Int,
    val name: String,           // queried domain
    val resolvedIp: String?,    // first A record seen
    val serverIp: String,       // resolver used
    val at: Long,
)

@Entity(tableName = "diagnostic_runs", indices = [Index("startedAt")])
data class DiagnosticRunEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val startedAt: Long, val finishedAt: Long?,
    val kind: String,           // "QUICK"
    val status: String,         // RUNNING | DONE | FAILED | CANCELLED
    val score: Int?,            // 0..100
    val summary: String?,       // generated human-readable text
)

@Entity(
    tableName = "probe_results",
    foreignKeys = [ForeignKey(
        entity = DiagnosticRunEntity::class, parentColumns = ["id"],
        childColumns = ["runId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("runId")],
)
data class ProbeResultEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val runId: Long,
    val name: String, val target: String,
    val status: String,         // PASS | WARN | FAIL | SKIP
    val latencyMs: Long?, val detail: String,
)

@Entity(tableName = "usage_daily", primaryKeys = ["appUid", "day"])
data class UsageDailyEntity(
    val appUid: Int,
    val day: Long,              // epoch day
    val bytesUp: Long, val bytesDown: Long,
    val connCount: Long,
)
```

DAOs: suspend upserts/inserts; reads return `Flow`. Representative queries:

```kotlin
@Query("SELECT * FROM connection_events WHERE sessionId = :id ORDER BY startedAt DESC")
fun observeSession(id: Long): Flow<List<ConnectionEventEntity>>

@Query("SELECT * FROM connection_events WHERE appUid = :uid AND startedAt >= :since ORDER BY startedAt DESC")
fun observeByApp(uid: Int, since: Long): Flow<List<ConnectionEventEntity>>

@Query("DELETE FROM connection_events WHERE lastSeenAt < :cutoff")
suspend fun deleteOlderThan(cutoff: Long): Int
```

Retention (AC-FR3-3): nightly `RetentionWorker` deletes `connection_events` and `dns_queries` older than 14 days; `usage_daily` aggregates persist ≥ 90 days.

Migration policy (AGENTS rule 6): bump version + `Migration` + migration test, e.g. the canonical template:

```kotlin
val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE connection_events ADD COLUMN blockedFlow INTEGER NOT NULL DEFAULT 0")
    }
}
```

## 5. Diagnostic Engine

### 5.1 Probe contract

```kotlin
interface Probe {
    val name: String
    suspend fun run(ctx: ProbeContext): ProbeOutcome
}

sealed interface ProbeOutcome {
    data class Pass(val latencyMs: Long, val detail: String) : ProbeOutcome
    data class Warn(val latencyMs: Long?, val detail: String) : ProbeOutcome
    data class Fail(val error: NetLensError) : ProbeOutcome
    data object Skip : ProbeOutcome
}
```

`ProbeContext` carries a cancellation token and per-probe timeout; a user cancel must abort the run within 1 s (AC-FR2-3's fast-fail sibling rule).

### 5.2 Built-in probes (QUICK run)

| Probe | Target / method | Timeout | PASS criterion | Penalty |
| --- | --- | --- | --- | --- |
| DNS compare | resolve 4 known domains via system + 1.1.1.1 + 8.8.8.8 | 5 s | all resolve; answers agree | FAIL if none resolve; WARN on mismatch |
| TCP connect | 443 on 3 endpoints (google.com, cloudflare.com, amazon.com) | 5 s each | ≥ 2 succeed | FAIL each misses; WARN if 1 misses |
| HTTPS reachability | GET `https://www.gstatic.com/generate_204` → 204 | 10 s | HTTP 204 | FAIL |
| Captive portal | GET `http://connectivitycheck.gstatic.com/generate_204` | 10 s | 204 (redirect ⇒ portal detected ⇒ WARN) | WARN |
| ICMP reachability | `InetAddress.isReachable` quick check | 3 s | best-effort; SKIP when blocked | WARN |

All sockets used here are `protect()`-ed (AC-FR2-2).

### 5.3 Scoring

`score = 100 − Σ penalties` (FAIL −25, WARN −5), bounded to 0..100. Grades: ≥ 85 PASS, 60–84 DEGRADED, < 60 BROKEN. `summary` is generated from probe outcomes ("DNS via system resolver failed for 2 of 4 domains; TCP connect to google.com timed out.").

### 5.4 Execution and persistence

- Probes run serially in the table order; progress is a `Flow<RunProgress>` consumed by the Diagnose ViewModel.
- The run + probe rows are persisted per SPEC §4 at start/end and per-probe completion (AC-FR2-4).
- Runs never depend on the tunnel being active; airplane mode fast-fails each probe with `NetLensError.NetworkUnreachable` (AC-FR2-3).
