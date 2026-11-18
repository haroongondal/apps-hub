package expo.modules.designmedia.core

import java.io.ByteArrayOutputStream
import java.util.zip.CRC32
import java.util.zip.DataFormatException
import java.util.zip.Deflater
import java.util.zip.Inflater
import kotlin.math.abs

// A photo with data after its end marker (an HDR copy) is left as it is; the message says so instead of "already small".
class LeftAloneException : IllegalArgumentException("This photo carries extra data after the picture, so it is left as it is.")

object ImageOptimizer {
  private const val DAMAGED = "This image looks damaged, so it can't be compressed."
  private const val MAX_RAW_BYTES = 96L * 1024 * 1024
  private val SIGNATURE = byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10)
  private val PNG_KEEP = setOf("PLTE", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "cICP", "pHYs")
  private val CHANNELS = mapOf(0 to 1, 2 to 3, 3 to 1, 4 to 2, 6 to 4)

  fun optimize(src: ByteArray, format: String): ByteArray? = if (format == "png") optimizePng(src) else optimizeJpeg(src)

  fun optimizePng(src: ByteArray): ByteArray? {
    require(src.size >= 8 && SIGNATURE.indices.all { src[it] == SIGNATURE[it] }) { "This file is not a PNG." }
    val kept = mutableListOf<ByteArray>()
    val idat = ByteArrayOutputStream()
    var ihdr: ByteArray? = null
    var ended = false
    var pos = 8
    while (!ended && pos + 12 <= src.size) {
      val len = u32(src, pos)
      val type = String(src, pos + 4, 4, Charsets.ISO_8859_1)
      require(len >= 0 && pos + 12L + len <= src.size && type.all { it in 'A'..'Z' || it in 'a'..'z' }) { DAMAGED }
      val data = src.copyOfRange(pos + 8, pos + 8 + len.toInt())
      when {
        type == "acTL" -> throw IllegalArgumentException("Animated PNGs can't be compressed without losing frames.")
        type == "IHDR" -> ihdr = data
        type == "IDAT" -> idat.write(data)
        type == "IEND" -> ended = true
        type in PNG_KEEP -> kept += chunk(type, data)
        type[0].code < 97 -> throw IllegalArgumentException("This PNG uses a feature that can't be compressed safely.")
      }
      pos += 12 + len.toInt()
    }
    val head = ihdr
    require(ended && head != null && head.size == 13 && idat.size() > 0) { DAMAGED }
    val width = u32(head, 0)
    val height = u32(head, 4)
    val depth = head[8].toInt()
    val channels = CHANNELS[head[9].toInt()]
    require(channels != null && width > 0 && height > 0) { DAMAGED }
    val joined = idat.toByteArray()
    var picture = joined
    if (head[12].toInt() == 0) {
      val rowBytes = ((width * channels * depth + 7) / 8)
      // Several copies of the picture are alive at once, so the limit follows the heap this app was given.
      require(rowBytes * height <= minOf(MAX_RAW_BYTES, Runtime.getRuntime().maxMemory() / 10)) { "This image is too large to compress on the phone." }
      val raw = inflate(joined, (height * (rowBytes + 1)).toInt())
      val filtered = refilter(raw, rowBytes.toInt(), height.toInt(), maxOf(1, (channels * depth) shr 3))
      val candidate = listOf(Deflater.DEFAULT_STRATEGY, Deflater.FILTERED).map { deflate(filtered, it) }.minBy { it.size }
      if (candidate.size < picture.size) picture = candidate
    }
    val out = ByteArrayOutputStream(src.size)
    out.write(SIGNATURE)
    out.write(chunk("IHDR", head))
    kept.forEach { out.write(it) }
    out.write(chunk("IDAT", picture))
    out.write(chunk("IEND", ByteArray(0)))
    return if (out.size() < src.size) out.toByteArray() else null
  }

  private fun u32(b: ByteArray, at: Int): Long =
    (b.u(at).toLong() shl 24) or (b.u(at + 1).toLong() shl 16) or (b.u(at + 2).toLong() shl 8) or b.u(at + 3).toLong()

  private fun ByteArray.u(i: Int): Int = this[i].toInt() and 255

  private fun inflate(data: ByteArray, expected: Int): ByteArray {
    val inflater = Inflater()
    try {
      inflater.setInput(data)
      val out = ByteArray(expected)
      var n = 0
      try {
        while (n < expected) {
          val k = inflater.inflate(out, n, expected - n)
          if (k == 0 && (inflater.finished() || inflater.needsInput() || inflater.needsDictionary())) break
          n += k
        }
        require(n == expected && inflater.inflate(ByteArray(1)) == 0) { DAMAGED }
      } catch (e: DataFormatException) {
        throw IllegalArgumentException(DAMAGED)
      }
      return out
    } finally {
      inflater.end()
    }
  }

  private fun deflate(data: ByteArray, strategy: Int): ByteArray {
    val deflater = Deflater(9).apply { setStrategy(strategy) }
    try {
      deflater.setInput(data)
      deflater.finish()
      val out = ByteArrayOutputStream(data.size / 2 + 64)
      val buffer = ByteArray(65536)
      while (!deflater.finished()) out.write(buffer, 0, deflater.deflate(buffer))
      return out.toByteArray()
    } finally {
      deflater.end()
    }
  }

  private fun predict(type: Int, a: Int, b: Int, c: Int): Int = when (type) {
    1 -> a
    2 -> b
    3 -> (a + b) shr 1
    4 -> {
      val p = a + b - c
      val pa = abs(p - a)
      val pb = abs(p - b)
      val pc = abs(p - c)
      if (pa <= pb && pa <= pc) a else if (pb <= pc) b else c
    }
    else -> 0
  }

  private fun refilter(data: ByteArray, rowBytes: Int, height: Int, bpp: Int): ByteArray {
    val px = ByteArray(rowBytes * height)
    for (y in 0 until height) {
      val type = data.u(y * (rowBytes + 1))
      require(type <= 4) { DAMAGED }
      val at = y * rowBytes
      for (x in 0 until rowBytes) {
        val a = if (x >= bpp) px.u(at + x - bpp) else 0
        val b = if (y > 0) px.u(at - rowBytes + x) else 0
        val c = if (y > 0 && x >= bpp) px.u(at - rowBytes + x - bpp) else 0
        px[at + x] = (data.u(y * (rowBytes + 1) + 1 + x) + predict(type, a, b, c)).toByte()
      }
    }
    val out = ByteArray((rowBytes + 1) * height)
    val rows = Array(5) { ByteArray(rowBytes) }
    for (y in 0 until height) {
      val at = y * rowBytes
      var best = 0
      var bestSum = Long.MAX_VALUE
      for (type in 0 until 5) {
        var sum = 0L
        val row = rows[type]
        for (x in 0 until rowBytes) {
          val a = if (x >= bpp) px.u(at + x - bpp) else 0
          val b = if (y > 0) px.u(at - rowBytes + x) else 0
          val c = if (y > 0 && x >= bpp) px.u(at - rowBytes + x - bpp) else 0
          val v = (px.u(at + x) - predict(type, a, b, c)) and 255
          row[x] = v.toByte()
          sum += if (v < 128) v else 256 - v
        }
        if (sum < bestSum) {
          bestSum = sum
          best = type
        }
      }
      out[y * (rowBytes + 1)] = best.toByte()
      rows[best].copyInto(out, y * (rowBytes + 1) + 1)
    }
    return out
  }

  private fun chunk(type: String, data: ByteArray): ByteArray {
    val out = ByteArray(12 + data.size)
    fun put(at: Int, v: Long) {
      for (i in 0 until 4) out[at + i] = (v shr (24 - 8 * i)).toByte()
    }
    put(0, data.size.toLong())
    type.forEachIndexed { i, ch -> out[4 + i] = ch.code.toByte() }
    data.copyInto(out, 8)
    val crc = CRC32().apply { update(out, 4, 4 + data.size) }
    put(8 + data.size, crc.value)
    return out
  }

  fun optimizeJpeg(src: ByteArray): ByteArray? {
    require(src.size >= 4 && src.u(0) == 0xff && src.u(1) == 0xd8) { "This file is not a JPEG." }
    val out = ByteArrayOutputStream(src.size)
    out.write(src, 0, 2)
    var pos = 2
    while (true) {
      while (pos + 1 < src.size && src.u(pos) == 0xff && src.u(pos + 1) == 0xff) pos++
      require(pos + 2 <= src.size && src.u(pos) == 0xff) { DAMAGED }
      val marker = src.u(pos + 1)
      if (marker == 0xd9) {
        out.write(src, pos, 2)
        pos += 2
        break
      }
      require(pos + 4 <= src.size) { DAMAGED }
      val end = pos + 2 + ((src.u(pos + 2) shl 8) or src.u(pos + 3))
      require(end <= src.size && end >= pos + 4) { DAMAGED }
      if (marker == 0xda) {
        var q = end
        while (q + 1 < src.size && !(src.u(q) == 0xff && src.u(q + 1) != 0 && src.u(q + 1) !in 0xd0..0xd7)) q++
        require(q + 1 < src.size) { DAMAGED }
        out.write(src, pos, q - pos)
        pos = q
        continue
      }
      val seg = src.copyOfRange(pos, end)
      val droppable = (marker in 0xe1..0xef && marker != 0xee) || marker == 0xfe
      val kept = if (droppable) keepSegment(marker, seg) else seg
      if (kept != null) out.write(kept)
      pos = end
    }
    // Bytes after the end marker hold a gain map or a second picture that the metadata points to; stripping would orphan them.
    if (pos < src.size) throw LeftAloneException()
    return if (out.size() < src.size) out.toByteArray() else null
  }

  // Rotation and the colour profile change how the picture looks, so they survive; the rest of EXIF (GPS, camera) goes.
  private fun keepSegment(marker: Int, seg: ByteArray): ByteArray? {
    if (marker == 0xe2 && seg.size >= 15 && String(seg, 4, 11, Charsets.ISO_8859_1) == "ICC_PROFILE") return seg
    if (marker != 0xe1 || seg.size < 8 || String(seg, 4, 4, Charsets.ISO_8859_1) != "Exif") return null
    val o = exifOrientation(seg)
    if (o < 2 || o > 8) return null
    return byteArrayOf(
      -1, -31, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8,
      0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o.toByte(), 0, 0, 0, 0, 0, 0,
    )
  }

  private fun exifOrientation(seg: ByteArray): Int {
    val tiff = 10
    if (seg.size <= tiff) return 0
    val little = seg.u(tiff) == 0x49
    fun u16(i: Int): Int =
      if (i < 0 || i + 2 > seg.size) 0 else if (little) seg.u(i) or (seg.u(i + 1) shl 8) else (seg.u(i) shl 8) or seg.u(i + 1)
    val (low, high) = if (little) tiff + 4 to tiff + 6 else tiff + 6 to tiff + 4
    val ifd = tiff + (u16(low) or (u16(high) shl 16))
    for (i in 0 until u16(ifd)) {
      val entry = ifd + 2 + 12 * i
      if (u16(entry) == 0x0112) return u16(entry + 8)
    }
    return 0
  }
}
