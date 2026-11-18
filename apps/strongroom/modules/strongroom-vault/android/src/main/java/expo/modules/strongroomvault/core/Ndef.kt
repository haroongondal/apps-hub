package expo.modules.strongroomvault.core

object Ndef {
  private const val MB = 0x80
  private const val ME = 0x40
  private const val SR = 0x10
  private const val TNF_WELL_KNOWN = 0x01

  // Case-sensitive on purpose: a prefix code expands to exactly these bytes, so "HTTPS://" must keep code 0x00.
  private val URI_PREFIXES = listOf("https://www." to 0x02, "http://www." to 0x01, "https://" to 0x04, "http://" to 0x03)

  fun forCode(code: String): ByteArray =
    if (code.startsWith("http://", ignoreCase = true) || code.startsWith("https://", ignoreCase = true)) uri(code) else text(code)

  fun uri(uri: String): ByteArray {
    val (prefix, id) = URI_PREFIXES.firstOrNull { uri.startsWith(it.first) } ?: ("" to 0x00)
    return record('U', byteArrayOf(id.toByte()), uri.substring(prefix.length).toByteArray(Charsets.UTF_8))
  }

  fun text(text: String): ByteArray = record('T', byteArrayOf(2, 'e'.code.toByte(), 'n'.code.toByte()), text.toByteArray(Charsets.UTF_8))

  private fun record(type: Char, head: ByteArray, body: ByteArray): ByteArray {
    val size = head.size + body.size
    val short = size <= 0xFF
    val out = ByteArray(3 + (if (short) 1 else 4) + size)
    var i = 0
    out[i++] = (MB or ME or (if (short) SR else 0) or TNF_WELL_KNOWN).toByte()
    out[i++] = 1
    if (short) out[i++] = size.toByte() else for (shift in intArrayOf(24, 16, 8, 0)) out[i++] = (size ushr shift).toByte()
    out[i++] = type.code.toByte()
    head.copyInto(out, i)
    body.copyInto(out, i + head.size)
    body.fill(0) // it holds the pass code: leave one copy on the heap, not two
    return out
  }
}
