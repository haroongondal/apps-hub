package expo.modules.strongroomvault.core

// Unarmed or expired it must look like no tag at all: no CC, no hint that a pass exists.
class Type4Tag {
  private var file: ByteArray? = null
  private var armedAt = 0L
  private var ttl = 0L
  private var appSelected = false
  private var current = NONE

  @Synchronized fun arm(message: ByteArray, nowMs: Long, ttlMs: Long = DEFAULT_TTL_MS) {
    disarm()
    require(message.isNotEmpty() && message.size <= MAX_MESSAGE) { "An NFC pass must be 1 to $MAX_MESSAGE bytes, this one is ${message.size}." }
    require(ttlMs > 0) { "ttlMs must be positive." }
    file = ByteArray(2 + message.size).also {
      it[0] = (message.size ushr 8).toByte()
      it[1] = message.size.toByte()
      message.copyInto(it, 2)
    }
    armedAt = nowMs
    ttl = ttlMs
  }

  @Synchronized fun disarm() {
    file?.fill(0)
    file = null
    appSelected = false
    current = NONE
  }

  @Synchronized fun process(apdu: ByteArray, nowMs: Long): ByteArray = try {
    answer(apdu, nowMs)
  } catch (e: RuntimeException) {
    // Fail closed: a throwing HCE callback would take the app down, and a confused state should not keep answering.
    disarm()
    sw(0x6F, 0x00)
  }

  internal fun heldForTest(): ByteArray? = file

  private fun answer(apdu: ByteArray, nowMs: Long): ByteArray {
    if (apdu.size < 4) return sw(0x67, 0x00)
    if (file != null) {
      val age = nowMs - armedAt
      if (age < 0 || age >= ttl) disarm()
    }
    if (apdu[0] != 0.toByte()) return sw(0x6E, 0x00)
    val ins = apdu[1].toInt() and 0xFF
    val live = file ?: return if (ins == INS_SELECT) notFound() else sw(0x6D, 0x00)
    return when (ins) {
      INS_SELECT -> select(apdu)
      INS_READ_BINARY -> read(apdu, live)
      INS_UPDATE_BINARY -> sw(0x69, 0x82)
      else -> sw(0x6D, 0x00)
    }
  }

  private fun select(apdu: ByteArray): ByteArray {
    if (apdu.size < 5) return sw(0x67, 0x00)
    val lc = apdu[4].toInt() and 0xFF
    if (apdu.size != 5 + lc && apdu.size != 6 + lc) return sw(0x67, 0x00)
    val p1 = apdu[2].toInt() and 0xFF
    val p2 = apdu[3].toInt() and 0xFF
    current = NONE
    if (p2 != 0x00 && p2 != 0x0C) {
      if (p1 == 0x04) appSelected = false
      return notFound()
    }
    return when (p1) {
      0x04 -> {
        appSelected = lc == AID.size && AID.indices.all { apdu[5 + it] == AID[it] }
        if (appSelected) ok() else notFound()
      }
      0x00 -> {
        if (!appSelected || lc != 2) return notFound()
        val id = ((apdu[5].toInt() and 0xFF) shl 8) or (apdu[6].toInt() and 0xFF)
        if (id != CC_FILE && id != NDEF_FILE) return notFound()
        current = id
        ok()
      }
      else -> notFound()
    }
  }

  private fun read(apdu: ByteArray, live: ByteArray): ByteArray {
    val data = when (current) {
      CC_FILE -> CC
      NDEF_FILE -> live
      else -> return sw(0x69, 0x86)
    }
    if (apdu.size != 5) return sw(0x67, 0x00)
    val offset = ((apdu[2].toInt() and 0xFF) shl 8) or (apdu[3].toInt() and 0xFF)
    if (offset >= data.size) return sw(0x6B, 0x00)
    val le = (apdu[4].toInt() and 0xFF).let { if (it == 0) 256 else it }
    val n = minOf(le, MLE, data.size - offset)
    val out = ByteArray(n + 2)
    data.copyInto(out, 0, offset, offset + n)
    out[n] = 0x90.toByte()
    return out
  }

  companion object {
    const val DEFAULT_TTL_MS = 60_000L
    const val MAX_MESSAGE = 2048
    const val MLE = 0x3B
    private const val MLC = 0x34
    private const val MAX_FILE = MAX_MESSAGE + 2

    private const val INS_SELECT = 0xA4
    private const val INS_READ_BINARY = 0xB0
    private const val INS_UPDATE_BINARY = 0xD6
    private const val NONE = -1
    private const val CC_FILE = 0xE103
    private const val NDEF_FILE = 0xE104

    private val AID = byteArrayOf(0xD2.toByte(), 0x76, 0x00, 0x00, 0x85.toByte(), 0x01, 0x01)

    private val CC = byteArrayOf(
      0x00, 0x0F, 0x20,
      (MLE ushr 8).toByte(), MLE.toByte(),
      (MLC ushr 8).toByte(), MLC.toByte(),
      0x04, 0x06, (NDEF_FILE ushr 8).toByte(), NDEF_FILE.toByte(),
      (MAX_FILE ushr 8).toByte(), MAX_FILE.toByte(),
      0x00, 0xFF.toByte(),
    )

    private fun sw(a: Int, b: Int) = byteArrayOf(a.toByte(), b.toByte())
    private fun ok() = sw(0x90, 0x00)
    private fun notFound() = sw(0x6A, 0x82)
  }
}
