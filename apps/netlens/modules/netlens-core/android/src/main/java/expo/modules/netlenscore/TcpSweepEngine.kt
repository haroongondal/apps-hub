package expo.modules.netlenscore

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore

/** Aggregate stats for one completed sweep. */
data class SweepStats(val durationMs: Long, val hostsFound: Int, val totalProbed: Int)

/**
 * Bounded (Semaphore-64) in-order sweep across `hostIps`.
 * Emits alive hosts in real time through [onHostDiscovered] and suspends
 * until every target has been probed (or the caller scope is cancelled).
 */
class TcpSweepEngine(
  private val hostIps: List<String>,
  private val ports: List<Int> = TcpProbe.DEFAULT_PORTS,
  private val timeoutMs: Int = 350,
  private val maxConcurrency: Int = 64,
  private val onHostDiscovered: suspend (DiscoveredHostPayload) -> Unit,
) {
  init {
    // Defensive re-assertion of the /24 clamp (NFR-1 / AGENTS rule 7).
    check(hostIps.size <= 256) { "Sweep list ${hostIps.size} exceeds the 256 target bound" }
  }

  suspend fun run(): SweepStats {
    val startedAt = System.nanoTime()
    val semaphore = Semaphore(maxConcurrency)
    val foundCounter = AtomicInteger(0)
    coroutineScope {
      for (ip in hostIps) {
        semaphore.acquire()
        launch(Dispatchers.IO) {
          try {
            if (!isActive) return@launch
            for (port in ports) {
              val result = TcpProbe.connect(ip, port, timeoutMs)
              if (TcpProbe.isReachable(result.outcome)) {
                foundCounter.incrementAndGet()
                onHostDiscovered(
                  DiscoveredHostPayload(
                    ip = ip,
                    outcome = result.outcome,
                    rttMs = result.elapsedMs,
                    winningPort = result.port,
                  ),
                )
                break // first responsive port wins for Phase 1
              }
            }
          } finally {
            semaphore.release()
          }
        }
      }
    }
    val durationMs = (System.nanoTime() - startedAt) / 1_000_000L
    return SweepStats(
      durationMs = durationMs,
      hostsFound = foundCounter.get(),
      totalProbed = hostIps.size,
    )
  }
}

/**
 * Payload mirrored 1:1 by the JS-side `DiscoveredHost` shape (model.ts).
 * `outcome` is lowercase (`open` | `refused` | `timeout` | `unreachable`).
 */
data class DiscoveredHostPayload(
  val ip: String,
  val outcome: ProbeOutcome,
  val rttMs: Long?,
  val winningPort: Int?,
)
