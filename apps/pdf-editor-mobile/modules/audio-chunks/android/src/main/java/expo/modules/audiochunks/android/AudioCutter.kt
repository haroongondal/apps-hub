package expo.modules.audiochunks.android

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import expo.modules.audiochunks.core.CutWindow
import java.io.File
import java.nio.ByteBuffer

object AudioCutter {
  private const val DEFAULT_SAMPLE_BYTES = 256 * 1024

  fun durationMs(path: String): Double {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(path)
      val format = extractor.getTrackFormat(audioTrack(extractor))
      require(format.containsKey(MediaFormat.KEY_DURATION)) { "The recording doesn't say how long it is." }
      return format.getLong(MediaFormat.KEY_DURATION) / 1000.0
    } finally {
      extractor.release()
    }
  }

  // Copies the window's AAC samples into a new MPEG-4 file without re-encoding; returns its size in bytes.
  fun cut(path: String, window: CutWindow, outPath: String): Long {
    val extractor = MediaExtractor()
    var muxer: MediaMuxer? = null
    var started = false
    try {
      extractor.setDataSource(path)
      val track = audioTrack(extractor)
      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      val out = MediaMuxer(outPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4).also { muxer = it }
      val outTrack = out.addTrack(format)
      out.start()
      started = true
      val sampleBytes = if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) else DEFAULT_SAMPLE_BYTES
      val buffer = ByteBuffer.allocate(maxOf(sampleBytes, DEFAULT_SAMPLE_BYTES))
      val info = MediaCodec.BufferInfo()
      extractor.seekTo(window.startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      var firstUs = -1L
      var written = 0
      while (true) {
        val sampleUs = extractor.sampleTime
        if (!window.keeps(sampleUs)) break
        val size = extractor.readSampleData(buffer, 0)
        if (size < 0) break
        if (firstUs < 0) firstUs = sampleUs
        val sync = (extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0
        info.set(0, size, window.shifted(sampleUs, firstUs), if (sync) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
        out.writeSampleData(outTrack, buffer, info)
        written++
        extractor.advance()
      }
      check(written > 0) { "That part of the recording has no sound in it." }
      started = false
      out.stop()
      return File(outPath).length()
    } finally {
      if (started) runCatching { muxer?.stop() }
      muxer?.release()
      extractor.release()
    }
  }

  private fun audioTrack(extractor: MediaExtractor): Int =
    (0 until extractor.trackCount).firstOrNull { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
      ?: throw IllegalArgumentException("The recording has no sound track.")
}
