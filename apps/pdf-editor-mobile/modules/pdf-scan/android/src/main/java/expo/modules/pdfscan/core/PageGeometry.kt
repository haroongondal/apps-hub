package expo.modules.pdfscan.core

import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// SPEC §7.5 steps 2 and 3. Quads are TL, TR, BR, BL; rotation is clockwise degrees.
object PageGeometry {
  fun rotatedQuad(quad: DoubleArray, rotation: Int): DoubleArray {
    val steps = (((rotation % 360) + 360) % 360) / 90
    return DoubleArray(8) { i -> quad[((i / 2 - steps + 4) % 4) * 2 + i % 2] }
  }

  /** Shrinks the quad about its centre so each edge moves in by `fraction` of the page, keeping the warp off the dark border. */
  fun insetQuad(quad: DoubleArray, fraction: Double): DoubleArray {
    val cx = (quad[0] + quad[2] + quad[4] + quad[6]) / 4
    val cy = (quad[1] + quad[3] + quad[5] + quad[7]) / 4
    val k = 1 - 2 * fraction
    return DoubleArray(8) { i -> (if (i % 2 == 0) cx else cy) + (quad[i] - (if (i % 2 == 0) cx else cy)) * k }
  }

  fun outputSize(quadPx: DoubleArray, rotation: Int, maxLongSide: Int, maxScale: Double = 1.0): Pair<Int, Int> {
    val q = rotatedQuad(quadPx, rotation)
    fun edge(a: Int, b: Int) = hypot(q[b * 2] - q[a * 2], q[b * 2 + 1] - q[a * 2 + 1])
    val w = max(edge(0, 1), edge(3, 2))
    val h = max(edge(0, 3), edge(1, 2))
    val long = max(w, h)
    val scale = if (long <= 0) 1.0 else min(maxScale, maxLongSide / long)
    return max(1, (w * scale).roundToInt()) to max(1, (h * scale).roundToInt())
  }

  fun fullFrameQuad() = doubleArrayOf(0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0)

  fun validateQuad(q: DoubleArray): Boolean {
    if (q.size != 8 || q.any { it.isNaN() || it < 0.0 || it > 1.0 }) return false
    var sign = 0
    for (k in 0 until 4) {
      val ax = q[k * 2]; val ay = q[k * 2 + 1]
      val bx = q[((k + 1) % 4) * 2]; val by = q[((k + 1) % 4) * 2 + 1]
      val cx = q[((k + 2) % 4) * 2]; val cy = q[((k + 2) % 4) * 2 + 1]
      val cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
      val s = if (cross > 1e-12) 1 else if (cross < -1e-12) -1 else 0
      if (s == 0 || (sign != 0 && s != sign)) return false
      sign = s
    }
    return true
  }
}
