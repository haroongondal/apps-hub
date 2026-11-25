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

// `fallback` is false when the request is tied to one service (it carries pictures or Gemini's signatures, or the caller named the service).
data class Route(val choice: ModelChoice, val fallback: Boolean)

// Before apiVersion 3 every job runs on the owner's choice for it. A v3 chat goes to Gemini (the vision model) when it needs Gemini or asks for it.
fun routeFor(r: Request, models: Map<Job, ModelChoice>): Route {
  val own = models.getValue(r.job)
  if (r.job != Job.CHAT || r.apiVersion < 3) return Route(own, true)
  return when (r.service ?: Service.GEMINI.takeIf { r.needsGemini }) {
    Service.GEMINI -> Route(models.getValue(Job.VISION), false)
    Service.GROQ -> Route(if (own.service == Service.GROQ) own else Job.CHAT.default, false)
    null -> Route(own, true)
  }
}
