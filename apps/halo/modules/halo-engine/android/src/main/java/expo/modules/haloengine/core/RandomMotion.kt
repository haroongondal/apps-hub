package expo.modules.haloengine.core

/** Smooth value noise in 0..1 per band, for previews and motion without audio. */
object RandomMotion {
  private const val PERIOD_MS = 480L

  fun fill(bands: FloatArray, timeMs: Long, seed: Int) {
    for (b in bands.indices) {
      // Staggered per band; smoothstep slope peaks at 1.5, so a 16 ms step moves a value at most 1.5*16/480.
      val period = PERIOD_MS + 37L * (b % 7)
      val at = timeMs + 131L * b
      val k = Math.floorDiv(at, period)
      val f = Math.floorMod(at, period).toFloat() / period
      val s = f * f * (3f - 2f * f)
      val a = hash(seed, b, k)
      bands[b] = a + (hash(seed, b, k + 1) - a) * s
    }
  }

  private fun hash(seed: Int, band: Int, k: Long): Float {
    var z = seed * -7046029254386353131L + band * 0x632BE59BD9B4E019L + k * -4658895280553007687L
    z = (z xor (z ushr 30)) * -4658895280553007687L
    z = (z xor (z ushr 27)) * -7723592293110705685L
    z = z xor (z ushr 31)
    return (z ushr 40).toFloat() / (1 shl 24)
  }
}
