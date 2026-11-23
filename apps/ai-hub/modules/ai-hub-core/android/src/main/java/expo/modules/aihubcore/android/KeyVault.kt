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
class KeyVault private constructor(context: Context) {
  private val prefs = context.getSharedPreferences(ALIAS, Context.MODE_PRIVATE)
  private val serializer = ListSerializer(String.serializer())

  // For display only: an unopenable blob shows as empty. Writers go through read(), which throws instead.
  @Synchronized
  fun list(): List<String> = try { read() } catch (e: IllegalStateException) { emptyList() }

  @Synchronized
  fun add(key: String) {
    val value = key.trim()
    val all = read()
    if (value.isNotEmpty() && value !in all) seal(all + value)
  }

  @Synchronized
  fun remove(index: Int) {
    val all = read()
    if (index in all.indices) seal(all.filterIndexed { i, _ -> i != index })
  }

  @Synchronized
  fun replaceAll(keys: List<String>) {
    read()
    seal(keys)
  }

  // The way out when the saved keys cannot be opened: drops the blob and the Keystore key.
  @Synchronized
  fun clear() {
    prefs.edit().clear().commit()
    KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS)
  }

  private fun read(): List<String> {
    val iv = prefs.getString("iv", null)
    val sealed = prefs.getString("keys", null)
    if (iv == null && sealed == null) return emptyList()
    try {
      val cipher = Cipher.getInstance(TRANSFORM)
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
      return Json.decodeFromString(serializer, String(cipher.doFinal(Base64.decode(sealed, Base64.NO_WRAP))))
    } catch (e: Exception) {
      throw IllegalStateException("Your saved keys couldn't be opened. Try again, or remove all keys and add them again.")
    }
  }

  private fun seal(keys: List<String>) {
    val clean = keys.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
    val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, key()) }
    val sealed = cipher.doFinal(Json.encodeToString(serializer, clean).toByteArray())
    val saved = prefs.edit()
      .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .putString("keys", Base64.encodeToString(sealed, Base64.NO_WRAP))
      .commit()
    check(saved) { "Your keys couldn't be saved. Try again." }
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

  companion object {
    private const val ALIAS = "aihub_keys"
    private const val TRANSFORM = "AES/GCM/NoPadding"

    @Volatile private var shared: KeyVault? = null

    fun get(context: Context): KeyVault = shared ?: synchronized(this) {
      shared ?: KeyVault(context.applicationContext).also { shared = it }
    }
  }
}
