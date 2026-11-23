package expo.modules.designmedia.core

import expo.modules.designmedia.applink.AppLinkGuard
import expo.modules.designmedia.applink.SiblingPackages

object AppHealth {
  const val AUTHORITY = "com.haroon.designeditor.applink"
  const val PATH = "health"
  const val APP_ID = "design-editor"
  const val LIMIT = 1
  val COLUMNS = arrayOf("app_id", "accessibility", "listener", "ai_source", "last_seen_at")
  const val AI_SOURCE_FILE = "ai-source.txt"
  const val HEARTBEAT_FILE = "last-seen-at.txt"
  private val SOURCES = setOf("hub", "own", "none")

  fun aiSource(text: String?): String = text?.trim()?.takeIf { it in SOURCES } ?: "none"

  fun lastSeen(text: String?): Long? = text?.trim()?.toLongOrNull()?.takeIf { it > 0 }

  fun rows(aiSourceText: String?, heartbeatText: String?): List<Array<Any?>> =
    listOf(arrayOf(APP_ID, null, null, aiSource(aiSourceText), lastSeen(heartbeatText)))
}

// A hand-off to a sibling starts only when the sibling check passes; otherwise nothing is sent and the caller says "not installed".
object TrustedStart {
  fun begin(trusted: () -> Boolean, start: () -> Unit): Boolean {
    if (!trusted()) return false
    start()
    return true
  }
}

object DeputyProposal {
  const val ACTION = "com.haroon.deputy.action.PROPOSE_TASK"
  const val DEPUTY_PACKAGE = SiblingPackages.DEPUTY
  const val REQUEST_CODE = 0x5C20
  val SPEC = mapOf(
    "task" to AppLinkGuard.ExtraSpec(AppLinkGuard.ExtraType.STRING, max = 300, required = true),
    "context" to AppLinkGuard.ExtraSpec(AppLinkGuard.ExtraType.STRING, max = 2000),
    "apps" to AppLinkGuard.ExtraSpec(AppLinkGuard.ExtraType.STRING_ARRAY, max = 20),
    "ref" to AppLinkGuard.ExtraSpec(AppLinkGuard.ExtraType.LONG),
  )

  fun extras(task: String, apps: List<String>): Map<String, Any>? {
    val raw = if (apps.isEmpty()) mapOf("task" to task) else mapOf("task" to task, "apps" to apps)
    return (AppLinkGuard.validateExtras(SPEC, raw) as? AppLinkGuard.ExtrasCheck.Ok)?.extras
  }

  fun outcome(resultOk: Boolean, code: String?): String = when {
    resultOk && code == "handed_over" -> "handed_over"
    code == null || code == "cancelled" -> "cancelled"
    else -> "refused"
  }
}

// Nexus's share screen (pdf-editor-mobile ShareRules.MAX_ITEMS) refuses a share of more than 10 files outright,
// and only this app's gallery photos may be granted to it, never a file from this app's own storage.
object NexusShare {
  const val PACKAGE = SiblingPackages.NEXUS
  const val MAX = 10

  fun ids(uris: List<String>, galleryBase: String): List<Long>? {
    if (uris.size !in 1..MAX) return null
    val ids = uris.map { galleryImageId(it, galleryBase) ?: return null }
    return ids.distinct().takeIf { it.size == ids.size }
  }
}

object PhotoTimes {
  const val LIMIT = 500

  fun takenAt(dateTakenMs: Long?, modifiedS: Long): Long = dateTakenMs?.takeIf { it > 0 } ?: (modifiedS * 1000)

  fun within(rows: List<Pair<Long, Long>>, fromMs: Long, toMs: Long, only: Set<Long>?): List<Pair<Long, Long>> =
    rows.filter { (id, at) -> at in fromMs until toMs && (only == null || id in only) }
      .sortedWith(compareBy({ it.second }, { it.first }))
      .take(LIMIT)
}
