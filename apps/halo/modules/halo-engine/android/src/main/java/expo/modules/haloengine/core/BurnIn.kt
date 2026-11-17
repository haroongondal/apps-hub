package expo.modules.haloengine.core

import kotlin.math.cos
import kotlin.math.sin

// Targets on a slow spiral (radius 0.2..1 maxPx, 0.6 rad apart) sit 0.09..0.63 maxPx apart: the content moves every
// minute, and easing over 60 s keeps it under ~0.016 maxPx per second.
object BurnIn {
  private const val PERIOD_MS = 60_000L
  private const val TURN = 0.6
  private const val WOBBLE = 0.07

  fun offset(timeMs: Long, maxPx: Float, out: FloatArray) {
    val k = Math.floorDiv(timeMs, PERIOD_MS)
    val f = (timeMs - k * PERIOD_MS).toDouble() / PERIOD_MS
    val e = f * f * (3 - 2 * f)
    val ra = radius(k)
    val rb = radius(k + 1)
    val ax = ra * cos(k * TURN)
    val ay = ra * sin(k * TURN)
    val bx = rb * cos((k + 1) * TURN)
    val by = rb * sin((k + 1) * TURN)
    out[0] = ((ax + (bx - ax) * e) * maxPx).toFloat()
    out[1] = ((ay + (by - ay) * e) * maxPx).toFloat()
  }

  private fun radius(k: Long) = 0.6 + 0.4 * sin(k * WOBBLE)
}
