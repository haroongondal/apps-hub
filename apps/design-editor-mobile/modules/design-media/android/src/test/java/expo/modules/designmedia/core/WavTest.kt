package expo.modules.designmedia.core

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class WavTest {
  private fun parse(bytes: ByteArray) = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)

  @Test
  fun aSixteenBitStereoHeaderHasTheRiffLayout() {
    val h = Wav.header(2, 44100, null, 1_000)
    assertEquals(44, h.size)
    val b = parse(h)
    assertEquals("RIFF", String(h, 0, 4, Charsets.US_ASCII))
    assertEquals(1_036, b.getInt(4))
    assertEquals("WAVEfmt ", String(h, 8, 8, Charsets.US_ASCII))
    assertEquals(16, b.getInt(16))
    assertEquals(1, b.getShort(20).toInt())
    assertEquals(2, b.getShort(22).toInt())
    assertEquals(44100, b.getInt(24))
    assertEquals(176_400, b.getInt(28))
    assertEquals(4, b.getShort(32).toInt())
    assertEquals(16, b.getShort(34).toInt())
    assertEquals("data", String(h, 36, 4, Charsets.US_ASCII))
    assertEquals(1_000, b.getInt(40))
  }

  @Test
  fun floatPcmUsesFormatTagThree() {
    val b = parse(Wav.header(1, 48000, Wav.PCM_FLOAT, 8))
    assertEquals(3, b.getShort(20).toInt())
    assertEquals(32, b.getShort(34).toInt())
    assertEquals(192_000, b.getInt(28))
  }

  @Test
  fun everyPcmEncodingMapsToItsBitDepth() {
    assertEquals(8, Wav.bitsOf(Wav.PCM_8BIT))
    assertEquals(16, Wav.bitsOf(null))
    assertEquals(24, Wav.bitsOf(Wav.PCM_24BIT_PACKED))
    assertEquals(32, Wav.bitsOf(Wav.PCM_32BIT))
    assertEquals(null, Wav.bitsOf(99))
  }

  @Test
  fun anUnknownEncodingOrAnOversizedBodyIsRefused() {
    assertThrows(IllegalArgumentException::class.java) { Wav.header(2, 44100, 99, 10) }
    assertThrows(IllegalArgumentException::class.java) { Wav.header(2, 44100, null, 5_000_000_000L) }
  }
}
