package expo.modules.designmedia.core

import java.io.OutputStream

// Port of gifenc 1.0.3 (MIT, Copyright (c) 2017 Matt DesLauriers); the LZW is Kevin Weiner's GIFCOMPR.
// Full notices: THIRD_PARTY_NOTICES.txt next to this file. Frames are full-size, opaque and share one global palette.
class GifEncoder(private val out: OutputStream, private val width: Int, private val height: Int, private val palette: IntArray) {
  private val accum = ByteArray(256)
  private val htab = IntArray(HSIZE)
  private val codetab = IntArray(HSIZE)
  private var cursorBits = 0
  private var cursorAccum = 0

  init {
    require(palette.isNotEmpty() && palette.size <= 256) { "A GIF palette holds 1 to 256 colours." }
    out.write("GIF89a".toByteArray(Charsets.US_ASCII))
    val tableBits = tableBits(palette.size)
    writeShort(width)
    writeShort(height)
    out.write(0x80 or ((COLOR_DEPTH - 1) shl 4) or (tableBits - 1))
    out.write(0)
    out.write(0)
    for (i in 0 until (1 shl tableBits)) {
      val c = if (i < palette.size) palette[i] else 0
      out.write((c shr 16) and 0xFF)
      out.write((c shr 8) and 0xFF)
      out.write(c and 0xFF)
    }
    out.write(0x21)
    out.write(0xFF)
    out.write(11)
    out.write("NETSCAPE2.0".toByteArray(Charsets.US_ASCII))
    out.write(3)
    out.write(1)
    writeShort(0)
    out.write(0)
  }

  fun writeFrame(indices: ByteArray, delayCs: Int) {
    require(indices.size == width * height) { "Frame size doesn't match the GIF size." }
    out.write(0x21)
    out.write(0xF9)
    out.write(4)
    out.write(0)
    writeShort(delayCs)
    out.write(0)
    out.write(0)
    out.write(0x2C)
    writeShort(0)
    writeShort(0)
    writeShort(width)
    writeShort(height)
    out.write(0)
    lzw(indices)
  }

  fun finish() {
    out.write(0x3B)
    out.flush()
  }

  private fun writeShort(v: Int) {
    out.write(v and 0xFF)
    out.write((v shr 8) and 0xFF)
  }

  private fun lzw(pixels: ByteArray) {
    val initCodeSize = maxOf(2, COLOR_DEPTH)
    accum.fill(0)
    codetab.fill(0)
    htab.fill(-1)
    cursorAccum = 0
    cursorBits = 0
    val initBits = initCodeSize + 1
    var clearFlag = false
    var nBits = initBits
    var maxCode = (1 shl nBits) - 1
    val clearCode = 1 shl (initBits - 1)
    val eofCode = clearCode + 1
    var freeEnt = clearCode + 2
    var count = 0
    var ent = pixels[0].toInt() and 0xFF
    var hshift = 0
    var f = HSIZE
    while (f < 65536) {
      hshift++
      f *= 2
    }
    hshift = 8 - hshift

    fun flushPacket() {
      out.write(count)
      out.write(accum, 0, count)
      count = 0
    }

    fun emit(code: Int) {
      cursorAccum = cursorAccum and MASKS[cursorBits]
      cursorAccum = if (cursorBits > 0) cursorAccum or (code shl cursorBits) else code
      cursorBits += nBits
      while (cursorBits >= 8) {
        accum[count++] = (cursorAccum and 0xFF).toByte()
        if (count >= 254) flushPacket()
        cursorAccum = cursorAccum shr 8
        cursorBits -= 8
      }
      if (freeEnt > maxCode || clearFlag) {
        if (clearFlag) {
          nBits = initBits
          maxCode = (1 shl nBits) - 1
          clearFlag = false
        } else {
          nBits++
          maxCode = if (nBits == BITS) 1 shl nBits else (1 shl nBits) - 1
        }
      }
      if (code == eofCode) {
        while (cursorBits > 0) {
          accum[count++] = (cursorAccum and 0xFF).toByte()
          if (count >= 254) flushPacket()
          cursorAccum = cursorAccum shr 8
          cursorBits -= 8
        }
        if (count > 0) flushPacket()
      }
    }

    out.write(initCodeSize)
    emit(clearCode)
    for (idx in 1 until pixels.size) {
      val c = pixels[idx].toInt() and 0xFF
      val fcode = (c shl BITS) + ent
      var i = (c shl hshift) xor ent
      if (htab[i] == fcode) {
        ent = codetab[i]
        continue
      }
      val disp = if (i == 0) 1 else HSIZE - i
      var found = false
      while (htab[i] >= 0) {
        i -= disp
        if (i < 0) i += HSIZE
        if (htab[i] == fcode) {
          ent = codetab[i]
          found = true
          break
        }
      }
      if (found) continue
      emit(ent)
      ent = c
      if (freeEnt < (1 shl BITS)) {
        codetab[i] = freeEnt++
        htab[i] = fcode
      } else {
        htab.fill(-1)
        freeEnt = clearCode + 2
        clearFlag = true
        emit(clearCode)
      }
    }
    emit(ent)
    emit(eofCode)
    out.write(0)
  }

  companion object {
    private const val COLOR_DEPTH = 8
    private const val BITS = 12
    private const val HSIZE = 5003
    private val MASKS = intArrayOf(
      0x0000, 0x0001, 0x0003, 0x0007, 0x000f, 0x001f, 0x003f, 0x007f, 0x00ff, 0x01ff, 0x03ff, 0x07ff, 0x0fff, 0x1fff, 0x3fff, 0x7fff, 0xffff,
    )

    fun tableBits(colours: Int): Int = maxOf(32 - Integer.numberOfLeadingZeros(colours - 1), 1)
  }
}
