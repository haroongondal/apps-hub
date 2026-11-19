package expo.modules.aihubcore.core

enum class Priority { FOREGROUND, BACKGROUND }

data class QueueItem(val id: String, val service: String, val priority: Priority)

class Queue(private val limit: Int = 2) {
  private val waiting = ArrayList<QueueItem>()
  private val running = HashMap<String, Int>()
  private val holds = HashMap<String, Long>()

  fun enqueue(item: QueueItem) {
    waiting.add(item)
  }

  fun next(now: Long): QueueItem? {
    val pick = waiting.filter { open(it.service, now) }.minByOrNull { it.priority.ordinal } ?: return null
    waiting.remove(pick)
    running[pick.service] = (running[pick.service] ?: 0) + 1
    return pick
  }

  fun done(item: QueueItem) {
    val n = running[item.service] ?: return
    if (n <= 1) running.remove(item.service) else running[item.service] = n - 1
  }

  fun cancel(id: String): Boolean = waiting.removeAll { it.id == id }

  fun onLimited(service: String, retryAfterMs: Long?, now: Long) {
    val until = now + (retryAfterMs ?: DEFAULT_HOLD_MS)
    holds[service] = maxOf(holds[service] ?: 0L, until)
  }

  fun heldUntil(service: String): Long? = holds[service]

  private fun open(service: String, now: Long): Boolean {
    val until = holds[service]
    return (until == null || now >= until) && (running[service] ?: 0) < limit
  }

  companion object {
    const val DEFAULT_HOLD_MS = 10_000L
  }
}
