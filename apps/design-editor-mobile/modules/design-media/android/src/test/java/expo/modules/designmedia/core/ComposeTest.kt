package expo.modules.designmedia.core

import androidx.media3.common.MediaItem
import androidx.media3.common.audio.GainProcessor
import androidx.media3.effect.FrameDropEffect
import androidx.media3.transformer.Effects
import expo.modules.designmedia.android.ComposeBuilder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
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
          ComposeClip("content://media/a", "a.mp4", 0.0, 10.0, true, 1.5),
          ComposeClip("content://media/b", "b.mp4", 0.0, 4.0, false, 1.0),
        ),
        1920, 1080, 30, 6_220_800, 11_222_400L, "mp4",
        listOf(ComposeMusic("content://media/s", "s.m4a", 0.0, 11.0, 3.0, 0.5)),
      ),
      plan,
    )
    assertEquals(plan, decodePlan(encodePlan(plan)))
  }

  @Test
  fun oneItemPerClipWithItsTimesInMicroseconds() {
    assertEquals(
      listOf(ItemSpec("content://media/a", 0, 10_000_000, true, 1.5f), ItemSpec("content://media/b", 0, 4_000_000, false, 1f)),
      composeItems(plan),
    )
  }

  @Test
  fun eachItemKnowsItsLengthSoThePreviewPlayerAcceptsIt() {
    val spec = ItemSpec("content://media/a", 2_000_000, 10_000_000, true)
    val media = MediaItem.Builder().setClippingConfiguration(ComposeBuilder.clipping(spec.startUs, spec.endUs)).build()
    assertEquals(8_000_000L, ComposeBuilder.item(spec, media, Effects.EMPTY).presentationDurationUs)
  }

  @Test
  fun thePreviewSkipsTheFrameRateCapThatFreezesThePlayerAfterTheFirstClip() {
    assertEquals(1, ComposeBuilder.effects(plan, preview = false).videoEffects.count { it is FrameDropEffect })
    assertEquals(0, ComposeBuilder.effects(plan, preview = true).videoEffects.count { it is FrameDropEffect })
    assertEquals(1, ComposeBuilder.effects(plan, preview = true).videoEffects.size)
  }

  @Test
  fun silenceIsAddedWhenSomeClipHasSoundOrThereIsMusic() {
    assertTrue(forceAudio(plan))
    val silent = plan.copy(clips = plan.clips.map { it.copy(hasAudio = false) })
    assertTrue(forceAudio(silent))
    assertFalse(forceAudio(silent.copy(music = emptyList())))
  }

  @Test
  fun aPlanQueuedBeforeMusicExistedDecodesAtNormalVolumeWithNoMusic() {
    val old = Json.parseToJsonElement(
      """{"tool":"compose","clips":[{"uri":"u","name":"a.mp4","inS":0,"outS":4,"hasAudio":true}],""" +
        """"width":1280,"height":720,"fps":30,"videoBps":1,"plannedBytes":2,"ext":"mp4"}""",
    ).jsonObject
    val p = decodePlan(old) as ComposePlan
    assertEquals(1.0, p.clips.single().volume, 0.0)
    assertEquals(emptyList<ComposeMusic>(), p.music)
  }

  @Test
  fun musicPiecesInStartOrderWithTheSilenceBeforeEach() {
    val p = plan.copy(music = listOf(
      ComposeMusic("u2", "t.m4a", 1.0, 3.0, 10.0, 0.5),
      ComposeMusic("u1", "s.m4a", 0.0, 5.0, 3.0, 1.0),
    ))
    assertEquals(
      listOf(MusicSpec("u1", 0, 5_000_000, 3_000_000, 1f), MusicSpec("u2", 1_000_000, 3_000_000, 2_000_000, 0.5f)),
      musicItems(p),
    )
    assertEquals(emptyList<MusicSpec>(), musicItems(p.copy(music = emptyList())))
  }

  @Test
  fun aVolumeOtherThanNormalAddsAGainAndASilentClipGetsNone() {
    assertEquals(0, ComposeBuilder.gain(1f).size)
    assertTrue(ComposeBuilder.gain(0.5f).single() is GainProcessor)
    assertTrue(ComposeBuilder.gain(0f).single() is GainProcessor)
    assertEquals(1, ComposeBuilder.clipGain(ItemSpec("a", 0, 1, true, 1.5f)).size)
    assertEquals(0, ComposeBuilder.clipGain(ItemSpec("a", 0, 1, false, 1.5f)).size)
  }

  @Test
  fun musicIsASecondSoundOnlySequenceWithSilenceBetweenPieces() {
    val specs = listOf(MusicSpec("u1", 0, 5_000_000, 3_000_000, 1f), MusicSpec("u2", 1_000_000, 3_000_000, 0, 0.5f))
    val seq = ComposeBuilder.musicSequence(specs) { s ->
      MediaItem.Builder().setMediaId(s.uri).setClippingConfiguration(ComposeBuilder.clipping(s.startUs, s.endUs)).build()
    }
    assertEquals(setOf(1), seq.trackTypes)
    val items = seq.editedMediaItems
    assertEquals(listOf("androidx-media3-GapMediaItem", "u1", "u2"), items.map { it.mediaItem.mediaId })
    assertEquals(3_000_000L, items[0].durationUs)
    assertTrue(items[1].removeVideo)
    assertEquals(5_000_000L, items[1].presentationDurationUs)
    assertEquals(0, items[1].effects.audioProcessors.size)
    assertTrue(items[2].effects.audioProcessors.single() is GainProcessor)
    assertEquals(2_000_000L, items[2].presentationDurationUs)
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
