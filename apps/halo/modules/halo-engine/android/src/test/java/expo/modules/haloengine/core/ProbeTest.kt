package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProbeTest {
  @Test fun capKeepsLastLines() {
    val text = (1..10).joinToString("") { "line $it\n" }
    assertEquals("line 8\nline 9\nline 10\n", Probe.capLines(text, 3))
  }

  @Test fun capLeavesShortTextAlone() {
    assertEquals("a\nb\n", Probe.capLines("a\nb\n", 5))
  }

  @Test fun nonZeroDetection() {
    assertFalse(Probe.anyNonZero(ByteArray(8)))
    assertTrue(Probe.anyNonZero(byteArrayOf(0, 0, 0, -1)))
  }

  @Test fun audioStatusPrefersBlocked() {
    assertEquals("blocked", Probe.audioStatus(true, 5))
    assertEquals("ok", Probe.audioStatus(false, 1))
    assertEquals("idle", Probe.audioStatus(false, 0))
  }

  @Test fun levelIsZeroForSilenceAndBoundedForLoud() {
    assertEquals(0f, Probe.level(ByteArray(16)), 0f)
    val loud = ByteArray(16) { 127 }
    assertEquals(1f, Probe.level(loud), 0f)
    assertEquals(0f, Probe.level(ByteArray(2)), 0f)
  }
}
