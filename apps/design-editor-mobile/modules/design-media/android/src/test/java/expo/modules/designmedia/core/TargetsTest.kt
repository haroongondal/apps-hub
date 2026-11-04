package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Test

class TargetsTest {
  private val plans = decodeSamples()

  private fun target(name: String) = targetFor(plans.getValue(name))

  @Test
  fun videoGoesToMoviesSoundToMusicAndStillsToPictures() {
    assertEquals(Target(Kind.VIDEO, "Movies/Design Editor/", "video/mp4"), target("size"))
    assertEquals(Target(Kind.VIDEO, "Movies/Design Editor/", "video/mp4"), target("stabilize"))
    assertEquals(Target(Kind.AUDIO, "Music/Design Editor/", "audio/mp4"), target("audioCopy"))
    assertEquals(Target(Kind.AUDIO, "Music/Design Editor/", "audio/ac3"), target("audioRaw"))
    assertEquals(Target(Kind.AUDIO, "Music/Design Editor/", "audio/mp4"), target("convertM4a"))
    assertEquals(Target(Kind.IMAGE, "Pictures/Design Editor/", "image/gif"), target("gif"))
    assertEquals(Target(Kind.IMAGE, "Pictures/Design Editor/", "image/png"), target("frame"))
  }

  @Test
  fun aWebmAudioTrackIsSoundButAWebmClipIsVideo() {
    assertEquals(Kind.AUDIO, targetFor(AudioPlan(1, "copy", "webm", "webm")).kind)
    assertEquals("audio/webm", targetFor(AudioPlan(1, "copy", "webm", "webm")).mime)
    assertEquals(Kind.VIDEO, targetFor(ClipPlan("copy", 0.0, 1.0, 0.0, "webm", "webm", listOf(0))).kind)
    assertEquals("audio/ogg", targetFor(AudioPlan(1, "copy", "ogg", "opus")).mime)
    assertEquals("audio/x-wav", targetFor(AudioPlan(1, "wav", "raw", "wav")).mime)
    assertEquals("image/jpeg", targetFor(FramePlan(1.0, "jpg", "jpg")).mime)
  }

  @Test
  fun everyPlanNamesItsOutputExtension() {
    assertEquals("mp4", outputExt(plans.getValue("quality")))
    assertEquals("mp4", outputExt(plans.getValue("reverse")))
    assertEquals("gif", outputExt(plans.getValue("gif")))
    assertEquals("m4a", outputExt(plans.getValue("volumeNormalize").let { (it as VolumePlan).copy(ext = "m4a", video = null) }))
    assertEquals("ac3", outputExt(plans.getValue("audioRaw")))
  }
}
