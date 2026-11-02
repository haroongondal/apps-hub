package expo.modules.designmedia.android

import android.content.Context
import android.media.MediaCodecInfo.EncoderCapabilities
import android.net.Uri
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.effect.FrameDropEffect
import androidx.media3.effect.Presentation
import androidx.media3.transformer.AudioEncoderSettings
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import expo.modules.designmedia.core.SizePlan
import java.io.File

object TransformerRunner {
  fun start(
    context: Context,
    looper: Looper,
    plan: SizePlan,
    input: Uri,
    out: File,
    cbr: Boolean,
    listener: Transformer.Listener,
  ): Transformer {
    val mode = if (cbr) EncoderCapabilities.BITRATE_MODE_CBR else EncoderCapabilities.BITRATE_MODE_VBR
    val encoders = DefaultEncoderFactory.Builder(context).apply {
      setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(plan.videoBps).setBitrateMode(mode).build())
      if (plan.audio.mode == "aac") {
        setRequestedAudioEncoderSettings(AudioEncoderSettings.Builder().setBitrate(plan.audio.bps).build())
      }
    }.build()
    val transformer = Transformer.Builder(context).apply {
      setVideoMimeType(if (plan.encoder == "hw-hevc") MimeTypes.VIDEO_H265 else MimeTypes.VIDEO_H264)
      if (plan.audio.mode == "aac") setAudioMimeType(MimeTypes.AUDIO_AAC)
      setEncoderFactory(encoders)
      setLooper(looper)
      addListener(listener)
    }.build()
    val item = EditedMediaItem.Builder(MediaItem.fromUri(input))
      .setRemoveAudio(plan.audio.mode == "none")
      .setEffects(
        Effects(
          emptyList(),
          listOf(
            Presentation.createForWidthAndHeight(plan.width, plan.height, Presentation.LAYOUT_SCALE_TO_FIT),
            FrameDropEffect.createDefaultFrameDropEffect(plan.rung.fps.toFloat()),
          ),
        ),
      )
      .build()
    transformer.start(item, out.absolutePath)
    return transformer
  }

  fun progress(transformer: Transformer): Double? {
    val holder = ProgressHolder()
    return if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) holder.progress / 100.0 else null
  }
}
