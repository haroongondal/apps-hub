# Technical Specification: NetLens

## 1. Tech Stack Selection
- **Framework:** Kotlin Multiplatform (KMP) + Compose Multiplatform (Android & iOS) OR Pure Native Android-first (Kotlin + Jetpack Compose) with modular `core-network` interfaces. *(Defaulting to KMP + Compose Multiplatform for unified Android/iOS codebase with F-Droid compatibility).*
- **Concurrency:** `kotlinx.coroutines` (`Dispatchers.IO`, `Semaphore(64)` for socket throttling).
- **Local Database:** `androidx.room` (KMP support via `androidx.room:room-runtime` + `BundledSQLiteDriver`).
- **Serialization:** `kotlinx.serialization-json` (for bundled offline IEEE OUI & mDNS service dictionaries).
- **Architecture Pattern:** Clean MVVM with Unidirectional Data Flow (`StateFlow`).

## 2. Project Directory Structure

```text
netlens/
├── AGENTS.md
├── docs/
│   ├── PRD.md
│   └── SPEC.md
├── composeApp/
│   ├── src/commonMain/kotlin/org/netlens/app/
│   │   ├── domain/
│   │   │   ├── model/         # NetworkInterfaceInfo, DiscoveredDevice, DiagnosticResult
│   │   │   └── repository/    # ScannerRepository, DeviceRepository, DiagnosticRepository
│   │   ├── data/
│   │   │   ├── db/            # Room Database, Entities, DAOs
│   │   │   ├── scanner/       # SubnetCalculator, TcpProbeScanner, MdnsDiscovery, SsdpDiscovery
│   │   │   └── diagnostics/   # PingEngine, DnsBenchmark
│   │   └── ui/
│   │       ├── scanner/       # ScannerScreen, ScannerViewModel
│   │       ├── device/        # DeviceDetailSheet
│   │       └── diagnostics/   # DiagnosticsScreen, DiagnosticsViewModel
│   ├── src/androidMain/       # Android Platform NetworkEngine (ConnectivityManager, NsdManager)
│   └── src/iosMain/           # iOS Platform NetworkEngine (NWPathMonitor, NWBrowser, NWConnection)
```

## 3. Native Platform Networking Contracts (`expect` / `actual`)

### 3.1 Interface & Gateway Detection

- **Android (`androidMain`):**
  - Use `ConnectivityManager.getActiveNetwork()` → `getLinkProperties(network)`.
  - Extract IPv4 `LinkAddress` and prefix length from `linkProperties.linkAddresses`.
  - Extract Gateway IP from `linkProperties.routes` where `route.isDefaultRoute`.
  - **CRITICAL:** Do NOT use deprecated `WifiManager.getConnectionInfo().ipAddress`.

- **iOS (`iosMain`):**
  - Use POSIX `getifaddrs()` filtering for `en0` (`AF_INET`) to extract IPv4 address and `ifa_netmask`.
  - Use `NWPathMonitor` for connectivity state.

### 3.2 Host Discovery Engine (`TcpProbeScanner`)

Because raw ICMP sockets (`SOCK_RAW`) require root on Android/iOS, implement a hybrid probe per IP in the subnet:

1. **Android:** Call `InetAddress.getByName(ip).isReachable(400)` concurrently alongside non-blocking `Socket().connect(InetSocketAddress(ip, port), 350)` across `[80, 443, 22, 445, 5353, 8080, 62078]`.
   - **Note:** Even if `connect()` throws `ConnectException` (Connection Refused), the host is **ALIVE** because its TCP stack actively sent a `RST` packet! Only `SocketTimeoutException` or `NoRouteToHostException` means unreachable.
2. **iOS:** Use `NWConnection(host:port:using:.tcp)` or POSIX non-blocking `connect()` with `poll()` checking for `ECONNREFUSED` (Host Alive) vs `ETIMEDOUT` (Host Dead).
3. **Concurrency Control:** Wrap IP iteration in `coroutineScope` gated by `Semaphore(64)`. Emit discovered hosts progressively via `Flow<DiscoveredDevice>`.

### 3.3 Service & Hostname Enrichment (mDNS & SSDP)

- **mDNS:**
  - Android: `NsdManager` + Multicast UDP socket on `224.0.0.251:5353` querying `_services._dns-sd._udp.local.` (Acquire `WifiManager.MulticastLock` before scan, release in `finally` block).
  - iOS: `NWBrowser` or POSIX multicast DNS query on `224.0.0.251:5353`.

- **SSDP:**
  - Send UDP datagram to `239.255.255.250:1900` with payload:

```text
M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n
```

  - Parse `LOCATION`, `SERVER`, and `USN` headers from responses within a 2.5s window.

## 4. Database Schema (Room SQLite)

```kotlin
@Entity(tableName = "networks")
data class NetworkEntity(
    @PrimaryKey val networkId: String, // Hash of GatewayIP + CIDR (or BSSID if granted)
    val gatewayIp: String,
    val subnetCidr: String,
    val customName: String?,
    val lastScannedAt: Long
)

@Entity(
    tableName = "devices",
    Index(value = ["networkId", "identityKey"], unique = true)
)
data class DeviceEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val networkId: String,
    val identityKey: String, // Primary: mDNS instance/hostname or MAC (if valid); Fallback: IP
    val lastIp: String,
    val hostname: String?,
    val customName: String?,
    val vendorOrModel: String?,
    val openPortsCsv: String,
    val mdnsServicesCsv: String,
    val isTrusted: Boolean = false,
    val firstSeenAt: Long,
    val lastSeenAt: Long
)
```

## 5. Diagnostic Engine ("Why is my Wi-Fi slow?")

- Execute 10 sequential probes (200ms interval) concurrently to:
  1. `gatewayIp` (TCP port 80/53/443 or `isReachable`)
  2. `1.1.1.1:53` (Cloudflare TCP handshake latency)
  3. `8.8.8.8:53` (Google DNS TCP handshake latency)

- **Metrics Computed:**
  - `avgRttMs = rtts.average()`
  - `jitterMs = rtts.zipWithNext { a, b -> abs(a - b) }.average()`
  - `packetLossPct = (failedCount / totalCount.toFloat()) * 100`

- **Diagnosis Heuristic:**
  - If `gateway.avgRttMs > 30ms` OR `gateway.jitterMs > 15ms` OR `gateway.packetLossPct > 2%` → `Diagnosis.LOCAL_WIFI_CONGESTION`
  - Else if `wan.avgRttMs > 120ms` OR `wan.packetLossPct > 2%` → `Diagnosis.ISP_WAN_DEGRADATION`
  - Else if `dnsResolveMs > 150ms` → `Diagnosis.SLOW_DNS_SERVER`
  - Else → `Diagnosis.HEALTHY`
