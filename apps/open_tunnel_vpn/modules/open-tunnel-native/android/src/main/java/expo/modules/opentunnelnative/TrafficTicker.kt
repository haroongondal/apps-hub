package expo.modules.opentunnelnative

import android.net.TrafficStats
import android.os.Handler
import android.os.Looper
import android.os.SystemClock

/**
 * 1 Hz traffic cadence (plan §4.2): one emit per second, scheduled on the
 * main-thread Handler — never faster. Counter readings come from the active
 * engine when it exposes totals (GoBackend statistics); the process-wide
 * TrafficStats fallback keeps the readout real without inventing data.
 * Emission stops on disconnect/revoke; ticks only post while the registry
 * reports `connected`, so the duration freezes off-UP as well.
 */
object TrafficTicker {

  private const val TICK_MS = 1000L

  private val handler = Handler(Looper.getMainLooper())
  private val running = java.util.concurrent.atomic.AtomicBoolean(false)
  private val scheduled = java.util.concurrent.atomic.AtomicReference<Runnable?>(null)

  @Volatile
  private var counterProvider: (() -> Pair<Long, Long>)? = null

  private var lastRx = 0L
  private var lastTx = 0L

  /**
   * Starts the cadence with the given provider (may be null — the
   * TrafficStats fallback applies). Cumulative baselines are re-seeded on
   * every start so the first tick always reports a delta.
   */
  fun start(provider: (() -> Pair<Long, Long>)?) {
    counterProvider = provider
    seedBaselines()
    if (!running.compareAndSet(false, true)) return
    val runnable = object : Runnable {
      override fun run() {
        if (!running.get()) return
        runCatching { emit() }
        handler.postDelayed(this, TICK_MS)
      }
    }
    scheduled.set(runnable)
    handler.post(runnable)
  }

  fun stop() {
    running.set(false)
    scheduled.getAndSet(null)?.let { handler.removeCallbacks(it) }
    counterProvider = null
  }

  private fun seedBaselines() {
    val (rx, tx) = rawCounters()
    lastRx = rx
    lastTx = tx
  }

  private fun rawCounters(): Pair<Long, Long> {
    val provider = counterProvider
    if (provider != null) {
      runCatching { return provider() }
    }
    return fallbackCounters()
  }

  private fun fallbackCounters(): Pair<Long, Long> =
    TrafficStats.getTotalRxBytes() to TrafficStats.getTotalTxBytes()

  private fun emit() {
    val (rx, tx) = rawCounters()
    val deltaIn = (rx - lastRx).coerceAtLeast(0)
    val deltaOut = (tx - lastTx).coerceAtLeast(0)
    lastRx = rx
    lastTx = tx
    if (TunnelStateRegistry.statusState != TunnelStatus.CONNECTED) return
    val startedAt = TunnelStateRegistry.connectedAtMs
    val durationSec =
      if (startedAt == null) 0L else (SystemClock.elapsedRealtime() - startedAt) / 1000L
    TunnelEventBus.postTraffic(deltaIn, deltaOut, durationSec)
  }
}
