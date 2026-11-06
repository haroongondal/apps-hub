package expo.modules.designmedia.core

import java.nio.ByteBuffer
import java.nio.ByteOrder

// A 44-byte RIFF/WAVE header for little-endian PCM. `pcmEncoding` is android.media.AudioFormat's ENCODING_PCM_* value.
object Wav {
  const val PCM_16BIT = 2
  const val PCM_8BIT = 3
  const val PCM_FLOAT = 4
  const val PCM_24BIT_PACKED = 21
  const val PCM_32BIT = 22
  private const val MAX_DATA = 0xFFFFFFFFL - 36

  fun bitsOf(pcmEncoding: Int?): Int? = when (pcmEncoding ?: PCM_16BIT) {
    PCM_8BIT -> 8
    PCM_16BIT -> 16
    PCM_24BIT_PACKED -> 24
    PCM_32BIT, PCM_FLOAT -> 32
    else -> null
  }

  fun header(channels: Int, sampleRate: Int, pcmEncoding: Int?, dataBytes: Long): ByteArray {
    val bits = requireNotNull(bitsOf(pcmEncoding)) { "This PCM format can't be saved as a WAV file." }
    require(dataBytes in 0..MAX_DATA) { "This sound is too long for a WAV file." }
    val blockAlign = channels * bits / 8
    return ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
      put("RIFF".toByteArray(Charsets.US_ASCII))
      putInt((36 + dataBytes).toInt())
      put("WAVEfmt ".toByteArray(Charsets.US_ASCII))
      putInt(16)
      putShort((if (pcmEncoding == PCM_FLOAT) 3 else 1).toShort())
      putShort(channels.toShort())
      putInt(sampleRate)
      putInt(sampleRate * blockAlign)
      putShort(blockAlign.toShort())
      putShort(bits.toShort())
      put("data".toByteArray(Charsets.US_ASCII))
      putInt(dataBytes.toInt())
    }.array()
  }
}
