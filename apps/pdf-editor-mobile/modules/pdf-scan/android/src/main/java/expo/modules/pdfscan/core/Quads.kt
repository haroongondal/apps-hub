package expo.modules.pdfscan.core

import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sqrt

// A quad: x,y of TL, TR, BR, BL in 0..1 of the frame (SPEC §6.1); aspect = width / height.
object Quads {
  fun order(q: DoubleArray): DoubleArray {
    val cx = (q[0] + q[2] + q[4] + q[6]) / 4
    val cy = (q[1] + q[3] + q[5] + q[7]) / 4
    val idx = (0 until 4).sortedBy { atan2(q[it * 2 + 1] - cy, q[it * 2] - cx) }
    val start = idx.indices.minBy { q[idx[it] * 2] + q[idx[it] * 2 + 1] }
    val out = DoubleArray(8)
    for (k in 0 until 4) {
      val i = idx[(start + k) % 4]
      out[k * 2] = q[i * 2]
      out[k * 2 + 1] = q[i * 2 + 1]
    }
    return out
  }

  fun rotate(q: DoubleArray, degrees: Int): DoubleArray {
    val r = ((degrees % 360) + 360) % 360
    if (r == 0) return q.copyOf()
    val out = DoubleArray(8)
    for (k in 0 until 4) {
      val x = q[k * 2]
      val y = q[k * 2 + 1]
      when (r) {
        90 -> { out[k * 2] = 1 - y; out[k * 2 + 1] = x }
        180 -> { out[k * 2] = 1 - x; out[k * 2 + 1] = 1 - y }
        270 -> { out[k * 2] = y; out[k * 2 + 1] = 1 - x }
        else -> throw IllegalArgumentException("rotation $degrees")
      }
    }
    return order(out)
  }

  fun maxCornerShareOfDiagonal(a: DoubleArray, b: DoubleArray, aspect: Double): Double {
    var worst = 0.0
    for (k in 0 until 4) {
      worst = max(worst, hypot((a[k * 2] - b[k * 2]) * aspect, a[k * 2 + 1] - b[k * 2 + 1]))
    }
    return worst / sqrt(aspect * aspect + 1)
  }
}
