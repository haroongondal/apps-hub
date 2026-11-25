package expo.modules.aihubcore.core

// `retryAfterMs` is set on RATE: how long the provider found the service needs before it takes requests again.
// `service`, `httpCode`, `fellBack` and `detail` feed the failed-request row in Recent requests; they hold no text from the provider (`detail` is field names and counts only).
class AiError(
  val kind: Kind,
  message: String,
  val retryAfterMs: Long? = null,
  val service: Service? = null,
  val httpCode: Int? = null,
  val fellBack: Boolean = false,
  val detail: String? = null,
) : Exception(message) {
  enum class Kind { AUTH, RATE, BAD_REQUEST, SERVER, OFFLINE, TIMEOUT }
}
