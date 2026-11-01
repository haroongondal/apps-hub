package expo.modules.designmedia.core

import kotlin.math.max
import kotlin.math.min

// Mirrors packages/media-core/src/budget.ts (walkLadder) and retry.ts (nextSizeAttempt).
// Kept in step by RetryRuleTest, which reads the same retry-cases.json fixture.

val LADDER = listOf(
  Rung(1080, 30), Rung(720, 30), Rung(540, 30), Rung(480, 30), Rung(360, 30), Rung(360, 24), Rung(240, 24),
)
val FLOOR = mapOf("hw-h264" to 0.05, "hw-hevc" to 0.035, "x264" to 0.04)
private const val RETRY_FACTOR = 0.97

class Walk(val rung: Rung, val width: Int, val height: Int, val bpp: Double, val fits: Boolean)

sealed interface Next {
  data class Publish(val plan: SizePlan) : Next
  data class Retry(val plan: SizePlan) : Next
  data class GaveUp(val detail: String?) : Next
}

fun walkLadder(width: Int, height: Int, fps: Int, videoBps: Int, encoder: String): Walk {
  val shortSrc = min(width, height)
  val fitting = LADDER.filter { it.shortSide <= shortSrc }
  val walks = fitting.ifEmpty { listOf(LADDER.last()) }.map { r ->
    val shortSide = min(r.shortSide, shortSrc)
    val rungFps = min(r.fps, fps)
    val (w, h) = dimsFor(width, height, shortSide)
    val bpp = videoBps.toDouble() / (w.toDouble() * h * rungFps)
    Walk(Rung(shortSide, rungFps), w, h, bpp, bpp >= FLOOR.getValue(encoder))
  }
  return walks.firstOrNull { it.fits } ?: walks.last()
}

fun nextSizeAttempt(plan: SizePlan, actualBytes: Long): Next {
  if (actualBytes < 0) return Next.GaveUp("The output size is unknown.")
  if (actualBytes <= plan.targetBytes) return Next.Publish(plan)
  if (plan.attempt == 3) return Next.GaveUp(null)
  val audioBytes = plan.plannedBytes - plan.plannedVideoBytes - plan.overheadBytes
  val actualVideoBytes = actualBytes - audioBytes - plan.overheadBytes
  if (actualVideoBytes <= 0) return Next.GaveUp("The output has no room left for video.")
  val videoBps = Math.round(plan.videoBps * plan.plannedVideoBytes.toDouble() / actualVideoBytes * RETRY_FACTOR).toInt()
  val walk = walkLadder(plan.width, plan.height, plan.fpsCap, videoBps, plan.encoder)
  val plannedVideoBytes = Math.round(plan.plannedVideoBytes.toDouble() * videoBps / plan.videoBps)
  return Next.Retry(
    plan.copy(
      rung = walk.rung, width = walk.width, height = walk.height, videoBps = videoBps,
      plannedVideoBytes = plannedVideoBytes, plannedBytes = plannedVideoBytes + audioBytes + plan.overheadBytes,
      attempt = plan.attempt + 1,
    ),
  )
}

private fun dimsFor(w: Int, h: Int, shortSide: Int): Pair<Int, Int> {
  val long = 2 * Math.round(shortSide * max(w, h).toDouble() / min(w, h) / 2).toInt()
  return if (w >= h) long to shortSide else shortSide to long
}
