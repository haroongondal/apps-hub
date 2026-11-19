package expo.modules.notchisland.core

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin
import kotlin.math.sqrt

// SwiftUI's spring(response:dampingFraction:) in closed form, so no physics dependency; it stops at SETTLE_MS, where it is within 0.1 % of 1.
object Spring {
  const val RESPONSE_S = 0.4
  const val DAMPING = 0.65
  const val SETTLE_MS = 800L

  private val omega = 2 * PI / RESPONSE_S
  private val decay = DAMPING * omega
  private val omegaD = omega * sqrt(1 - DAMPING * DAMPING)

  fun value(ms: Long): Float {
    if (ms <= 0) return 0f
    if (ms >= SETTLE_MS) return 1f
    val t = ms / 1000.0
    return (1 - exp(-decay * t) * (cos(omegaD * t) + decay / omegaD * sin(omegaD * t))).toFloat()
  }

  fun openAlpha(progress: Float): Float = ((progress - 0.4f) / 0.6f).coerceIn(0f, 1f)

  fun closeAlpha(progress: Float): Float = (1f - progress / 0.4f).coerceIn(0f, 1f)

  fun contentScale(alpha: Float): Float = 0.92f + 0.08f * alpha
}
