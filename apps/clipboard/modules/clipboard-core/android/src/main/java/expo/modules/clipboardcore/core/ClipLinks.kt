package expo.modules.clipboardcore.core

import expo.modules.clipboardcore.applink.AppLinkGuard

object ClipLinks {
  const val AUTHORITY = "com.haroon.clipboard.applink"
  const val NEXUS_PACKAGE = "com.haroon.pdfeditor"

  const val HEALTH_PATH = "health"
  val HEALTH_COLUMNS = arrayOf("app_id", "accessibility", "listener", "ai_source", "last_seen_at")
  const val HEALTH_MAX_ROWS = 1

  const val PINNED_PATH = "pinned"
  val PINNED_COLUMNS = arrayOf("id", "text", "pinned_at", "from_app")
  const val PINNED_MAX_ROWS = 200
  const val TEXT_MAX = 2000

  fun health(accessibilityOn: Boolean, lastSeenAt: Long?): Array<Any?> =
    arrayOf("clipboard", if (accessibilityOn) 1 else 0, null, "none", lastSeenAt)

  fun pinnedSince(segments: List<String>): Long? = when {
    segments == listOf(PINNED_PATH) -> 0L
    segments.size == 2 && segments[0] == PINNED_PATH && segments[1].length in 1..15 && segments[1].all { it in '0'..'9' } -> segments[1].toLong()
    else -> null
  }

  fun pinnedReader(switchOn: Boolean, callingPackage: String?): Boolean = switchOn && callingPackage == NEXUS_PACKAGE

  // Re-checked per row whatever the SQL returned: hidden kinds (secret, code), images and files never cross.
  fun pinnedRow(id: Long, kind: String, text: String?, pinned: Boolean, pinnedAt: Long, source: String?): Array<Any?>? {
    if (!pinned || kind != ClipKind.TEXT.id || text == null) return null
    return arrayOf(id, cap(text), pinnedAt, source ?: "")
  }

  private fun cap(text: String): String {
    if (text.length <= TEXT_MAX) return text
    val end = if (Character.isHighSurrogate(text[TEXT_MAX - 1])) TEXT_MAX - 1 else TEXT_MAX
    return text.substring(0, end)
  }
}

object InflowTodo {
  const val ACTION = "com.haroon.inflow.action.ADD_TODO"
  const val INFLOW_PACKAGE = "com.haroon.inflow"
  // Lower 16 bits only: FragmentActivity refuses larger request codes.
  const val REQUEST_CODE = 0x4342
  val SPEC = mapOf(
    "title" to AppLinkGuard.ExtraSpec(AppLinkGuard.ExtraType.STRING, max = 200, required = true),
    "dueAt" to AppLinkGuard.ExtraSpec(AppLinkGuard.ExtraType.LONG),
    "note" to AppLinkGuard.ExtraSpec(AppLinkGuard.ExtraType.STRING, max = 500),
    "source" to AppLinkGuard.ExtraSpec(AppLinkGuard.ExtraType.STRING, max = 40),
  )

  fun extras(title: String, note: String, source: String): Map<String, Any>? =
    (AppLinkGuard.validateExtras(SPEC, mapOf("title" to title, "note" to note, "source" to source)) as? AppLinkGuard.ExtrasCheck.Ok)?.extras

  // Null means the start went out. An untrusted Inflow counts as not installed and nothing is sent (decision is a parameter so a JVM test can pass a fake).
  fun launch(trusted: Boolean, start: () -> Unit): String? {
    if (!trusted) return "not_installed"
    return try {
      start()
      null
    } catch (_: android.content.ActivityNotFoundException) {
      "not_installed"
    } catch (_: SecurityException) {
      "refused"
    }
  }

  fun outcome(resultOk: Boolean, code: String?): String = when {
    resultOk && code == "added" -> "added"
    code == null || code == "cancelled" -> "cancelled"
    else -> "refused"
  }
}
