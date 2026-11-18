package expo.modules.pdfscan.core

// SPEC §7.5 step 6: rows MSB-first, 1 = white, each row padded to whole bytes. The caller deflates.
object BitPack {
  fun pack(white: ByteArray, w: Int, h: Int): ByteArray {
    require(w > 0 && h > 0 && white.size >= w * h) { "bad plane ${w}x$h size ${white.size}" }
    val row = (w + 7) / 8
    val out = ByteArray(row * h)
    for (y in 0 until h) for (x in 0 until w) {
      if (white[y * w + x].toInt() != 0) {
        val i = y * row + x / 8
        out[i] = (out[i].toInt() or (0x80 ushr (x % 8))).toByte()
      }
    }
    return out
  }
}
