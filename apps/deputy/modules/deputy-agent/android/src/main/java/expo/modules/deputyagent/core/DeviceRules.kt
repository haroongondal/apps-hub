package expo.modules.deputyagent.core

import kotlinx.coroutines.delay

object DeviceRules {
  fun line(b: Bounds, d: Direction): IntArray {
    val cx = (b.left + b.right) / 2
    val cy = (b.top + b.bottom) / 2
    val dx = (b.right - b.left) * 3 / 10
    val dy = (b.bottom - b.top) * 3 / 10
    return when (d) {
      Direction.UP -> intArrayOf(cx, cy + dy, cx, cy - dy)
      Direction.DOWN -> intArrayOf(cx, cy - dy, cx, cy + dy)
      Direction.LEFT -> intArrayOf(cx + dx, cy, cx - dx, cy)
      Direction.RIGHT -> intArrayOf(cx - dx, cy, cx + dx, cy)
    }
  }

  fun scrollLine(b: Bounds, d: Direction) = line(
    b,
    when (d) {
      Direction.UP -> Direction.DOWN
      Direction.DOWN -> Direction.UP
      Direction.LEFT -> Direction.RIGHT
      Direction.RIGHT -> Direction.LEFT
    },
  )

  /** Spike S5: a secure window comes back as a black frame, not an error, so it is detected from ARGB samples. */
  fun isBlank(pixels: IntArray) = pixels.isNotEmpty() && pixels.all { p ->
    (p shr 16 and 0xFF) < 16 && (p shr 8 and 0xFF) < 16 && (p and 0xFF) < 16
  }

  /** Matches on where a node is, since the observation's copy may be redacted or carry lifted child labels. */
  fun find(raw: List<NodeRef>, target: NodeRef): Int? = raw.indexOfFirst {
    it.pkg == target.pkg && it.depth == target.depth && it.bounds == target.bounds && it.viewId == target.viewId
  }.takeIf { it >= 0 }

  fun changed(seen: NodeRef, now: NodeRef) =
    seen.viewId != now.viewId || seen.text != now.text || seen.desc != now.desc || seen.bounds != now.bounds

  /** The 0.2.0 phone test: the next alarm was a prayer app's, not the clock's, so its app is named; a blocked one isn't. */
  fun nextAlarm(time: String?, app: String?, blocked: Boolean) = when {
    time == null -> "none"
    blocked -> "$time, set by another app"
    app == null -> time
    else -> "$time, set by $app"
  }

  /** Rule 5 after an approval: the approved element found again by what it is, once the closing keyboard moved it. */
  fun relocate(nodes: List<NodeRef>, target: NodeRef): NodeRef? {
    if (target.viewId == null && target.label == null) return null
    return nodes.singleOrNull { it.copy(bounds = target.bounds, depth = target.depth) == target }
  }

  suspend fun settle(lastEvent: () -> Long, now: () -> Long) {
    val start = now()
    while (now() - start < 3_000 && now() - maxOf(start, lastEvent()) < 400) delay(50)
  }
}
