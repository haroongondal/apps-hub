package expo.modules.pdfscan.core

import kotlin.math.abs

data class StabilizerConfig(
  val driftShare: Double = 0.02,
  val holdMs: Long = 800,
  val lostMs: Long = 200,
  val minSharpness: Double = 60.0,
  val rearmMissingMs: Long = 400,
  val rearmMoveShare: Double = 0.15,
  val rearmThumbDiff: Double = 0.12,
)

enum class ScanHint(val js: String) { SEARCHING("searching"), HOLD("hold"), BLURRY("blurry"), FOCUSING("focusing"), CAPTURED("captured") }

enum class StabilizerState { SEARCHING, HOLDING, COOLDOWN }

class StabilizerStep(
  val quad: DoubleArray?,
  val steady: Double,
  val hint: ScanHint,
  val fire: Boolean,
  val enteredHolding: Boolean,
)

class QuadStabilizer(private val config: StabilizerConfig = StabilizerConfig(), private val clock: () -> Long) {
  var state = StabilizerState.SEARCHING
    private set
  private var last: Detection? = null
  private var reference: Detection? = null
  private var lastSeenAt = 0L
  private var lastUpdateAt = -1L
  private var held = 0L

  fun update(det: Detection?, focused: Boolean, autoCapture: Boolean): StabilizerStep {
    val now = clock()
    val dt = if (lastUpdateAt < 0) 0 else now - lastUpdateAt
    lastUpdateAt = now

    if (state == StabilizerState.COOLDOWN) {
      if (det == null) {
        if (now - lastSeenAt >= config.rearmMissingMs) toSearching()
      } else {
        lastSeenAt = now
        if (pageChanged(det)) toSearching()
      }
      if (state == StabilizerState.COOLDOWN) return StabilizerStep(det?.quad, 0.0, ScanHint.CAPTURED, false, false)
    }

    if (det == null) {
      if (state == StabilizerState.HOLDING && now - lastSeenAt <= config.lostMs) {
        return StabilizerStep(last?.quad, steady(autoCapture), ScanHint.HOLD, false, false)
      }
      toSearching()
      return StabilizerStep(null, 0.0, ScanHint.SEARCHING, false, false)
    }

    lastSeenAt = now
    val entered = state != StabilizerState.HOLDING
    val prev = last
    last = det
    if (entered) {
      state = StabilizerState.HOLDING
      held = 0
    } else if (prev == null || Quads.maxCornerShareOfDiagonal(det.quad, prev.quad, det.aspect) > config.driftShare) {
      held = 0
    } else if (focused && det.sharpness >= config.minSharpness) {
      held += dt
    }
    val hint = when {
      !focused -> ScanHint.FOCUSING
      det.sharpness < config.minSharpness -> ScanHint.BLURRY
      else -> ScanHint.HOLD
    }
    if (autoCapture && held >= config.holdMs) {
      enterCooldown(det, now)
      return StabilizerStep(det.quad, 1.0, ScanHint.CAPTURED, true, entered)
    }
    return StabilizerStep(det.quad, steady(autoCapture), hint, false, entered)
  }

  fun manualCapture(det: Detection?) = enterCooldown(det ?: last, clock())

  fun reset() {
    toSearching()
    lastUpdateAt = -1
  }

  private fun steady(autoCapture: Boolean) = if (autoCapture) (held.toDouble() / config.holdMs).coerceIn(0.0, 1.0) else 0.0

  private fun enterCooldown(det: Detection?, now: Long) {
    state = StabilizerState.COOLDOWN
    reference = det
    lastSeenAt = now
    held = 0
  }

  private fun toSearching() {
    state = StabilizerState.SEARCHING
    last = null
    reference = null
    held = 0
  }

  private fun pageChanged(det: Detection): Boolean {
    val ref = reference ?: return true
    if (Quads.maxCornerShareOfDiagonal(det.quad, ref.quad, det.aspect) > config.rearmMoveShare) return true
    var diff = 0L
    for (i in det.thumb.indices) diff += abs((det.thumb[i].toInt() and 0xFF) - (ref.thumb[i].toInt() and 0xFF))
    return diff.toDouble() / det.thumb.size / 255 >= config.rearmThumbDiff
  }
}
