package expo.modules.aihubcore.core

// `retryAfterMs` is set on RATE: how long the provider found the service needs before it takes requests again.
class AiError(val kind: Kind, message: String, val retryAfterMs: Long? = null) : Exception(message) {
  enum class Kind { AUTH, RATE, BAD_REQUEST, SERVER, OFFLINE, TIMEOUT }
}
