package expo.modules.designmedia.core

import java.io.ByteArrayOutputStream
import java.util.concurrent.CancellationException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class GifEncoderTest {
  private class Decoded(val width: Int, val height: Int, val palette: List<Int>, val loops: Boolean, val delays: List<Int>, val frames: List<ByteArray>)

  // A small GIF reader: header, screen descriptor, colour table, NETSCAPE loop, then frames (LZW decoded).
  private fun decode(bytes: ByteArray): Decoded {
    var p = 0
    fun u8() = bytes[p++].toInt() and 0xFF
    fun u16() = u8() or (u8() shl 8)
    assertEquals("GIF89a", String(bytes, 0, 6, Charsets.US_ASCII))
    p = 6
    val width = u16()
    val height = u16()
    val fields = u8()
    u8()
    u8()
    val palette = if (fields and 0x80 != 0) List(1 shl ((fields and 7) + 1)) { (u8() shl 16) or (u8() shl 8) or u8() } else emptyList()
    var loops = false
    val delays = ArrayList<Int>()
    val frames = ArrayList<ByteArray>()
    while (true) {
      when (val block = u8()) {
        0x21 -> {
          val label = u8()
          if (label == 0xF9) {
            u8()
            u8()
            delays.add(u16())
            u8()
            u8()
          } else {
            if (label == 0xFF && String(bytes, p + 1, 11, Charsets.US_ASCII) == "NETSCAPE2.0") loops = true
            var n = u8()
            while (n != 0) {
              p += n
              n = u8()
            }
          }
        }
        0x2C -> {
          u16(); u16()
          val w = u16()
          val h = u16()
          u8()
          val minCode = u8()
          val data = ArrayList<Byte>()
          var n = u8()
          while (n != 0) {
            repeat(n) { data.add(bytes[p++]) }
            n = u8()
          }
          frames.add(lzwDecode(minCode, data.toByteArray(), w * h))
        }
        0x3B -> return Decoded(width, height, palette, loops, delays, frames)
        else -> fail("unexpected block 0x${block.toString(16)} at ${p - 1}")
      }
    }
  }

  private fun lzwDecode(minCode: Int, data: ByteArray, pixels: Int): ByteArray {
    val clear = 1 shl minCode
    val eof = clear + 1
    val out = ByteArray(pixels)
    var o = 0
    var table = ArrayList<ByteArray>()
    fun reset() {
      table = ArrayList()
      for (i in 0 until clear) table.add(byteArrayOf(i.toByte()))
      table.add(ByteArray(0))
      table.add(ByteArray(0))
    }
    reset()
    var size = minCode + 1
    var bitPos = 0
    var prev: ByteArray? = null
    while (true) {
      var code = 0
      for (b in 0 until size) code = code or (((data[bitPos shr 3].toInt() shr (bitPos and 7)) and 1) shl b).also { bitPos++ }
      if (code == clear) {
        reset()
        size = minCode + 1
        prev = null
        continue
      }
      if (code == eof) break
      val entry = if (code < table.size) table[code] else prev!! + prev[0]
      for (b in entry) if (o < pixels) out[o++] = b
      if (prev != null) table.add(prev + entry[0])
      prev = entry
      if (table.size == (1 shl size) && size < 12) size++
    }
    assertEquals("pixels decoded", pixels, o)
    return out
  }

  private fun encode(width: Int, height: Int, palette: IntArray, frames: List<ByteArray>, delayCs: Int = 8): ByteArray {
    val out = ByteArrayOutputStream()
    val encoder = GifEncoder(out, width, height, palette)
    frames.forEach { encoder.writeFrame(it, delayCs) }
    encoder.finish()
    return out.toByteArray()
  }

  @Test
  fun writesTheHeaderScreenSizePaletteAndLoopExtension() {
    val palette = intArrayOf(0xFF0000, 0x00FF00, 0x0000FF)
    val gif = decode(encode(5, 3, palette, listOf(ByteArray(15) { (it % 3).toByte() })))
    assertEquals(5, gif.width)
    assertEquals(3, gif.height)
    assertEquals(palette.toList() + 0, gif.palette)
    assertTrue("NETSCAPE2.0 loop block", gif.loops)
  }

  @Test
  fun everyFrameComesBackPixelForPixel() {
    val width = 40
    val height = 30
    val palette = IntArray(256) { (it shl 16) or ((255 - it) shl 8) or (it * 7 and 0xFF) }
    val frames = (0 until 4).map { f -> ByteArray(width * height) { ((it * (f + 3) + f * 11) % 256).toByte() } }
    val gif = decode(encode(width, height, palette, frames, 7))
    assertEquals(4, gif.frames.size)
    assertEquals(List(4) { 7 }, gif.delays)
    frames.forEachIndexed { i, f -> assertArrayEquals("frame $i", f, gif.frames[i]) }
  }

  @Test
  fun aLongFlatFrameAndANoisyFrameBothSurviveTheCodeTableFillingUp() {
    val width = 200
    val height = 200
    val palette = IntArray(256) { it * 0x010101 }
    val rng = java.util.Random(7)
    val flat = ByteArray(width * height)
    val noisy = ByteArray(width * height).also { rng.nextBytes(it) }
    val gif = decode(encode(width, height, palette, listOf(flat, noisy)))
    assertArrayEquals(flat, gif.frames[0])
    assertArrayEquals(noisy, gif.frames[1])
  }

  @Test
  fun aOneColourPaletteStillMakesAValidGif() {
    val gif = decode(encode(2, 2, intArrayOf(0x123456), listOf(ByteArray(4))))
    assertEquals(listOf(0x123456, 0), gif.palette)
    assertArrayEquals(ByteArray(4), gif.frames.single())
  }

  @Test
  fun theWriterCountsFramesDelaysAndPaletteSamples() {
    assertEquals(36, GifWriter.frameCount(1.0, 4.0, 12))
    assertEquals(1, GifWriter.frameCount(0.0, 0.01, 12))
    assertEquals(listOf(0, 5, 10, 15, 20, 25, 30, 35), GifWriter.paletteFrames(36))
    assertEquals(listOf(0, 1, 2), GifWriter.paletteFrames(3))
    assertEquals(listOf(0), GifWriter.paletteFrames(1))
    val delays = GifWriter.delaysCs(12, 36)
    assertEquals(300, delays.sum())
    assertTrue(delays.all { it == 8 || it == 9 })
    assertEquals(listOf(10, 10), GifWriter.delaysCs(10, 2).toList())
  }

  @Test
  fun aWholeClipIsWrittenFromFramesThatAreFilledOneAtATime() {
    val width = 16
    val height = 12
    val out = ByteArrayOutputStream()
    val asked = ArrayList<Int>()
    val progress = ArrayList<Double>()
    GifWriter.write(
      out, width, height, 12, 20,
      frame = { i, rgb ->
        asked.add(i)
        for (p in rgb.indices) rgb[p] = if ((p % width + i) % 2 == 0) 0xFF0000 else 0x0000FF
      },
      progress = { progress.add(it) },
    )
    val gif = decode(out.toByteArray())
    assertEquals(20, gif.frames.size)
    assertEquals(width, gif.width)
    assertEquals(height, gif.height)
    assertEquals(GifWriter.paletteFrames(20) + (0 until 20), asked)
    assertEquals(1.0, progress.last(), 1e-9)
    assertTrue(progress.zipWithNext().all { (a, b) -> b > a })
    assertEquals(setOf(0xFF0000, 0x0000FF), gif.palette.take(2).toSet())
  }

  @Test
  fun cancellingStopsTheWriter() {
    var calls = 0
    try {
      GifWriter.write(ByteArrayOutputStream(), 4, 4, 10, 30, frame = { _, rgb -> rgb.fill(0x112233); calls++ }, cancelled = { calls >= 10 })
      fail("expected a cancellation")
    } catch (e: CancellationException) {
      assertEquals(10, calls)
    }
  }
}
