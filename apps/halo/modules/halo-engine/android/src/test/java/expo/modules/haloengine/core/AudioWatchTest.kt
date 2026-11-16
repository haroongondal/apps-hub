package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioWatchTest {
  @Test
  fun blockedAfterInitFailure() {
    val w = AudioWatch()
    w.onInit(false, 0)
    assertEquals(AudioState.BLOCKED, w.state(0))
    assertEquals(AudioState.BLOCKED, w.state(60_000))
    assertFalse(w.animate(100))
    w.onInit(true, 5_000)
    assertEquals(AudioState.IDLE, w.state(5_000))
    w.onFft(true, 5_100)
    assertEquals(AudioState.OK, w.state(5_100))
  }

  @Test
  fun idleWhenSilent() {
    val w = AudioWatch()
    w.onInit(true, 0)
    assertEquals(AudioState.IDLE, w.state(0))
    assertFalse(w.animate(0))
    w.onFft(true, 1_000)
    assertEquals(AudioState.OK, w.state(1_000))
    assertTrue(w.animate(1_000))
    // The Visualizer keeps delivering all-zero frames after the music stops.
    for (t in 1_050L..3_000L step 50) w.onFft(false, t)
    assertTrue(w.animate(1_499))
    assertFalse(w.animate(1_500))
    assertEquals(AudioState.IDLE, w.state(3_000))
    assertFalse(w.useRandom(60_000))
    assertFalse(w.animate(60_000))
  }

  @Test
  fun randomAfterThreeSecondsPlayingSilent() {
    val w = AudioWatch()
    w.onInit(true, 0)
    w.onPlaying(true)
    for (t in 0L..4_000L step 50) w.onFft(false, t)
    assertFalse(w.useRandom(2_999))
    assertTrue(w.useRandom(3_000))
    assertTrue(w.animate(3_000))
    w.onPlaying(false)
    assertFalse(w.useRandom(4_000))
    assertFalse(w.animate(4_000))
  }

  @Test
  fun realDataStopsRandom() {
    val w = AudioWatch()
    w.onInit(true, 0)
    w.onPlaying(true)
    assertTrue(w.useRandom(5_000))
    w.onFft(true, 5_000)
    assertFalse(w.useRandom(5_000))
    assertTrue(w.animate(5_000))
    assertEquals(AudioState.OK, w.state(5_000))
    assertFalse(w.useRandom(7_999))
    assertTrue(w.useRandom(8_000))
  }

  @Test
  fun blockedRetriesKeepRandomMotion() {
    val w = AudioWatch()
    w.onPlaying(true)
    w.onInit(false, 0)
    for (retryAt in listOf(1_000L, 3_000L, 7_000L)) {
      for (t in 3_000L until retryAt step 100) assertTrue("useRandom at $t", w.useRandom(t))
      w.onInit(false, retryAt)
    }
    for (t in 3_000L..15_000L step 100) assertTrue("useRandom at $t", w.useRandom(t))
    assertTrue(w.animate(15_000))
  }

  @Test
  fun retryBacksOffAndCaps() {
    val w = AudioWatch()
    assertEquals(1_000L, w.retryDelayMs(0))
    assertEquals(2_000L, w.retryDelayMs(1))
    assertEquals(4_000L, w.retryDelayMs(2))
    assertEquals(32_000L, w.retryDelayMs(5))
    assertEquals(60_000L, w.retryDelayMs(6))
    assertEquals(60_000L, w.retryDelayMs(100))
    assertEquals(60_000L, w.retryDelayMs(Int.MAX_VALUE))
    assertEquals(1_000L, w.retryDelayMs(-1))
  }
}
