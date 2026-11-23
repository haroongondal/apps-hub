package expo.modules.aihubcore.core

// `retryAfterMs` is the server's retry-after (sent with a 429 or 503), already in milliseconds.
data class HttpReply(val code: Int, val body: String, val retryAfterMs: Long? = null)

// Throws SocketTimeoutException for a read timeout (never re-sent: the server already has it) and IOException when the request never arrived.
fun interface Transport {
  fun post(url: String, headers: Map<String, String>, body: ByteArray, contentType: String): HttpReply
}
