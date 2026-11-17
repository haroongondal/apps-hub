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

  fun outputSize(quadPx: DoubleArray, rotation: Int, maxLongSide: Int, maxScale: Double = 1.0): Pair<Int, Int> {
    val q = rotatedQuad(quadPx, rotation)
    fun edge(a: Int, b: Int) = hypot(q[b * 2] - q[a * 2], q[b * 2 + 1] - q[a * 2 + 1])
    val w = max(edge(0, 1), edge(3, 2))
    val h = max(edge(0, 3), edge(1, 2))
    val long = max(w, h)
    val scale = if (long <= 0) 1.0 else min(maxScale, maxLongSide / long)
    return max(1, (w * scale).roundToInt()) to max(1, (h * scale).roundToInt())
  }
}
