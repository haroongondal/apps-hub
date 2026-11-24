package expo.modules.deputyagent.core

import expo.modules.deputyagent.applink.AppLinkGuard
import expo.modules.deputyagent.applink.AppLinkGuard.ExtraSpec
import expo.modules.deputyagent.applink.AppLinkGuard.ExtraType

/** `context` is someone else's text and only ever travels in the untrusted block; `source` comes from the verified calling package, never an extra. */
data class Proposal(val id: String, val task: String, val context: String, val apps: List<String>, val source: String) {
  fun draft(createdAt: Long): Draft = Draft.of(id, task, context, null, createdAt, source, apps)
}

object ProposeTask {
  const val ACTION = "com.haroon.deputy.action.PROPOSE_TASK"
  const val TASK_MAX = 300
  const val CONTEXT_MAX = 2000
  const val APPS_MAX = 20
  private const val SOURCE_MAX = 40
  private val PACKAGE = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$")

  val SPEC = mapOf(
    "task" to ExtraSpec(ExtraType.STRING, max = TASK_MAX, required = true),
    "context" to ExtraSpec(ExtraType.STRING, max = CONTEXT_MAX),
    "apps" to ExtraSpec(ExtraType.STRING_ARRAY, max = APPS_MAX),
    "ref" to ExtraSpec(ExtraType.LONG),
  )

  const val HANDED_OVER = "handed_over"
  const val CANCELLED = "cancelled"
  const val NOT_ALLOWED = "not_allowed"
  const val BAD_EXTRAS = "bad_extras"

  fun isPackageName(s: String) = s.length <= 200 && PACKAGE.matches(s)

  fun from(id: String, raw: Map<String, Any?>, source: String, installed: Map<String, String>): Proposal? {
    val extras = (AppLinkGuard.validateExtras(SPEC, raw) as? AppLinkGuard.ExtrasCheck.Ok)?.extras ?: return null
    val task = SharedText.clean(extras["task"] as String)
    if (task.isEmpty()) return null
    val context = SharedText.cap(SharedText.clean(extras["context"] as? String ?: ""), CONTEXT_MAX).first
    val apps = (extras["apps"] as? List<*>).orEmpty().filterIsInstance<String>().filter { isPackageName(it) && it in installed }.distinct()
    val from = SharedText.cap(SharedText.oneLine(source) ?: "another app", SOURCE_MAX).first
    return Proposal(id, task, context, apps, from)
  }
}

/** Never starts anything: it holds the proposal until the screen takes it, and tells the waiting caller once whether the owner kept it. */
object ProposalInbox {
  private var pending: Proposal? = null
  private var waiting: Pair<String, (kept: Boolean) -> Unit>? = null
  @Volatile var listener: (() -> Unit)? = null

  fun put(p: Proposal, onSettled: (kept: Boolean) -> Unit) {
    val replaced = synchronized(this) {
      val old = waiting
      pending = p
      waiting = p.id to onSettled
      old
    }
    replaced?.second?.invoke(false)
    listener?.invoke()
  }

  @Synchronized
  fun take(): Proposal? = pending.also { pending = null }

  fun settle(id: String, kept: Boolean) {
    val done = synchronized(this) { waiting?.takeIf { it.first == id }.also { if (it != null) waiting = null } }
    done?.second?.invoke(kept)
  }

  /** What a caller hears when the waiting screen is left with Back: the draft counts as handed over only once the screen has taken it. */
  @Synchronized
  fun answerOnLeaving(id: String) = if (pending?.id == id) ProposeTask.CANCELLED else ProposeTask.HANDED_OVER

  @Synchronized
  fun forget(id: String) {
    if (waiting?.first == id) waiting = null
    if (pending?.id == id) pending = null
  }
}
