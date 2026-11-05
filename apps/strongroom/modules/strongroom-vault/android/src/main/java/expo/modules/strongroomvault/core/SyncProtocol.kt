package expo.modules.strongroomvault.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.util.Base64

open class SyncHttpError(val status: Int, message: String = "The vault server answered with error $status. Try again later.") :
  Exception(message)

class SyncAuthError :
  SyncHttpError(401, "The vault server did not accept this sign-in. Sign in again with your master password and account key.")

class SyncOfflineError : Exception("The vault server could not be reached. Check the connection and try again.")

class SyncRollbackError :
  Exception("The vault server sent an older history than this device already has, so nothing was changed. Try again later.")

data class Prelogin(val kdf: KdfParams, val salt: String, val accountKey: Boolean)

data class WireRecord(val id: String?, val rev: Long?, val ciphertext: String?)

data class PullResponse(val header: String, val headerRev: Long, val records: List<WireRecord>, val latestRev: Long, val more: Boolean)

data class Upsert(val id: String, val baseRev: Long, val ciphertext: String)

data class PushRequest(val upserts: List<Upsert>)

sealed interface PushResult

data class PushResponse(val revs: List<Pair<String?, Long?>>, val latestRev: Long) : PushResult

data class PushConflict(val conflicts: List<Pair<String?, Long?>>) : PushResult

data class AccountCreate(val header: String, val loginHash: String, val recoveryHash: String, val readHash: String)

data class AccountUpdate(val header: String, val loginHash: String, val readHash: String, val ifRev: Long, val recoveryHash: String? = null)

interface SyncTransport {
  fun prelogin(): Prelogin?

  fun pull(token: ByteArray, since: Long): PullResponse

  fun push(token: ByteArray, req: PushRequest): PushResult

  fun putAccount(setupToken: String, body: AccountCreate): Long

  fun putAccount(token: ByteArray, body: AccountUpdate): Long
}

/** Every reply is checked here, as strongroom-core's fetchTransport does, so a server that lies gives a SyncHttpError, never a crash deep in sync. */
object SyncWire {
  const val MAX_CIPHERTEXT_CHARS = 90_000
  const val MAX_UPSERTS = 100
  val ID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
  private const val UNREADABLE = "The vault server sent a reply this device could not read. Try again later."
  private const val MAX_SAFE = 9_007_199_254_740_991L
  private val SALT = Regex("^[A-Za-z0-9+/]{22}==$")
  private val BASE64 = Regex("^[A-Za-z0-9+/]*={0,2}$")

  fun toJson(r: PushRequest): String = buildJsonObject {
    putJsonArray("upserts") {
      for (u in r.upserts) addJsonObject {
        put("id", u.id)
        put("baseRev", u.baseRev)
        put("ciphertext", u.ciphertext)
      }
    }
  }.toString()

  fun toJson(a: AccountCreate): String = buildJsonObject {
    put("header", a.header)
    put("loginHash", a.loginHash)
    put("recoveryHash", a.recoveryHash)
    put("readHash", a.readHash)
  }.toString()

  fun toJson(a: AccountUpdate): String = buildJsonObject {
    put("header", a.header)
    put("loginHash", a.loginHash)
    a.recoveryHash?.let { put("recoveryHash", it) }
    put("readHash", a.readHash)
    put("ifRev", a.ifRev)
  }.toString()

  fun prelogin(status: Int, body: String): Prelogin? {
    val d = json(status, body)
    if (status == 404) return null
    return shaped(status, d, 200) {
      val k = it.obj("kdf")
      Prelogin(KdfParams(k.int("memoryKiB"), k.int("iterations"), k.int("parallelism")), it.string("salt").takeIf(SALT::matches)!!, it.bool("accountKey"))
    }
  }

  fun pull(status: Int, body: String): PullResponse = shaped(status, json(status, body), 200) {
    val records = (it["records"] as JsonArray).map { r -> r as JsonObject }
    PullResponse(
      it.string("header"),
      it.safe("headerRev"),
      records.map { r -> WireRecord(r.text("id"), (r["rev"] as? JsonPrimitive)?.safe(), r.text("ciphertext")) },
      it.safe("latestRev"),
      it.bool("more"),
    )
  }

  fun push(status: Int, body: String): PushResult {
    val d = json(status, body)
    return if (status == 409) {
      shaped(status, d, 409) { PushConflict((it["conflicts"] as JsonArray).map { c -> idRev(c as? JsonObject) }) }
    } else {
      shaped(status, d, 200) { PushResponse((it["revs"] as JsonArray).map { r -> idRev(r as JsonObject) }, it.safe("latestRev")) }
    }
  }

  fun account(status: Int, body: String): Long = shaped(status, json(status, body), 200) { it.safe("headerRev") }

  fun toBase64(b: ByteArray): String = Base64.getEncoder().encodeToString(b)

  fun fromBase64(s: String): ByteArray? =
    if (s.length % 4 != 0 || !BASE64.matches(s)) null else try {
      Base64.getDecoder().decode(s)
    } catch (e: IllegalArgumentException) {
      null
    }

  private fun json(status: Int, body: String): JsonElement {
    if (status == 401) throw SyncAuthError()
    return try {
      Json.parseToJsonElement(body)
    } catch (e: IllegalArgumentException) {
      throw SyncHttpError(status, UNREADABLE)
    } catch (e: StackOverflowError) {
      throw SyncHttpError(status, UNREADABLE)
    }
  }

  // A missing field, a wrong type or a failed check in [read] (ClassCastException, NullPointerException, IllegalArgumentException) all mean a reply this device can't read.
  private fun <T> shaped(status: Int, d: JsonElement, expected: Int, read: (JsonObject) -> T): T {
    if (status != expected) throw SyncHttpError(status)
    return try {
      read(d as JsonObject)
    } catch (e: RuntimeException) {
      throw SyncHttpError(status, UNREADABLE)
    }
  }

  private fun JsonPrimitive.safe(): Long? = if (isString) null else longOrNull?.takeIf { it in -MAX_SAFE..MAX_SAFE }

  private fun JsonObject.safe(key: String): Long = (this[key] as JsonPrimitive).safe()!!

  private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

  private fun idRev(o: JsonObject?) = o?.text("id") to (o?.get("rev") as? JsonPrimitive)?.safe()
}
