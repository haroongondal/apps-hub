package expo.modules.aihubcore.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

// The owner's API keys for every service, as one AES-GCM sealed list under a non-exportable Keystore key (as Deputy's KeyVault).
class KeyVault(context: Context) {
  private val prefs = context.getSharedPreferences(ALIAS, Context.MODE_PRIVATE)
  private val serializer = ListSerializer(String.serializer())

  // A list that cannot be opened (key lost after a restore, torn write) reads as empty; the owner pastes the keys again.
  @Synchronized
  fun list(): List<String> = try {
    val cipher = Cipher.getInstance(TRANSFORM)
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(prefs.getString("iv", null), Base64.NO_WRAP)))
    Json.decodeFromString(serializer, String(cipher.doFinal(Base64.decode(prefs.getString("keys", null), Base64.NO_WRAP))))
  } catch (e: Exception) {
    emptyList()
  }

  @Synchronized
  fun add(key: String) {
    val value = key.trim()
    val all = list()
    if (value.isNotEmpty() && value !in all) replaceAll(all + value)
  }

  @Synchronized
  fun remove(index: Int) {
    val all = list()
    if (index in all.indices) replaceAll(all.filterIndexed { i, _ -> i != index })
  }

  @Synchronized
  fun replaceAll(keys: List<String>) {
    val clean = keys.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
    val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, key()) }
    val sealed = cipher.doFinal(Json.encodeToString(serializer, clean).toByteArray())
    prefs.edit()
      .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .putString("keys", Base64.encodeToString(sealed, Base64.NO_WRAP))
      .apply()
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

  private companion object {
    const val ALIAS = "aihub_keys"
    const val TRANSFORM = "AES/GCM/NoPadding"
  }
}
