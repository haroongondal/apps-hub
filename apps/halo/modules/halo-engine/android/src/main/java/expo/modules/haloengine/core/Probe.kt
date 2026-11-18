package expo.modules.haloengine.core

/** Pure decisions behind the stage 1 probes (no Android imports, so the JVM can test them). */
object Probe {
  /** Keeps the last [max] lines of [text]; the log file is rewritten with this so it cannot grow forever. */
  fun capLines(text: String, max: Int): String {
    val lines = text.lines().filter { it.isNotEmpty() }
    return if (lines.size <= max) text else lines.takeLast(max).joinToString("\n", postfix = "\n")
  }

  /** True when any byte of an FFT frame is non-zero (a silent mix gives all zeros). */
  fun anyNonZero(fft: ByteArray): Boolean = fft.any { it.toInt() != 0 }

  /** Plain status for RN: "blocked" when the Visualizer could not be created or enabled, "ok" once real data arrived, else "idle". */
  fun audioStatus(initFailed: Boolean, nonZeroFrames: Long): String =
    if (initFailed) "blocked" else if (nonZeroFrames > 0) "ok" else "idle"

  /** Mean FFT magnitude in 0..1 (bytes are re/im pairs after the DC and Nyquist bytes). */
  fun level(fft: ByteArray): Float {
    if (fft.size < 4) return 0f
    var sum = 0f
    var n = 0
    var i = 2
    while (i + 1 < fft.size) {
      val re = fft[i].toInt()
      val im = fft[i + 1].toInt()
      sum += Math.sqrt((re * re + im * im).toDouble()).toFloat() / 181f
      n++
      i += 2
    }
    return (sum / n * 8f).coerceIn(0f, 1f)
  }
}
