package expo.modules.storeinstaller

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal fun prefs(context: Context) = context.getSharedPreferences("store-installer", Context.MODE_PRIVATE)

/** API URL + device token; the token is AES-GCM encrypted with a non-exportable Android Keystore key. */
object Credentials {
  private const val ALIAS = "store-installer-token"

  fun save(context: Context, apiUrl: String, token: String) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val sealed = cipher.doFinal(token.toByteArray())
    prefs(context).edit()
      .putString("apiUrl", apiUrl)
      .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .putString("token", Base64.encodeToString(sealed, Base64.NO_WRAP))
      .apply()
  }

  fun load(context: Context): Pair<String, String>? {
    val p = prefs(context)
    val apiUrl = p.getString("apiUrl", null) ?: return null
    val iv = p.getString("iv", null) ?: return null
    val sealed = p.getString("token", null) ?: return null
    return try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
      apiUrl to String(cipher.doFinal(Base64.decode(sealed, Base64.NO_WRAP)))
    } catch (e: Exception) {
      null
    }
  }

  fun clear(context: Context) {
    prefs(context).edit().remove("apiUrl").remove("iv").remove("token").apply()
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
