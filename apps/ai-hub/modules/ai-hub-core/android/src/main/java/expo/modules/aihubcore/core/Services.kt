package expo.modules.aihubcore.core

enum class Service(val label: String, val baseUrl: String) {
  GROQ("Groq", "https://api.groq.com/openai/v1/"),
  GEMINI("Gemini", "https://generativelanguage.googleapis.com/v1beta/openai/"),
}

fun serviceOf(key: String): Service? = when {
  key.startsWith("gsk_") -> Service.GROQ
  key.startsWith("AIza") || key.startsWith("AQ.") -> Service.GEMINI
  else -> null
}

// What anyone outside the hub may see of a key: its service and last four characters.
fun labelOf(key: String): String = "${serviceOf(key)?.label ?: "Unknown"} key ending ${key.takeLast(4)}"
