package expo.modules.designmedia.android

import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.effect.FrameDropEffect
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import expo.modules.designmedia.core.ComposePlan
import expo.modules.designmedia.core.ItemSpec
import expo.modules.designmedia.core.MusicSpec
import expo.modules.designmedia.core.composeItems
import expo.modules.designmedia.core.forceAudio
import expo.modules.designmedia.core.musicItems
import java.nio.ByteBuffer

// The one place a "Make a video" Composition is made: the preview plays it and the export writes it.
object ComposeBuilder {
  fun composition(plan: ComposePlan, preview: Boolean = false): Composition {
    val picture = effects(plan, preview).videoEffects
    val items = composeItems(plan).map { spec ->
      item(spec, media(spec.uri, spec.startUs, spec.endUs), Effects(clipGain(spec), picture))
    }
    val video = EditedMediaItemSequence.Builder(items).experimentalSetForceAudioTrack(forceAudio(plan)).build()
    val music = musicItems(plan)
    if (music.isEmpty()) return Composition.Builder(listOf(video)).build()
    return Composition.Builder(listOf(video, musicSequence(music) { media(it.uri, it.startUs, it.endUs) })).build()
  }

  private fun media(uri: String, startUs: Long, endUs: Long) =
    MediaItem.Builder().setUri(uri).setClippingConfiguration(clipping(startUs, endUs)).build()

  fun clipping(startUs: Long, endUs: Long): MediaItem.ClippingConfiguration =
    MediaItem.ClippingConfiguration.Builder().setStartPositionUs(startUs).setEndPositionUs(endUs).build()

  // shortcut: Loud stops at full scale (a hard clip, no limiter), so a loud song can sound harsh at 1.5; add a limiter if the phone check hears it.
  fun gain(volume: Float): List<AudioProcessor> = if (volume == 1f) emptyList() else listOf(ClampedGain(volume))

  // A clip with no sound gets its silence from the sequence; there is nothing to make louder or quieter.
  fun clipGain(spec: ItemSpec): List<AudioProcessor> = if (spec.keepAudio) gain(spec.volume) else emptyList()

  // The music row: sound only, a gap for the silence before each piece. It is never longer than the video (the planner cuts it).
  fun musicSequence(specs: List<MusicSpec>, media: (MusicSpec) -> MediaItem): EditedMediaItemSequence {
    val b = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO))
    for (s in specs) {
      if (s.gapBeforeUs > 0) b.addGap(s.gapBeforeUs)
      b.addItem(EditedMediaItem.Builder(media(s)).setRemoveVideo(true).setDurationUs(s.endUs).setEffects(Effects(gain(s.volume), emptyList())).build())
    }
    return b.build()
  }

  // CompositionPlayer refuses an item with no length. The clip's end is enough: it is never past the file
  // (the planner floors it to a tenth), and the clipping stops there anyway.
  fun item(spec: ItemSpec, media: MediaItem, effects: Effects): EditedMediaItem =
    EditedMediaItem.Builder(media).setDurationUs(spec.endUs).setEffects(effects).build()

  // On the phone (Media3 1.11.1) CompositionPlayer froze the picture after the first clip with the frame-rate cap on each item;
  // the preview plays at the clips' own rates, the export still caps it.
  fun effects(plan: ComposePlan, preview: Boolean): Effects =
    if (preview) Effects(emptyList(), listOf(fitTo(plan.width, plan.height))) else scaleTo(plan.width, plan.height, plan.fps)

  fun scaleTo(width: Int, height: Int, fps: Int) = Effects(
    emptyList(),
    listOf(
      fitTo(width, height),
      FrameDropEffect.createDefaultFrameDropEffect(fps.toFloat()),
    ),
  )

  private fun fitTo(width: Int, height: Int) = Presentation.createForWidthAndHeight(width, height, Presentation.LAYOUT_SCALE_TO_FIT)
}

// Media3 1.11.1's GainProcessor casts 16-bit samples back with no clamp, so a gain above 1 wraps a loud sample
// to the opposite sign (a crackle). This one stops at full scale. It takes the same formats GainProcessor takes.
class ClampedGain(private val volume: Float) : BaseAudioProcessor() {
  override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
      throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
    }
    return inputAudioFormat
  }

  override fun queueInput(inputBuffer: ByteBuffer) {
    val out = replaceOutputBuffer(inputBuffer.remaining())
    if (inputAudioFormat.encoding == C.ENCODING_PCM_16BIT) {
      while (inputBuffer.remaining() >= 2) out.putShort(Math.round(inputBuffer.short * volume).coerceIn(-32_768, 32_767).toShort())
    } else {
      while (inputBuffer.remaining() >= 4) out.putFloat((inputBuffer.float * volume).coerceIn(-1f, 1f))
    }
    out.flip()
  }
}
