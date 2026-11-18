package expo.modules.designmedia.core

import kotlin.math.abs
import kotlin.math.ceil

private const val SIDE = 224
private const val BITS = 22
private val MEAN = floatArrayOf(0.48145466f, 0.4578275f, 0.40821073f)
private val STD = floatArrayOf(0.26862954f, 0.26130258f, 0.27577711f)

// Mirrors Pillow's 8-bit BICUBIC resample (Resample.c) so the tensor matches what CLIP was benchmarked with.
fun clipTensor(argb: IntArray, width: Int, height: Int): FloatArray {
  require(width > 0 && height > 0 && argb.size == width * height) { "bad image size" }
  val k = SIDE.toDouble() / minOf(width, height)
  val outW = Math.rint(width * k).toInt()
  val outH = Math.rint(height * k).toInt()
  val left = (outW - SIDE) / 2
  val top = (outH - SIDE) / 2
  val plane = SIDE * SIDE
  val out = FloatArray(3 * plane)
  for (c in 0 until 3) {
    val shift = 16 - 8 * c
    val src = IntArray(argb.size) { (argb[it] shr shift) and 0xFF }
    val resized = pass(pass(src, width, height, outW), height, outW, outH)
    for (y in 0 until SIDE) for (x in 0 until SIDE) {
      out[c * plane + y * SIDE + x] = (resized[(y + top) * outW + x + left] / 255f - MEAN[c]) / STD[c]
    }
  }
  return out
}

private fun bicubic(x: Double): Double {
  val a = -0.5
  val t = abs(x)
  return when {
    t < 1.0 -> ((a + 2.0) * t - (a + 3.0)) * t * t + 1
    t < 2.0 -> (((t - 5) * t + 8) * t - 4) * a
    else -> 0.0
  }
}

// Output is transposed, so a pass over rows then one over columns gives a row-major image again.
private fun pass(src: IntArray, inLen: Int, lines: Int, outLen: Int): IntArray {
  val scale = inLen.toDouble() / outLen
  val filterScale = maxOf(1.0, scale)
  val support = 2.0 * filterScale
  val ss = 1.0 / filterScale
  val ksize = ceil(support).toInt() * 2 + 1
  val starts = IntArray(outLen)
  val counts = IntArray(outLen)
  val kk = IntArray(outLen * ksize)
  for (o in 0 until outLen) {
    val center = (o + 0.5) * scale
    val min = maxOf(0, (center - support + 0.5).toInt())
    val n = minOf(inLen, (center + support + 0.5).toInt()) - min
    val w = DoubleArray(n) { bicubic((it + min - center + 0.5) * ss) }
    val sum = w.sum()
    for (i in 0 until n) {
      val v = (if (sum != 0.0) w[i] / sum else w[i]) * (1 shl BITS)
      kk[o * ksize + i] = (if (v < 0) v - 0.5 else v + 0.5).toInt()
    }
    starts[o] = min
    counts[o] = n
  }
  val out = IntArray(outLen * lines)
  for (line in 0 until lines) {
    val base = line * inLen
    for (o in 0 until outLen) {
      var acc = 1 shl (BITS - 1)
      for (i in 0 until counts[o]) acc += src[base + starts[o] + i] * kk[o * ksize + i]
      out[o * lines + line] = (acc shr BITS).coerceIn(0, 255)
    }
  }
  return out
}
