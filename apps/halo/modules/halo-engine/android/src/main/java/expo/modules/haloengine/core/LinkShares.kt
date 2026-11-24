package expo.modules.haloengine.core

import kotlin.math.abs

data class ReadShare(val name: String, val authority: String, val path: String, val columns: List<String>, val maxRows: Int)

data class ShieldRow(val on: Boolean, val untrustedNow: Boolean, val since: Long)
data class NewDeviceRow(val firstSeenAt: Long, val label: String, val acknowledged: Boolean)
data class HomeRow(val person: String, val present: Boolean, val lastSeenAt: Long)
data class DeputyWaitingRow(val id: Long, val label: String, val dueAt: Long?, val state: String)
data class SuggestionRow(val id: Long, val kind: String, val title: String, val dueAt: Long?, val state: String, val createdAt: Long, val expiresAt: Long)
data class BriefingLine(val lineId: Long, val kind: String, val text: String, val at: Long?, val personal: Boolean)

typealias RawRow = Map<String, Any?>

/** Tolerant readers for rows from other apps: a bad row is skipped (never thrown on), extra columns are ignored, at most maxRows are read, and text is cleaned before any screen sees it. */
object LinkShares {
  private val HEALTH = listOf("app_id", "accessibility", "listener", "ai_source", "last_seen_at")

  val WHO_IS_HOME = ReadShare("who_is_home", "com.haroon.netlens.applink", "who_is_home", listOf("person", "present", "last_seen_at"), 16)
  val NEW_DEVICES = ReadShare("new_devices", "com.haroon.netlens.applink", "new_devices", listOf("first_seen_at", "label", "acknowledged"), 200)
  val SHIELD = ReadShare("shield", "com.haroon.opentunnel.applink", "shield", listOf("on", "untrusted_now", "since"), 1)
  val TUNNEL_HEALTH = ReadShare("tunnel_health", "com.haroon.opentunnel.applink", "health", HEALTH, 1)
  val DEPUTY_WAITING = ReadShare("deputy_waiting", "com.haroon.deputy.applink", "waiting", listOf("id", "label", "due_at", "state"), 100)
  val SUGGESTIONS = ReadShare(
    "suggestions", "com.haroon.inflow.autopilot", "suggestions",
    listOf("id", "kind", "title", "item_id", "due_at", "state", "created_at", "expires_at"), 200,
  )
  // The brief named the last column `private`, which defineShare refuses as a column name, so Halo reads `personal`.
  val BRIEFING = ReadShare("briefing", "com.haroon.inflow.autopilot", "briefing", listOf("line_id", "kind", "text", "at", "personal"), 20)

  val ALL = listOf(WHO_IS_HOME, NEW_DEVICES, SHIELD, TUNNEL_HEALTH, DEPUTY_WAITING, SUGGESTIONS, BRIEFING)

  const val MAX_TEXT = 60
  private const val MAX_SAFE = 9007199254740991L

  fun shield(raw: List<RawRow>): ShieldRow? =
    rows(raw, SHIELD) { ShieldRow(need(flag(it, "on")), need(flag(it, "untrusted_now")), need(long(it, "since"))) }.firstOrNull()

  fun lastSeenAt(raw: List<RawRow>, appId: String): Long? =
    rows(raw, TUNNEL_HEALTH) { if (it["app_id"] == appId) long(it, "last_seen_at") else null }.firstOrNull()

  fun newDevices(raw: List<RawRow>): List<NewDeviceRow> =
    rows(raw, NEW_DEVICES) { NewDeviceRow(need(long(it, "first_seen_at")), text(it, "label") ?: "", need(flag(it, "acknowledged"))) }

  fun home(raw: List<RawRow>): List<HomeRow> =
    rows(raw, WHO_IS_HOME) { HomeRow(need(text(it, "person")), need(flag(it, "present")), need(long(it, "last_seen_at"))) }

  fun deputyWaiting(raw: List<RawRow>): List<DeputyWaitingRow> = rows(raw, DEPUTY_WAITING) {
    DeputyWaitingRow(need(long(it, "id")), need(text(it, "label")), optLong(it, "due_at"), need(text(it, "state")))
  }

  fun suggestions(raw: List<RawRow>): List<SuggestionRow> = rows(raw, SUGGESTIONS) {
    SuggestionRow(
      need(long(it, "id")), need(text(it, "kind")), need(text(it, "title")), optLong(it, "due_at"),
      need(text(it, "state")), need(long(it, "created_at")), need(long(it, "expires_at")),
    )
  }

  fun briefing(raw: List<RawRow>): List<BriefingLine> = rows(raw, BRIEFING) {
    BriefingLine(need(long(it, "line_id")), need(text(it, "kind")), need(text(it, "text")), optLong(it, "at"), need(flag(it, "personal")))
  }

  private class Bad : RuntimeException()

  private fun <T> need(v: T?): T = v ?: throw Bad()

  private fun <T> rows(raw: List<RawRow>, share: ReadShare, parse: (RawRow) -> T?): List<T> =
    raw.take(share.maxRows).mapNotNull { runCatching { parse(it) }.getOrNull() }

  internal fun long(r: RawRow, k: String): Long? = when (val v = r[k]) {
    is Long -> v
    is Int -> v.toLong()
    is Double -> v.takeIf { it.isFinite() && it == Math.floor(it) && abs(it) <= MAX_SAFE }?.toLong()
    else -> null
  }?.takeIf { abs(it) <= MAX_SAFE }

  private fun optLong(r: RawRow, k: String): Long? = if (r[k] == null) null else need(long(r, k))

  private fun flag(r: RawRow, k: String): Boolean? = when (long(r, k)) {
    0L -> false
    1L -> true
    else -> null
  }

  private fun text(r: RawRow, k: String): String? = (r[k] as? String)?.let(::clean)

  fun clean(s: String): String? {
    val flat = s.replace(CONTROL, " ").replace(SPACES, " ").trim()
    val cut = flat.take(MAX_TEXT).let { if (it.lastOrNull()?.isHighSurrogate() == true) it.dropLast(1) else it }.trim()
    return cut.ifEmpty { null }
  }

  private val CONTROL = Regex("[\\p{Cc}\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\u2028\\u2029]")
  private val SPACES = Regex("\\s+")
}
