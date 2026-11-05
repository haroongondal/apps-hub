package expo.modules.strongroomvault.android

import expo.modules.strongroomvault.core.AccountCreate
import expo.modules.strongroomvault.core.AccountUpdate
import expo.modules.strongroomvault.core.PushRequest
import expo.modules.strongroomvault.core.SyncOfflineError
import expo.modules.strongroomvault.core.SyncTransport
import expo.modules.strongroomvault.core.SyncWire
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

private const val CONNECT_MS = 15_000
private const val READ_MS = 30_000
private const val PAGE = 100
private const val MAX_BODY = 16 * 1024 * 1024

internal class HttpSyncTransport(baseUrl: String) : SyncTransport {
  private val base: URL

  init {
    require(baseUrl.startsWith("https://", ignoreCase = true)) { "Sync talks to the vault server over HTTPS only" }
    base = URL(baseUrl)
  }

  override fun prelogin() = call("GET", "/v1/prelogin", null, null).let { (s, b) -> SyncWire.prelogin(s, b) }

  override fun pull(token: ByteArray, since: Long) =
    call("GET", "/v1/records?since=$since&limit=$PAGE", bearer(token), null).let { (s, b) -> SyncWire.pull(s, b) }

  override fun push(token: ByteArray, req: PushRequest) =
    call("POST", "/v1/records", bearer(token), SyncWire.toJson(req)).let { (s, b) -> SyncWire.push(s, b) }

  override fun putAccount(setupToken: String, body: AccountCreate) =
    call("PUT", "/v1/account", "Bearer $setupToken", SyncWire.toJson(body)).let { (s, b) -> SyncWire.account(s, b) }

  override fun putAccount(token: ByteArray, body: AccountUpdate) =
    call("PUT", "/v1/account", bearer(token), SyncWire.toJson(body)).let { (s, b) -> SyncWire.account(s, b) }

  private fun bearer(token: ByteArray) = "Bearer " + SyncWire.toBase64(token)

  // No redirects: one could carry the bearer token to another host or to plain http.
  private fun call(method: String, path: String, auth: String?, body: String?): Pair<Int, String> {
    val c = URL(base, path).openConnection() as HttpURLConnection
    try {
      c.requestMethod = method
      c.connectTimeout = CONNECT_MS
      c.readTimeout = READ_MS
      c.instanceFollowRedirects = false
      c.useCaches = false
      auth?.let { c.setRequestProperty("Authorization", it) }
      if (body != null) {
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      }
      val status = c.responseCode
      return status to ((if (status >= 400) c.errorStream else c.inputStream)?.use(::read) ?: "")
    } catch (e: IOException) {
      throw SyncOfflineError()
    } finally {
      c.disconnect()
    }
  }

  // A page of 100 records is at most about 9 MB; a longer body becomes "", which SyncWire refuses as unreadable.
  private fun read(s: InputStream): String {
    val bytes = s.readNBytes(MAX_BODY + 1)
    return if (bytes.size > MAX_BODY) "" else String(bytes, Charsets.UTF_8)
  }
}
