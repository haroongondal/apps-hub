package expo.modules.designmedia.core

// Maps RGB pixels to palette indices with a 4x4 Bayer ordered dither. The nearest palette colour is cached per
// 5-bit colour, so a flat area costs one search.
class Dither(private val palette: IntArray) {
  private val cache = IntArray(Histogram.KEYS) { -1 }

  fun apply(rgb: IntArray, width: Int, height: Int, out: ByteArray) {
    for (y in 0 until height) {
      for (x in 0 until width) {
        val offset = OFFSETS[(y and 3) * 4 + (x and 3)]
        val c = rgb[y * width + x]
        val r = (((c shr 16) and 0xFF) + offset).coerceIn(0, 255)
        val g = (((c shr 8) and 0xFF) + offset).coerceIn(0, 255)
        val b = ((c and 0xFF) + offset).coerceIn(0, 255)
        val key = Histogram.key(r, g, b)
        var index = cache[key]
        if (index < 0) {
          index = nearest(r, g, b)
          cache[key] = index
        }
        out[y * width + x] = index.toByte()
      }
    }
  }

  private fun nearest(r: Int, g: Int, b: Int): Int {
    var best = 0
    var bestDist = Int.MAX_VALUE
    for (i in palette.indices) {
      val p = palette[i]
      val dr = ((p shr 16) and 0xFF) - r
      val dg = ((p shr 8) and 0xFF) - g
      val db = (p and 0xFF) - b
      val dist = dr * dr + dg * dg + db * db
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    }
    return best
  }

  companion object {
    val BAYER = intArrayOf(0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5)
    const val SPREAD = 16
    val OFFSETS = IntArray(16) { (2 * BAYER[it] - 15) * SPREAD / 32 }
  }
}
