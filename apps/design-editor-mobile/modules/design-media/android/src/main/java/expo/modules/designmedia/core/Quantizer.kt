package expo.modules.designmedia.core

// Median-cut palette from a histogram of 5-bit-per-channel colours, filled frame by frame so a whole clip never
// sits in memory. Original code: gifenc's quantizer descends from PnnQuant.js (MPL-2.0), so it is not ported (THIRD_PARTY_NOTICES.txt).
class Histogram {
  private val rs = LongArray(KEYS)
  private val gs = LongArray(KEYS)
  private val bs = LongArray(KEYS)
  private val counts = IntArray(KEYS)

  fun add(rgb: IntArray, length: Int = rgb.size) {
    for (i in 0 until length) {
      val c = rgb[i]
      val r = (c shr 16) and 0xFF
      val g = (c shr 8) and 0xFF
      val b = c and 0xFF
      val key = key(r, g, b)
      rs[key] += r.toLong()
      gs[key] += g.toLong()
      bs[key] += b.toLong()
      counts[key]++
    }
  }

  // Splits the box with the most pixels times the widest colour range at its pixel-count median, until `maxColors`
  // boxes remain; each box becomes the mean colour of its pixels. 0xRRGGBB entries, no duplicates.
  fun palette(maxColors: Int): IntArray {
    val keys = (0 until KEYS).filter { counts[it] > 0 }
    val n = keys.size
    if (n == 0) return IntArray(0)
    val cnt = LongArray(n) { counts[keys[it]].toLong() }
    val er = IntArray(n) { (rs[keys[it]] / cnt[it]).toInt() }
    val eg = IntArray(n) { (gs[keys[it]] / cnt[it]).toInt() }
    val eb = IntArray(n) { (bs[keys[it]] / cnt[it]).toInt() }
    if (n <= maxColors) return (0 until n).map { rgb(er[it], eg[it], eb[it]) }.distinct().toIntArray()

    fun channel(e: Int, ch: Int) = when (ch) {
      0 -> er[e]
      1 -> eg[e]
      else -> eb[e]
    }

    class Box(val entries: IntArray) {
      var total = 0L
      var widest = 0
      var range = 0

      init {
        val lo = intArrayOf(255, 255, 255)
        val hi = intArrayOf(0, 0, 0)
        for (e in entries) {
          total += cnt[e]
          for (ch in 0..2) {
            lo[ch] = minOf(lo[ch], channel(e, ch))
            hi[ch] = maxOf(hi[ch], channel(e, ch))
          }
        }
        for (ch in 0..2) if (hi[ch] - lo[ch] > range) {
          range = hi[ch] - lo[ch]
          widest = ch
        }
      }

      val priority get() = if (entries.size > 1) total * range else 0L
    }

    val boxes = arrayListOf(Box(IntArray(n) { it }))
    while (boxes.size < maxColors) {
      val pick = boxes.indices.maxByOrNull { boxes[it].priority }!!
      val box = boxes[pick]
      if (box.priority == 0L) break
      boxes.removeAt(pick)
      val sorted = box.entries.sortedBy { channel(it, box.widest) }
      var seen = 0L
      var cut = sorted.size - 1
      for ((i, e) in sorted.withIndex()) {
        seen += cnt[e]
        if (seen * 2 >= box.total) {
          cut = (i + 1).coerceIn(1, sorted.size - 1)
          break
        }
      }
      boxes.add(Box(sorted.subList(0, cut).toIntArray()))
      boxes.add(Box(sorted.subList(cut, sorted.size).toIntArray()))
    }
    return boxes.map { box ->
      var r = 0L
      var g = 0L
      var b = 0L
      for (e in box.entries) {
        r += rs[keys[e]]
        g += gs[keys[e]]
        b += bs[keys[e]]
      }
      rgb(Math.round(r.toDouble() / box.total).toInt(), Math.round(g.toDouble() / box.total).toInt(), Math.round(b.toDouble() / box.total).toInt())
    }.distinct().toIntArray()
  }

  companion object {
    const val KEYS = 32768

    fun key(r: Int, g: Int, b: Int): Int = ((r shr 3) shl 10) or ((g shr 3) shl 5) or (b shr 3)

    private fun rgb(r: Int, g: Int, b: Int) = (r shl 16) or (g shl 8) or b
  }
}
