package expo.modules.designmedia.android

import androidx.media3.common.MediaItem
import androidx.media3.effect.FrameDropEffect
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import expo.modules.designmedia.core.ComposePlan
import expo.modules.designmedia.core.ItemSpec
import expo.modules.designmedia.core.composeItems
import expo.modules.designmedia.core.forceAudio

// The one place a "Make a video" Composition is made: the preview plays it and the export writes it.
object ComposeBuilder {
  fun composition(plan: ComposePlan, preview: Boolean = false): Composition {
    val items = composeItems(plan).map { spec ->
      item(spec, MediaItem.Builder().setUri(spec.uri).setClippingConfiguration(clipping(spec)).build(), effects(plan, preview))
    }
    val sequence = EditedMediaItemSequence.Builder(items).experimentalSetForceAudioTrack(forceAudio(plan)).build()
    return Composition.Builder(listOf(sequence)).build()
  }

  fun clipping(spec: ItemSpec): MediaItem.ClippingConfiguration =
    MediaItem.ClippingConfiguration.Builder().setStartPositionUs(spec.startUs).setEndPositionUs(spec.endUs).build()

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
