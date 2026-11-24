package expo.modules.inflowcore.core

import expo.modules.inflowcore.applink.SiblingPackages

sealed interface PingDecision {
  /** A send is already planned (or nothing to say): this change is covered by it. */
  data object None : PingDecision

  data object SendNow : PingDecision

  data class SendAt(val at: Long) : PingDecision
}

/**
 * At most one ping per [WINDOW_MS]. A change inside the window is not lost: the first one asks for one trailing ping at the end of the window,
 * and the changes after it are covered by that one. [now] must be a clock that does not jump (SystemClock.elapsedRealtime).
 */
class ChangedPing {
  private var planned: Long? = null   // the time of the last ping sent or planned

  @Synchronized
  fun request(now: Long): PingDecision {
    val last = planned
    if (last == null || last > now + WINDOW_MS || now >= last + WINDOW_MS) {   // never pinged, the clock went back, or the window is over
      planned = now
      return PingDecision.SendNow
    }
    if (last > now) return PingDecision.None
    planned = last + WINDOW_MS
    return PingDecision.SendAt(last + WINDOW_MS)
  }

  companion object {
    const val WINDOW_MS = 60_000L
  }
}

/** How the ping leaves the app: asked first whether the receiver is the real sibling, then sent. Only the action and the package pass through, so there is no way to attach data. */
interface PingTransport {
  fun trusted(action: String, pkg: String): Boolean

  fun send(action: String, pkg: String)
}

object ChangedSender {
  const val ACTION = "com.haroon.autopilot.CHANGED"
  const val TARGET = SiblingPackages.HALO

  /** False (nothing sent, no fallback) when Halo is missing or is not the app signed with our key. */
  fun send(transport: PingTransport): Boolean {
    if (!transport.trusted(ACTION, TARGET)) return false
    transport.send(ACTION, TARGET)
    return true
  }
}

/** The waiting suggestions as a set of ids: told by value, so a change that leaves the same ones waiting (started, then done) is not a change. The first look counts as one. */
class WaitingWatch(private val onChanged: () -> Unit) {
  private var last: Set<Long>? = null

  @Synchronized
  fun after(waitingIds: Collection<Long>) {
    val now = waitingIds.toSet()
    if (now == last) return
    last = now
    runCatching(onChanged)
  }
}
