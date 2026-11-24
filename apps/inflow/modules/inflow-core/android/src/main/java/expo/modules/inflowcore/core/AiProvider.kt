package expo.modules.inflowcore.core

/** `inputTokens` includes `cachedTokens`, as OpenAI-style `prompt_tokens` does. */
data class Usage(val inputTokens: Long, val cachedTokens: Long, val outputTokens: Long)

// `waits` kinds mean AI hub was not ready and nothing reached a model (nothing billed), so callers keep their queue and tries for them.
class AiError(val kind: Kind, message: String) : Exception(message) {
  enum class Kind {
    HUB_MISSING, NOT_ALLOWED, VERSION, NO_KEY, BAD_REQUEST, SERVER, TIMEOUT;

    val waits: Boolean get() = this == HUB_MISSING || this == NOT_ALLOWED || this == VERSION || this == NO_KEY
  }
}

data class AiReply(val text: String, val usage: Usage, val inputChars: Int = 0, val model: String? = null)

data class Prices(val inputPerM: Double, val cachedPerM: Double, val outputPerM: Double) {
  /** A provider that sends no usage (all zeros) is counted at about 4 characters per token, so the daily cap still holds. */
  fun cost(u: Usage, inputChars: Int = 0, outputChars: Int = 0): Double {
    val used = if (u.inputTokens == 0L && u.cachedTokens == 0L && u.outputTokens == 0L) Usage(inputChars / 4L, 0, outputChars / 4L) else u
    return ((used.inputTokens - used.cachedTokens).coerceAtLeast(0) * inputPerM + used.cachedTokens * cachedPerM + used.outputTokens * outputPerM) / 1_000_000
  }
}

object AiPricing {
  // Google's pricing page and Groq's model cards, 2026-10-29 (as Deputy has them).
  val KNOWN: Map<String, Prices> = mapOf(
    "gemini-3.5-flash-lite" to Prices(0.30, 0.03, 2.50),
    "openai/gpt-oss-120b" to Prices(0.15, 0.075, 0.60),
    "openai/gpt-oss-20b" to Prices(0.075, 0.037, 0.30),
  )

  // The model the hub names sets the price; one Inflow does not know is priced at the dearest known model, so the daily limit still stops it.
  fun cost(r: AiReply): Double {
    fun priced(p: Prices) = p.cost(r.usage, r.inputChars, r.text.length)
    return KNOWN[r.model]?.let(::priced) ?: KNOWN.values.maxOf(::priced)
  }
}
