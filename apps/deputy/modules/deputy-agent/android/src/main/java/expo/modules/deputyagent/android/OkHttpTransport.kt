package expo.modules.deputyagent.android

import expo.modules.deputyagent.core.HttpReply
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/** The `post` for `OpenAiCompatProvider`. Safety rule 6: cancelling the coroutine (Stop) cancels the HTTP call. */
object OkHttpTransport {
  private val client = OkHttpClient.Builder().readTimeout(60, TimeUnit.SECONDS).callTimeout(90, TimeUnit.SECONDS).build()
  private val json = "application/json".toMediaType()

  suspend fun post(url: String, headers: Map<String, String>, body: String): HttpReply = suspendCancellableCoroutine { c ->
    val request = Request.Builder().url(url).apply { headers.forEach { (k, v) -> header(k, v) } }.post(body.toRequestBody(json)).build()
    val call = client.newCall(request)
    c.invokeOnCancellation { call.cancel() }
    call.enqueue(
      object : Callback {
        override fun onFailure(call: Call, e: IOException) = c.resumeWithException(e)

        // OkHttp only logs an IOException thrown here and never calls onFailure, so it must be passed on by hand.
        override fun onResponse(call: Call, response: Response) = response.use {
          try {
            c.resume(HttpReply(it.code, it.body?.string().orEmpty(), it.header("retry-after")?.toDoubleOrNull()?.let { s -> (s * 1_000).toLong() }))
          } catch (e: IOException) {
            c.resumeWithException(e)
          }
        }
      },
    )
  }
}
