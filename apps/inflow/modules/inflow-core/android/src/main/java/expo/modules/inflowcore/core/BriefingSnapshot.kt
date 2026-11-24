package expo.modules.inflowcore.core

import expo.modules.inflowcore.applink.SiblingPackages
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** The briefing as last built, kept in one meta key so the provider can answer without running any reader. Anything unreadable reads as [EMPTY] (builtAt 0, so it counts as stale). */
data class BriefingSnapshot(val builtAt: Long, val lines: List<BriefingLine>) {
  fun stale(now: Long): Boolean = now - builtAt > STALE_MS || builtAt > now

  fun toJson(): String = buildJsonObject {
    put("builtAt", builtAt)
    put("lines", buildJsonArray {
      lines.take(Briefing.MAX_LINES).forEach { l ->
        add(buildJsonObject {
          put("id", l.lineId)
          put("kind", l.kind)
          put("text", l.text)
          put("at", l.at)
          put("personal", l.personal)
        })
      }
    })
  }.toString()

  companion object {
    const val META = "briefingSnapshot"
    const val STALE_MS = 10 * 60 * 1000L
    val EMPTY = BriefingSnapshot(0, emptyList())

    /** Bad JSON gives [EMPTY]; a line that fails [BriefingShare.valid] is dropped; at most 20 lines are kept. */
    fun parse(json: String?): BriefingSnapshot {
      val o = runCatching { Json.parseToJsonElement(json ?: return EMPTY).jsonObject }.getOrNull() ?: return EMPTY
      val builtAt = (o["builtAt"] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull ?: return EMPTY
      val lines = (o["lines"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let(::line) } ?: return EMPTY
      return BriefingSnapshot(builtAt, lines.take(Briefing.MAX_LINES))
    }

    private fun num(o: JsonObject, k: String): Long? = (o[k] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull
    private fun str(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun line(o: JsonObject): BriefingLine? {
      val at = if (o["at"] is JsonNull) null else num(o, "at") ?: return null
      val l = BriefingLine(num(o, "id") ?: return null, str(o, "kind") ?: return null, str(o, "text") ?: return null, at, num(o, "personal")?.toInt() ?: return null)
      return l.takeIf(BriefingShare::valid)
    }
  }
}

/** What the `briefing` path serves: rows from the snapshot only, to Halo alone, and only while the owner turned sharing on. */
object BriefingShare {
  // Equal to INFLOW_BRIEFING_SHARE in packages/autopilot-contract/src/inflow-shares.ts (fixtures/briefing.share.json).
  val COLUMNS = arrayOf("line_id", "kind", "text", "at", "personal")
  const val PATH = "briefing"
  const val MAX_ROWS = Briefing.MAX_LINES

  // The two kinds that come from the health setting: dropped at serve time whenever that setting is off, whatever the snapshot holds.
  private val HEALTH_KINDS = setOf(BriefingKind.MEDICINE.key, BriefingKind.STEPS.key)
  private val KINDS = BriefingKind.values().associateBy { it.key }

  fun callerIsHalo(packages: Array<String>?): Boolean = packages != null && packages.size == 1 && packages[0] == SiblingPackages.HALO

  fun valid(l: BriefingLine): Boolean =
    l.kind in KINDS && (l.personal == 0 || l.personal == 1) && l.text.isNotBlank() && Briefing.clean(l.text, Briefing.MAX_TEXT) == l.text

  /** One cursor row, or null for a line that does not validate. A kind that is personal by nature is always served as personal. */
  fun row(l: BriefingLine): Array<Any?>? {
    val kind = KINDS[l.kind] ?: return null
    if (l.personal != 0 && l.personal != 1) return null
    val text = Briefing.clean(l.text, Briefing.MAX_TEXT).takeIf { it.isNotEmpty() } ?: return null
    return arrayOf(l.lineId, kind.key, text, l.at, if (l.personal == 1 || kind.personal == 1) 1 else 0)
  }

  fun serve(shareOn: Boolean, healthOn: Boolean, snapshot: BriefingSnapshot): List<Array<Any?>> =
    if (!shareOn) emptyList()
    else snapshot.lines.filter { healthOn || it.kind !in HEALTH_KINDS }.mapNotNull(::row).take(MAX_ROWS)
}
