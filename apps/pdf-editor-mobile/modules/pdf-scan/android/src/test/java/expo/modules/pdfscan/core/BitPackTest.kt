package expo.modules.pdfscan.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.zip.Deflater
import java.util.zip.Inflater

class BitPackTest {
  @Test fun packsMsbFirstWithRowPadding() {
    val white = ByteArray(10 * 2)
    white[0] = 1
    assertArrayEquals(byteArrayOf(0b1000_0000.toByte(), 0, 0, 0), BitPack.pack(white, 10, 2))
  }

  @Test fun packsAFullRowAndTheLastPaddedBits() {
    val white = ByteArray(9) { 255.toByte() }
    assertArrayEquals(byteArrayOf(0xFF.toByte(), 0b1000_0000.toByte()), BitPack.pack(white, 9, 1))
  }

  @Test fun survivesAZlibRoundTrip() {
    val w = 13; val h = 7
    val white = ByteArray(w * h) { if ((it * 7) % 3 == 0) 255.toByte() else 0 }
    val packed = BitPack.pack(white, w, h)
    val d = Deflater(9).apply { setInput(packed); finish() }
    val buf = ByteArray(1024)
    val z = buf.copyOf(d.deflate(buf))
    val out = ByteArray(packed.size)
    val n = Inflater().apply { setInput(z) }.inflate(out)
    assertEquals(packed.size, n)
    assertArrayEquals(packed, out)
    for (y in 0 until h) for (x in 0 until w) {
      val bit = (out[y * 2 + x / 8].toInt() shr (7 - x % 8)) and 1
      assertEquals(if (white[y * w + x].toInt() != 0) 1 else 0, bit)
    }
  }
}
