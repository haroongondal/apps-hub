package expo.modules.inflowcore.core

import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

data class BriefingLine(val lineId: Long, val kind: String, val text: String, val at: Long?, val personal: Int)

enum class BriefingKind(val code: Long, val key: String, val personal: Int) {
  BILL(1, "bill", 0), EVENT(2, "event", 0), SPENT(3, "spent", 1), MEDICINE(4, "medicine", 1), STEPS(5, "steps", 1),
  HOME(6, "home", 1), CARDS(7, "cards", 0), TASKS(8, "tasks", 0), NEXUS(9, "nexus", 0),
}

data class DueThing(val id: Long, val kind: SuggestionKind, val dueAt: Long)

data class AppLine(val kind: BriefingKind, val text: String)

interface BriefingHealth {
  fun nextDoseAt(now: Long, zone: ZoneId): Long?

  fun steps(day: LocalDate): Long?
}

// health() is a separate source so that, with the setting off, the builder never even opens the health tables (VitalsSqlWiringTest).
interface BriefingInputs {
  val healthOn: Boolean

  fun due(): List<DueThing>

  fun txns(from: Long, to: Long): List<Txn>

  fun health(): BriefingHealth

  fun others(): List<AppLine>
}

object Briefing {
  const val HEALTH_META = "healthInBriefing"
  const val SHARE_META = "briefingShare"
  const val MAX_TEXT = 60
  const val MAX_LINES = 20
  const val MAX_DUE = 5
  const val SOON_DAYS = 3L
  // lineId = kind code * ID_BLOCK + n (n: suggestion id for a bill or event, else the place within its kind): unique, stable while the same things are due, below 2^53.
  const val ID_BLOCK = 1_000_000_000_000L

  fun on(meta: String?): Boolean = meta == "1"

  fun build(inputs: BriefingInputs, now: Long, zone: ZoneId): List<BriefingLine> {
    val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    val dayStart = ms(today, zone)
    val soonEnd = ms(today.plusDays(SOON_DAYS), zone)
    val out = mutableListOf<BriefingLine>()

    inputs.due()
      .filter { (it.kind == SuggestionKind.BILL || (it.kind == SuggestionKind.EVENT && it.dueAt > now)) && it.dueAt >= dayStart && it.dueAt < soonEnd }
      .sortedWith(compareBy({ it.dueAt }, { it.id })).take(MAX_DUE)
      .forEach { d ->
        val kind = if (d.kind == SuggestionKind.BILL) BriefingKind.BILL else BriefingKind.EVENT
        out += line(kind, d.id, SuggestionTitle.of(d.kind, null, d.dueAt, now, zone), d.dueAt)
      }

    inputs.txns(ms(today.minusDays(1), zone), dayStart)
      .filter { it.direction == Direction.OUT && !it.own }
      .groupBy { it.currency }.mapValues { (_, l) -> l.sumOf { it.amountMinor } }
      .filterValues { it > 0 }.toSortedMap().entries
      .forEachIndexed { i, (currency, minor) -> out += line(BriefingKind.SPENT, i.toLong(), "Spent ${money(currency, minor)} yesterday", null) }

    if (inputs.healthOn) out += healthLines(inputs.health(), now, today, zone)

    inputs.others().groupBy { it.kind }.toSortedMap().forEach { (kind, lines) ->
      lines.forEachIndexed { i, l -> out += line(kind, i.toLong(), l.text, null) }
    }
    return out.take(MAX_LINES)
  }

  private fun healthLines(h: BriefingHealth, now: Long, today: LocalDate, zone: ZoneId): List<BriefingLine> = listOfNotNull(
    h.nextDoseAt(now, zone)?.let { at ->
      val day = Instant.ofEpochMilli(at).atZone(zone)
      val time = String.format(Locale.ENGLISH, "%02d:%02d", day.hour, day.minute)
      line(BriefingKind.MEDICINE, 0, if (day.toLocalDate() == today) "Medicine at $time" else "Medicine at $time tomorrow", at)
    },
    h.steps(today)?.takeIf { it > 0 }?.let { line(BriefingKind.STEPS, 0, String.format(Locale.ENGLISH, "%d steps", it), null) },
  )

  private fun line(kind: BriefingKind, n: Long, text: String, at: Long?) =
    BriefingLine(kind.code * ID_BLOCK + n, kind.key, clean(text, MAX_TEXT), at, kind.personal)

  fun clean(text: String, max: Int): String =
    text.replace(Regex("[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]"), " ").replace(Regex("\\s+"), " ").trim().take(max).trim()

  fun money(currency: String, minor: Long): String =
    if (minor % 100 == 0L) String.format(Locale.ENGLISH, "%s %,d", currency, minor / 100)
    else String.format(Locale.ENGLISH, "%s %,.2f", currency, BigDecimal.valueOf(minor, 2))

  private fun ms(day: LocalDate, zone: ZoneId) = day.atStartOfDay(zone).toInstant().toEpochMilli()
}
