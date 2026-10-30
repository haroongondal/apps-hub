package expo.modules.deputyagent.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import expo.modules.deputyagent.core.Settings
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/** The owner's API keys, each AES-GCM sealed with a non-exportable Keystore key. A copy of the Store's `Credentials.kt` (SPEC §12). */
object KeyVault {
  private const val ALIAS = "deputy-api-key"

  private fun prefs(context: Context) = context.getSharedPreferences("deputy-key", Context.MODE_PRIVATE)

  private fun entries(context: Context): List<JsonObject> {
    val p = prefs(context)
    val before021 = p.getString("key", null)?.let { k ->
      buildJsonObject { put("id", "first"); put("url", p.getString("url", null)); put("iv", p.getString("iv", null)); put("key", k) }
    }
    return listOfNotNull(before021) + p.getString("keys", null)?.let { Json.parseToJsonElement(it).jsonArray.map { e -> e.jsonObject } }.orEmpty()
  }

  private fun store(context: Context, entries: List<JsonObject>) =
    prefs(context).edit().remove("iv").remove("key").remove("url").putString("keys", JsonArray(entries).toString()).apply()

  private fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull

  /** Only the keys saved for this address, so none reaches another host; a run tries them in this order. */
  private fun mine(context: Context, settings: Settings) = entries(context).filter { settings.ownsKeySavedFor(it.str("url")) }

  @Synchronized
  fun add(context: Context, apiKey: String, settings: Settings): String? {
    val value = apiKey.trim()
    if (value.isEmpty()) return "Paste a key first."
    if (value in load(context, settings)) return "That key is already saved."
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val sealed = cipher.doFinal(value.toByteArray())
    store(
      context,
      entries(context) + buildJsonObject {
        put("id", UUID.randomUUID().toString().take(8))
        put("url", settings.baseUrl)
        put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
        put("key", Base64.encodeToString(sealed, Base64.NO_WRAP))
      },
    )
    return null
  }

  fun load(context: Context, settings: Settings): List<String> = mine(context, settings).mapNotNull(::open)

  fun load(context: Context, settings: Settings, id: String): String? = mine(context, settings).firstOrNull { it.str("id") == id }?.let(::open)

  fun list(context: Context, settings: Settings): List<Map<String, String>> =
    mine(context, settings).mapNotNull { e -> open(e)?.let { mapOf("id" to e.str("id").orEmpty(), "ending" to it.takeLast(4)) } }

  fun has(context: Context, settings: Settings) = mine(context, settings).isNotEmpty()

  @Synchronized
  fun remove(context: Context, id: String) = store(context, entries(context).filter { it.str("id") != id })

  private fun open(e: JsonObject): String? = try {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(e.str("iv"), Base64.NO_WRAP)))
    String(cipher.doFinal(Base64.decode(e.str("key"), Base64.NO_WRAP)))
  } catch (x: Exception) {
    null
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
