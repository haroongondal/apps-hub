package expo.modules.strongroomvault.core

object RecoveryKey {
  private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  private const val BYTES = 20
  private const val CHARS = 32

  fun generate(): ByteArray = Crypto.randomBytes(BYTES)

  fun format(bytes: ByteArray): String {
    require(bytes.size == BYTES) { "A recovery key is 20 bytes" }
    val out = StringBuilder(CHARS)
    var buffer = 0
    var bits = 0
    for (b in bytes) {
      buffer = (buffer shl 8) or (b.toInt() and 0xff)
      bits += 8
      while (bits >= 5) {
        bits -= 5
        out.append(ALPHABET[(buffer shr bits) and 31])
      }
      buffer = buffer and ((1 shl bits) - 1)
    }
    return out.chunked(4).joinToString("-")
  }

  fun parse(text: String): ByteArray? {
    val chars = text.filter { it != '-' && !it.isWhitespace() }
    if (chars.length != CHARS) return null
    val out = ByteArray(BYTES)
    var buffer = 0
    var bits = 0
    var next = 0
    for (c in chars) {
      val value = when (c) {
        in 'A'..'Z' -> c - 'A'
        in 'a'..'z' -> c - 'a'
        in '2'..'7' -> c - '2' + 26
        else -> return null
      }
      buffer = (buffer shl 5) or value
      bits += 5
      if (bits >= 8) {
        bits -= 8
        out[next++] = (buffer shr bits).toByte()
        buffer = buffer and ((1 shl bits) - 1)
      }
    }
    return out
  }

  fun group(formatted: String, index: Int): String = formatted.split('-')[index]
}
