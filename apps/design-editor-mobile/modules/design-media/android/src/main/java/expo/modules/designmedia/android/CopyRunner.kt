package expo.modules.designmedia.android

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Log
import expo.modules.designmedia.core.AudioPlan
import expo.modules.designmedia.core.ClipPlan
import expo.modules.designmedia.core.ClipWindow
import expo.modules.designmedia.core.ConvertPlan
import expo.modules.designmedia.core.TrackRef
import expo.modules.designmedia.core.Verdict
import expo.modules.designmedia.core.audioLabel
import expo.modules.designmedia.core.microseconds
import expo.modules.designmedia.core.remuxSelection
import expo.modules.designmedia.core.videoFirst
import java.nio.ByteBuffer

// Never calls MediaMuxer.setLocation, so a copy carries no location tag (PRD FR-10).
object CopyRunner {
  private const val MIN_BUFFER = 1 shl 20

  fun start(req: Request, source: Probe.Source, done: (Outcome) -> Unit): Runner =
    Worker(req.handler, done) { w -> copy(req, source, w) }.start()

  private fun copy(req: Request, source: Probe.Source, w: Worker): Outcome {
    val extractor = MediaExtractor()
    var muxer: MediaMuxer? = null
    try {
      extractor.setDataSource(req.context, req.input, null)
      val tracks = (0 until extractor.trackCount).map { TrackRef(it, extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME).orEmpty()) }
      val plan = req.plan
      var windows: Map<Int, ClipWindow>? = null
      var spanUs = microseconds(source.durationS)
      var baseUs = 0L
      var label: String? = null
      val container: String
      val picked: List<TrackRef>
      when (plan) {
        is ClipPlan -> {
          container = plan.container
          picked = videoFirst(tracks.filter { it.index in plan.tracks })
          val video = picked.firstOrNull { it.isVideo }
          baseUs = if (video == null) microseconds(plan.startS) else keyframeUs(extractor, video.index, microseconds(plan.startS))
          val endUs = microseconds(plan.endS)
          windows = picked.associate { it.index to ClipWindow(baseUs, endUs) }
          spanUs = endUs - baseUs
        }
        is ConvertPlan -> {
          container = if (plan.container == "m4a") "mp4" else plan.container
          picked = remuxSelection(tracks, plan)
        }
        is AudioPlan -> {
          container = plan.container
          picked = tracks.filter { it.index == plan.trackIndex }
          label = audioLabel(tracks.filter { it.isAudio }.indexOfFirst { it.index == plan.trackIndex }, languageOf(extractor, plan.trackIndex))
          if (plan.mode == "raw" || plan.mode == "wav") {
            if (picked.isEmpty()) return Outcome.Failed("no track to copy")
            return RawAudioWriter.write(extractor, picked.single().index, plan, req.out, source.durationS, w, label)
          }
        }
        else -> throw IllegalArgumentException("Not a copy job: ${plan.tool}")
      }
      if (picked.isEmpty()) return Outcome.Failed("no track to copy")

      val format = when (container) {
        "mp4" -> MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4
        "webm" -> MediaMuxer.OutputFormat.MUXER_OUTPUT_WEBM
        "ogg" -> MediaMuxer.OutputFormat.MUXER_OUTPUT_OGG
        else -> throw IllegalArgumentException("No muxer for container $container")
      }
      val m = MediaMuxer(req.out.absolutePath, format)
      muxer = m
      if (container == "mp4" && picked.any { it.isVideo }) m.setOrientationHint(source.rotation)
      val muxerIndex = HashMap<Int, Int>()
      var bufferSize = MIN_BUFFER
      for (t in picked) {
        val f = extractor.getTrackFormat(t.index)
        if (f.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) bufferSize = maxOf(bufferSize, f.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE))
        extractor.selectTrack(t.index)
        muxerIndex[t.index] = m.addTrack(f)
      }
      if (windows != null) extractor.seekTo(baseUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      m.start()

      var buffer = ByteBuffer.allocateDirect(bufferSize)
      val info = MediaCodec.BufferInfo()
      val finished = HashSet<Int>()
      val leadVideo = picked.firstOrNull { it.isVideo }?.index
      while (true) {
        w.check()
        val track = extractor.sampleTrackIndex
        if (track < 0) break
        val pts = extractor.sampleTime
        val verdict = if (track in finished) Verdict.SKIP else windows?.getValue(track)?.check(pts) ?: Verdict.WRITE
        if (verdict == Verdict.DONE) {
          finished += track
          if (finished.size == picked.size) break
        }
        if (verdict == Verdict.WRITE) {
          val size = extractor.sampleSize.toInt()
          if (size > buffer.capacity()) buffer = ByteBuffer.allocateDirect(size)
          buffer.clear()
          val n = extractor.readSampleData(buffer, 0)
          val flags = if ((extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
          info.set(0, n, pts - baseUs, flags)
          m.writeSampleData(muxerIndex.getValue(track), buffer, info)
          if ((leadVideo == null || track == leadVideo) && spanUs > 0) w.report((pts - baseUs).toDouble() / spanUs)
        }
        if (!extractor.advance()) break
      }
      m.stop()
      return Outcome.Written(label)
    } finally {
      try {
        muxer?.release()
      } catch (e: Exception) {
        Log.w("DesignMediaCopy", "muxer release failed", e)
      }
      extractor.release()
    }
  }

  // The previous sync sample's time, which is the first thing a lossless clip can show.
  private fun keyframeUs(extractor: MediaExtractor, videoIndex: Int, atUs: Long): Long {
    extractor.selectTrack(videoIndex)
    extractor.seekTo(atUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
    val t = extractor.sampleTime.coerceAtLeast(0L)
    extractor.unselectTrack(videoIndex)
    return t
  }

  private fun languageOf(extractor: MediaExtractor, index: Int): String? =
    extractor.getTrackFormat(index).takeIf { it.containsKey(MediaFormat.KEY_LANGUAGE) }?.getString(MediaFormat.KEY_LANGUAGE)
}
