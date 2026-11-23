package expo.modules.inflowcore.core

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

enum class DigestKind(val title: String) { MORNING("Morning summary"), EVENING("Evening summary") }

/** [lines] are private text (shown only once the phone is unlocked); [publicText] is the only text a lock screen may show: a count, never a line. */
data class DigestContent(val kind: DigestKind, val title: String, val lines: List<String>, val publicText: String)

/** The 08:00 and 20:00 summary. Reads only through [BriefingInputs], so health reaches it only through the briefing's own gated source. */
object Digest {
  const val META = "digest"
  const val MAX_LINES = 5
  const val MAX_TEXT = 60
  const val LATE_MS = 3 * 3_600_000L
  private val MORNING_AT = LocalTime.of(8, 0)
  private val EVENING_AT = LocalTime.of(20, 0)

  /** The next 08:00 or 20:00 strictly after [now] in [zone]. */
  fun nextAt(now: Long, zone: ZoneId): Long {
    val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    return (0L..2L).flatMap { d -> slots(today.plusDays(d), zone).map { it.second } }.first { it > now }
  }

  /** The slot an alarm that fires at [now] was for: the latest one not after [now], or null when it is more than 3 hours old (too late to post). */
  fun kindAt(now: Long, zone: ZoneId): DigestKind? {
    val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    val latest = (slots(today.minusDays(1), zone) + slots(today, zone)).filter { it.second <= now }.maxByOrNull { it.second } ?: return null
    return latest.first.takeIf { now - latest.second <= LATE_MS }
  }

  /** Null when there is nothing to say: no notification is posted for an empty summary. */
  fun build(kind: DigestKind, inputs: BriefingInputs, now: Long, zone: ZoneId): DigestContent? {
    val lines = when (kind) {
      DigestKind.MORNING -> Briefing.build(inputs, now, zone).map { it.text }
      DigestKind.EVENING -> evening(inputs, now, zone)
    }.map { Briefing.clean(it, MAX_TEXT) }.filter { it.isNotEmpty() }
    if (lines.isEmpty()) return null
    return DigestContent(kind, kind.title, lines.take(MAX_LINES), publicText(kind, lines.size))
  }

  fun publicText(kind: DigestKind, count: Int): String = "$count ${if (count == 1) "thing" else "things"} ${if (kind == DigestKind.MORNING) "today" else "tonight"}"

  // Money out today (not the owner's own transfers) per currency, then the bills and meetings due tomorrow. No health, no other app's lines.
  private fun evening(inputs: BriefingInputs, now: Long, zone: ZoneId): List<String> {
    val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    val dayStart = ms(today, zone)
    val tomorrow = ms(today.plusDays(1), zone)
    val spent = inputs.txns(dayStart, tomorrow)
      .filter { it.direction == Direction.OUT && !it.own }
      .groupBy { it.currency }.mapValues { (_, l) -> l.sumOf { it.amountMinor } }
      .filterValues { it > 0 }.toSortedMap().map { (currency, minor) -> "Spent ${Briefing.money(currency, minor)} today" }
    val due = inputs.due()
      .filter { (it.kind == SuggestionKind.BILL || it.kind == SuggestionKind.EVENT) && it.dueAt >= tomorrow && it.dueAt < ms(today.plusDays(2), zone) }
      .sortedWith(compareBy({ it.dueAt }, { it.id })).take(Briefing.MAX_DUE)
      .map { SuggestionTitle.of(it.kind, null, it.dueAt, now, zone) }
    return spent + due
  }

  private fun slots(day: LocalDate, zone: ZoneId) =
    listOf(DigestKind.MORNING to ms(day, MORNING_AT, zone), DigestKind.EVENING to ms(day, EVENING_AT, zone))

  private fun ms(day: LocalDate, zone: ZoneId) = day.atStartOfDay(zone).toInstant().toEpochMilli()

  private fun ms(day: LocalDate, at: LocalTime, zone: ZoneId) = ZonedDateTime.of(day, at, zone).toInstant().toEpochMilli()
}
