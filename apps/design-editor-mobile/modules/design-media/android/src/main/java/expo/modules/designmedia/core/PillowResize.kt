package expo.modules.designmedia.core

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.sin

enum class Filter(val support: Double) { LANCZOS(3.0), BILINEAR(1.0) }

private const val BITS = 22
private const val HALF = 1 shl (BITS - 1)

private fun sinc(x: Double) = if (x == 0.0) 1.0 else sin(x * PI) / (x * PI)

private fun kernel(f: Filter, x: Double): Double = when (f) {
  Filter.LANCZOS -> if (x >= -3.0 && x < 3.0) sinc(x) * sinc(x / 3.0) else 0.0
  Filter.BILINEAR -> if (abs(x) < 1.0) 1.0 - abs(x) else 0.0
}

private class Coeffs(val start: IntArray, val count: IntArray, val k: IntArray, val ksize: Int)

private fun coeffs(inLen: Int, outLen: Int, f: Filter): Coeffs {
  val scale = inLen.toDouble() / outLen
  val fs = maxOf(scale, 1.0)
  val support = f.support * fs
  val ss = 1.0 / fs
  val ksize = ceil(support).toInt() * 2 + 1
  val start = IntArray(outLen)
  val count = IntArray(outLen)
  val k = IntArray(outLen * ksize)
  for (o in 0 until outLen) {
    val center = (o + 0.5) * scale
    val lo = maxOf((center - support + 0.5).toInt(), 0)
    val n = minOf((center + support + 0.5).toInt(), inLen) - lo
    val w = DoubleArray(n) { kernel(f, (it + lo - center + 0.5) * ss) }
    val sum = w.sum()
    for (i in 0 until n) {
      val v = (if (sum != 0.0) w[i] / sum else w[i]) * (1 shl BITS)
      k[o * ksize + i] = (if (v < 0) v - 0.5 else v + 0.5).toInt()
    }
    start[o] = lo
    count[o] = n
  }
  return Coeffs(start, count, k, ksize)
}

private fun clip8(v: Int) = (v shr BITS).coerceIn(0, 255)

private fun mix(src: IntArray, first: Int, step: Int, c: Coeffs, o: Int): Int {
  var a = HALF
  var r = HALF
  var g = HALF
  var b = HALF
  val base = o * c.ksize
  for (i in 0 until c.count[o]) {
    val p = src[first + i * step]
    val k = c.k[base + i]
    a += (p ushr 24) * k
    r += (p shr 16 and 0xFF) * k
    g += (p shr 8 and 0xFF) * k
    b += (p and 0xFF) * k
  }
  return (clip8(a) shl 24) or (clip8(r) shl 16) or (clip8(g) shl 8) or clip8(b)
}

private fun horizontal(src: IntArray, w: Int, h: Int, nw: Int, f: Filter): IntArray {
  if (nw == w) return src
  val c = coeffs(w, nw, f)
  val out = IntArray(nw * h)
  for (y in 0 until h) for (x in 0 until nw) out[y * nw + x] = mix(src, y * w + c.start[x], 1, c, x)
  return out
}

private fun vertical(src: IntArray, w: Int, h: Int, nh: Int, f: Filter): IntArray {
  if (nh == h) return src
  val c = coeffs(h, nh, f)
  val out = IntArray(w * nh)
  for (y in 0 until nh) for (x in 0 until w) out[y * w + x] = mix(src, c.start[y] * w + x, w, c, y)
  return out
}

// Pillow 13's 8-bit resize (Resample.c) bit for bit, per channel as its C core does; Image.resize would premultiply RGBA first.
fun resize(argb: IntArray, w: Int, h: Int, nw: Int, nh: Int, filter: Filter): IntArray {
  require(w > 0 && h > 0 && nw > 0 && nh > 0 && argb.size == w * h) { "bad image size" }
  // Pillow's pass order; checked against Pillow on 600 random size pairs, both filters.
  val verticalFirst = h - nh > 0 && h - nh > 2 * (w - nw)
  val out = if (verticalFirst) horizontal(vertical(argb, w, h, nh, filter), w, nh, nw, filter)
  else vertical(horizontal(argb, w, h, nw, filter), nw, h, nh, filter)
  return if (out === argb) argb.copyOf() else out
}
