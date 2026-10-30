package expo.modules.strongroomvault.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

data class Site(val https: Boolean, val host: String)

data class AppId(val pkg: String, val certSha256: String) {
  init {
    require(DIGEST.matches(certSha256)) { "certSha256 must be 64 lowercase hex characters" }
  }

  private companion object {
    val DIGEST = Regex("[0-9a-f]{64}")
  }
}

data class AppLink(val app: AppId, val domain: String?)

sealed interface Entry {
  val updatedAt: Long

  data class Login(
    val name: String,
    val username: String,
    val password: String,
    val sites: List<Site>,
    val apps: List<AppLink>,
    val note: String,
    override val updatedAt: Long,
  ) : Entry

  data class Card(
    val name: String,
    val holder: String,
    val number: String,
    val expMonth: Int?,
    val expYear: Int?,
    val cvc: String,
    val note: String,
    override val updatedAt: Long,
  ) : Entry

  data class Note(val name: String, val text: String, override val updatedAt: Long) : Entry

  data class Deleted(override val updatedAt: Long) : Entry
}

object EntryJson {
  fun encode(e: Entry): String = buildJsonObject {
    when (e) {
      is Entry.Login -> {
        put("type", "login")
        put("name", e.name)
        put("username", e.username)
        put("password", e.password)
        putJsonArray("sites") {
          e.sites.forEach { addJsonObject { put("https", it.https); put("host", it.host) } }
        }
        putJsonArray("apps") {
          e.apps.forEach {
            addJsonObject { put("pkg", it.app.pkg); put("certSha256", it.app.certSha256); put("domain", it.domain) }
          }
        }
        put("note", e.note)
      }
      is Entry.Card -> {
        put("type", "card")
        put("name", e.name)
        put("holder", e.holder)
        put("number", e.number)
        put("expMonth", e.expMonth)
        put("expYear", e.expYear)
        put("cvc", e.cvc)
        put("note", e.note)
      }
      is Entry.Note -> {
        put("type", "note")
        put("name", e.name)
        put("text", e.text)
      }
      is Entry.Deleted -> put("type", "deleted")
    }
    put("updatedAt", e.updatedAt)
  }.toString()

  fun decode(s: String): Entry? = try {
    val o = Json.parseToJsonElement(s).jsonObject
    val updatedAt = o.long("updatedAt")
    when (o.string("type")) {
      "login" -> Entry.Login(
        name = o.string("name"),
        username = o.string("username"),
        password = o.string("password"),
        sites = o.objects("sites").map { Site(it.bool("https"), it.string("host")) },
        apps = o.objects("apps").map { AppLink(AppId(it.string("pkg"), it.string("certSha256")), it.optString("domain")) },
        note = o.string("note"),
        updatedAt = updatedAt,
      )
      "card" -> Entry.Card(
        name = o.string("name"),
        holder = o.string("holder"),
        number = o.string("number"),
        expMonth = o.optInt("expMonth"),
        expYear = o.optInt("expYear"),
        cvc = o.string("cvc"),
        note = o.string("note"),
        updatedAt = updatedAt,
      )
      "note" -> Entry.Note(o.string("name"), o.string("text"), updatedAt)
      "deleted" -> Entry.Deleted(updatedAt)
      else -> null
    }
  } catch (e: IllegalArgumentException) {
    null // SerializationException, a wrong JSON type, a bad number and AppId's digest check are all IllegalArgumentExceptions
  }
}

private fun malformed(key: String): Nothing = throw IllegalArgumentException("malformed field $key")

private fun JsonObject.literal(key: String): JsonPrimitive = this[key] as? JsonPrimitive ?: malformed(key)

internal fun JsonObject.string(key: String): String = literal(key).takeIf { it.isString }?.content ?: malformed(key)

internal fun JsonObject.long(key: String): Long = literal(key).takeIf { !it.isString }?.longOrNull ?: malformed(key)

internal fun JsonObject.int(key: String): Int = literal(key).takeIf { !it.isString }?.intOrNull ?: malformed(key)

internal fun JsonObject.bool(key: String): Boolean = literal(key).takeIf { !it.isString }?.booleanOrNull ?: malformed(key)

internal fun JsonObject.optString(key: String): String? = if (literal(key) is JsonNull) null else string(key)

internal fun JsonObject.optInt(key: String): Int? = if (literal(key) is JsonNull) null else int(key)

internal fun JsonObject.obj(key: String): JsonObject = this[key] as? JsonObject ?: malformed(key)

internal fun JsonObject.objects(key: String): List<JsonObject> =
  (this[key] as? JsonArray ?: malformed(key)).map { it as? JsonObject ?: malformed(key) }
