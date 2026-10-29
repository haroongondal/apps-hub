package expo.modules.deputyagent.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The provider API key, AES-GCM sealed with a non-exportable Keystore key. A copy of the Store's `Credentials.kt` (SPEC §12). */
object KeyVault {
  private const val ALIAS = "deputy-api-key"

  private fun prefs(context: Context) = context.getSharedPreferences("deputy-key", Context.MODE_PRIVATE)

  fun save(context: Context, apiKey: String) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val sealed = cipher.doFinal(apiKey.trim().toByteArray())
    prefs(context).edit()
      .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .putString("key", Base64.encodeToString(sealed, Base64.NO_WRAP))
      .apply()
  }

  fun load(context: Context): String? {
    val p = prefs(context)
    val iv = p.getString("iv", null) ?: return null
    val sealed = p.getString("key", null) ?: return null
    return try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
      String(cipher.doFinal(Base64.decode(sealed, Base64.NO_WRAP)))
    } catch (e: Exception) {
      null
    }
  }

  fun has(context: Context) = prefs(context).contains("key")

  fun clear(context: Context) {
    prefs(context).edit().remove("iv").remove("key").apply()
  }

  private fun key(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getKey(ALIAS, null) as SecretKey?)?.let { return it }
    val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .build()
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec) }.generateKey()
  }
}
