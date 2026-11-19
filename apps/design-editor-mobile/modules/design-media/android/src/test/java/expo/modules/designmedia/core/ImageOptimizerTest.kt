package expo.modules.designmedia.core

import java.io.ByteArrayOutputStream
import java.util.zip.CRC32
import java.util.zip.Deflater
import java.util.zip.Inflater
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

// Same cases as packages/media-core/src/__tests__/image.test.ts.
class ImageOptimizerTest {
  private val signature = byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10)
  private val channelsOf = mapOf(0 to 1, 2 to 3, 3 to 1, 4 to 2, 6 to 4)

  private fun chunk(type: String, data: ByteArray): ByteArray {
    val out = ByteArrayOutputStream()
    fun u32(v: Long) = (3 downTo 0).forEach { out.write((v shr (8 * it)).toInt() and 255) }
    u32(data.size.toLong())
    out.write(type.toByteArray(Charsets.ISO_8859_1))
    out.write(data)
    val crc = CRC32().apply { update(type.toByteArray(Charsets.ISO_8859_1)); update(data) }
    u32(crc.value)
    return out.toByteArray()
  }

  private fun deflate(data: ByteArray, level: Int): ByteArray {
    val d = Deflater(level).apply { setInput(data); finish() }
    val out = ByteArrayOutputStream()
    val buf = ByteArray(4096)
    while (!d.finished()) out.write(buf, 0, d.deflate(buf))
    return out.toByteArray()
  }

  private fun makePng(width: Int, height: Int, colorType: Int, depth: Int, pixels: ByteArray, extra: List<ByteArray> = emptyList(), interlace: Int = 0): ByteArray {
    val rowBytes = (width * channelsOf.getValue(colorType) * depth + 7) / 8
    val filtered = ByteArray((rowBytes + 1) * height)
    for (y in 0 until height) pixels.copyInto(filtered, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes)
    val ihdr = ByteArray(13).also {
      it[3] = width.toByte(); it[7] = height.toByte(); it[8] = depth.toByte(); it[9] = colorType.toByte(); it[12] = interlace.toByte()
    }
    val out = ByteArrayOutputStream()
    out.write(signature)
    out.write(chunk("IHDR", ihdr))
    extra.forEach { out.write(it) }
    out.write(chunk("IDAT", deflate(filtered, 1)))
    out.write(chunk("IEND", ByteArray(0)))
    return out.toByteArray()
  }

  private fun decode(png: ByteArray): ByteArray {
    val width = png[19].toInt() and 255
    val height = png[23].toInt() and 255
    val depth = png[24].toInt()
    val colorType = png[25].toInt()
    val idat = ByteArrayOutputStream()
    var pos = 8
    while (pos < png.size) {
      val len = ((png[pos].toInt() and 255) shl 24) or ((png[pos + 1].toInt() and 255) shl 16) or ((png[pos + 2].toInt() and 255) shl 8) or (png[pos + 3].toInt() and 255)
      if (String(png, pos + 4, 4, Charsets.ISO_8859_1) == "IDAT") idat.write(png, pos + 8, len)
      pos += 12 + len
    }
    val rowBytes = (width * channelsOf.getValue(colorType) * depth + 7) / 8
    val bpp = maxOf(1, (channelsOf.getValue(colorType) * depth) shr 3)
    val data = ByteArray((rowBytes + 1) * height)
    Inflater().apply { setInput(idat.toByteArray()) }.inflate(data)
    val px = ByteArray(rowBytes * height)
    fun at(i: Int) = px[i].toInt() and 255
    for (y in 0 until height) for (x in 0 until rowBytes) {
      val f = data[y * (rowBytes + 1)].toInt()
      val a = if (x >= bpp) at(y * rowBytes + x - bpp) else 0
      val b = if (y > 0) at((y - 1) * rowBytes + x) else 0
      val c = if (y > 0 && x >= bpp) at((y - 1) * rowBytes + x - bpp) else 0
      val p = a + b - c
      val paeth = if (Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)) a else if (Math.abs(p - b) <= Math.abs(p - c)) b else c
      px[y * rowBytes + x] = ((data[y * (rowBytes + 1) + 1 + x].toInt() and 255) + listOf(0, a, b, (a + b) shr 1, paeth)[f]).toByte()
    }
    return px
  }

  private fun gradient(rowBytes: Int, height: Int): ByteArray {
    var seed = 7
    return ByteArray(rowBytes * height) { i ->
      seed = (seed * 1103515245 + 12345) and 0x7fffffff
      (((i % rowBytes) * 3 + (i / rowBytes) * 2 + (seed shr 28)) and 255).toByte()
    }
  }

  private fun contains(data: ByteArray, text: String) = String(data, Charsets.ISO_8859_1).contains(text)

  @Test
  fun everyPngColorTypeKeepsItsPixelsAndGetsSmaller() {
    for ((colorType, depth) in listOf(0 to 8, 2 to 8, 4 to 8, 6 to 8, 2 to 16, 3 to 4, 0 to 1)) {
      val (width, height) = 61 to 40
      val pixels = gradient((width * channelsOf.getValue(colorType) * depth + 7) / 8, height)
      val text = chunk("tEXt", "Comment\u0000made by a test, with some padding to weigh something".toByteArray())
      val plte = if (colorType == 3) listOf(chunk("PLTE", ByteArray(48))) else emptyList()
      val src = makePng(width, height, colorType, depth, pixels, plte + text)
      val out = ImageOptimizer.optimizePng(src)
      assertNotNull("type $colorType depth $depth", out)
      assertTrue(out!!.size < src.size)
      assertArrayEquals("type $colorType depth $depth", pixels, decode(out))
      assertTrue(!contains(out, "tEXt"))
      assertEquals(colorType == 3, contains(out, "PLTE"))
    }
  }

  @Test
  fun aSecondPassFindsNothingMoreToSave() {
    val once = ImageOptimizer.optimizePng(makePng(64, 64, 6, 8, gradient(256, 64)))!!
    assertNull(ImageOptimizer.optimizePng(once))
  }

  @Test
  fun colourChunksSurviveAndTimestampsGo() {
    val src = makePng(8, 8, 2, 8, gradient(24, 8), listOf(chunk("gAMA", ByteArray(4)), chunk("iCCP", "p\u0000\u0000abc".toByteArray()), chunk("tIME", ByteArray(7))))
    val out = ImageOptimizer.optimizePng(src)!!
    assertTrue(contains(out, "gAMA") && contains(out, "iCCP"))
    assertTrue(!contains(out, "tIME"))
  }

  @Test
  fun anInterlacedFileKeepsItsPictureData() {
    val src = makePng(8, 8, 2, 8, gradient(24, 8), listOf(chunk("tEXt", "Comment\u0000".repeat(30).toByteArray())), 1)
    val out = ImageOptimizer.optimizePng(src)!!
    assertTrue(out.size < src.size)
    assertTrue(!contains(out, "tEXt"))
  }

  @Test
  fun pngRefusalsSayWhatIsWrong() {
    assertThrows("not a PNG", IllegalArgumentException::class.java) { ImageOptimizer.optimizePng(byteArrayOf(1, 2, 3)) }
    val good = makePng(8, 8, 2, 8, gradient(24, 8))
    val cut = assertThrows(IllegalArgumentException::class.java) { ImageOptimizer.optimizePng(good.copyOf(good.size - 30)) }
    assertTrue(cut.message!!.contains("damaged"))
    val animated = makePng(8, 8, 2, 8, gradient(24, 8), listOf(chunk("acTL", ByteArray(8))))
    val e = assertThrows(IllegalArgumentException::class.java) { ImageOptimizer.optimizePng(animated) }
    assertTrue(e.message!!.contains("Animated"))
  }

  private fun seg(marker: Int, payload: ByteArray): ByteArray {
    val len = payload.size + 2
    return byteArrayOf(-1, marker.toByte(), (len shr 8).toByte(), len.toByte()) + payload
  }

  private fun ascii(s: String) = s.toByteArray(Charsets.ISO_8859_1)

  private fun exif(orientation: Int, little: Boolean): ByteArray {
    fun u16(n: Int) = if (little) byteArrayOf(n.toByte(), (n shr 8).toByte()) else byteArrayOf((n shr 8).toByte(), n.toByte())
    fun u32(n: Int) = if (little) byteArrayOf(n.toByte(), (n shr 8).toByte(), 0, 0) else byteArrayOf(0, 0, (n shr 8).toByte(), n.toByte())
    val tiff = ascii(if (little) "II" else "MM") + u16(42) + u32(8) + u16(2) +
      u16(0x010f) + u16(2) + u32(0) + u32(0) + u16(0x0112) + u16(3) + u32(1) + u16(orientation) + byteArrayOf(0, 0) + u32(0)
    return seg(0xe1, ascii("Exif") + byteArrayOf(0, 0) + tiff + ByteArray(500) { 7 })
  }

  private val scan = byteArrayOf(-1, -38, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, -1, 0, 0x34, -1, -48, 0x56)
  private val table = seg(0xdb, ByteArray(65) { if (it == 0) 0 else 8 })

  private fun jpeg(vararg parts: ByteArray): ByteArray = byteArrayOf(-1, -40) + parts.fold(ByteArray(0)) { a, b -> a + b } + scan + byteArrayOf(-1, -39)

  private fun indexOf(data: ByteArray, needle: ByteArray): Int {
    for (i in 0..data.size - needle.size) if ((needle.indices).all { data[i + it] == needle[it] }) return i
    return -1
  }

  @Test
  fun jpegMetadataGoesAndThePictureDataIsCopiedByteForByte() {
    val xmp = seg(0xe1, ascii("http://ns.adobe.com/xap/1.0/\u0000") + ByteArray(300) { 1 })
    val src = jpeg(seg(0xe0, ascii("JFIF\u0000")), exif(1, true), xmp, seg(0xfe, ascii("hello")), table)
    val out = ImageOptimizer.optimizeJpeg(src)!!
    assertTrue(out.size < src.size - 700)
    assertEquals(-1, indexOf(out, byteArrayOf(-1, -31)))
    assertEquals(-1, indexOf(out, byteArrayOf(-1, -2)))
    assertTrue(indexOf(out, byteArrayOf(-1, -32)) > 0 && indexOf(out, table) > 0)
    assertArrayEquals(src.copyOfRange(indexOf(src, scan), src.size), out.copyOfRange(indexOf(out, scan), out.size))
  }

  @Test
  fun rotationSurvivesInAMinimalExifInEitherByteOrder() {
    for (little in listOf(true, false)) {
      val out = ImageOptimizer.optimizeJpeg(jpeg(exif(6, little), table))!!
      val at = indexOf(out, byteArrayOf(-1, -31))
      assertTrue(at > 0)
      assertEquals(34, ((out[at + 2].toInt() and 255) shl 8) or (out[at + 3].toInt() and 255))
      assertArrayEquals(byteArrayOf(0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6), out.copyOfRange(at + 20, at + 30))
    }
  }

  @Test
  fun theColourProfileSurvives() {
    val profile = seg(0xe2, ascii("ICC_PROFILE") + byteArrayOf(0, 1, 1) + ByteArray(40) { 9 })
    assertTrue(indexOf(ImageOptimizer.optimizeJpeg(jpeg(profile, exif(1, true)))!!, profile) > 0)
  }

  @Test
  fun aPictureAfterTheEndMarkerIsLeftAlone() {
    assertNull(ImageOptimizer.optimizeJpeg(jpeg(exif(1, true)) + jpeg(table)))
  }

  @Test
  fun aFileWithNoMetadataHasNothingToGainAndBadFilesAreRefused() {
    assertNull(ImageOptimizer.optimizeJpeg(jpeg(table)))
    assertThrows(IllegalArgumentException::class.java) { ImageOptimizer.optimizeJpeg(byteArrayOf(1, 2, 3, 4)) }
    val e = assertThrows(IllegalArgumentException::class.java) { ImageOptimizer.optimizeJpeg(byteArrayOf(-1, -40, -1, -31, -1, -1)) }
    assertNotEquals(null, e.message)
    assertTrue(e.message!!.contains("damaged"))
  }
}
