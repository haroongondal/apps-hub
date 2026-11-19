package expo.modules.aihubcore.core

class AiError(val kind: Kind, message: String) : Exception(message) {
  enum class Kind { AUTH, RATE, BAD_REQUEST, SERVER, OFFLINE, TIMEOUT }
}
