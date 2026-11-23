package expo.modules.nexuslinks.core

import expo.modules.nexuslinks.applink.AppLinkGuard
import expo.modules.nexuslinks.applink.AppLinkGuard.ExtraSpec
import expo.modules.nexuslinks.applink.AppLinkGuard.ExtraType

object Links {
  const val DONE = "done"
  const val CANCELLED = "cancelled"
  const val FAILED = "failed"
  const val UNAVAILABLE = "unavailable"
  const val REFUSED = "refused"

  // Lower 16 bits only: FragmentActivity refuses larger request codes.
  const val REQUEST_CODE = 0x4e58

  data class Target(val pkg: String, val spec: Map<String, ExtraSpec>)

  val TARGETS: Map<String, Target> = mapOf(
    "com.haroon.inflow.action.ADD_TODO" to Target(
      "com.haroon.inflow",
      mapOf(
        "title" to ExtraSpec(ExtraType.STRING, max = 200, required = true),
        "dueAt" to ExtraSpec(ExtraType.LONG),
        "note" to ExtraSpec(ExtraType.STRING, max = 500),
        "source" to ExtraSpec(ExtraType.STRING, max = 40),
      ),
    ),
    "com.haroon.deputy.action.PROPOSE_TASK" to Target(
      "com.haroon.deputy",
      mapOf(
        "task" to ExtraSpec(ExtraType.STRING, max = 300, required = true),
        "context" to ExtraSpec(ExtraType.STRING, max = 2000),
        "apps" to ExtraSpec(ExtraType.STRING_ARRAY, max = 20),
        "ref" to ExtraSpec(ExtraType.LONG),
      ),
    ),
  )

  data class Result(val status: String, val code: String? = null) {
    fun toMap(): Map<String, Any?> = if (code == null) mapOf("status" to status) else mapOf("status" to status, "code" to code)
  }

  sealed interface Plan {
    data class Start(val pkg: String, val action: String, val extras: Map<String, Any>) : Plan
    data class Answer(val result: Result) : Plan
  }

  fun plan(action: String, raw: Map<String, Any?>): Plan {
    val target = TARGETS[action] ?: return Plan.Answer(Result(FAILED, "unknown_action"))
    return when (val check = AppLinkGuard.validateExtras(target.spec, raw)) {
      is AppLinkGuard.ExtrasCheck.Ok -> Plan.Start(target.pkg, action, check.extras)
      is AppLinkGuard.ExtrasCheck.Rejected -> Plan.Answer(Result(FAILED, "bad_extras"))
    }
  }

  private val CODE = Regex("^[a-z0-9_]{1,40}$")

  // Inflow's AddTodoActivity and Deputy's ProposeTaskActivity put `status` and `code` extras on the result. `done` needs RESULT_OK too.
  fun result(resultOk: Boolean, status: String?, code: String?): Result {
    val c = code?.takeIf { CODE.matches(it) }
    return when {
      status == FAILED -> Result(FAILED, c)
      resultOk && (status == null || status == DONE) -> Result(DONE, c)
      else -> Result(CANCELLED, c)
    }
  }
}
