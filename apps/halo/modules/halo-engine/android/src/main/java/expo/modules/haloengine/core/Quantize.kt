package expo.modules.haloengine.core

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Picks dominant colours from album art (median cut) and lifts dark ones. Pure math, no android.* imports. */
object Quantize {
  /** Up to [max] colours (opaque ARGB), most common first. Pixels with alpha < 128 are skipped. */
  fun dominant(argb: IntArray, max: Int = 4): IntArray {
    val px = argb.filter { (it ushr 24) >= 128 }.map { it and 0xFFFFFF }
    if (px.isEmpty() || max < 1) return IntArray(0)
    val boxes = mutableListOf(px)
    while (boxes.size < max) {
      val box = boxes.filter { range(it) > 0 }.maxByOrNull { it.size * range(it) } ?: break
      boxes.remove(box)
      val ch = widestChannel(box)
      val sorted = box.sortedBy { (it shr ch) and 255 }
      val cut = cutIndex(sorted, ch)
      boxes.add(sorted.subList(0, cut))
      boxes.add(sorted.subList(cut, sorted.size))
    }
    return boxes.sortedByDescending { it.size }.map { mean(it) }.toIntArray()
  }

  /** Raises HSV value to at least 0.7, keeping hue and saturation. */
  fun lift(c: Int): Int {
    val r = ((c shr 16) and 255) / 255f
    val g = ((c shr 8) and 255) / 255f
    val b = (c and 255) / 255f
    val mx = max(r, max(g, b))
    val d = mx - min(r, min(g, b))
    if (mx >= 0.7f) return c or (0xFF shl 24)
    val s = if (mx == 0f) 0f else d / mx
    val h = when {
      d == 0f -> 0f
      mx == r -> ((g - b) / d + 6) % 6
      mx == g -> (b - r) / d + 2
      else -> (r - g) / d + 4
    }
    val v = 0.7f
    fun ch(n: Float): Int {
      val k = (n + h) % 6
      return ((v - v * s * max(0f, min(1f, min(k, 4 - k)))) * 255).roundToInt()
    }
    return (0xFF shl 24) or (ch(5f) shl 16) or (ch(3f) shl 8) or ch(1f)
  }

  private fun chRange(box: List<Int>, ch: Int): Int {
    var lo = 255
    var hi = 0
    for (p in box) {
      val v = (p shr ch) and 255
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    return hi - lo
  }

  private fun range(box: List<Int>) = maxOf(chRange(box, 16), chRange(box, 8), chRange(box, 0))

  private fun widestChannel(box: List<Int>) = listOf(16, 8, 0).maxByOrNull { chRange(box, it) }!!

  // Cuts at the value change nearest the median so equal pixels never straddle two boxes.
  private fun cutIndex(sorted: List<Int>, ch: Int): Int {
    val mid = sorted.size / 2
    fun edge(i: Int) = ((sorted[i - 1] shr ch) and 255) != ((sorted[i] shr ch) and 255)
    for (d in 0..sorted.size) {
      if (mid - d >= 1 && edge(mid - d)) return mid - d
      if (mid + d < sorted.size && mid + d >= 1 && edge(mid + d)) return mid + d
    }
    return mid
  }

  private fun mean(box: List<Int>): Int {
    fun avg(ch: Int) = (box.sumOf { ((it shr ch) and 255).toLong() }.toDouble() / box.size).roundToInt()
    return (0xFF shl 24) or (avg(16) shl 16) or (avg(8) shl 8) or avg(0)
  }
}
