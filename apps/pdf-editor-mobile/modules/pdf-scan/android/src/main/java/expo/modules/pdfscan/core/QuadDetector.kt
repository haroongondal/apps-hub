package expo.modules.pdfscan.core

import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.ceil
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

data class DetectorConfig(
  val maxSide: Int = 320,
  val highPercentile: Double = 0.90,
  val highFloor: Int = 20,
  val lowRatio: Double = 0.4,
  val minComponentShare: Double = 0.25,
  val dpEpsilonShare: Double = 0.02,
  val maxHullVertices: Int = 16,
  val minAreaShare: Double = 0.20,
  val minAngleDeg: Double = 50.0,
  val maxAngleDeg: Double = 130.0,
  // Per side, not overall: a page running out of the frame has one side with no edge under it.
  val minSupport: Double = 0.60,
  val supportSamples: Int = 64,
  val supportRadius: Int = 2,
  val borderShare: Double = 0.01,
)

class Detection(val quad: DoubleArray, val aspect: Double, val sharpness: Double, val thumb: ByteArray) {
  fun rotated(degrees: Int): Detection {
    val r = ((degrees % 360) + 360) % 360
    if (r == 0) return this
    return Detection(Quads.rotate(quad, r), if (r == 180) aspect else 1 / aspect, sharpness, thumb)
  }
}

// SPEC §7.2. Not thread-safe: buffers are reused between frames of one size.
class QuadDetector(val config: DetectorConfig = DetectorConfig()) {
  private var w = 0
  private var h = 0
  private var small = IntArray(0)
  private var tmp = IntArray(0)
  private var blur = IntArray(0)
  private var mag = IntArray(0)
  private var nms = IntArray(0)
  private var edge = ByteArray(0)
  private var dilated = ByteArray(0)
  private var seen = ByteArray(0)
  private var stack = IntArray(0)
  private var members = IntArray(0)
  private val hist = IntArray(HIST)

  var lastHigh = 0
    private set

  fun detect(luma: Luma): Detection? {
    val f = max(1, ceil(max(luma.width, luma.height).toDouble() / config.maxSide).toInt())
    allocate(luma.width / f, luma.height / f)
    downscale(luma, f)
    gaussian()
    sobel()
    hysteresis()
    dilate()
    val best = findBest() ?: return null
    val sx = w.toDouble() * f / luma.width
    val sy = h.toDouble() * f / luma.height
    // The fitted side lines can meet just outside the frame; the contract is 0..1.
    val quad = DoubleArray(8) { i -> (if (i % 2 == 0) (best[i] + 0.5) / w * sx else (best[i] + 0.5) / h * sy).coerceIn(0.0, 1.0) }
    return Detection(quad, luma.width.toDouble() / luma.height, sharpness(best), thumbnail(best))
  }

  private fun allocate(nw: Int, nh: Int) {
    if (nw == w && nh == h) return
    w = nw
    h = nh
    val n = w * h
    small = IntArray(n); tmp = IntArray(n); blur = IntArray(n); mag = IntArray(n); nms = IntArray(n)
    edge = ByteArray(n); dilated = ByteArray(n); seen = ByteArray(n)
    stack = IntArray(n); members = IntArray(n)
  }

  private fun downscale(luma: Luma, f: Int) {
    val area = f * f
    for (y in 0 until h) {
      for (x in 0 until w) {
        var sum = 0
        for (dy in 0 until f) {
          val row = (y * f + dy) * luma.rowStride + x * f
          for (dx in 0 until f) sum += luma.data[row + dx].toInt() and 0xFF
        }
        small[y * w + x] = sum / area
      }
    }
  }

  private fun gaussian() {
    for (y in 0 until h) {
      val r = y * w
      for (x in 0 until w) {
        tmp[r + x] = small[r + cx(x - 2)] + 4 * small[r + cx(x - 1)] + 6 * small[r + x] +
          4 * small[r + cx(x + 1)] + small[r + cx(x + 2)]
      }
    }
    for (y in 0 until h) {
      for (x in 0 until w) {
        blur[y * w + x] = (tmp[cy(y - 2) * w + x] + 4 * tmp[cy(y - 1) * w + x] + 6 * tmp[y * w + x] +
          4 * tmp[cy(y + 1) * w + x] + tmp[cy(y + 2) * w + x]) / 256
      }
    }
  }

  private fun cx(x: Int) = if (x < 0) 0 else if (x >= w) w - 1 else x
  private fun cy(y: Int) = if (y < 0) 0 else if (y >= h) h - 1 else y

  private fun sobel() {
    mag.fill(0)
    nms.fill(0)
    hist.fill(0)
    for (y in 1 until h - 1) {
      for (x in 1 until w - 1) {
        val i = y * w + x
        val gx = blur[i - w + 1] + 2 * blur[i + 1] + blur[i + w + 1] - blur[i - w - 1] - 2 * blur[i - 1] - blur[i + w - 1]
        val gy = blur[i + w - 1] + 2 * blur[i + w] + blur[i + w + 1] - blur[i - w - 1] - 2 * blur[i - w] - blur[i - w + 1]
        val m = (sqrt((gx * gx + gy * gy).toDouble()) / 4).toInt()
        mag[i] = m
        hist[min(m, HIST - 1)]++
        tmp[i] = when {
          abs(gy) * 1000 < abs(gx) * 414 -> DIR_H
          abs(gx) * 1000 < abs(gy) * 414 -> DIR_V
          (gx > 0) == (gy > 0) -> DIR_DOWN
          else -> DIR_UP
        }
      }
    }
    for (y in 1 until h - 1) {
      for (x in 1 until w - 1) {
        val i = y * w + x
        val m = mag[i]
        if (m == 0) continue
        val a: Int
        val b: Int
        when (tmp[i]) {
          DIR_H -> { a = mag[i - 1]; b = mag[i + 1] }
          DIR_V -> { a = mag[i - w]; b = mag[i + w] }
          DIR_DOWN -> { a = mag[i - w - 1]; b = mag[i + w + 1] }
          else -> { a = mag[i - w + 1]; b = mag[i + w - 1] }
        }
        if (m > a && m >= b) nms[i] = m
      }
    }
  }

  private fun hysteresis() {
    val target = ((w - 2) * (h - 2) * config.highPercentile).toInt()
    var acc = 0
    var p = 0
    while (p < HIST - 1 && acc + hist[p] <= target) acc += hist[p++]
    val high = max(config.highFloor, p)
    val low = max(1, (high * config.lowRatio).roundToInt())
    lastHigh = high
    edge.fill(0)
    var sp = 0
    for (i in nms.indices) {
      if (nms[i] >= high) { edge[i] = 1; stack[sp++] = i }
    }
    while (sp > 0) {
      val i = stack[--sp]
      val x = i % w
      val y = i / w
      for (dy in -1..1) for (dx in -1..1) {
        val nx = x + dx
        val ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        val j = ny * w + nx
        if (edge[j].toInt() == 0 && nms[j] >= low) { edge[j] = 1; stack[sp++] = j }
      }
    }
  }

  private fun dilate() {
    for (y in 0 until h) {
      for (x in 0 until w) {
        var on = 0
        loop@ for (dy in -1..1) for (dx in -1..1) {
          val nx = x + dx
          val ny = y + dy
          if (nx in 0 until w && ny in 0 until h && edge[ny * w + nx].toInt() != 0) { on = 1; break@loop }
        }
        dilated[y * w + x] = on.toByte()
      }
    }
  }

  private fun findBest(): DoubleArray? {
    seen.fill(0)
    val minW = w * config.minComponentShare
    val minH = h * config.minComponentShare
    var best: DoubleArray? = null
    var bestScore = 0.0
    for (start in 0 until w * h) {
      if (dilated[start].toInt() == 0 || seen[start].toInt() != 0) continue
      var sp = 0
      var count = 0
      stack[sp++] = start
      seen[start] = 1
      var x0 = w
      var x1 = -1
      var y0 = h
      var y1 = -1
      while (sp > 0) {
        val i = stack[--sp]
        members[count++] = i
        val x = i % w
        val y = i / w
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
        for (dy in -1..1) for (dx in -1..1) {
          val nx = x + dx
          val ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          val j = ny * w + nx
          if (dilated[j].toInt() != 0 && seen[j].toInt() == 0) { seen[j] = 1; stack[sp++] = j }
        }
      }
      if (x1 - x0 + 1 < minW || y1 - y0 + 1 < minH) continue
      val quad = quadOf(count, y0, y1) ?: continue
      val support = minSideSupport(quad)
      if (support < config.minSupport) continue
      val score = area(quad) * support
      if (score > bestScore) { bestScore = score; best = quad }
    }
    return best
  }

  private fun quadOf(count: Int, y0: Int, y1: Int): DoubleArray? {
    val rows = y1 - y0 + 1
    val left = IntArray(rows) { Int.MAX_VALUE }
    val right = IntArray(rows) { -1 }
    for (k in 0 until count) {
      val i = members[k]
      val r = i / w - y0
      val x = i % w
      if (x < left[r]) left[r] = x
      if (x > right[r]) right[r] = x
    }
    val pts = ArrayList<IntArray>(rows * 2)
    for (r in 0 until rows) {
      if (right[r] < 0) continue
      pts.add(intArrayOf(left[r], r + y0))
      if (right[r] != left[r]) pts.add(intArrayOf(right[r], r + y0))
    }
    val hull = convexHull(pts)
    if (hull.size < 4) return null
    var perimeter = 0.0
    for (k in hull.indices) {
      val a = hull[k]
      val b = hull[(k + 1) % hull.size]
      perimeter += hypot((a[0] - b[0]).toDouble(), (a[1] - b[1]).toDouble())
    }
    var eps = perimeter * config.dpEpsilonShare
    var poly = simplifyClosed(hull, eps)
    while (poly.size > config.maxHullVertices) {
      eps *= 1.5
      poly = simplifyClosed(hull, eps)
    }
    if (poly.size < 4) return null
    val quad = refine(refine(largestQuad(poly), 4.0), 2.0)
    return if (accept(quad)) quad else null
  }

  // Douglas–Peucker always keeps hull vertex 0, which on a tilted page sits up a side, not on the corner.
  private fun refine(q: DoubleArray, band: Double): DoubleArray {
    val n = IntArray(4)
    val sx = DoubleArray(4); val sy = DoubleArray(4); val sxx = DoubleArray(4); val syy = DoubleArray(4); val sxy = DoubleArray(4)
    val xa = max(0, (minOf(q[0], q[2], q[4], q[6]) - band).toInt())
    val xb = min(w - 1, (maxOf(q[0], q[2], q[4], q[6]) + band).toInt() + 1)
    val ya = max(0, (minOf(q[1], q[3], q[5], q[7]) - band).toInt())
    val yb = min(h - 1, (maxOf(q[1], q[3], q[5], q[7]) + band).toInt() + 1)
    for (y in ya..yb) for (x in xa..xb) {
      if (edge[y * w + x].toInt() == 0) continue
      for (k in 0 until 4) {
        val ax = q[k * 2]; val ay = q[k * 2 + 1]
        val dx = q[((k + 1) % 4) * 2] - ax; val dy = q[((k + 1) % 4) * 2 + 1] - ay
        val len2 = dx * dx + dy * dy
        val t = ((x - ax) * dx + (y - ay) * dy) / len2
        if (t < 0.1 || t > 0.9) continue
        if (abs((x - ax) * dy - (y - ay) * dx) / sqrt(len2) > band) continue
        n[k]++; sx[k] += x.toDouble(); sy[k] += y.toDouble(); sxx[k] += x.toDouble() * x; syy[k] += y.toDouble() * y; sxy[k] += x.toDouble() * y
      }
    }
    if (n.any { it < 8 }) return q
    // each side as a point (mx, my) and the principal direction (ux, uy) of its pixels
    val line = Array(4) { k ->
      val mx = sx[k] / n[k]; val my = sy[k] / n[k]
      val cxx = sxx[k] / n[k] - mx * mx; val cyy = syy[k] / n[k] - my * my; val cxy = sxy[k] / n[k] - mx * my
      val theta = 0.5 * kotlin.math.atan2(2 * cxy, cxx - cyy)
      doubleArrayOf(mx, my, kotlin.math.cos(theta), kotlin.math.sin(theta))
    }
    val out = DoubleArray(8)
    for (k in 0 until 4) {
      val a = line[(k + 3) % 4]
      val b = line[k]
      val det = a[2] * b[3] - a[3] * b[2]
      if (abs(det) < 1e-6) return q
      val s = ((b[0] - a[0]) * b[3] - (b[1] - a[1]) * b[2]) / det
      out[k * 2] = a[0] + s * a[2]
      out[k * 2 + 1] = a[1] + s * a[3]
    }
    return out
  }

  private fun accept(q: DoubleArray): Boolean {
    if (area(q) < config.minAreaShare * w * h) return false
    var sign = 0
    for (k in 0 until 4) {
      val ax = q[k * 2]
      val ay = q[k * 2 + 1]
      val ux = q[((k + 3) % 4) * 2] - ax
      val uy = q[((k + 3) % 4) * 2 + 1] - ay
      val vx = q[((k + 1) % 4) * 2] - ax
      val vy = q[((k + 1) % 4) * 2 + 1] - ay
      val cross = ux * vy - uy * vx
      val s = if (cross > 0) 1 else if (cross < 0) -1 else 0
      if (s == 0 || (sign != 0 && s != sign)) return false
      sign = s
      val cos = (ux * vx + uy * vy) / (hypot(ux, uy) * hypot(vx, vy))
      val deg = Math.toDegrees(acos(cos.coerceIn(-1.0, 1.0)))
      if (deg < config.minAngleDeg || deg > config.maxAngleDeg) return false
    }
    val bx = config.borderShare * w + 1
    val by = config.borderShare * h + 1
    val onFrame = q[0] <= bx && q[6] <= bx && q[2] >= w - 1 - bx && q[4] >= w - 1 - bx &&
      q[1] <= by && q[3] <= by && q[5] >= h - 1 - by && q[7] >= h - 1 - by
    return !onFrame
  }

  private fun minSideSupport(q: DoubleArray): Double {
    var worst = 1.0
    val n = config.supportSamples
    val r = config.supportRadius
    for (k in 0 until 4) {
      val ax = q[k * 2]
      val ay = q[k * 2 + 1]
      val bx = q[((k + 1) % 4) * 2]
      val by = q[((k + 1) % 4) * 2 + 1]
      var hits = 0
      for (s in 0 until n) {
        val t = (s + 0.5) / n
        val x = (ax + (bx - ax) * t).roundToInt()
        val y = (ay + (by - ay) * t).roundToInt()
        var hit = false
        loop@ for (dy in -r..r) for (dx in -r..r) {
          val nx = x + dx
          val ny = y + dy
          if (nx in 0 until w && ny in 0 until h && edge[ny * w + nx].toInt() != 0) { hit = true; break@loop }
        }
        if (hit) hits++
      }
      worst = min(worst, hits.toDouble() / n)
    }
    return worst
  }

  private fun sharpness(q: DoubleArray): Double {
    val xs = doubleArrayOf(q[0], q[2], q[4], q[6])
    val ys = doubleArrayOf(q[1], q[3], q[5], q[7])
    val xa = max(1, xs.min().toInt())
    val xb = min(w - 2, ceil(xs.max()).toInt())
    val ya = max(1, ys.min().toInt())
    val yb = min(h - 2, ceil(ys.max()).toInt())
    var n = 0L
    var sum = 0.0
    var sq = 0.0
    for (y in ya..yb) for (x in xa..xb) {
      if (!inside(q, x.toDouble(), y.toDouble())) continue
      val i = y * w + x
      val l = (small[i - 1] + small[i + 1] + small[i - w] + small[i + w] - 4 * small[i]).toDouble()
      sum += l
      sq += l * l
      n++
    }
    if (n == 0L) return 0.0
    val mean = sum / n
    return sq / n - mean * mean
  }

  private fun inside(q: DoubleArray, x: Double, y: Double): Boolean {
    for (k in 0 until 4) {
      val ax = q[k * 2]
      val ay = q[k * 2 + 1]
      val bx = q[((k + 1) % 4) * 2]
      val by = q[((k + 1) % 4) * 2 + 1]
      if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) return false
    }
    return true
  }

  private fun thumbnail(q: DoubleArray): ByteArray {
    val out = ByteArray(THUMB * THUMB)
    for (v in 0 until THUMB) for (u in 0 until THUMB) {
      val s = (u + 0.5) / THUMB
      val t = (v + 0.5) / THUMB
      val x = (1 - t) * ((1 - s) * q[0] + s * q[2]) + t * ((1 - s) * q[6] + s * q[4])
      val y = (1 - t) * ((1 - s) * q[1] + s * q[3]) + t * ((1 - s) * q[7] + s * q[5])
      out[v * THUMB + u] = small[cy(y.roundToInt()) * w + cx(x.roundToInt())].toByte()
    }
    return out
  }

  companion object {
    const val THUMB = 32
    private const val HIST = 1024
    private const val DIR_H = 0
    private const val DIR_DOWN = 1
    private const val DIR_V = 2
    private const val DIR_UP = 3

    fun area(q: DoubleArray): Double {
      var a = 0.0
      for (k in 0 until 4) {
        val j = (k + 1) % 4
        a += q[k * 2] * q[j * 2 + 1] - q[j * 2] * q[k * 2 + 1]
      }
      return abs(a) / 2
    }

    fun convexHull(points: List<IntArray>): List<IntArray> {
      val p = points.sortedWith(compareBy({ it[0] }, { it[1] }))
      if (p.size < 3) return p
      fun cross(o: IntArray, a: IntArray, b: IntArray) =
        (a[0] - o[0]).toLong() * (b[1] - o[1]) - (a[1] - o[1]).toLong() * (b[0] - o[0])
      val lower = ArrayList<IntArray>()
      for (pt in p) {
        while (lower.size >= 2 && cross(lower[lower.size - 2], lower[lower.size - 1], pt) <= 0) lower.removeAt(lower.size - 1)
        lower.add(pt)
      }
      val upper = ArrayList<IntArray>()
      for (pt in p.asReversed()) {
        while (upper.size >= 2 && cross(upper[upper.size - 2], upper[upper.size - 1], pt) <= 0) upper.removeAt(upper.size - 1)
        upper.add(pt)
      }
      lower.removeAt(lower.size - 1)
      upper.removeAt(upper.size - 1)
      return lower + upper
    }

    fun simplifyClosed(ring: List<IntArray>, eps: Double): List<IntArray> {
      if (ring.size <= 4) return ring
      var far = 0
      var farD = -1.0
      for (i in ring.indices) {
        val d = hypot((ring[i][0] - ring[0][0]).toDouble(), (ring[i][1] - ring[0][1]).toDouble())
        if (d > farD) { farD = d; far = i }
      }
      val a = dp(ring.subList(0, far + 1), eps)
      val b = dp(ring.subList(far, ring.size) + listOf(ring[0]), eps)
      return a.dropLast(1) + b.dropLast(1)
    }

    private fun dp(pts: List<IntArray>, eps: Double): List<IntArray> {
      if (pts.size < 3) return pts
      val a = pts.first()
      val b = pts.last()
      val dx = (b[0] - a[0]).toDouble()
      val dy = (b[1] - a[1]).toDouble()
      val len = hypot(dx, dy)
      var idx = -1
      var dmax = 0.0
      for (i in 1 until pts.size - 1) {
        val d = if (len == 0.0) hypot((pts[i][0] - a[0]).toDouble(), (pts[i][1] - a[1]).toDouble())
        else abs(dy * (pts[i][0] - a[0]) - dx * (pts[i][1] - a[1])) / len
        if (d > dmax) { dmax = d; idx = i }
      }
      if (dmax <= eps) return listOf(a, b)
      return dp(pts.subList(0, idx + 1), eps).dropLast(1) + dp(pts.subList(idx, pts.size), eps)
    }

    fun largestQuad(poly: List<IntArray>): DoubleArray {
      val n = poly.size
      var best = DoubleArray(8)
      var bestArea = -1.0
      val q = DoubleArray(8)
      val idx = IntArray(4)
      for (a in 0 until n) for (b in a + 1 until n) for (c in b + 1 until n) for (d in c + 1 until n) {
        idx[0] = a; idx[1] = b; idx[2] = c; idx[3] = d
        for (k in 0 until 4) { q[k * 2] = poly[idx[k]][0].toDouble(); q[k * 2 + 1] = poly[idx[k]][1].toDouble() }
        val ar = area(q)
        if (ar > bestArea) { bestArea = ar; best = q.copyOf() }
      }
      return Quads.order(best)
    }
  }
}
