package expo.modules.aihubcore.android

import expo.modules.aihubcore.core.HttpReply
import expo.modules.aihubcore.core.Transport
import java.io.InterruptedIOException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class OkHttpTransport(
  private val client: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(60, TimeUnit.SECONDS)
    .callTimeout(120, TimeUnit.SECONDS)
    .build(),
) : Transport {
  override fun post(url: String, headers: Map<String, String>, body: ByteArray, contentType: String): HttpReply {
    val request = Request.Builder().url(url).apply { headers.forEach { (k, v) -> header(k, v) } }
      .post(body.toRequestBody(contentType.toMediaType())).build()
    try {
      client.newCall(request).execute().use { r ->
        val wait = r.header("retry-after")
        val ms = wait?.trim()?.toDoubleOrNull()?.let { (it * 1_000).toLong() }
          ?: r.headers.getDate("retry-after")?.let { it.time - System.currentTimeMillis() }
        return HttpReply(r.code, r.body?.string().orEmpty(), ms?.coerceAtLeast(0))
      }
    } catch (e: SocketTimeoutException) {
      throw e
    } catch (e: InterruptedIOException) {
      // The call timeout fires after the request was sent, so it counts as a read timeout and is never re-sent.
      throw SocketTimeoutException(e.message)
    }
  }
}
