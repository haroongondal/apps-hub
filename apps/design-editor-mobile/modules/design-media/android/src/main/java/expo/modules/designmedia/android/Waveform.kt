package expo.modules.designmedia.android

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import expo.modules.designmedia.core.PeakBuckets
import java.nio.ByteBuffer
import java.nio.ByteOrder

// Read-only: the file is opened for reading and decoded in memory; nothing is written anywhere.
object Waveform {
  private const val WAIT_US = 10_000L
  private const val STALL_POLLS = 500 // about 10 s in which the decoder neither took input nor gave output

  // Peak 0..1 per slice of the first sound track, or an empty list when the file has none.
  fun peaks(context: Context, uri: Uri, buckets: Int): List<Float> {
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      extractor.setDataSource(context, uri, null)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME).orEmpty().startsWith("audio/")
      } ?: return emptyList()
      val format = extractor.getTrackFormat(track)
      extractor.selectTrack(track)
      val result = PeakBuckets(durationUs(context, uri, format), buckets)
      val decoder = MediaCodec.createDecoderByType(requireNotNull(format.getString(MediaFormat.KEY_MIME)))
      codec = decoder
      decoder.configure(format, null, null, 0)
      decoder.start()
      var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var encoding = AudioFormat.ENCODING_PCM_16BIT
      val info = MediaCodec.BufferInfo()
      var inputDone = false
      var stalled = 0
      while (true) {
        if (!inputDone) {
          val i = decoder.dequeueInputBuffer(WAIT_US)
          if (i >= 0) {
            stalled = 0
            val n = extractor.readSampleData(checkNotNull(decoder.getInputBuffer(i)), 0)
            if (n < 0) {
              decoder.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              decoder.queueInputBuffer(i, 0, n, extractor.sampleTime.coerceAtLeast(0L), 0)
              extractor.advance()
            }
          }
        }
        val o = decoder.dequeueOutputBuffer(info, WAIT_US)
        if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          val out = decoder.outputFormat
          channels = out.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          sampleRate = out.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          encoding = if (out.containsKey(MediaFormat.KEY_PCM_ENCODING)) out.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
        } else if (o >= 0) {
          stalled = 0
          if (info.size > 0) {
            val buffer = checkNotNull(decoder.getOutputBuffer(o))
            buffer.position(info.offset)
            buffer.limit(info.offset + info.size)
            buffer.order(ByteOrder.nativeOrder())
            result.add(info.presentationTimeUs, pcm16(buffer, info.size, encoding), channels, sampleRate)
          }
          decoder.releaseOutputBuffer(o, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
        } else if (++stalled > STALL_POLLS) {
          throw IllegalStateException("The sound stopped decoding.")
        }
      }
      return result.result()
    } finally {
      try {
        codec?.release()
      } finally {
        extractor.release()
      }
    }
  }

  // The decoder reports 16-bit unless the format says float; anything else would be read wrongly, so it fails instead.
  private fun pcm16(buffer: ByteBuffer, size: Int, encoding: Int): ShortArray = when (encoding) {
    AudioFormat.ENCODING_PCM_16BIT -> ShortArray(size / 2).also { buffer.asShortBuffer().get(it) }
    AudioFormat.ENCODING_PCM_FLOAT -> {
      val floats = FloatArray(size / 4).also { buffer.asFloatBuffer().get(it) }
      ShortArray(floats.size) { (floats[it] * 32768f).toInt().coerceIn(-32768, 32767).toShort() }
    }
    else -> throw IllegalStateException("This sound format cannot be drawn.")
  }

  // The strip lays the bars over the whole file's length (what probe reports), so slice that, not the sound track's own length.
  private fun durationUs(context: Context, uri: Uri, format: MediaFormat): Long {
    val retriever = MediaMetadataRetriever()
    val container = try {
      retriever.setDataSource(context, uri)
      (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) * 1000
    } finally {
      retriever.release()
    }
    if (container > 0) return container
    return if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
  }
}
