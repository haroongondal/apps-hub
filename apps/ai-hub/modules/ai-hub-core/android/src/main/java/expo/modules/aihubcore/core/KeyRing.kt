package expo.modules.aihubcore.core

import java.util.concurrent.ConcurrentHashMap

enum class Verdict { SUCCESS, NEXT_KEY, STOP }

private val UNKNOWN_KEY = Regex("API key not valid|API_KEY_INVALID")

// Gemini answers 400, not 401, for a key it does not know.
fun isRefused(r: HttpReply) = r.code == 401 || r.code == 403 || (r.code == 400 && UNKNOWN_KEY.containsMatchIn(r.body))

fun isLimited(r: HttpReply) = r.code == 429

fun verdictOf(r: HttpReply): Verdict = when {
  r.code in 200..299 -> Verdict.SUCCESS
  isRefused(r) || isLimited(r) -> Verdict.NEXT_KEY
  else -> Verdict.STOP
}

enum class Exhausted { LIMITED, REFUSED }

// A limit beats a refusal, since waiting can fix it.
fun exhausted(anyLimited: Boolean) = if (anyLimited) Exhausted.LIMITED else Exhausted.REFUSED

class KeyRing(keys: List<String>) {
  private val byService: Map<Service, List<String>> = keys.map(String::trim).filter(String::isNotEmpty).distinct()
    .mapNotNull { k -> serviceOf(k)?.let { it to k } }
    .groupBy({ it.first }, { it.second })
  private val inUse = ConcurrentHashMap<Service, Int>()

  val all: List<String> get() = byService.values.flatten()

  fun keys(service: Service): List<String> = byService[service].orEmpty()

  fun current(service: Service): Int = inUse[service] ?: 0

  fun order(service: Service): List<Int> {
    val n = keys(service).size
    return List(n) { (current(service) + it) % n }
  }

  fun use(service: Service, index: Int) {
    inUse[service] = index
  }
}
