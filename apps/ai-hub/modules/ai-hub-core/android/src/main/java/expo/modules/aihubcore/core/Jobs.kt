package expo.modules.aihubcore.core

data class ModelChoice(val service: Service, val model: String)

enum class Job(val default: ModelChoice, val fallback: ModelChoice?) {
  CHAT(ModelChoice(Service.GROQ, "openai/gpt-oss-120b"), ModelChoice(Service.GEMINI, "gemini-3.5-flash-lite")),
  VISION(ModelChoice(Service.GEMINI, "gemini-3.5-flash-lite"), null),
  EMBED(ModelChoice(Service.GEMINI, "gemini-embedding-001"), null),
  TRANSCRIBE(ModelChoice(Service.GROQ, "whisper-large-v3-turbo"), null),
}

// The owner may move CHAT to Gemini, so the fallback is whichever of the job's two choices sits on the other service.
fun fallbackFor(job: Job, primary: Service): ModelChoice? =
  job.fallback?.let { listOf(it, job.default).firstOrNull { c -> c.service != primary } }
