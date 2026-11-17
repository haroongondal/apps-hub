package expo.modules.designmedia.core

import kotlin.math.sqrt

// Clean up score maths: a Kotlin port of tools/gallery-cleanup-bench/ref.py (its docstring is the exact recipe).

// Pillow "L", integer only.
fun grey(argb: IntArray): ByteArray = ByteArray(argb.size) {
  val p = argb[it]
  ((19595 * ((p shr 16) and 255) + 38470 * ((p shr 8) and 255) + 7471 * (p and 255) + 32768) shr 16).toByte()
}

// 9x8 exact area average in integers; bit 63 = row 0 pair 0; a flat image hashes to 0.
fun dhash(g: ByteArray, w: Int, h: Int): Long {
  val s = Array(8) { LongArray(9) }
  val row = LongArray(9)
  for (y in 0 until h) {
    row.fill(0)
    val base = y * w
    for (x in 0 until w) {
      val v = g[base + x].toInt() and 255
      for (j in 9 * x / w..minOf(8, (9 * x + 8) / w))
        row[j] += (minOf(9 * x + 9, (j + 1) * w) - maxOf(9 * x, j * w)).toLong() * v
    }
    for (i in 8 * y / h..minOf(7, (8 * y + 7) / h)) {
      val wy = (minOf(8 * y + 8, (i + 1) * h) - maxOf(8 * y, i * h)).toLong()
      for (j in 0 until 9) s[i][j] += wy * row[j]
    }
  }
  var hash = 0L
  for (i in 0 until 8) for (j in 0 until 8) hash = (hash shl 1) or (if (s[i][j] < s[i][j + 1]) 1L else 0L)
  return hash
}

fun hamming(a: Long, b: Long): Int = java.lang.Long.bitCount(a xor b)

// [mean, population std] of g/255; integer sums first (exact in Long up to about 4 megapixels).
fun brightness(g: ByteArray): DoubleArray {
  val n = g.size.toLong()
  var s1 = 0L
  var s2 = 0L
  for (b in g) { val v = b.toInt() and 255; s1 += v; s2 += v * v }
  return doubleArrayOf(s1.toDouble() / n / 255, sqrt((n * s2 - s1 * s1).toDouble()) / n / 255)
}

// 3x3 Laplacian, valid region only, population variance on the 0..255 scale; 0 below 3x3.
fun laplacianVar(g: ByteArray, w: Int, h: Int): Double {
  if (w < 3 || h < 3) return 0.0
  var t1 = 0L
  var t2 = 0L
  val m = (w - 2).toLong() * (h - 2)
  for (y in 1 until h - 1) {
    for (x in 1 until w - 1) {
      val i = y * w + x
      val o = ((g[i - w].toInt() and 255) + (g[i + w].toInt() and 255) + (g[i - 1].toInt() and 255) +
        (g[i + 1].toInt() and 255) - 4 * (g[i].toInt() and 255)).toLong()
      t1 += o
      t2 += o * o
    }
  }
  return (m * t2 - t1 * t1).toDouble() / (m * m).toDouble()
}

// Spec: same aspect ratio within 2 %.
fun aspectClose(w1: Int, h1: Int, w2: Int, h2: Int, tol: Double = 0.02): Boolean {
  val r1 = w1.toDouble() / h1
  val r2 = w2.toDouble() / h2
  return Math.abs(r1 - r2) / maxOf(r1, r2) <= tol
}

// Long side 512, never upscaled; short side floor(s * 512 / long + 0.5), at least 1.
fun thumb512Size(w: Int, h: Int): Pair<Int, Int> {
  val long = maxOf(w, h)
  if (long <= 512) return w to h
  return maxOf(1, (w * 1024 + long) / (2 * long)) to maxOf(1, (h * 1024 + long) / (2 * long))
}

data class PhotoScores(val dhash: Long, val mean: Float, val spread: Float, val laplacian: Float, val width: Int, val height: Int)

fun scoresOf(argb: IntArray, w: Int, h: Int): PhotoScores {
  val g = grey(argb)
  val b = brightness(g)
  return PhotoScores(dhash(g, w, h), b[0].toFloat(), b[1].toFloat(), laplacianVar(g, w, h).toFloat(), w, h)
}
