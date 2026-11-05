package expo.modules.designmedia.core

import androidx.media3.common.MediaItem
import androidx.media3.effect.FrameDropEffect
import androidx.media3.transformer.Effects
import expo.modules.designmedia.android.ComposeBuilder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ComposeTest {
  private val plan = decodeSamples().getValue("compose") as ComposePlan

  @Test
  fun decodesTheMediaCoreExampleAndRoundTrips() {
    assertEquals(
      ComposePlan(
        listOf(
          ComposeClip("content://media/a", "a.mp4", 0.0, 10.0, true),
          ComposeClip("content://media/b", "b.mp4", 0.0, 4.0, false),
        ),
        1920, 1080, 30, 6_220_800, 11_222_400L, "mp4",
      ),
      plan,
    )
    assertEquals(plan, decodePlan(encodePlan(plan)))
  }

  @Test
  fun oneItemPerClipWithItsTimesInMicroseconds() {
    assertEquals(
      listOf(ItemSpec("content://media/a", 0, 10_000_000, true), ItemSpec("content://media/b", 0, 4_000_000, false)),
      composeItems(plan),
    )
  }

  @Test
  fun eachItemKnowsItsLengthSoThePreviewPlayerAcceptsIt() {
    val spec = ItemSpec("content://media/a", 2_000_000, 10_000_000, true)
    val media = MediaItem.Builder().setClippingConfiguration(ComposeBuilder.clipping(spec)).build()
    assertEquals(8_000_000L, ComposeBuilder.item(spec, media, Effects.EMPTY).presentationDurationUs)
  }

  @Test
  fun thePreviewSkipsTheFrameRateCapThatFreezesThePlayerAfterTheFirstClip() {
    assertEquals(1, ComposeBuilder.effects(plan, preview = false).videoEffects.count { it is FrameDropEffect })
    assertEquals(0, ComposeBuilder.effects(plan, preview = true).videoEffects.count { it is FrameDropEffect })
    assertEquals(1, ComposeBuilder.effects(plan, preview = true).videoEffects.size)
  }

  @Test
  fun silenceIsAddedOnlyWhenSomeClipHasSound() {
    assertTrue(forceAudio(plan))
    assertFalse(forceAudio(plan.copy(clips = plan.clips.map { it.copy(hasAudio = false) })))
  }

  @Test
  fun thePreviewKnowsTheLengthAndFitsThePictureInsideItsBox() {
    assertEquals(14_000L, durationMs(plan))
    assertEquals(711 to 400, fitInside(1000, 400, 1920, 1080))
    assertEquals(225 to 400, fitInside(1000, 400, 720, 1280))
    assertEquals(300 to 169, fitInside(300, 600, 1920, 1080))
    assertEquals(0 to 0, fitInside(0, 400, 1920, 1080))
    assertEquals(0 to 0, fitInside(1000, 400, 0, 1080))
  }

  @Test
  fun eachClipKeepsItsPicturesInItsOwnFolderInsideTheCache() {
    assertEquals("thumbs", thumbFolder(null))
    assertEquals("video/m1x-a9k2", thumbFolder("video/m1x-a9k2"))
    assertEquals("video", thumbFolder("video"))
    for (bad in listOf("", "../x", "video/../../x", "/abs", "video/a/b", "a b")) {
      assertThrows(bad, IllegalArgumentException::class.java) { thumbFolder(bad) }
    }
  }

  @Test
  fun savesOneMp4InMoviesNamedAfterTheProject() {
    assertEquals(2 * plan.plannedBytes, neededBytes(plan, 0, 0.0))
    assertEquals("mp4", outputExt(plan))
    assertEquals("", outputLabel(plan))
    assertEquals("My video.mp4", outputName("My video", outputLabel(plan), outputExt(plan)) { false })
    assertTrue(hasBitrateMode(plan))
    assertEquals(Target(Kind.VIDEO, "Movies/Design Editor/", "video/mp4"), targetFor(plan))
  }
}
