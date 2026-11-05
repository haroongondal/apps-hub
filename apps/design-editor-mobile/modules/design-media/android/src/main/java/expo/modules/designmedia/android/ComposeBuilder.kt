package expo.modules.designmedia.android

import androidx.media3.common.MediaItem
import androidx.media3.effect.FrameDropEffect
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import expo.modules.designmedia.core.ComposePlan
import expo.modules.designmedia.core.composeItems
import expo.modules.designmedia.core.forceAudio

// The one place a "Make a video" Composition is made: the preview plays it and the export writes it.
object ComposeBuilder {
  fun composition(plan: ComposePlan): Composition {
    val items = composeItems(plan).map { spec ->
      val clip = MediaItem.ClippingConfiguration.Builder().setStartPositionUs(spec.startUs).setEndPositionUs(spec.endUs).build()
      EditedMediaItem.Builder(MediaItem.Builder().setUri(spec.uri).setClippingConfiguration(clip).build())
        .setEffects(scaleTo(plan.width, plan.height, plan.fps))
        .build()
    }
    val sequence = EditedMediaItemSequence.Builder(items).experimentalSetForceAudioTrack(forceAudio(plan)).build()
    return Composition.Builder(listOf(sequence)).build()
  }

  fun scaleTo(width: Int, height: Int, fps: Int) = Effects(
    emptyList(),
    listOf(
      Presentation.createForWidthAndHeight(width, height, Presentation.LAYOUT_SCALE_TO_FIT),
      FrameDropEffect.createDefaultFrameDropEffect(fps.toFloat()),
    ),
  )
}
