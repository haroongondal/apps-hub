package expo.modules.strongroomvault.core

/** What an opened escrow blob holds: the recovery key and account key the vault was sealed with. */
class EscrowKeys(val recoveryKey: ByteArray, val accountKey: ByteArray)

/**
 * Email-recovery escrow, the Kotlin port of packages/strongroom-core/src/escrow.ts: recoveryKey(20) || accountKey(20)
 * sealed under HKDF(code, LABEL), with LABEL as AAD. The code is a [RecoveryKey] (same 20-byte text format).
 */
object Escrow {
  private const val LABEL = "strongroom/v1/escrow"
  private const val KEY_BYTES = 20

  fun seal(code: ByteArray, recoveryKey: ByteArray, accountKey: ByteArray): ByteArray {
    require(recoveryKey.size == KEY_BYTES && accountKey.size == KEY_BYTES) { "escrow keys must be 20 bytes each" }
    val key = Crypto.hkdf(code, LABEL)
    val plain = recoveryKey + accountKey
    try {
      return Crypto.seal(key, plain, LABEL.toByteArray(Charsets.UTF_8))
    } finally {
      key.fill(0)
      plain.fill(0)
    }
  }

  /** Null for a wrong code, a damaged blob, or a blob that doesn't hold exactly two 20-byte keys. */
  fun open(code: ByteArray, blob: ByteArray): EscrowKeys? {
    val key = Crypto.hkdf(code, LABEL)
    val plain = try {
      Crypto.open(key, blob, LABEL.toByteArray(Charsets.UTF_8))
    } finally {
      key.fill(0)
    }
    if (plain == null) return null
    try {
      if (plain.size != 2 * KEY_BYTES) return null
      return EscrowKeys(plain.copyOfRange(0, KEY_BYTES), plain.copyOfRange(KEY_BYTES, 2 * KEY_BYTES))
    } finally {
      plain.fill(0)
    }
  }
}
