package expo.modules.strongroomvault.core

import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import org.bouncycastle.crypto.params.HKDFParameters
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import java.security.SecureRandom
import java.text.Normalizer
import javax.crypto.BadPaddingException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

data class KdfParams(val memoryKiB: Int, val iterations: Int, val parallelism: Int) {
  fun inRange(): Boolean {
    val floor = testFloor ?: FLOOR
    return memoryKiB >= floor.memoryKiB && iterations >= floor.iterations &&
      parallelism >= floor.parallelism && memoryKiB <= MAX_MEMORY_KIB &&
      iterations <= MAX_ITERATIONS && parallelism <= MAX_PARALLELISM
  }

  companion object {
    val DEFAULT = KdfParams(65536, 3, 1)
    val FLOOR = KdfParams(32768, 2, 1)
    const val MAX_MEMORY_KIB = 1048576
    const val MAX_ITERATIONS = 16
    const val MAX_PARALLELISM = 4
    internal var testFloor: KdfParams? = null
  }
}

object Crypto {
  private const val KEY_BYTES = 32
  private const val NONCE_BYTES = 12
  private const val TAG_BITS = 128
  private const val TAG_BYTES = TAG_BITS / 8

  private val random = SecureRandom()

  fun passwordBytes(password: CharArray): ByteArray {
    // shortcut: the normalised String can't be zeroed (JVM strings are immutable); accepted, the byte arrays are zeroed.
    return utf8(Normalizer.normalize(CharBuffer.wrap(password), Normalizer.Form.NFC))
  }

  internal fun utf8(s: CharSequence): ByteArray {
    // An unpaired surrogate becomes U+FFFD (EF BF BD), as WHATWG TextEncoder does, so the Phase 3 extension derives the same bytes.
    val encoder = Charsets.UTF_8.newEncoder()
      .onMalformedInput(CodingErrorAction.REPLACE)
      .onUnmappableCharacter(CodingErrorAction.REPLACE)
      .replaceWith(byteArrayOf(0xEF.toByte(), 0xBF.toByte(), 0xBD.toByte()))
    val work = ByteBuffer.allocate((s.length * encoder.maxBytesPerChar()).toInt())
    try {
      val encoded = encoder.encode(CharBuffer.wrap(s), work, true)
      val flushed = encoder.flush(work)
      check(encoded.isUnderflow && flushed.isUnderflow)
      return work.array().copyOf(work.position())
    } finally {
      work.array().fill(0)
    }
  }

  fun argon2id(password: CharArray, salt: ByteArray, p: KdfParams): ByteArray {
    val passwordBytes = passwordBytes(password)
    try {
      val params = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
        .withVersion(Argon2Parameters.ARGON2_VERSION_13)
        .withSalt(salt)
        .withMemoryAsKB(p.memoryKiB)
        .withIterations(p.iterations)
        .withParallelism(p.parallelism)
        .build()
      val out = ByteArray(KEY_BYTES)
      Argon2BytesGenerator().apply { init(params) }.generateBytes(passwordBytes, out)
      return out
    } finally {
      passwordBytes.fill(0)
    }
  }

  fun hkdf(ikm: ByteArray, info: String, length: Int = 32): ByteArray =
    hkdf(ikm, null, info.toByteArray(Charsets.UTF_8), length)

  internal fun hkdf(ikm: ByteArray, salt: ByteArray?, info: ByteArray, length: Int): ByteArray {
    val out = ByteArray(length)
    HKDFBytesGenerator(SHA256Digest()).apply { init(HKDFParameters(ikm, salt, info)) }
      .generateBytes(out, 0, length)
    return out
  }

  fun seal(key: ByteArray, plaintext: ByteArray, aad: ByteArray): ByteArray {
    val nonce = randomBytes(NONCE_BYTES)
    return nonce + gcm(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, nonce), aad).doFinal(plaintext)
  }

  fun open(key: ByteArray, sealed: ByteArray, aad: ByteArray): ByteArray? {
    if (sealed.size < NONCE_BYTES + TAG_BYTES) return null
    val spec = GCMParameterSpec(TAG_BITS, sealed, 0, NONCE_BYTES)
    return try {
      gcm(Cipher.DECRYPT_MODE, key, spec, aad).doFinal(sealed, NONCE_BYTES, sealed.size - NONCE_BYTES)
    } catch (e: BadPaddingException) {
      null // AEADBadTagException is a BadPaddingException: wrong key, wrong AAD or tampered bytes
    }
  }

  fun randomBytes(n: Int): ByteArray = ByteArray(n).also { random.nextBytes(it) }

  private fun gcm(mode: Int, key: ByteArray, spec: GCMParameterSpec, aad: ByteArray): Cipher {
    require(key.size == KEY_BYTES) { "AES-256 key must be 32 bytes" }
    return Cipher.getInstance("AES/GCM/NoPadding").apply {
      init(mode, SecretKeySpec(key, "AES"), spec)
      updateAAD(aad)
    }
  }
}
