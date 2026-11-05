package expo.modules.designmedia.core

import kotlin.math.min

// Bits per second for a quality job: bpp x pixels x fps (QUALITY_PRESETS.bpp), never above what the source already uses.
fun qualityBps(bpp: Double, width: Int, height: Int, fps: Int, sourceBps: Int?): Int {
  val wanted = Math.round(bpp * width * height * fps).coerceIn(1, Int.MAX_VALUE.toLong())
  return if (sourceBps != null && sourceBps > 0) min(wanted, sourceBps.toLong()).toInt() else wanted.toInt()
}

// The track's own figure when the container gives one, else the file's average minus the sound (an upper bound for the picture).
fun estimateVideoBps(trackBps: Int?, fileBytes: Long, durationS: Double, audioBps: Int?): Int? {
  if (trackBps != null && trackBps > 0) return trackBps
  if (fileBytes <= 0 || durationS <= 0) return null
  val whole = fileBytes * 8.0 / durationS
  return (whole - (audioBps ?: 128_000)).takeIf { it > 0 }?.toInt()
}

// A smaller-file HEVC convert keeps the picture at 70% of the source rate; H.264 keeps the source rate.
fun convertBps(encoder: String, sourceBps: Int?): Int? =
  sourceBps?.let { if (encoder == "hw-hevc") it * 7 / 10 else it }

// SPEC §11.1: free space needed before a job starts. Size jobs write a temp file and a published copy.
fun neededBytes(plan: Plan, inputBytes: Long, durationS: Double): Long = when (plan) {
  is SizePlan -> 2 * plan.plannedBytes
  is ComposePlan -> 2 * plan.plannedBytes
  is GifPlan -> 2 * (plan.targetBytes ?: 20_000_000L)
  is FramePlan -> 25_000_000L
  is ClipPlan ->
    if (durationS > 0) (inputBytes * min(1.0, (plan.endS - plan.keyframeS) / durationS) * 1.1).toLong() else inputBytes
  else -> inputBytes
}
