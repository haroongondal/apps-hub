package expo.modules.pdfscan.core

import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

// SPEC §7.5 step 5 and design 2026-11-18 §3. In place on opaque ARGB pixels; no Android classes.
object Filters {
  private const val SCALE = 8
  private const val SATURATION = 1.15
  private const val SHARPEN = 0.6
  private const val SHARPEN_RADIUS = 2
  private const val MIN_SPAN = 128 // stretch gain at most 2, so a page with almost no ink keeps its paper white
  private const val SAUVOLA_R = 128.0

  fun magic(argb: IntArray, w: Int, h: Int) {
    val bg = background(argb, w, h)
    val hist = IntArray(256)
    for (y in 0 until h) for (x in 0 until w) {
      val i = y * w + x
      val c = argb[i]
      val f = 255f / max(1f, bg.at(x, y))
      val r = min(255, (((c shr 16) and 0xFF) * f).toInt())
      val g = min(255, (((c shr 8) and 0xFF) * f).toInt())
      val b = min(255, ((c and 0xFF) * f).toInt())
      argb[i] = rgb(r, g, b)
      hist[luma(r, g, b)]++
    }
    val lut = stretch(hist, w * h)
    for (i in argb.indices) {
      val c = argb[i]
      val r = lut[(c shr 16) and 0xFF]
      val g = lut[(c shr 8) and 0xFF]
      val b = lut[c and 0xFF]
      val l = luma(r, g, b)
      argb[i] = rgb(lift(l, r), lift(l, g), lift(l, b))
    }
  }

  fun gray(argb: IntArray, w: Int, h: Int) {
    grayPlane(argb, w, h)
  }

  fun sauvola(argb: IntArray, w: Int, h: Int, window: Int = 31, k: Double = 0.2): ByteArray {
    val plane = grayPlane(argb, w, h)
    val hw = (w + 1) / 2
    val hh = (h + 1) / 2
    val mean = FloatArray(hw * hh)
    val sq = FloatArray(hw * hh)
    for (y in 0 until hh) for (x in 0 until hw) {
      var s = 0f
      var n = 0
      for (dy in 0..1) for (dx in 0..1) {
        val sx = x * 2 + dx
        val sy = y * 2 + dy
        if (sx < w && sy < h) { s += plane[sy * w + sx].toInt() and 0xFF; n++ }
      }
      val v = s / n
      mean[y * hw + x] = v
      sq[y * hw + x] = v * v
    }
    val r = max(1, window / 4)
    val m = box(mean, hw, hh, r)
    val m2 = box(sq, hw, hh, r)
    val sd = FloatArray(hw * hh) { sqrt(max(0f, m2[it] - m[it] * m[it])) }
    val mm = Grid(m, hw, hh, 2)
    val ss = Grid(sd, hw, hh, 2)
    val out = ByteArray(w * h)
    for (y in 0 until h) for (x in 0 until w) {
      val i = y * w + x
      val t = mm.at(x, y) * (1 + k * (ss.at(x, y) / SAUVOLA_R - 1))
      val white = (plane[i].toInt() and 0xFF) > t
      out[i] = if (white) 255.toByte() else 0
      argb[i] = if (white) rgb(255, 255, 255) else rgb(0, 0, 0)
    }
    return out
  }

  private fun grayPlane(argb: IntArray, w: Int, h: Int): ByteArray {
    val bg = background(argb, w, h)
    val plane = ByteArray(w * h)
    val hist = IntArray(256)
    for (y in 0 until h) for (x in 0 until w) {
      val i = y * w + x
      val v = min(255, (luma(argb[i]) * 255f / max(1f, bg.at(x, y))).toInt())
      plane[i] = v.toByte()
      hist[v]++
    }
    val lut = stretch(hist, w * h)
    for (i in plane.indices) plane[i] = lut[plane[i].toInt() and 0xFF].toByte()
    val blur = boxBytes(plane, w, h, SHARPEN_RADIUS)
    for (i in plane.indices) {
      val v = plane[i].toInt() and 0xFF
      val s = (v + SHARPEN * (v - (blur[i].toInt() and 0xFF))).roundToInt().coerceIn(0, 255)
      plane[i] = s.toByte()
      argb[i] = rgb(s, s, s)
    }
    return plane
  }

  private fun background(argb: IntArray, w: Int, h: Int): Grid {
    val sw = (w + SCALE - 1) / SCALE
    val sh = (h + SCALE - 1) / SCALE
    val small = FloatArray(sw * sh)
    val count = IntArray(sw * sh)
    for (y in 0 until h) for (x in 0 until w) {
      val j = (y / SCALE) * sw + x / SCALE
      small[j] += luma(argb[y * w + x]).toFloat()
      count[j]++
    }
    for (j in small.indices) small[j] /= count[j]
    val r = max(1, (w / 20.0 / SCALE / 2).roundToInt())
    return Grid(box(maxFilter(small, sw, sh, r), sw, sh, r), sw, sh, SCALE)
  }

  private fun stretch(hist: IntArray, n: Int): IntArray {
    var lo = percentile(hist, n * 0.01)
    var hi = percentile(hist, n * 0.99)
    if (hi - lo < MIN_SPAN) {
      lo = max(0, hi - MIN_SPAN)
      hi = lo + MIN_SPAN
    }
    return IntArray(256) { v -> ((v - lo) * 255 / (hi - lo)).coerceIn(0, 255) }
  }

  private fun percentile(hist: IntArray, at: Double): Int {
    var acc = 0L
    for (v in 0 until 256) {
      acc += hist[v]
      if (acc > at) return v
    }
    return 255
  }

  private fun maxFilter(src: FloatArray, w: Int, h: Int, r: Int): FloatArray {
    val tmp = FloatArray(src.size)
    val out = FloatArray(src.size)
    for (y in 0 until h) for (x in 0 until w) {
      var m = 0f
      for (d in max(0, x - r)..min(w - 1, x + r)) m = max(m, src[y * w + d])
      tmp[y * w + x] = m
    }
    for (y in 0 until h) for (x in 0 until w) {
      var m = 0f
      for (d in max(0, y - r)..min(h - 1, y + r)) m = max(m, tmp[d * w + x])
      out[y * w + x] = m
    }
    return out
  }

  private fun box(src: FloatArray, w: Int, h: Int, r: Int): FloatArray {
    val tmp = FloatArray(src.size)
    val out = FloatArray(src.size)
    for (y in 0 until h) for (x in 0 until w) {
      var s = 0f
      val a = max(0, x - r)
      val b = min(w - 1, x + r)
      for (d in a..b) s += src[y * w + d]
      tmp[y * w + x] = s / (b - a + 1)
    }
    for (y in 0 until h) for (x in 0 until w) {
      var s = 0f
      val a = max(0, y - r)
      val b = min(h - 1, y + r)
      for (d in a..b) s += tmp[d * w + x]
      out[y * w + x] = s / (b - a + 1)
    }
    return out
  }

  private fun boxBytes(src: ByteArray, w: Int, h: Int, r: Int): ByteArray {
    val tmp = ByteArray(src.size)
    val out = ByteArray(src.size)
    for (y in 0 until h) for (x in 0 until w) {
      var s = 0
      val a = max(0, x - r)
      val b = min(w - 1, x + r)
      for (d in a..b) s += src[y * w + d].toInt() and 0xFF
      tmp[y * w + x] = (s / (b - a + 1)).toByte()
    }
    for (y in 0 until h) for (x in 0 until w) {
      var s = 0
      val a = max(0, y - r)
      val b = min(h - 1, y + r)
      for (d in a..b) s += tmp[d * w + x].toInt() and 0xFF
      out[y * w + x] = (s / (b - a + 1)).toByte()
    }
    return out
  }

  // Cell (i, j) covers full-size pixels i*scale until (i+1)*scale; sampled bilinearly between cell centres.
  private class Grid(val v: FloatArray, val w: Int, val h: Int, val scale: Int) {
    fun at(x: Int, y: Int): Float {
      val fx = ((x + 0.5f) / scale - 0.5f).coerceIn(0f, (w - 1).toFloat())
      val fy = ((y + 0.5f) / scale - 0.5f).coerceIn(0f, (h - 1).toFloat())
      val x0 = floor(fx).toInt()
      val y0 = floor(fy).toInt()
      val x1 = min(w - 1, x0 + 1)
      val y1 = min(h - 1, y0 + 1)
      val tx = fx - x0
      val ty = fy - y0
      val top = v[y0 * w + x0] * (1 - tx) + v[y0 * w + x1] * tx
      val bottom = v[y1 * w + x0] * (1 - tx) + v[y1 * w + x1] * tx
      return top * (1 - ty) + bottom * ty
    }
  }

  private fun lift(l: Int, c: Int) = (l + (c - l) * SATURATION).roundToInt().coerceIn(0, 255)
  private fun luma(r: Int, g: Int, b: Int) = (r * 77 + g * 150 + b * 29) shr 8
  private fun luma(c: Int) = luma((c shr 16) and 0xFF, (c shr 8) and 0xFF, c and 0xFF)
  private fun rgb(r: Int, g: Int, b: Int) = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
}
