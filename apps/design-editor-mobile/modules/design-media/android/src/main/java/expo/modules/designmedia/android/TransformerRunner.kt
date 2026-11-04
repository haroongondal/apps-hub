package expo.modules.designmedia.android

import android.media.MediaCodecInfo.EncoderCapabilities
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.effect.FrameDropEffect
import androidx.media3.effect.Presentation
import androidx.media3.transformer.AudioEncoderSettings
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import expo.modules.designmedia.core.AudioPlan
import expo.modules.designmedia.core.ClipPlan
import expo.modules.designmedia.core.ConvertPlan
import expo.modules.designmedia.core.QualityPlan
import expo.modules.designmedia.core.SizePlan
import expo.modules.designmedia.core.convertBps
import expo.modules.designmedia.core.microseconds
import expo.modules.designmedia.core.qualityBps

object TransformerRunner {
  private const val TAG = "DesignMediaTransformer"
  private const val AAC_BPS = 192_000
  private const val QUALITY_AUDIO_BPS = 160_000

  fun start(req: Request, source: Probe.Source?, done: (Outcome) -> Unit): Runner {
    val input = req.input
    val plain = MediaItem.fromUri(input)
    return when (val plan = req.plan) {
      is SizePlan -> {
        val audioBps = if (plan.audio.mode == "aac") plan.audio.bps else null
        val item = EditedMediaItem.Builder(plain)
          .setRemoveAudio(plan.audio.mode == "none")
          .setEffects(scaleTo(plan.width, plan.height, plan.rung.fps))
          .build()
        launch(req, done, item) {
          setVideoMimeType(if (plan.encoder == "hw-hevc") MimeTypes.VIDEO_H265 else MimeTypes.VIDEO_H264)
          if (audioBps != null) setAudioMimeType(MimeTypes.AUDIO_AAC)
          setEncoderFactory(encoders(req, plan.videoBps, audioBps))
        }
      }
      is QualityPlan -> {
        val bps = qualityBps(plan.quality, plan.width, plan.height, plan.rung.fps, source?.videoBps)
        val item = EditedMediaItem.Builder(plain).setEffects(scaleTo(plan.width, plan.height, plan.rung.fps)).build()
        launch(req, done, item) {
          setVideoMimeType(MimeTypes.VIDEO_H264)
          setAudioMimeType(MimeTypes.AUDIO_AAC)
          setEncoderFactory(encoders(req, bps, QUALITY_AUDIO_BPS))
        }
      }
      is ClipPlan -> {
        val clip = MediaItem.ClippingConfiguration.Builder()
          .setStartPositionUs(microseconds(plan.startS))
          .setEndPositionUs(microseconds(plan.endS))
          .build()
        val item = EditedMediaItem.Builder(MediaItem.Builder().setUri(input).setClippingConfiguration(clip).build()).build()
        launch(req, done, item) {
          experimentalSetTrimOptimizationEnabled(true)
          setEncoderFactory(encoders(req, source?.videoBps, null))
        }
      }
      is ConvertPlan -> {
        val video = plan.video
        val audio = plan.audio
        val item = EditedMediaItem.Builder(plain).setRemoveAudio(audio == null).setRemoveVideo(video == null).build()
        launch(req, done, item) {
          val reencode = video != null && video.encoder != "copy"
          if (video != null && reencode) {
            setVideoMimeType(if (video.encoder == "hw-hevc") MimeTypes.VIDEO_H265 else MimeTypes.VIDEO_H264)
          }
          val audioBps = if (audio != null && !audio.copy) audio.bps ?: AAC_BPS else null
          if (audioBps != null) setAudioMimeType(MimeTypes.AUDIO_AAC)
          setEncoderFactory(encoders(req, if (video != null && reencode) convertBps(video.encoder, source?.videoBps) else null, audioBps))
        }
      }
      is AudioPlan -> {
        val item = EditedMediaItem.Builder(plain).setRemoveVideo(true).build()
        launch(req, done, item) {
          setAudioMimeType(MimeTypes.AUDIO_AAC)
          setEncoderFactory(encoders(req, null, plan.bps ?: AAC_BPS))
        }
      }
      else -> throw IllegalArgumentException("Not a Media3 job: ${plan.tool}")
    }
  }

  private fun launch(req: Request, done: (Outcome) -> Unit, item: EditedMediaItem, configure: Transformer.Builder.() -> Unit): Runner {
    val transformer = Transformer.Builder(req.context).apply {
      configure()
      setLooper(req.looper)
      addListener(
        object : Transformer.Listener {
          override fun onCompleted(composition: Composition, result: ExportResult) {
            Log.i(TAG, "completed, trim optimisation result ${result.optimizationResult}")
            done(Outcome.Written())
          }

          override fun onError(composition: Composition, result: ExportResult, exception: ExportException) =
            done(Outcome.Failed("export error ${ExportException.getErrorCodeName(exception.errorCode)}"))
        },
      )
    }.build()
    transformer.start(item, req.out.absolutePath)
    return object : Runner {
      override fun progress(): Double? {
        val holder = ProgressHolder()
        return if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) holder.progress / 100.0 else null
      }

      override fun cancel() = transformer.cancel()
    }
  }

  private fun encoders(req: Request, videoBps: Int?, audioBps: Int?): DefaultEncoderFactory {
    val mode = if (req.cbr) EncoderCapabilities.BITRATE_MODE_CBR else EncoderCapabilities.BITRATE_MODE_VBR
    return DefaultEncoderFactory.Builder(req.context).apply {
      if (videoBps != null) {
        setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(videoBps).setBitrateMode(mode).build())
      }
      if (audioBps != null) setRequestedAudioEncoderSettings(AudioEncoderSettings.Builder().setBitrate(audioBps).build())
    }.build()
  }

  private fun scaleTo(width: Int, height: Int, fps: Int) = Effects(
    emptyList(),
    listOf(
      Presentation.createForWidthAndHeight(width, height, Presentation.LAYOUT_SCALE_TO_FIT),
      FrameDropEffect.createDefaultFrameDropEffect(fps.toFloat()),
    ),
  )
}
