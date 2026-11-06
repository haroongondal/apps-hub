package expo.modules.designmedia.android

import android.media.MediaExtractor
import android.media.MediaFormat
import expo.modules.designmedia.core.AudioPlan
import expo.modules.designmedia.core.Wav
import java.io.FileOutputStream
import java.io.File
import java.nio.ByteBuffer

// MP3, AC-3 and E-AC-3 samples are whole frames, so writing them back to back makes a playable file; PCM gets a WAV header.
object RawAudioWriter {
  fun write(extractor: MediaExtractor, index: Int, plan: AudioPlan, out: File, durationS: Double, w: Worker, label: String?): Outcome {
    val format = extractor.getTrackFormat(index)
    extractor.selectTrack(index)
    var dataBytes = 0L
    if (plan.mode == "wav") {
      while (extractor.sampleTrackIndex >= 0) {
        w.check()
        dataBytes += extractor.sampleSize
        if (!extractor.advance()) break
      }
      extractor.seekTo(0, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
    }
    val durationUs = durationS * 1_000_000
    FileOutputStream(out).use { file ->
      if (plan.mode == "wav") {
        val encoding = if (format.containsKey(MediaFormat.KEY_PCM_ENCODING)) format.getInteger(MediaFormat.KEY_PCM_ENCODING) else null
        file.write(Wav.header(format.getInteger(MediaFormat.KEY_CHANNEL_COUNT), format.getInteger(MediaFormat.KEY_SAMPLE_RATE), encoding, dataBytes))
      }
      var buffer = ByteBuffer.allocate(1 shl 16)
      val channel = file.channel
      while (extractor.sampleTrackIndex >= 0) {
        w.check()
        val size = extractor.sampleSize.toInt()
        if (size > buffer.capacity()) buffer = ByteBuffer.allocate(size)
        buffer.clear()
        val n = extractor.readSampleData(buffer, 0)
        buffer.limit(n).position(0)
        while (buffer.hasRemaining()) channel.write(buffer)
        if (durationUs > 0) w.report(extractor.sampleTime / durationUs)
        if (!extractor.advance()) break
      }
    }
    return Outcome.Written(label)
  }
}
