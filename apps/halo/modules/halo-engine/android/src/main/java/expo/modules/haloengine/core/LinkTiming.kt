package expo.modules.haloengine.core

/** When to re-read the shares: a CHANGED ping reads 5 s after the first ping of a burst, an app open at once; never two reads within a minute. Monotonic clock. */
class RereadGate {
  private var lastReadAt: Long? = null
  private var pendingAt: Long? = null

  fun onPing(now: Long): Long? = request(now + SETTLE_MS)

  fun onOpen(now: Long): Long? = request(now)

  fun onStale(now: Long): Long? = if (lastReadAt.let { it == null || now - it >= STALE_MS }) request(now) else null

  fun onRead(now: Long) {
    lastReadAt = now
    pendingAt = null
  }

  // The posted read was removed (switches off, service stopped), so a request must be allowed again.
  fun cancel() {
    pendingAt = null
  }

  private fun request(at: Long): Long? {
    if (pendingAt != null) return null
    val due = lastReadAt?.let { maxOf(at, it + MIN_GAP_MS) } ?: at
    pendingAt = due
    return due
  }

  companion object {
    const val SETTLE_MS = 5_000L
    const val MIN_GAP_MS = 60_000L
    const val STALE_MS = 15 * 60_000L
  }
}

enum class PulseKind { SHIELD, WAITING }

data class PulseState(val lastShield: Long? = null, val lastWaiting: Long? = null)

data class PulseStep(val show: PulseKind?, val state: PulseState, val nextAt: Long?)

object LinkPulse {
  const val SHIELD_EVERY_MS = 5 * 60_000L
  const val WAITING_EVERY_MS = 10 * 60_000L
  const val BUMPED_MS = 10_000L

  // One pulse per step, the red one first; a pulse that turns false and true again starts over, so it shows at once.
  fun step(prev: PulseState, shield: Boolean, waiting: Boolean, quiet: Boolean, now: Long): PulseStep {
    var ls = if (shield) prev.lastShield else null
    var lw = if (waiting) prev.lastWaiting else null
    val shieldDue = shield && (ls == null || now - ls >= SHIELD_EVERY_MS)
    val waitingDue = waiting && (lw == null || now - lw >= WAITING_EVERY_MS)
    val show = when {
      quiet -> null
      shieldDue -> PulseKind.SHIELD
      waitingDue -> PulseKind.WAITING
      else -> null
    }
    if (show == PulseKind.SHIELD) ls = now
    if (show == PulseKind.WAITING) lw = now
    val nextShield = if (shield) (ls ?: now) + SHIELD_EVERY_MS else null
    val nextWaiting = when {
      !waiting -> null
      waitingDue && show == PulseKind.SHIELD -> now + BUMPED_MS
      else -> (lw ?: now) + WAITING_EVERY_MS
    }
    return PulseStep(show, PulseState(ls, lw), listOfNotNull(nextShield, nextWaiting).minOrNull())
  }
}
