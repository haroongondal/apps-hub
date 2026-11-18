package expo.modules.haloengine.core

import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.sqrt

/** One analysed frame. The instance is reused by [Spectrum.update]; copy values you need to keep. */
class SpectrumFrame(val bands: FloatArray, var level: Float, var beat: Boolean)

/**
 * Turns Visualizer FFT bytes into smoothed log-spaced bands, an overall level and a beat flag.
 * Layout of `fft` (Visualizer.getFft): [0] DC real, [1] Nyquist real, then re,im pairs for k = 1..n/2-1.
 * [update] does not allocate unless the FFT size changes.
 */
class Spectrum(private val bandCount: Int = 32, fftSize: Int = 1024) {
  private val frame = SpectrumFrame(FloatArray(bandCount), 0f, false)
  private var binStart = IntArray(bandCount + 1)
  private var bandOfBin = IntArray(0)
  private var layoutSize = -1
  private var lastMs = -1L
  private var lastBeatMs = Long.MIN_VALUE / 2
  private var mean = 0f

  init { layout(fftSize) }

  /** Band that bin `k` (1 until fftSize/2) feeds; out-of-range bins clamp to the nearest band. */
  fun bandOf(bin: Int): Int = bandOfBin[bin.coerceIn(0, bandOfBin.size - 1)]

  fun update(fft: ByteArray, nowMs: Long): SpectrumFrame {
    if (fft.size != layoutSize) layout(fft.size)
    val dt = if (lastMs < 0) 0f else ((nowMs - lastMs).coerceAtLeast(0) / 1000f)
    lastMs = nowMs

    var sum = 0f
    for (b in 0 until bandCount) {
      var mag = 0f
      for (k in binStart[b] until binStart[b + 1]) {
        val re = fft[2 * k].toFloat()
        val im = fft[2 * k + 1].toFloat()
        val m = sqrt(re * re + im * im)
        if (m > mag) mag = m
      }
      val target = (log10(1f + mag) / LOG_MAX).coerceIn(0f, 1f)
      val old = frame.bands[b]
      val v = if (target > old) old + (target - old) * ATTACK else (old - RELEASE_PER_S * dt).coerceAtLeast(target)
      frame.bands[b] = v
      sum += v
    }
    val level = sum / bandCount
    frame.level = level

    // Compare against the mean before this frame is folded in, so a burst stands out from what came before.
    frame.beat = level > BEAT_RATIO * mean && level > BEAT_MIN_LEVEL && nowMs - lastBeatMs >= REFRACTORY_MS
    if (frame.beat) lastBeatMs = nowMs
    mean += (level - mean) * dt.coerceAtMost(1f) // 1 s time constant
    return frame
  }

  private fun layout(size: Int) {
    layoutSize = size
    val hi = size / 2 // bins 1 until hi
    val ratio = if (hi > 1) hi.toFloat().pow(1f / bandCount) else 1f
    for (b in 0..bandCount) {
      val s = ratio.pow(b).toInt() // log-spaced from bin 1
      // Every band gets at least one bin while bins last: low bands would otherwise round to empty.
      binStart[b] = if (b == 0) 1 else s.coerceAtLeast(binStart[b - 1] + 1)
    }
    binStart[bandCount] = hi.coerceAtLeast(1)
    for (b in bandCount - 1 downTo 0) binStart[b] = binStart[b].coerceAtMost(binStart[b + 1])
    bandOfBin = IntArray(hi.coerceAtLeast(1))
    for (b in 0 until bandCount) for (k in binStart[b] until binStart[b + 1]) bandOfBin[k] = b
  }

  private companion object {
    val LOG_MAX = log10(182f) // a signed-byte re/im pair peaks near 181
    const val ATTACK = 0.6f
    const val RELEASE_PER_S = 3.0f
    const val BEAT_RATIO = 1.4f
    const val BEAT_MIN_LEVEL = 0.2f
    const val REFRACTORY_MS = 200L
  }
}
