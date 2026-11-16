package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random

class SpectrumTest {
  private val size = 1024

  /** A frame whose every bin has the same real and imaginary part. */
  private fun flat(v: Int) = ByteArray(size) { v.toByte() }

  private fun spike(bin: Int, v: Int = 100) = ByteArray(size).also {
    it[2 * bin] = v.toByte()
    it[2 * bin + 1] = v.toByte()
  }

  @Test
  fun silenceDecaysToZero() {
    val s = Spectrum()
    var now = 0L
    repeat(20) { s.update(flat(100), now); now += 16 }
    val end = now + 1000
    var f = s.update(ByteArray(size), now)
    while (now < end) { now += 16; f = s.update(ByteArray(size), now) }
    assertTrue(f.bands.all { it < 0.02f })
    assertFalse(f.beat)
    assertTrue(f.level < 0.02f)
  }

  @Test
  fun singleBinLandsInItsBand() {
    val s = Spectrum(32, size)
    for (k in intArrayOf(1, 2, 5, 17, 60, 200, 511)) {
      val f = s.update(spike(k), 1_000L * k)
      var max = 0
      for (i in f.bands.indices) if (f.bands[i] > f.bands[max]) max = i
      assertEquals("bin $k", s.bandOf(k), max)
      assertTrue(f.bands[max] > 0.1f)
    }
  }

  @Test
  fun everyBandHasABin() {
    val s = Spectrum(32, size)
    val seen = BooleanArray(32)
    for (k in 1 until size / 2) seen[s.bandOf(k)] = true
    assertTrue(seen.all { it })
  }

  @Test
  fun valuesInUnitRange() {
    val s = Spectrum()
    val rnd = Random(7)
    var now = 0L
    repeat(200) {
      val b = ByteArray(size).also { rnd.nextBytes(it) }
      val f = s.update(b, now)
      now += 16
      assertTrue(f.level in 0f..1f)
      assertTrue(f.bands.all { it in 0f..1f })
    }
  }

  @Test
  fun burstAfterQuietIsBeat() {
    val s = Spectrum()
    var now = 0L
    repeat(60) { assertFalse(s.update(ByteArray(size), now).beat); now += 16 }
    assertTrue(s.update(flat(100), now).beat)
  }

  @Test
  fun noBeatWithinRefractory() {
    val s = Spectrum()
    var now = 0L
    repeat(60) { s.update(ByteArray(size), now); now += 16 }
    assertTrue(s.update(flat(100), now).beat)
    // Drop to quiet, then burst again 64 ms later: still inside the 200 ms window.
    repeat(3) { now += 16; s.update(ByteArray(size), now) }
    now += 16
    assertFalse(s.update(flat(120), now).beat)
    // Past the window, a fresh burst after silence is a beat again.
    repeat(30) { now += 16; s.update(ByteArray(size), now) }
    now += 16
    assertTrue(s.update(flat(120), now).beat)
  }

  @Test
  fun fftSizeChangeDoesNotThrow() {
    val s = Spectrum()
    s.update(ByteArray(256), 0)
    s.update(ByteArray(2048), 16)
    s.update(ByteArray(0), 32)
  }
}
