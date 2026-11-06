package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Test

class CopyRulesTest {
  @Test
  fun aClipWritesSamplesFromTheKeyframeToTheEndAndShiftsThemToZero() {
    val w = ClipWindow(2_000_000, 5_000_000)
    assertEquals(Verdict.SKIP, w.check(1_980_000))
    assertEquals(Verdict.WRITE, w.check(2_000_000))
    assertEquals(Verdict.WRITE, w.check(5_000_000))
    assertEquals(0L, w.shifted(2_000_000))
    assertEquals(3_000_000L, w.shifted(5_000_000))
  }

  @Test
  fun aTrackIsDoneOnlyAfterSixteenSamplesPastTheEnd() {
    val w = ClipWindow(0, 1_000_000)
    repeat(ClipWindow.LOOKAHEAD - 1) { assertEquals(Verdict.SKIP, w.check(1_000_001L + it)) }
    assertEquals(Verdict.DONE, w.check(2_000_000))
  }

  @Test
  fun aBFrameShownBeforeTheEndButDecodedAfterTheFirstLateSampleStillGetsWritten() {
    val w = ClipWindow(0, 1_000_000)
    assertEquals(Verdict.SKIP, w.check(1_040_000))
    assertEquals(Verdict.WRITE, w.check(1_000_000))
  }

  private val tracks = listOf(
    TrackRef(0, "audio/mp4a-latm"), TrackRef(1, "video/avc"), TrackRef(2, "audio/ac3"), TrackRef(3, "video/hevc"),
  )

  @Test
  fun videoTracksComeFirstBecauseTheExtractorSeeksByTheFirstOne() {
    assertEquals(listOf(1, 3, 0, 2), videoFirst(tracks).map { it.index })
  }

  @Test
  fun aVideoRemuxKeepsEveryPictureAndSoundTrackUnlessMuted() {
    val keep = ConvertPlan("remux", "mp4", "mp4", ConvertVideo("copy", 0.0), ConvertAudio("aac", null, true))
    assertEquals(listOf(1, 3, 0, 2), remuxSelection(tracks, keep).map { it.index })
    assertEquals(listOf(1, 3), remuxSelection(tracks, keep.copy(audio = null)).map { it.index })
  }

  @Test
  fun anM4aKeepsOnlyTheFirstSoundTrack() {
    val plan = ConvertPlan("remux", "m4a", "m4a", null, ConvertAudio("aac", null, true))
    assertEquals(listOf(0), remuxSelection(tracks, plan).map { it.index })
  }

  @Test
  fun secondsBecomeWholeMicroseconds() {
    assertEquals(1_500_000L, microseconds(1.5))
    assertEquals(6_250_000L, microseconds(6.25))
    assertEquals(0L, microseconds(0.0))
  }
}
