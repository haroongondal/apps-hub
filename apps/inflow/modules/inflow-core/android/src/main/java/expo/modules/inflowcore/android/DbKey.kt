package expo.modules.inflowcore.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The 32-byte database key, AES-GCM wrapped by a non-exportable Keystore key with no user authentication, so the listener can open the store in the background. */
object DbKey {
  private const val ALIAS = "inflow-db"
  private const val PREFS = "inflow-key"
  private const val KEY_LEN = 32

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun isWrappedKeyPresent(context: Context): Boolean {
    val p = prefs(context)
    return p.getString("key", null) != null && p.getString("iv", null) != null
  }

  @Synchronized
  fun get(context: Context, create: Boolean): ByteArray? {
    val p = prefs(context)
    val blob = p.getString("key", null)
    val iv = p.getString("iv", null)
    if (blob != null && iv != null) unwrap(blob, iv)?.let { return it }
    if (!create) return null
    val fresh = ByteArray(KEY_LEN).also { SecureRandom().nextBytes(it) }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, wrappingKey(true)) }
    val sealed = cipher.doFinal(fresh)
    val saved = p.edit()
      .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .putString("key", Base64.encodeToString(sealed, Base64.NO_WRAP))
      .commit()
    return if (saved) fresh else null
  }

  private fun unwrap(blob: String, iv: String): ByteArray? = try {
    val wrapping = wrappingKey(false)
    if (wrapping == null) {
      null
    } else {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, wrapping, GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
      cipher.doFinal(Base64.decode(blob, Base64.NO_WRAP)).takeIf { it.size == KEY_LEN }
    }
  } catch (e: Exception) {
    null
  }

  private fun wrappingKey(create: Boolean): SecretKey? {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getKey(ALIAS, null) as SecretKey?)?.let { return it }
    if (!create) return null
    val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .build()
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec) }.generateKey()
  }
}
